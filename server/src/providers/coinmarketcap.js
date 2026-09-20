const COINMARKETCAP_API_BASE_URL = 'https://pro-api.coinmarketcap.com';
const COINMARKETCAP_TETHER_ID = 825;
const BASE_CURRENCY = 'USDT';
const QUOTE_CURRENCY = 'VND';
const PROVIDER = 'COINMARKETCAP';

export const COINMARKETCAP_CURRENT_RATE_POLICY = Object.freeze({
  refreshMs: 5 * 60 * 1000,
  maxAgeMs: 10 * 60 * 1000,
  fiatSupportRefreshMs: 24 * 60 * 60 * 1000,
  timeoutMs: 8 * 1000,
  transientBackoffMs: 60 * 1000,
  rateLimitBackoffMs: 5 * 60 * 1000,
  maximumBackoffMs: 60 * 60 * 1000
});

export function createCoinMarketCapCurrentRateCache() {
  return {
    rateEntry: null,
    rateInFlight: null,
    fiatSupportEntry: null,
    fiatSupportInFlight: null,
    backoffUntilMs: 0,
    lastFailureReason: null
  };
}

const defaultCurrentRateCache = createCoinMarketCapCurrentRateCache();

function normalizeCurrency(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeNow(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function unavailable(reason, details = {}) {
  return {
    availability: 'unavailable',
    baseCurrency: BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    rate: null,
    provider: PROVIDER,
    providerTimestamp: details.providerTimestamp ?? null,
    lastUpdated: details.lastUpdated ?? null,
    fetchedAt: details.fetchedAt ?? null,
    sourceTimestamp: details.providerTimestamp ?? null,
    freshness: details.freshness ?? 'unknown',
    reason
  };
}

function assertCacheShape(cache) {
  if (!cache) return null;
  if (
    !Object.prototype.hasOwnProperty.call(cache, 'rateEntry')
    || !Object.prototype.hasOwnProperty.call(cache, 'rateInFlight')
    || !Object.prototype.hasOwnProperty.call(cache, 'fiatSupportEntry')
    || !Object.prototype.hasOwnProperty.call(cache, 'fiatSupportInFlight')
    || !Number.isFinite(cache.backoffUntilMs)
  ) {
    throw new TypeError('Invalid CoinMarketCap current-rate cache');
  }
  return cache;
}

function resolveCache(options) {
  if (options.cache === null) return null;
  if (options.cache !== undefined) return assertCacheShape(options.cache);
  // Injected fetch functions are isolated by default so deterministic tests do
  // not share observations unless they explicitly supply a cache.
  if (options.fetchFn) return null;
  return defaultCurrentRateCache;
}

function parseRetryAfterMs(response, nowMs) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : null;
}

function providerError(code, status, retryAfterMs = null) {
  const error = new Error('CoinMarketCap current-rate request failed');
  error.code = code;
  error.status = status;
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    error.retryAfterMs = retryAfterMs;
  }
  return error;
}

function responseError(response, nowMs) {
  if (response?.status === 401 || response?.status === 403) {
    return providerError('FX_PROVIDER_ACCESS_DENIED', 503);
  }
  if (response?.status === 429) {
    return providerError(
      'FX_PROVIDER_RATE_LIMITED',
      503,
      parseRetryAfterMs(response, nowMs)
    );
  }
  return providerError('FX_PROVIDER_UNAVAILABLE', 502);
}

function payloadError(data) {
  const rawCode = data?.status?.error_code;
  if (rawCode === undefined || rawCode === null || Number(rawCode) === 0) return null;
  const code = Number(rawCode);
  if (code === 401 || code === 403 || code === 1001 || code === 1002) {
    return providerError('FX_PROVIDER_ACCESS_DENIED', 503);
  }
  if (code === 429 || code === 1008) {
    return providerError('FX_PROVIDER_RATE_LIMITED', 503);
  }
  return providerError('FX_PROVIDER_UNAVAILABLE', 502);
}

async function fetchProviderJson(url, { apiKey, fetchFn, timeoutMs, nowMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-CMC_PRO_API_KEY': apiKey
      }
    });
    if (!response?.ok) throw responseError(response, nowMs);

    let data;
    try {
      data = await response.json();
    } catch {
      throw providerError('MALFORMED_PROVIDER_RESPONSE', 502);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw providerError('MALFORMED_PROVIDER_RESPONSE', 502);
    }
    const error = payloadError(data);
    if (error) throw error;
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw providerError('FX_PROVIDER_TIMEOUT', 504);
    }
    if (error?.code && error?.status) throw error;
    throw providerError('FX_PROVIDER_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyVndSupport({ cache, apiKey, fetchFn, timeoutMs, nowMs }) {
  if (cache?.fiatSupportEntry && nowMs < cache.fiatSupportEntry.freshUntilMs) {
    return cache.fiatSupportEntry.value;
  }
  if (cache?.fiatSupportInFlight) return cache.fiatSupportInFlight;

  const request = (async () => {
    const url = new URL('/v1/fiat/map', COINMARKETCAP_API_BASE_URL);
    url.searchParams.set('limit', '5000');
    const data = await fetchProviderJson(url, { apiKey, fetchFn, timeoutMs, nowMs });
    if (!Array.isArray(data.data)) {
      throw providerError('MALFORMED_PROVIDER_RESPONSE', 502);
    }
    const vnd = data.data.find((item) => normalizeCurrency(item?.symbol) === QUOTE_CURRENCY);
    if (!vnd || !Number.isInteger(vnd.id) || vnd.id <= 0) {
      throw providerError('FX_QUOTE_CURRENCY_UNSUPPORTED', 502);
    }

    const value = Object.freeze({ symbol: QUOTE_CURRENCY, id: vnd.id });
    if (cache) {
      cache.fiatSupportEntry = {
        value,
        freshUntilMs: nowMs + COINMARKETCAP_CURRENT_RATE_POLICY.fiatSupportRefreshMs
      };
    }
    return value;
  })();

  if (cache) cache.fiatSupportInFlight = request;
  try {
    return await request;
  } finally {
    if (cache) cache.fiatSupportInFlight = null;
  }
}

function normalizeCurrentRateResponse(data, now) {
  const source = data?.data;
  const quote = source?.quote?.[QUOTE_CURRENCY];
  const rate = quote?.price;
  const sourceLastUpdated = parseTimestamp(source?.last_updated);
  const quoteLastUpdated = parseTimestamp(quote?.last_updated);

  if (
    source?.id !== COINMARKETCAP_TETHER_ID
    || normalizeCurrency(source?.symbol) !== BASE_CURRENCY
    || source?.amount !== 1
    || typeof rate !== 'number'
    || !Number.isFinite(rate)
    || rate <= 0
    || !sourceLastUpdated
    || !quoteLastUpdated
  ) {
    throw providerError('MALFORMED_PROVIDER_RESPONSE', 502);
  }

  const nowMs = now.getTime();
  const sourceAgeMs = nowMs - Date.parse(sourceLastUpdated);
  const quoteAgeMs = nowMs - Date.parse(quoteLastUpdated);
  if (sourceAgeMs < 0 || quoteAgeMs < 0) {
    throw providerError('FX_OBSERVATION_TIMESTAMP_INVALID', 502);
  }
  if (
    sourceAgeMs > COINMARKETCAP_CURRENT_RATE_POLICY.maxAgeMs
    || quoteAgeMs > COINMARKETCAP_CURRENT_RATE_POLICY.maxAgeMs
  ) {
    throw providerError('FX_OBSERVATION_STALE', 503);
  }

  const providerResponseTimestamp = parseTimestamp(data?.status?.timestamp);
  return Object.freeze({
    availability: 'available',
    baseCurrency: BASE_CURRENCY,
    quoteCurrency: QUOTE_CURRENCY,
    rate,
    provider: PROVIDER,
    sourceAssetId: COINMARKETCAP_TETHER_ID,
    sourceAssetSymbol: BASE_CURRENCY,
    sourceAmount: 1,
    providerTimestamp: quoteLastUpdated,
    lastUpdated: quoteLastUpdated,
    sourceLastUpdated,
    providerResponseTimestamp,
    fetchedAt: now.toISOString(),
    sourceTimestamp: quoteLastUpdated,
    freshness: 'current',
    cacheStatus: 'refreshed',
    reason: null
  });
}

async function fetchCurrentRate({ cache, apiKey, fetchFn, timeoutMs, now, nowMs }) {
  await verifyVndSupport({ cache, apiKey, fetchFn, timeoutMs, nowMs });

  const url = new URL('/v2/tools/price-conversion', COINMARKETCAP_API_BASE_URL);
  url.searchParams.set('amount', '1');
  url.searchParams.set('id', String(COINMARKETCAP_TETHER_ID));
  url.searchParams.set('convert', QUOTE_CURRENCY);
  const data = await fetchProviderJson(url, { apiKey, fetchFn, timeoutMs, nowMs });
  return normalizeCurrentRateResponse(data, now);
}

function isHardFresh(rate, nowMs) {
  const sourceMs = Date.parse(rate?.sourceLastUpdated);
  const quoteMs = Date.parse(rate?.providerTimestamp);
  return Number.isFinite(sourceMs)
    && Number.isFinite(quoteMs)
    && nowMs >= sourceMs
    && nowMs >= quoteMs
    && nowMs - sourceMs <= COINMARKETCAP_CURRENT_RATE_POLICY.maxAgeMs
    && nowMs - quoteMs <= COINMARKETCAP_CURRENT_RATE_POLICY.maxAgeMs;
}

function cachedRate(entry, cacheStatus) {
  return { ...entry.value, cacheStatus };
}

function backoffDuration(error) {
  if (error?.code === 'FX_PROVIDER_RATE_LIMITED') {
    const requested = Number.isFinite(error.retryAfterMs)
      ? Math.max(error.retryAfterMs, COINMARKETCAP_CURRENT_RATE_POLICY.rateLimitBackoffMs)
      : COINMARKETCAP_CURRENT_RATE_POLICY.rateLimitBackoffMs;
    return Math.min(requested, COINMARKETCAP_CURRENT_RATE_POLICY.maximumBackoffMs);
  }
  return COINMARKETCAP_CURRENT_RATE_POLICY.transientBackoffMs;
}

/**
 * Resolves one authenticated, direct CoinMarketCap USDT/VND current rate.
 * The result is current-valuation evidence only and is never persisted as
 * historical accounting evidence.
 */
export async function getCoinMarketCapCurrentUsdtVndRate(options = {}) {
  const baseCurrency = normalizeCurrency(options.baseCurrency ?? BASE_CURRENCY);
  const quoteCurrency = normalizeCurrency(options.quoteCurrency ?? QUOTE_CURRENCY);
  if (baseCurrency !== BASE_CURRENCY || quoteCurrency !== QUOTE_CURRENCY) {
    return unavailable('FX_PAIR_UNSUPPORTED');
  }

  const apiKey = options.apiKey !== undefined
    ? options.apiKey
    : process.env.COINMARKETCAP_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return unavailable('FX_PROVIDER_UNCONFIGURED');
  }

  const now = normalizeNow(options.now);
  if (!now) return unavailable('FX_OBSERVATION_TIMESTAMP_INVALID');
  const nowMs = now.getTime();
  const fetchFn = options.fetchFn || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : COINMARKETCAP_CURRENT_RATE_POLICY.timeoutMs;
  const cache = resolveCache(options);
  const entry = cache?.rateEntry;

  if (entry && nowMs < entry.refreshAtMs && isHardFresh(entry.value, nowMs)) {
    return cachedRate(entry, 'hit');
  }

  if (cache && nowMs < cache.backoffUntilMs) {
    if (entry && isHardFresh(entry.value, nowMs)) {
      return cachedRate(entry, 'fallback');
    }
    return unavailable(cache.lastFailureReason || 'FX_PROVIDER_UNAVAILABLE');
  }

  if (cache?.rateInFlight) return cache.rateInFlight;

  const request = (async () => {
    try {
      const value = await fetchCurrentRate({
        cache,
        apiKey: apiKey.trim(),
        fetchFn,
        timeoutMs,
        now,
        nowMs
      });
      if (cache) {
        cache.rateEntry = {
          value,
          refreshAtMs: nowMs + COINMARKETCAP_CURRENT_RATE_POLICY.refreshMs
        };
        cache.backoffUntilMs = 0;
        cache.lastFailureReason = null;
      }
      return value;
    } catch (error) {
      const reason = typeof error?.code === 'string'
        ? error.code
        : 'FX_PROVIDER_UNAVAILABLE';
      if (cache) {
        cache.backoffUntilMs = nowMs + backoffDuration(error);
        cache.lastFailureReason = reason;
        if (entry && isHardFresh(entry.value, nowMs)) {
          return cachedRate(entry, 'fallback');
        }
      }
      return unavailable(reason);
    } finally {
      if (cache) cache.rateInFlight = null;
    }
  })();

  if (cache) cache.rateInFlight = request;
  return request;
}

export const COINMARKETCAP_CURRENT_RATE_CONTRACT = Object.freeze({
  provider: PROVIDER,
  sourceAssetId: COINMARKETCAP_TETHER_ID,
  baseCurrency: BASE_CURRENCY,
  quoteCurrency: QUOTE_CURRENCY
});
