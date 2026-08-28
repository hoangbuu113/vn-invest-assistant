export const REPORTING_CURRENCY = 'VND';

const CURRENCY_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;
const FX_FRESHNESS_VALUES = new Set(['current', 'delayed', 'stale', 'unknown']);
const TIMEZONE_EXPLICIT_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function normalizeCurrencyCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeProvider(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeFreshness(value) {
  return typeof value === 'string' && FX_FRESHNESS_VALUES.has(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : 'unknown';
}

function normalizeSourceTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = TIMEZONE_EXPLICIT_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const maximumDay = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  if (
    day < 1 || day > maximumDay
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
    || !Number.isFinite(Date.parse(value))
  ) return null;

  return value;
}

function normalizeReason(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export function createUnavailableFxRate(
  baseCurrency,
  quoteCurrency = REPORTING_CURRENCY,
  reason = 'FX_UNAVAILABLE',
  details = {}
) {
  return {
    baseCurrency: normalizeCurrencyCode(baseCurrency),
    quoteCurrency: normalizeCurrencyCode(quoteCurrency),
    rate: null,
    provider: normalizeProvider(details.provider),
    sourceTimestamp: normalizeSourceTimestamp(details.sourceTimestamp),
    availability: 'unavailable',
    freshness: normalizeFreshness(details.freshness),
    reason: normalizeReason(reason, 'FX_UNAVAILABLE')
  };
}

/**
 * Normalizes and validates one exact, direct provider-neutral FX quote.
 * Opposite pairs are rejected rather than inverted, and no timestamp/provider
 * provenance is fabricated.
 */
export function normalizeFxRate(rawRate, requestedBaseCurrency, requestedQuoteCurrency = REPORTING_CURRENCY) {
  const requestedBase = normalizeCurrencyCode(requestedBaseCurrency);
  const requestedQuote = normalizeCurrencyCode(requestedQuoteCurrency);
  const rawBase = normalizeCurrencyCode(rawRate?.baseCurrency);
  const rawQuote = normalizeCurrencyCode(rawRate?.quoteCurrency);
  const provider = normalizeProvider(rawRate?.provider);
  const sourceTimestamp = normalizeSourceTimestamp(rawRate?.sourceTimestamp);
  const freshness = normalizeFreshness(rawRate?.freshness);

  if (!rawRate || typeof rawRate !== 'object') {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_UNAVAILABLE');
  }

  if (!requestedBase || !requestedQuote || rawBase !== requestedBase || rawQuote !== requestedQuote) {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_PAIR_MISMATCH', {
      provider,
      sourceTimestamp,
      freshness
    });
  }

  if (rawRate.availability !== 'available') {
    return createUnavailableFxRate(requestedBase, requestedQuote, normalizeReason(rawRate.reason, 'FX_UNAVAILABLE'), {
      provider,
      sourceTimestamp,
      freshness
    });
  }

  if (typeof rawRate.rate !== 'number' || !Number.isFinite(rawRate.rate) || rawRate.rate <= 0) {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_RATE_INVALID', {
      provider,
      sourceTimestamp,
      freshness
    });
  }

  if (!provider) {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_PROVIDER_MISSING', {
      sourceTimestamp,
      freshness
    });
  }

  if (!sourceTimestamp) {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_TIMESTAMP_INVALID', {
      provider,
      freshness
    });
  }

  return {
    baseCurrency: requestedBase,
    quoteCurrency: requestedQuote,
    rate: rawRate.rate,
    provider,
    sourceTimestamp,
    availability: 'available',
    freshness,
    reason: null
  };
}

/**
 * Resolves a direct FX quote for converting non-VND asset prices into VND reporting currency.
 * Dispatches USD -> VND to Twelve Data FX provider.
 *
 * @param {string} baseCurrency - Source quote currency (e.g. 'USD')
 * @param {string} [quoteCurrency=REPORTING_CURRENCY] - Target reporting currency (defaults to 'VND')
 * @param {Object} [options] - Options containing fetchFn, apiKey, getFxRateFn etc.
 * @returns {Promise<Object>} Normalized FX rate object
 */
export async function getFxRate(baseCurrency, quoteCurrency = REPORTING_CURRENCY, options = {}) {
  const requestedBase = normalizeCurrencyCode(baseCurrency);
  const requestedQuote = normalizeCurrencyCode(quoteCurrency);

  if (!requestedBase || !requestedQuote) {
    return createUnavailableFxRate(requestedBase, requestedQuote, 'FX_PAIR_MISMATCH');
  }

  if (requestedBase === requestedQuote) {
    return {
      baseCurrency: requestedBase,
      quoteCurrency: requestedQuote,
      rate: 1.0,
      provider: 'identity',
      sourceTimestamp: new Date().toISOString(),
      availability: 'available',
      freshness: 'current',
      reason: null
    };
  }

  if (requestedBase === 'USD' && requestedQuote === 'VND') {
    const { getTwelveDataFxRate } = await import('./providers/twelvedata.js');
    return getTwelveDataFxRate(requestedBase, requestedQuote, options);
  }

  return createUnavailableFxRate(
    requestedBase,
    requestedQuote,
    'FX_PAIR_UNSUPPORTED'
  );
}
