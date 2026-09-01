import { normalizeDailyHistory } from '../history.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DAY_MS = 24 * 60 * 60 * 1000;

export const ALPHA_VANTAGE_CACHE_POLICY = Object.freeze({
  // Twelve Gold snapshot acquisitions/day leaves room inside the documented
  // 25-call free daily budget for daily history and the existing 4-hour news feed.
  snapshotFreshMs: 2 * 60 * 60 * 1000,
  snapshotStaleMs: DAY_MS,
  historyFreshBoundary: 'NEXT_UTC_DAY',
  historyStaleMs: 3 * DAY_MS,
  quotaCooldownMs: 4 * 60 * 60 * 1000
});

export function createAlphaVantageRequestCache() {
  return {
    snapshotEntries: new Map(),
    snapshotInFlight: new Map(),
    historyEntries: new Map(),
    historyInFlight: new Map(),
    quotaLimitedUntilMs: 0
  };
}

const defaultRequestCache = createAlphaVantageRequestCache();

function resolveRequestCache(options) {
  if (options.cache === null) return null;
  if (options.cache !== undefined) return options.cache;
  // Injected fetch functions belong to isolated tests unless a cache is explicit.
  if (options.fetchFn) return null;
  return defaultRequestCache;
}

function getCacheNowMs(options) {
  return typeof options.cacheNowMs === 'number' && Number.isFinite(options.cacheNowMs)
    ? options.cacheNowMs
    : Date.now();
}

function nextUtcDayMs(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function assertCacheShape(cache, resource) {
  if (!cache) return null;
  const entries = cache[`${resource}Entries`];
  const inFlight = cache[`${resource}InFlight`];
  if (!(entries instanceof Map) || !(inFlight instanceof Map) || !Number.isFinite(cache.quotaLimitedUntilMs)) {
    throw new TypeError('Invalid Alpha Vantage request cache');
  }
  return { entries, inFlight };
}

function createRateLimitError(retryAfterMs = null) {
  const error = new Error('Nhà cung cấp dữ liệu đang tạm thời giới hạn yêu cầu. Vui lòng thử lại sau.');
  error.status = 503;
  error.code = 'PROVIDER_RATE_LIMITED';
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) error.retryAfterMs = retryAfterMs;
  return error;
}

function parseRetryAfterMs(response) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function createProviderResponseError({ resource, symbol, response }) {
  if (response?.status === 429) return createRateLimitError(parseRetryAfterMs(response));

  const notFound = response?.status === 404;
  const error = new Error(notFound
    ? `${resource === 'history' ? 'Historical Gold Spot data' : 'Market data'} for '${symbol}' not found on Alpha Vantage`
    : 'Không thể kết nối nhà cung cấp dữ liệu');
  error.status = notFound ? 404 : 502;
  error.code = notFound
    ? (resource === 'history' ? 'HISTORY_NOT_FOUND' : 'MARKET_DATA_NOT_FOUND')
    : 'PROVIDER_ERROR';
  return error;
}

function createMalformedProviderError(resource) {
  const error = new Error(`Alpha Vantage ${resource} provider returned malformed data`);
  error.status = 502;
  error.code = 'MALFORMED_PROVIDER_RESPONSE';
  return error;
}

function assertNoProviderPayloadError(data, resource, symbol) {
  if (data?.['Error Message']) {
    const error = new Error(
      `${resource === 'history' ? 'Historical Gold Spot data' : 'Market data'} for '${symbol}' not found on Alpha Vantage`
    );
    error.status = 404;
    error.code = resource === 'history' ? 'HISTORY_NOT_FOUND' : 'MARKET_DATA_NOT_FOUND';
    throw error;
  }

  if (data?.Note || data?.Information) {
    const message = data.Note || data.Information;
    if (typeof message === 'string' && /rate|frequency|limit|thank you/i.test(message)) {
      throw createRateLimitError();
    }
    const error = new Error('Không thể kết nối nhà cung cấp dữ liệu');
    error.status = 502;
    error.code = 'PROVIDER_ERROR';
    throw error;
  }
}

function isTemporaryProviderError(error) {
  return [
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_ERROR',
    'PROVIDER_TIMEOUT',
    'MALFORMED_PROVIDER_RESPONSE'
  ].includes(error?.code);
}

async function fetchProviderJson({ url, fetchFn, resource, symbol, timeoutMs = 8000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) throw createProviderResponseError({ resource, symbol, response });

    let data;
    try {
      data = await response.json();
    } catch {
      throw createMalformedProviderError(resource);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw createMalformedProviderError(resource);
    }
    assertNoProviderPayloadError(data, resource, symbol);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Alpha Vantage ${resource === 'history' ? 'market history' : 'market data'} request timed out`);
      timeoutError.status = 504;
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    if (error?.status && error?.code) throw error;
    const providerError = new Error(`Error fetching Alpha Vantage ${resource === 'history' ? 'market history' : 'market data'}`);
    providerError.status = 502;
    providerError.code = 'PROVIDER_ERROR';
    throw providerError;
  } finally {
    clearTimeout(timeout);
  }
}

function markSnapshotStale(snapshot, { nowMs, loadedAtMs, reason }) {
  return {
    ...snapshot,
    freshness: 'stale',
    cacheStatus: 'stale',
    staleReason: reason,
    cacheAgeMs: Math.max(0, nowMs - loadedAtMs)
  };
}

function markHistoryStale(source, { nowMs, loadedAtMs, reason }) {
  return {
    ...source,
    freshness: 'stale',
    cacheStatus: 'stale',
    staleReason: reason,
    cacheAgeMs: Math.max(0, nowMs - loadedAtMs)
  };
}

async function loadCachedResource({
  cache,
  resource,
  key,
  nowMs,
  load,
  getFreshUntil,
  getStaleUntil,
  markStale
}) {
  const maps = assertCacheShape(cache, resource);
  if (!maps) return load();

  const entry = maps.entries.get(key);
  if (entry && nowMs < entry.freshUntilMs) return entry.value;

  if (nowMs < cache.quotaLimitedUntilMs) {
    const error = createRateLimitError(cache.quotaLimitedUntilMs - nowMs);
    if (entry && nowMs < entry.staleUntilMs) {
      return markStale(entry.value, { nowMs, loadedAtMs: entry.loadedAtMs, reason: error.code });
    }
    throw error;
  }

  const pending = maps.inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const value = await load();
      const freshUntilMs = getFreshUntil(nowMs);
      maps.entries.set(key, {
        value,
        loadedAtMs: nowMs,
        freshUntilMs,
        staleUntilMs: getStaleUntil(nowMs, freshUntilMs)
      });
      if (nowMs >= cache.quotaLimitedUntilMs) cache.quotaLimitedUntilMs = 0;
      return value;
    } catch (error) {
      if (error?.code === 'PROVIDER_RATE_LIMITED') {
        const cooldownMs = Number.isFinite(error.retryAfterMs)
          ? Math.max(error.retryAfterMs, ALPHA_VANTAGE_CACHE_POLICY.quotaCooldownMs)
          : ALPHA_VANTAGE_CACHE_POLICY.quotaCooldownMs;
        cache.quotaLimitedUntilMs = Math.max(cache.quotaLimitedUntilMs, nowMs + cooldownMs);
      }
      if (entry && nowMs < entry.staleUntilMs && isTemporaryProviderError(error)) {
        return markStale(entry.value, { nowMs, loadedAtMs: entry.loadedAtMs, reason: error.code });
      }
      throw error;
    } finally {
      maps.inFlight.delete(key);
    }
  })();

  maps.inFlight.set(key, request);
  return request;
}

/**
 * Fetches and normalizes a Gold Spot market snapshot from Alpha Vantage.
 *
 * Rules:
 * 1. Uses the dedicated GOLD_SILVER_SPOT endpoint with explicit symbol=XAU (NOT futures/ETF/CFD).
 * 2. Normalizes into standard market snapshot contract with quote currency USD.
 * 3. Does not fabricate missing values (volume, high, low remain null).
 * 4. Error payloads (rate limits, invalid key, notes) degrade cleanly to standard error objects with status codes.
 */
export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'GOLD';
  const providerSymbol = mapping?.providerSymbol ?? mapping?.provider_symbol;
  const normalizedProviderSymbol = typeof providerSymbol === 'string' ? providerSymbol.trim().toUpperCase() : '';
  if (normalizedProviderSymbol !== 'XAU') {
    const error = new Error(`Alpha Vantage Gold Spot snapshot requires explicit XAU mapping for '${symbol}'`);
    error.status = 422;
    error.code = 'UNSUPPORTED_PROVIDER';
    throw error;
  }

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    const err = new Error('Alpha Vantage API key is not configured');
    err.status = 422;
    err.code = 'PROVIDER_UNCONFIGURED';
    throw err;
  }

  const url = `https://www.alphavantage.co/query?function=GOLD_SILVER_SPOT&symbol=XAU&apikey=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn || fetch;
  const cache = resolveRequestCache(options);
  const cacheNowMs = getCacheNowMs(options);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;

  try {
    return await loadCachedResource({
      cache,
      resource: 'snapshot',
      key: 'XAU:USD',
      nowMs: cacheNowMs,
      getFreshUntil: (loadedAtMs) => loadedAtMs + ALPHA_VANTAGE_CACHE_POLICY.snapshotFreshMs,
      getStaleUntil: (loadedAtMs) => loadedAtMs + ALPHA_VANTAGE_CACHE_POLICY.snapshotStaleMs,
      markStale: markSnapshotStale,
      load: async () => {
        const data = await fetchProviderJson({ url, fetchFn, resource: 'snapshot', symbol, timeoutMs });
        const rawPrice = Number(data.price);
        const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
        if (price === null) throw createMalformedProviderError('snapshot');

        const rawTime = data.timestamp;
        let priceAsOf = null;
        if (typeof rawTime === 'string' && rawTime.trim()) {
          const timeStr = rawTime.trim();
          const parsed = Date.parse(timeStr.endsWith('Z') || timeStr.includes('+') ? timeStr : `${timeStr}Z`);
          if (Number.isFinite(parsed)) priceAsOf = new Date(parsed).toISOString();
        }

        return {
          symbol: asset.symbol,
          currency: 'USD',
          exchange: null,
          price,
          previousClose: null,
          change: null,
          changePercent: null,
          dayHigh: null,
          dayLow: null,
          volume: null,
          updatedAt: priceAsOf,
          priceAsOf,
          priceSource: 'alphavantage_gold_spot',
          freshness: 'delayed',
          cacheStatus: 'fresh',
          cachedAt: new Date(cacheNowMs).toISOString(),
          changeBasis: 'UNAVAILABLE',
          volumeSemantics: 'UNAVAILABLE'
        };
      }
    });
  } catch (err) {
    if (err.status) throw err;
    const internalErr = new Error('Error fetching Alpha Vantage market data');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  }
}

export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'GOLD';
  const providerSymbol = mapping?.providerSymbol ?? mapping?.provider_symbol;
  const normalizedProviderSymbol = typeof providerSymbol === 'string' ? providerSymbol.trim().toUpperCase() : '';
  if (normalizedProviderSymbol !== 'XAU') {
    const err = new Error(`Alpha Vantage Gold Spot history requires explicit XAU mapping for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }
  if (asset?.marketPolicy !== 'GLOBAL_24_5' || asset?.marketTimezone !== 'UTC') {
    const err = new Error(`Alpha Vantage Gold Spot history is unsupported for market policy '${asset?.marketPolicy || 'unavailable'}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
  if (asset?.quoteCurrency !== 'USD') {
    const err = new Error(`Alpha Vantage Gold Spot history conflicts with canonical currency '${asset?.quoteCurrency || 'unavailable'}'`);
    err.status = 502;
    err.code = 'PROVIDER_CURRENCY_MISMATCH';
    throw err;
  }

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    const err = new Error('Alpha Vantage API key is not configured');
    err.status = 422;
    err.code = 'PROVIDER_UNCONFIGURED';
    throw err;
  }

  const range = (options.range || '1M').toString().trim().toUpperCase();
  const now = options.now instanceof Date ? options.now : new Date();
  const url = `https://www.alphavantage.co/query?function=GOLD_SILVER_HISTORY&symbol=XAU&interval=daily&apikey=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn || fetch;
  const cache = resolveRequestCache(options);
  const cacheNowMs = getCacheNowMs(options);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;

  try {
    const source = await loadCachedResource({
      cache,
      resource: 'history',
      key: 'XAU:daily',
      nowMs: cacheNowMs,
      getFreshUntil: nextUtcDayMs,
      getStaleUntil: (_loadedAtMs, freshUntilMs) => freshUntilMs + ALPHA_VANTAGE_CACHE_POLICY.historyStaleMs,
      markStale: markHistoryStale,
      load: async () => {
        const data = await fetchProviderJson({ url, fetchFn, resource: 'history', symbol, timeoutMs });
        if (!Array.isArray(data.data)) throw createMalformedProviderError('history');

        const providerRecords = data.data.map((row) => {
          const rawPrice = row?.price;
          return {
            date: row?.date,
            timestamp: null,
            timestampDerived: true,
            open: null,
            high: null,
            low: null,
            close: (typeof rawPrice === 'number' || (typeof rawPrice === 'string' && rawPrice.trim()))
              ? Number(rawPrice)
              : null,
            volume: null
          };
        });

        // Validate once at acquisition and cache only completed bars. This prevents
        // an incomplete current-day provider row from becoming eligible merely
        // because a later request is served from stale cache.
        const validated = normalizeDailyHistory({
          asset,
          provider: 'alphavantage',
          range,
          records: providerRecords,
          now,
          freshness: 'delayed',
          historyCapabilities: {
            close: true,
            ohlc: false,
            volume: false
          },
          applyRangeFilter: false
        });
        const records = validated.bars.map((bar) => ({
          date: bar.date,
          timestamp: null,
          timestampDerived: true,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume
        }));

        return {
          records,
          validationWarnings: validated.warnings || [],
          freshness: 'delayed',
          cacheStatus: 'fresh',
          cachedAt: new Date(cacheNowMs).toISOString()
        };
      }
    });

    const initialWarnings = [...(source.validationWarnings || [])];
    if (source.freshness === 'stale') {
      initialWarnings.push({
          code: 'STALE_PROVIDER_DATA',
          message: 'Previously validated completed Alpha Vantage Gold history is being served during a temporary provider failure.'
        });
    }
    const normalized = normalizeDailyHistory({
      asset,
      provider: 'alphavantage',
      range,
      records: source.records,
      now,
      freshness: source.freshness,
      historyCapabilities: {
        close: true,
        ohlc: false,
        volume: false
      },
      initialWarnings
    });
    normalized.cacheStatus = source.cacheStatus;
    normalized.cachedAt = source.cachedAt;
    if (source.cacheStatus === 'stale') {
      normalized.staleReason = source.staleReason;
      normalized.cacheAgeMs = source.cacheAgeMs;
    }
    return normalized;
  } catch (err) {
    if (err.status) throw err;
    const internalErr = new Error('Error fetching Alpha Vantage market history');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  }
}

export const alphavantageProvider = Object.freeze({
  name: 'alphavantage',
  capabilities: Object.freeze({
    snapshot: true,
    history: true,
    analysis: true,
    ohlcHistory: false,
    snapshotChangeBasis: 'UNAVAILABLE'
  }),
  getSnapshot,
  getHistory
});
