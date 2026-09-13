export const ACCOUNTING_RATE_UI_STATUS = Object.freeze({
  IDLE: 'AUTO_IDLE',
  LOADING: 'AUTO_LOADING',
  AVAILABLE: 'AUTO_AVAILABLE',
  UNAVAILABLE: 'AUTO_UNAVAILABLE',
  STALE: 'AUTO_STALE'
});

const USDT_VND_PROVENANCE = 'COINGECKO_USDT_VND';
export const CURRENT_ACCOUNTING_RATE_MAX_AGE_MS = 10 * 60 * 1000;
export const HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS = 60 * 60 * 1000;

function positiveFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function shouldResolveUsdtVndAccountingRate({
  isCrypto,
  settlementMode,
  priceCurrency
} = {}) {
  return isCrypto === true
    && settlementMode === 'EXTERNAL_SETTLEMENT'
    && priceCurrency === 'USDT';
}

export function getUsdtVndAccountingPresentation({
  isAutomatic,
  isSimplifiedCryptoExternal,
  status
} = {}) {
  const isPending = isAutomatic === true && [
    ACCOUNTING_RATE_UI_STATUS.IDLE,
    ACCOUNTING_RATE_UI_STATUS.LOADING
  ].includes(status);
  const showAutomatic = isAutomatic === true && [
    ACCOUNTING_RATE_UI_STATUS.IDLE,
    ACCOUNTING_RATE_UI_STATUS.LOADING,
    ACCOUNTING_RATE_UI_STATUS.AVAILABLE
  ].includes(status);

  return {
    isPending,
    showAutomatic,
    showManual: isSimplifiedCryptoExternal === true && !showAutomatic
  };
}

export function buildUsdtVndAccountingRatePath(at = null) {
  const query = new URLSearchParams({ base: 'USDT', quote: 'VND' });
  if (at) query.set('at', at);
  return `/api/accounting-rate?${query.toString()}`;
}

function normalizeIntentNumber(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : String(value ?? '');
}

/**
 * Builds a stable semantic identity for one automatic accounting-rate intent.
 * Provider resolution must not depend on React object identity.
 */
export function buildUsdtVndAccountingRateIntentKey({
  assetId,
  assetSymbol,
  priceCurrency,
  settlementMode,
  executionUnitPrice,
  isCustomTime,
  executedAt
} = {}) {
  return JSON.stringify({
    assetIdentity: typeof assetId === 'string' && assetId.trim()
      ? assetId.trim()
      : String(assetSymbol || '').trim().toUpperCase(),
    priceCurrency: String(priceCurrency || '').trim().toUpperCase(),
    settlementMode: String(settlementMode || '').trim().toUpperCase(),
    executionUnitPrice: normalizeIntentNumber(executionUnitPrice),
    timestampMode: isCustomTime === true ? 'HISTORICAL' : 'CURRENT',
    executedAt: isCustomTime === true ? String(executedAt || '').trim() : null
  });
}

export function normalizeUsdtVndAccountingRate(data) {
  const availability = typeof data?.availability === 'string'
    ? data.availability.trim().toLowerCase()
    : 'unavailable';
  const common = {
    quote: null,
    reason: typeof data?.reason === 'string' && data.reason.trim()
      ? data.reason.trim()
      : 'ACCOUNTING_RATE_UNAVAILABLE'
  };

  if (availability === 'stale') {
    return {
      status: ACCOUNTING_RATE_UI_STATUS.STALE,
      ...common
    };
  }

  const rate = typeof data?.rate === 'number'
    ? positiveFiniteNumber(data.rate)
    : null;
  const isCanonicalAvailable = availability === 'available'
    && data?.baseCurrency === 'USDT'
    && data?.quoteCurrency === 'VND'
    && data?.provider === 'CoinGecko'
    && data?.provenance === USDT_VND_PROVENANCE
    && validTimestamp(data?.observedAt)
    && rate !== null;

  if (!isCanonicalAvailable) {
    return {
      status: ACCOUNTING_RATE_UI_STATUS.UNAVAILABLE,
      ...common
    };
  }

  return {
    status: ACCOUNTING_RATE_UI_STATUS.AVAILABLE,
    quote: {
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      rate,
      provider: 'CoinGecko',
      provenance: USDT_VND_PROVENANCE,
      observedAt: new Date(data.observedAt).toISOString(),
      requestedAt: validTimestamp(data.requestedAt)
        ? new Date(data.requestedAt).toISOString()
        : null,
      observationDeltaMs: Number.isFinite(data.observationDeltaMs)
        ? data.observationDeltaMs
        : null,
      mode: data.mode === 'HISTORICAL' ? 'HISTORICAL' : 'CURRENT'
    },
    reason: null
  };
}

export function deriveUsdtVndAccountingPrice(executionUnitPrice, rateState) {
  if (rateState?.status !== ACCOUNTING_RATE_UI_STATUS.AVAILABLE) return null;
  const executionPrice = positiveFiniteNumber(executionUnitPrice);
  const rate = positiveFiniteNumber(rateState?.quote?.rate);
  if (executionPrice === null || rate === null) return null;
  return executionPrice * rate;
}

/**
 * Revalidates an available quote immediately before its first dispatch.
 * Historical observations are governed by their delta from executedAt rather
 * than by wall-clock age.
 */
export function isUsdtVndAccountingQuoteFreshAtSubmission(rateState, nowMs = Date.now()) {
  if (rateState?.status !== ACCOUNTING_RATE_UI_STATUS.AVAILABLE) return false;

  if (rateState.quote?.mode === 'HISTORICAL') {
    const deltaMs = rateState.quote?.observationDeltaMs;
    return Number.isFinite(deltaMs)
      && deltaMs >= 0
      && deltaMs <= HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS;
  }

  const observedMs = Date.parse(rateState.quote?.observedAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return false;
  const ageMs = nowMs - observedMs;
  return ageMs >= 0 && ageMs <= CURRENT_ACCOUNTING_RATE_MAX_AGE_MS;
}

export function accountingRateFallbackMessage(reason) {
  const messages = {
    PROVIDER_NOT_ENABLED: 'Tự động quy đổi chưa được bật cho môi trường này.',
    OBSERVATION_STALE: 'Dữ liệu USDT/VND đã quá cũ để tự động hạch toán.',
    OBSERVATION_TOO_DISTANT: 'Không có quan sát USDT/VND đủ gần thời gian giao dịch.',
    NO_HISTORICAL_OBSERVATION: 'Không có dữ liệu USDT/VND lịch sử phù hợp.',
    PROVIDER_RATE_LIMITED: 'CoinGecko đang giới hạn yêu cầu.',
    PROVIDER_TIMEOUT: 'CoinGecko phản hồi quá chậm.',
    PROVIDER_ACCESS_DENIED: 'CoinGecko chưa cho phép môi trường này dùng dữ liệu quy đổi.',
    HISTORICAL_DATA_UNAVAILABLE: 'Gói dữ liệu CoinGecko hiện không cung cấp quan sát lịch sử được yêu cầu.',
    EXECUTED_AT_REQUIRED: 'Vui lòng chọn thời gian giao dịch để lấy tỷ giá lịch sử.'
  };
  return messages[reason]
    || 'Không thể tự động lấy USDT/VND. Vui lòng nhập giá hạch toán VND.';
}
