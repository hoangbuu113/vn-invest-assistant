import {
  getCanonicalDate,
  getHistoryRangeStart,
  normalizeDailyHistory
} from '../history.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DAY_MS = 24 * 60 * 60 * 1000;

export const COINGECKO_CACHE_POLICY = Object.freeze({
  // Matches the existing UI snapshot refresh cadence. Duplicate consumers inside
  // the same refresh cycle must reuse one provider observation.
  snapshotFreshMs: 5 * 60 * 1000,
  // Three missed refresh cycles remain usable only when explicitly marked stale.
  snapshotStaleMs: 15 * 60 * 1000,
  // Completed daily observations are stable through the current UTC day.
  historyFreshBoundary: 'NEXT_UTC_DAY',
  // Two additional UTC boundaries allow a temporary provider limit to recover.
  historyStaleMs: 2 * DAY_MS,
  // Prevent sequential consumers from retrying during the same UI refresh cycle.
  rateLimitCooldownMs: 5 * 60 * 1000,
  // Concurrent HTTP consumers join one official /simple/price multi-ID request.
  snapshotBatchWindowMs: 15,
  // The canonical universe contains 40 Crypto assets; cap each provider request
  // so future universe growth remains bounded and deterministic.
  snapshotBatchMaxIds: 40,
  // CoinGecko's public API rejects history earlier than the trailing 365 days.
  publicHistoryLookbackDays: 365
});

export function createCoinGeckoRequestCache() {
  return {
    snapshotEntries: new Map(),
    snapshotInFlight: new Map(),
    snapshotRateLimits: new Map(),
    historyEntries: new Map(),
    historyInFlight: new Map(),
    historyRateLimits: new Map()
  };
}

const defaultRequestCache = createCoinGeckoRequestCache();
const snapshotBatchStates = new WeakMap();
const SNAPSHOT_RATE_LIMIT_SCOPE = '__all_snapshots__';

function resolveRequestCache(options) {
  if (options.cache === null) return null;
  if (options.cache !== undefined) return options.cache;
  // Existing deterministic adapter tests inject fetchFn. Keep them isolated unless
  // they explicitly opt into a dedicated cache instance.
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

function parseRetryAfterMs(response) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function createRateLimitError(resource, retryAfterMs = null) {
  const error = new Error(`CoinGecko ${resource} rate limit exceeded`);
  error.status = 503;
  error.code = 'PROVIDER_RATE_LIMITED';
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    error.retryAfterMs = retryAfterMs;
  }
  return error;
}

function createProviderResponseError({ symbol, resource, response }) {
  const status = response?.status;
  if (status === 429) {
    const error = createRateLimitError(resource, parseRetryAfterMs(response));
    error.upstreamStatus = status;
    return error;
  }

  const error = new Error(
    status === 404
      ? `${resource === 'history' ? 'Historical market data' : 'Market data'} for '${symbol}' not found on CoinGecko`
      : `CoinGecko ${resource} provider request failed`
  );
  error.status = status === 404 ? 404 : 502;
  error.code = status === 404
    ? (resource === 'history' ? 'HISTORY_NOT_FOUND' : 'SNAPSHOT_NOT_FOUND')
    : 'PROVIDER_ERROR';
  error.upstreamStatus = status;
  return error;
}

function getPayloadErrorCode(data) {
  return data?.status?.error_code ?? data?.error?.status?.error_code ?? null;
}

function assertNoProviderPayloadError(data, resource) {
  const rawErrorCode = getPayloadErrorCode(data);
  if (rawErrorCode === null && !data?.error) return;
  const errorCode = Number(rawErrorCode);
  if (errorCode === 429) throw createRateLimitError(resource);

  const error = new Error(`CoinGecko ${resource} provider returned an error payload`);
  error.status = 502;
  error.code = 'PROVIDER_ERROR';
  throw error;
}

function assertCacheShape(cache, resource) {
  if (!cache) return null;
  const prefix = resource === 'snapshot' ? 'snapshot' : 'history';
  const entries = cache[`${prefix}Entries`];
  const inFlight = cache[`${prefix}InFlight`];
  const rateLimits = cache[`${prefix}RateLimits`];
  if (!(entries instanceof Map) || !(inFlight instanceof Map) || !(rateLimits instanceof Map)) {
    throw new TypeError('Invalid CoinGecko request cache');
  }
  return { entries, inFlight, rateLimits };
}

async function loadCachedResource({
  cache,
  resource,
  key,
  nowMs,
  getFreshUntil,
  getStaleUntil,
  load,
  markStale
}) {
  const maps = assertCacheShape(cache, resource);
  if (!maps) return load();

  const entry = maps.entries.get(key);
  if (entry && nowMs < entry.freshUntilMs) return entry.value;

  const limitedUntilMs = maps.rateLimits.get(key) || 0;
  if (nowMs < limitedUntilMs) {
    if (entry && nowMs < entry.staleUntilMs) return markStale(entry.value);
    throw createRateLimitError(resource, limitedUntilMs - nowMs);
  }

  const pending = maps.inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const value = await load();
      const freshUntilMs = getFreshUntil(nowMs);
      maps.entries.set(key, {
        value,
        freshUntilMs,
        staleUntilMs: getStaleUntil(nowMs, freshUntilMs)
      });
      maps.rateLimits.delete(key);
      return value;
    } catch (error) {
      if (error?.code === 'PROVIDER_RATE_LIMITED') {
        const cooldownMs = Number.isFinite(error.retryAfterMs)
          ? Math.max(error.retryAfterMs, COINGECKO_CACHE_POLICY.rateLimitCooldownMs)
          : COINGECKO_CACHE_POLICY.rateLimitCooldownMs;
        maps.rateLimits.set(key, nowMs + cooldownMs);
        if (entry && nowMs < entry.staleUntilMs) return markStale(entry.value);
      }
      throw error;
    } finally {
      maps.inFlight.delete(key);
    }
  })();

  maps.inFlight.set(key, request);
  return request;
}

function staleSnapshot(snapshot, { nowMs, loadedAtMs, reason }) {
  return {
    ...snapshot,
    freshness: 'stale',
    cacheStatus: 'stale',
    staleReason: reason,
    cacheAgeMs: Math.max(0, nowMs - loadedAtMs)
  };
}

function staleHistorySource(source) {
  return {
    ...source,
    freshness: 'stale',
    cacheStatus: 'stale',
    staleReason: 'PROVIDER_RATE_LIMITED'
  };
}

function createMalformedSnapshotError() {
  const error = new Error('CoinGecko snapshot provider returned malformed data');
  error.status = 502;
  error.code = 'MALFORMED_PROVIDER_RESPONSE';
  return error;
}

function createMissingSnapshotError(symbol) {
  const error = new Error(`No market quote available for '${symbol}' on CoinGecko`);
  error.status = 404;
  error.code = 'SNAPSHOT_NOT_FOUND';
  return error;
}

function isTemporarySnapshotError(error) {
  return [
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_ERROR',
    'PROVIDER_TIMEOUT',
    'MALFORMED_PROVIDER_RESPONSE',
    'PARTIAL_PROVIDER_RESPONSE'
  ].includes(error?.code);
}

function normalizeSnapshotObservation(asset, coinData, loadedAtMs) {
  if (!coinData || typeof coinData !== 'object' || Array.isArray(coinData)) {
    throw createMalformedSnapshotError();
  }

  const price = typeof coinData.usd === 'number' && Number.isFinite(coinData.usd) && coinData.usd > 0
    ? coinData.usd
    : null;
  if (price === null) throw createMalformedSnapshotError();

  const changePercent = typeof coinData.usd_24h_change === 'number' && Number.isFinite(coinData.usd_24h_change)
    ? coinData.usd_24h_change
    : null;
  const volume = typeof coinData.usd_24h_vol === 'number' && Number.isFinite(coinData.usd_24h_vol) && coinData.usd_24h_vol >= 0
    ? coinData.usd_24h_vol
    : null;
  const rawTs = coinData.last_updated_at;
  const priceAsOf = typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0
    ? new Date(rawTs * 1000).toISOString()
    : null;

  let change = null;
  if (changePercent !== null && (1 + changePercent / 100) > 0) {
    const rollingReference = price / (1 + changePercent / 100);
    change = price - rollingReference;
  }

  return {
    symbol: asset.symbol,
    currency: 'USD',
    exchange: null,
    price,
    previousClose: null,
    change,
    changePercent,
    dayHigh: null,
    dayLow: null,
    volume,
    updatedAt: priceAsOf,
    priceAsOf,
    priceSource: 'coingecko_market_snapshot',
    freshness: 'delayed',
    cacheStatus: 'fresh',
    cachedAt: new Date(loadedAtMs).toISOString(),
    changeBasis: 'ROLLING_24H',
    volumeSemantics: 'ROLLING_24H_QUOTE_CURRENCY'
  };
}

async function fetchSnapshotBatch({ requests, fetchFn, headers }) {
  const coinIds = requests.map((request) => request.coinId).sort();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinIds.join(','))}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true&precision=full`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetchFn(url, { signal: controller.signal, headers });
    if (!response.ok) {
      throw createProviderResponseError({
        symbol: requests.map((request) => request.symbol).join(','),
        resource: 'snapshot',
        response
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw createMalformedSnapshotError();
    }
    assertNoProviderPayloadError(data, 'snapshot');
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw createMalformedSnapshotError();
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('CoinGecko market data request timed out');
      timeoutError.status = 504;
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    if (error?.status && error?.code) throw error;
    const providerError = new Error('CoinGecko snapshot provider request failed');
    providerError.status = 502;
    providerError.code = 'PROVIDER_ERROR';
    throw providerError;
  } finally {
    clearTimeout(timeout);
  }
}

function cachedStaleOrError({ entry, error, nowMs }) {
  if (
    entry
    && Number.isFinite(entry.loadedAtMs)
    && nowMs < entry.staleUntilMs
    && isTemporarySnapshotError(error)
  ) {
    return {
      value: staleSnapshot(entry.value, {
        nowMs,
        loadedAtMs: entry.loadedAtMs,
        reason: error.code
      })
    };
  }
  return { error };
}

function getSnapshotBatchState(cache) {
  let state = snapshotBatchStates.get(cache);
  if (!state) {
    state = { groups: new Set() };
    snapshotBatchStates.set(cache, state);
  }
  return state;
}

function findOrCreateBatchGroup(cache, fetchFn, apiKey, headers) {
  const state = getSnapshotBatchState(cache);
  for (const group of state.groups) {
    if (!group.closed && group.fetchFn === fetchFn && group.apiKey === apiKey) return group;
  }

  const group = {
    state,
    cache,
    fetchFn,
    apiKey,
    headers,
    requests: new Map(),
    timer: null,
    closed: false
  };
  state.groups.add(group);
  return group;
}

function settleSnapshotRequest(maps, request, outcome) {
  maps.inFlight.delete(request.coinId);
  if (outcome.error) request.reject(outcome.error);
  else request.resolve(outcome.value);
}

async function flushSnapshotBatch(group) {
  if (group.closed) return;
  group.closed = true;
  if (group.timer) clearTimeout(group.timer);
  group.state.groups.delete(group);

  const requests = [...group.requests.values()];
  const maps = assertCacheShape(group.cache, 'snapshot');
  const batchNowMs = Math.max(...requests.map((request) => request.nowMs));

  try {
    const data = await fetchSnapshotBatch({
      requests,
      fetchFn: group.fetchFn,
      headers: group.headers
    });
    maps.rateLimits.delete(SNAPSHOT_RATE_LIMIT_SCOPE);

    for (const request of requests) {
      const entry = maps.entries.get(request.coinId);
      const coinData = data[request.coinId];
      if (coinData === undefined) {
        const missing = createMissingSnapshotError(request.symbol);
        missing.code = 'PARTIAL_PROVIDER_RESPONSE';
        missing.status = 502;
        settleSnapshotRequest(maps, request, cachedStaleOrError({
          entry,
          error: missing,
          nowMs: request.nowMs
        }));
        continue;
      }

      try {
        const value = normalizeSnapshotObservation(request.asset, coinData, request.nowMs);
        maps.entries.set(request.coinId, {
          value,
          loadedAtMs: request.nowMs,
          freshUntilMs: request.nowMs + COINGECKO_CACHE_POLICY.snapshotFreshMs,
          staleUntilMs: request.nowMs + COINGECKO_CACHE_POLICY.snapshotStaleMs
        });
        settleSnapshotRequest(maps, request, { value });
      } catch (error) {
        settleSnapshotRequest(maps, request, cachedStaleOrError({
          entry,
          error,
          nowMs: request.nowMs
        }));
      }
    }
  } catch (error) {
    if (error?.code === 'PROVIDER_RATE_LIMITED') {
      const cooldownMs = Number.isFinite(error.retryAfterMs)
        ? Math.max(error.retryAfterMs, COINGECKO_CACHE_POLICY.rateLimitCooldownMs)
        : COINGECKO_CACHE_POLICY.rateLimitCooldownMs;
      maps.rateLimits.set(SNAPSHOT_RATE_LIMIT_SCOPE, batchNowMs + cooldownMs);
    }

    for (const request of requests) {
      settleSnapshotRequest(maps, request, cachedStaleOrError({
        entry: maps.entries.get(request.coinId),
        error,
        nowMs: request.nowMs
      }));
    }
  }
}

function loadCachedSnapshot({ cache, asset, coinId, symbol, nowMs, fetchFn, apiKey, headers }) {
  const maps = assertCacheShape(cache, 'snapshot');
  const entry = maps.entries.get(coinId);
  if (entry && nowMs < entry.freshUntilMs) return Promise.resolve(entry.value);

  const limitedUntilMs = maps.rateLimits.get(SNAPSHOT_RATE_LIMIT_SCOPE) || 0;
  if (nowMs < limitedUntilMs) {
    const error = createRateLimitError('snapshot', limitedUntilMs - nowMs);
    const outcome = cachedStaleOrError({ entry, error, nowMs });
    return outcome.error ? Promise.reject(outcome.error) : Promise.resolve(outcome.value);
  }

  const pending = maps.inFlight.get(coinId);
  if (pending) return pending;

  const group = findOrCreateBatchGroup(cache, fetchFn, apiKey, headers);
  const promise = new Promise((resolve, reject) => {
    group.requests.set(coinId, { asset, coinId, symbol, nowMs, resolve, reject });
  });
  maps.inFlight.set(coinId, promise);

  if (group.requests.size >= COINGECKO_CACHE_POLICY.snapshotBatchMaxIds) {
    void flushSnapshotBatch(group);
  } else if (!group.timer) {
    group.timer = setTimeout(
      () => void flushSnapshotBatch(group),
      COINGECKO_CACHE_POLICY.snapshotBatchWindowMs
    );
  }

  return promise;
}

/**
 * Fetches and normalizes a cryptocurrency market snapshot from CoinGecko.
 *
 * Rules:
 * 1. Uses the immutable CoinGecko coin ID from asset_provider_mappings (e.g. 'bitcoin', 'ethereum', 'solana').
 * 2. Normalizes into standard market snapshot contract with quote currency USD.
 * 3. Does not invent missing values (dayHigh / dayLow remain null).
 * 4. Error responses degrade cleanly to standard error objects with status codes.
 */
export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'CRYPTO';
  const coinId = mapping?.providerSymbol ?? mapping?.provider_symbol;

  if (!coinId || typeof coinId !== 'string' || !coinId.trim()) {
    const err = new Error(`No CoinGecko coin ID mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }

  const normalizedCoinId = coinId.trim().toLowerCase();
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.COINGECKO_API_KEY;
  const fetchFn = options.fetchFn || fetch;

  const headers = {
    'User-Agent': USER_AGENT
  };
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const cache = resolveRequestCache(options);
  const cacheNowMs = getCacheNowMs(options);

  try {
    if (cache) {
      return await loadCachedSnapshot({
        cache,
        asset,
        coinId: normalizedCoinId,
        symbol,
        nowMs: cacheNowMs,
        fetchFn,
        apiKey,
        headers
      });
    }

    const data = await fetchSnapshotBatch({
      requests: [{ asset, coinId: normalizedCoinId, symbol, nowMs: cacheNowMs }],
      fetchFn,
      headers
    });
    if (data[normalizedCoinId] === undefined) throw createMissingSnapshotError(symbol);
    return normalizeSnapshotObservation(asset, data[normalizedCoinId], cacheNowMs);
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('CoinGecko market data request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    const internalErr = new Error('CoinGecko market data provider request failed');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  }
}

export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'CRYPTO';
  const coinId = mapping?.providerSymbol ?? mapping?.provider_symbol;
  if (!coinId || typeof coinId !== 'string' || !coinId.trim()) {
    const err = new Error(`No CoinGecko coin ID mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }
  if (asset?.marketPolicy !== 'CONTINUOUS_24_7' || asset?.marketTimezone !== 'UTC') {
    const err = new Error(`CoinGecko history is unsupported for market policy '${asset?.marketPolicy || 'unavailable'}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
  if (asset?.quoteCurrency !== 'USD') {
    const err = new Error(`CoinGecko USD history conflicts with canonical currency '${asset?.quoteCurrency || 'unavailable'}'`);
    err.status = 502;
    err.code = 'PROVIDER_CURRENCY_MISMATCH';
    throw err;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const range = (options.range || '1M').toString().trim().toUpperCase();
  const today = getCanonicalDate(now, 'UTC');
  const rangeStartDate = getHistoryRangeStart(today, range);
  const rangeStartMs = Date.parse(`${rangeStartDate}T00:00:00.000Z`);
  const todayStartMs = Date.parse(`${today}T00:00:00.000Z`);
  const spanDays = Math.max(1, Math.ceil((todayStartMs - rangeStartMs) / DAY_MS));
  const maxChunkDays = COINGECKO_CACHE_POLICY.publicHistoryLookbackDays;
  const requiredLookbackDays = Math.max(COINGECKO_CACHE_POLICY.publicHistoryLookbackDays, spanDays);

  const chunks = [];
  if (requiredLookbackDays <= maxChunkDays) {
    const from = Math.ceil((now.getTime() - maxChunkDays * DAY_MS) / 1000);
    const to = Math.floor(now.getTime() / 1000);
    chunks.push({ from, to });
  } else {
    let curFromMs = now.getTime() - requiredLookbackDays * DAY_MS;
    const endMs = now.getTime();
    while (curFromMs < endMs) {
      const curToMs = Math.min(curFromMs + maxChunkDays * DAY_MS, endMs);
      chunks.push({
        from: Math.ceil(curFromMs / 1000),
        to: Math.floor(curToMs / 1000)
      });
      curFromMs = curToMs;
    }
  }

  const normalizedCoinId = coinId.trim().toLowerCase();
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.COINGECKO_API_KEY;
  const fetchFn = options.fetchFn || fetch;
  const headers = { 'User-Agent': USER_AGENT };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
  const cache = resolveRequestCache(options);
  const cacheNowMs = getCacheNowMs(options);
  const historyCacheKey = `${normalizedCoinId}:daily-${requiredLookbackDays}d`;

  try {
    const source = await loadCachedResource({
      cache,
      resource: 'history',
      key: historyCacheKey,
      nowMs: cacheNowMs,
      getFreshUntil: nextUtcDayMs,
      getStaleUntil: (_loadedAtMs, freshUntilMs) => freshUntilMs + COINGECKO_CACHE_POLICY.historyStaleMs,
      markStale: staleHistorySource,
      load: async () => {
        const rawPrices = [];
        for (const chunk of chunks) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(normalizedCoinId)}/market_chart/range?vs_currency=usd&from=${chunk.from}&to=${chunk.to}&interval=daily&precision=full`;
            const response = await fetchFn(url, { signal: controller.signal, headers });
            if (!response.ok) {
              throw createProviderResponseError({ symbol, resource: 'history', response });
            }

            const data = await response.json();
            assertNoProviderPayloadError(data, 'history');
            if (!Array.isArray(data?.prices)) {
              const error = new Error(`Malformed CoinGecko historical response for '${symbol}'`);
              error.status = 502;
              error.code = 'MALFORMED_PROVIDER_RESPONSE';
              throw error;
            }
            rawPrices.push(...data.prices);
          } finally {
            clearTimeout(timeout);
          }
        }

        const seenTimestamps = new Set();
        const dedupedPrices = [];
        for (const row of rawPrices) {
          const ts = Array.isArray(row) ? row[0] : null;
          if (ts !== null && !seenTimestamps.has(ts)) {
            seenTimestamps.add(ts);
            dedupedPrices.push(row);
          }
        }
        dedupedPrices.sort((a, b) => a[0] - b[0]);

        const sourceDayStartMs = Date.parse(`${today}T00:00:00.000Z`);
        const records = dedupedPrices.map((row) => {
          const timestampMs = Array.isArray(row) ? row[0] : null;
          const rawPrice = Array.isArray(row) ? row[1] : null;
          const price = (typeof rawPrice === 'number' || (typeof rawPrice === 'string' && rawPrice.trim()))
            ? Number(rawPrice)
            : null;
          return {
            timestamp: typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0
              ? new Date(timestampMs).toISOString()
              : null,
            open: null,
            high: null,
            low: null,
            close: price,
            volume: null
          };
        }).filter((record) => {
          const timestampMs = Date.parse(record.timestamp);
          return !Number.isFinite(timestampMs) || timestampMs < sourceDayStartMs;
        });

        return { records, freshness: 'delayed' };
      }
    });

    const initialWarnings = [];
    if (range === '1Y') {
      initialWarnings.push({
        code: 'PARTIAL_HISTORY_COVERAGE',
        date: getHistoryRangeStart(today, range),
        message: 'CoinGecko public history is limited to the trailing 365 days; the returned observations remain explicitly bounded by their dates.'
      });
    }
    if (source.freshness === 'stale') {
      initialWarnings.push({
        code: 'STALE_PROVIDER_DATA',
        message: 'Previously validated completed CoinGecko history is being served during a temporary provider rate limit.'
      });
    }

    const normalized = normalizeDailyHistory({
      asset,
      provider: 'coingecko',
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

    if (source.cacheStatus === 'stale') {
      normalized.cacheStatus = 'stale';
      normalized.staleReason = source.staleReason;
    }
    return normalized;
  } catch (err) {
    if (err.status) throw err;
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('CoinGecko market history request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching CoinGecko market history');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  }
}

export const coingeckoProvider = Object.freeze({
  name: 'coingecko',
  role: 'canonical_usd_valuation_snapshot',
  capabilities: Object.freeze({
    snapshot: true,
    history: false,
    analysis: false,
    ohlcHistory: false,
    snapshotChangeBasis: 'ROLLING_24H'
  }),
  getSnapshot,
  // Kept as a direct legacy utility for deterministic compatibility tests.
  // Production market routing rejects history for this valuation-only adapter.
  getHistory
});
