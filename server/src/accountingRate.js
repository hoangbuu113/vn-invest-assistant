import {
  getCoinGeckoCurrentUsdtVndObservation,
  getCoinGeckoHistoricalUsdtVndObservations
} from './providers/coingecko.js';

export const USDT_VND_ACCOUNTING_PROVENANCE = 'COINGECKO_USDT_VND';
export const CURRENT_ACCOUNTING_RATE_MAX_AGE_MS = 10 * 60 * 1000;
export const HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS = 60 * 60 * 1000;
const HISTORICAL_QUERY_PADDING_MS = 2 * 60 * 60 * 1000;
const ACCOUNTING_PRICE_ABSOLUTE_TOLERANCE_VND = 0.05;
const ACCOUNTING_PRICE_RELATIVE_TOLERANCE = 0.0001;

function normalizeCurrency(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isCoinGeckoAccountingRateEnabled(
  value = process.env.COINGECKO_ACCOUNTING_RATE_ENABLED
) {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function positiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Validates the client-carried fields for the server-authoritative CoinGecko
 * provenance before an RPC write. The feature flag is intentionally enforced
 * here as well as on the read-only resolver endpoint.
 */
export function validateCoinGeckoAccountingRateWrite({
  price,
  executionUnitPrice,
  priceCurrency,
  settlementMode,
  fxRateToVnd,
  fxObservedAt
} = {}, { enabled } = {}) {
  const errors = [];

  if (!isCoinGeckoAccountingRateEnabled(enabled)) {
    errors.push('COINGECKO_USDT_VND provenance is unavailable while automatic accounting rates are disabled');
  }
  if (normalizeCurrency(priceCurrency) !== 'USDT') {
    errors.push('COINGECKO_USDT_VND provenance requires priceCurrency USDT');
  }
  if (typeof settlementMode !== 'string' || settlementMode.trim().toUpperCase() !== 'EXTERNAL_SETTLEMENT') {
    errors.push('COINGECKO_USDT_VND provenance requires EXTERNAL_SETTLEMENT');
  }

  const executionPrice = positiveFiniteNumber(executionUnitPrice);
  const rate = positiveFiniteNumber(fxRateToVnd);
  const accountingPrice = positiveFiniteNumber(price);
  if (executionPrice === null || rate === null || accountingPrice === null) {
    errors.push('COINGECKO_USDT_VND provenance requires positive executionUnitPrice, fxRateToVnd, and price');
  } else {
    const expectedAccountingPrice = executionPrice * rate;
    const difference = Math.abs(accountingPrice - expectedAccountingPrice);
    if (
      difference > ACCOUNTING_PRICE_ABSOLUTE_TOLERANCE_VND
      && difference / expectedAccountingPrice > ACCOUNTING_PRICE_RELATIVE_TOLERANCE
    ) {
      errors.push('price must match executionUnitPrice multiplied by fxRateToVnd for COINGECKO_USDT_VND provenance');
    }
  }

  if (!normalizeDate(fxObservedAt)) {
    errors.push('COINGECKO_USDT_VND provenance requires a valid provider fxObservedAt timestamp');
  }

  return errors;
}

function resultBase({
  baseCurrency,
  quoteCurrency,
  requestedAt,
  mode,
  availability = 'unavailable',
  rate = null,
  observedAt = null,
  observationDeltaMs = null,
  reason = null,
  includeProvider = true
}) {
  return {
    availability,
    baseCurrency,
    quoteCurrency,
    rate,
    provider: includeProvider ? 'CoinGecko' : null,
    provenance: includeProvider ? USDT_VND_ACCOUNTING_PROVENANCE : null,
    observedAt,
    requestedAt,
    observationDeltaMs,
    mode,
    reason
  };
}

function safeProviderReason(error) {
  return [
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TIMEOUT',
    'MALFORMED_PROVIDER_RESPONSE',
    'PROVIDER_ACCESS_DENIED',
    'HISTORICAL_DATA_UNAVAILABLE'
  ].includes(error?.code)
    ? error.code
    : 'PROVIDER_UNAVAILABLE';
}

/**
 * Resolves one governed direct provider-output accounting rate. This resolver
 * never mutates Portfolio state and never derives USDT through USD.
 */
export async function getAccountingRate({
  baseCurrency,
  quoteCurrency,
  at
} = {}, options = {}) {
  const base = normalizeCurrency(baseCurrency);
  const quote = normalizeCurrency(quoteCurrency);
  const now = normalizeDate(options.now ?? new Date());
  const requestedDate = at === undefined || at === null
    ? now
    : normalizeDate(at);
  const mode = at === undefined || at === null ? 'CURRENT' : 'HISTORICAL';
  const requestedAt = requestedDate?.toISOString() ?? null;

  if (!now || !requestedDate) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'INVALID_REQUEST_TIME',
      includeProvider: false
    });
  }

  if (base !== 'USDT' || quote !== 'VND') {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'PAIR_UNSUPPORTED',
      includeProvider: false
    });
  }

  if (!isCoinGeckoAccountingRateEnabled(options.enabled)) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: 'PROVIDER_NOT_ENABLED'
    });
  }

  const getCurrentObservationFn = options.getCurrentObservationFn
    || getCoinGeckoCurrentUsdtVndObservation;
  const getHistoricalObservationsFn = options.getHistoricalObservationsFn
    || getCoinGeckoHistoricalUsdtVndObservations;

  try {
    if (mode === 'CURRENT') {
      const observation = await getCurrentObservationFn({
        fetchFn: options.fetchFn,
        apiKey: options.apiKey
      });
      const observationRate = typeof observation?.rate === 'number'
        && Number.isFinite(observation.rate)
        && observation.rate > 0
        ? observation.rate
        : null;
      const observedMs = Date.parse(observation?.observedAt);
      if (observationRate === null || !Number.isFinite(observedMs)) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          reason: observationRate === null
            ? 'MALFORMED_PROVIDER_RESPONSE'
            : 'OBSERVATION_TIMESTAMP_INVALID'
        });
      }

      const ageMs = now.getTime() - observedMs;
      if (ageMs < 0) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          observedAt: observation.observedAt,
          observationDeltaMs: Math.abs(ageMs),
          reason: 'OBSERVATION_TIMESTAMP_INVALID'
        });
      }
      if (ageMs > CURRENT_ACCOUNTING_RATE_MAX_AGE_MS) {
        return resultBase({
          baseCurrency: base,
          quoteCurrency: quote,
          requestedAt,
          mode,
          availability: 'stale',
          observedAt: observation.observedAt,
          observationDeltaMs: ageMs,
          reason: 'OBSERVATION_STALE'
        });
      }

      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        availability: 'available',
        rate: observationRate,
        observedAt: observation.observedAt,
        observationDeltaMs: ageMs
      });
    }

    const requestedMs = requestedDate.getTime();
    const observations = await getHistoricalObservationsFn({
      fromMs: requestedMs - HISTORICAL_QUERY_PADDING_MS,
      toMs: requestedMs + HISTORICAL_QUERY_PADDING_MS
    }, {
      fetchFn: options.fetchFn,
      apiKey: options.apiKey
    });

    const nearest = observations
      .map((observation) => ({
        ...observation,
        observedMs: Date.parse(observation?.observedAt)
      }))
      .filter((observation) => (
        typeof observation.rate === 'number'
        && Number.isFinite(observation.rate)
        && observation.rate > 0
        && Number.isFinite(observation.observedMs)
      ))
      .sort((left, right) => {
        const leftDelta = Math.abs(left.observedMs - requestedMs);
        const rightDelta = Math.abs(right.observedMs - requestedMs);
        return leftDelta - rightDelta || left.observedMs - right.observedMs;
      })[0];

    if (!nearest) {
      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        reason: 'NO_HISTORICAL_OBSERVATION'
      });
    }

    const deltaMs = Math.abs(nearest.observedMs - requestedMs);
    if (deltaMs > HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS) {
      return resultBase({
        baseCurrency: base,
        quoteCurrency: quote,
        requestedAt,
        mode,
        observedAt: nearest.observedAt,
        observationDeltaMs: deltaMs,
        reason: 'OBSERVATION_TOO_DISTANT'
      });
    }

    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      availability: 'available',
      rate: nearest.rate,
      observedAt: nearest.observedAt,
      observationDeltaMs: deltaMs
    });
  } catch (error) {
    return resultBase({
      baseCurrency: base,
      quoteCurrency: quote,
      requestedAt,
      mode,
      reason: safeProviderReason(error)
    });
  }
}
