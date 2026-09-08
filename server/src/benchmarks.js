/**
 * Feature 25C — Portfolio Benchmark Integration
 *
 * Authoritative benchmark registry and comparison service.
 *
 * Benchmarks are NOT investable canonical assets.
 * They MUST NOT appear in public.assets, asset browser, holdings,
 * watchlist, or transaction selectors.
 *
 * Architecture:
 *   - ONE authoritative in-code benchmark registry (BENCHMARK_REGISTRY)
 *   - VNDIRECT adapter for VN-Index (VND_COMPARABLE)
 *   - Yahoo history adapter for S&P 500 (REFERENCE_ONLY_CURRENCY_MISMATCH)
 *   - Comparison service: intersect dates, rebase to Base100, same-endpoint returns
 *   - Provider failure is isolated: base /api/portfolio/performance is unaffected
 */

import { getCanonicalDate, addCalendarDays, normalizeDailyHistory } from './history.js';
import { PUBLIC_PERFORMANCE_RANGES } from './performance.js';
import { fetchVndirectHistory } from './providers/vndirect.js';
import { normalizeHistoricalData as normalizeYahooHistoricalData } from './providers/yahoo.js';

// ---------------------------------------------------------------------------
// 1. AUTHORITATIVE BENCHMARK REGISTRY
// ---------------------------------------------------------------------------

export const BENCHMARK_IDS = Object.freeze({
  VN_INDEX: 'VN_INDEX',
  SP500: 'SP500'
});

/**
 * Authoritative benchmark definitions.
 * Single source of truth — do not duplicate in other files.
 */
export const BENCHMARK_REGISTRY = Object.freeze({
  [BENCHMARK_IDS.VN_INDEX]: Object.freeze({
    id: BENCHMARK_IDS.VN_INDEX,
    name: 'VN-Index',
    provider: 'VNDIRECT',
    providerIdentifier: 'VNINDEX',
    quoteCurrency: 'VND',
    returnType: 'PRICE_RETURN',
    marketPolicy: 'VN_EXCHANGE',
    marketTimezone: 'Asia/Ho_Chi_Minh',
    comparability: 'VND_COMPARABLE',
    currencyAdjusted: false
  }),
  [BENCHMARK_IDS.SP500]: Object.freeze({
    id: BENCHMARK_IDS.SP500,
    name: 'S&P 500',
    provider: 'YAHOO',
    providerIdentifier: '^GSPC',
    quoteCurrency: 'USD',
    returnType: 'PRICE_RETURN',
    marketPolicy: 'GLOBAL_24_5',
    marketTimezone: 'America/New_York',
    comparability: 'REFERENCE_ONLY_CURRENCY_MISMATCH',
    currencyAdjusted: false,
    currencyMismatchReason: 'HISTORICAL_FX_UNAVAILABLE'
  })
});

/**
 * Resolves a benchmark definition from registry.
 * Throws a controlled validation error for unknown IDs.
 *
 * @param {string} benchmarkId
 * @returns {Object} Benchmark definition
 */
export function resolveBenchmark(benchmarkId) {
  if (!benchmarkId || typeof benchmarkId !== 'string') {
    const err = new Error('Benchmark ID is required');
    err.code = 'INVALID_BENCHMARK_ID';
    err.status = 400;
    throw err;
  }
  const def = BENCHMARK_REGISTRY[benchmarkId.trim().toUpperCase()];
  if (!def) {
    const valid = Object.keys(BENCHMARK_REGISTRY).join(', ');
    const err = new Error(`Unknown benchmark '${benchmarkId}'. Supported: ${valid}`);
    err.code = 'UNKNOWN_BENCHMARK';
    err.status = 400;
    throw err;
  }
  return def;
}

// ---------------------------------------------------------------------------
// 2. SIMPLE IN-MEMORY BENCHMARK HISTORY CACHE
// ---------------------------------------------------------------------------

const _cache = new Map();

function makeCacheKey(benchmarkId, fromDateKey, toDateKey) {
  return `${benchmarkId}::${fromDateKey}::${toDateKey}`;
}

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  // Benchmark history is completed daily bars — valid until next VN-calendar-day boundary.
  // Simple TTL: cache valid for up to 4 hours (completed history doesn't change intraday).
  const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.bars;
}

function setCached(key, bars) {
  _cache.set(key, { bars, fetchedAt: Date.now() });
}

function shouldUseCache(options) {
  if (options.cache === false) return false;
  return typeof options.fetchFn !== 'function' && typeof options.getYahooHistoryFn !== 'function';
}

// In-flight promise deduplication — prevents redundant concurrent fetches
const _inflight = new Map();

// ---------------------------------------------------------------------------
// 3. BENCHMARK HISTORY FETCHERS
// ---------------------------------------------------------------------------

/**
 * Fetches VN-Index completed daily history from VNDIRECT.
 * Filters to only bars within [fromDateKey, toDateKey] (completed, inclusive).
 * Current VN-calendar-day is excluded (provider self-excludes + local guard).
 *
 * @param {string} fromDateKey - YYYY-MM-DD start (inclusive)
 * @param {string} toDateKey   - YYYY-MM-DD end (inclusive, completed)
 * @param {Date} now           - Reference time for current-day guard
 * @param {Object} options     - Injectable options { fetchFn }
 * @returns {Promise<Array<{date, close}>>}
 */
async function fetchVnIndexHistory(fromDateKey, toDateKey, now, options = {}) {
  const def = BENCHMARK_REGISTRY[BENCHMARK_IDS.VN_INDEX];

  // Current completed date in VN timezone
  const todayKey = getCanonicalDate(now, def.marketTimezone);
  // toDateKey must be < today (completed-only)
  const safeToKey = toDateKey < todayKey ? toDateKey : addCalendarDays(todayKey, -1);

  if (fromDateKey > safeToKey) return [];

  const cacheKey = makeCacheKey(def.id, fromDateKey, safeToKey);
  const useCache = shouldUseCache(options);
  const cached = useCache ? getCached(cacheKey) : null;
  if (cached) return cached;

  // Coalesce concurrent identical requests
  if (useCache && _inflight.has(cacheKey)) {
    return _inflight.get(cacheKey);
  }

  // fromDate: UTC midnight of fromDateKey
  const fromParts = fromDateKey.split('-');
  const fromDate = new Date(Date.UTC(+fromParts[0], +fromParts[1] - 1, +fromParts[2]));

  // toDate: UTC midnight of day AFTER safeToKey (provider uses exclusive upper bound)
  const toDateNext = addCalendarDays(safeToKey, 1);
  const toParts = toDateNext.split('-');
  const toDate = new Date(Date.UTC(+toParts[0], +toParts[1] - 1, +toParts[2]));

  const promise = fetchVndirectHistory(def.providerIdentifier, fromDate, toDate, { ...options, now })
    .then(({ bars }) => {
      // Filter to [fromDateKey, safeToKey] and exclude current VN day
      const candidates = bars.filter((bar) => (
        bar.date >= fromDateKey && bar.date <= safeToKey && bar.date < todayKey
      ));
      if (candidates.length === 0) return [];

      const normalized = normalizeDailyHistory({
        asset: {
          symbol: def.id,
          assetType: 'benchmark',
          quoteCurrency: def.quoteCurrency,
          marketPolicy: def.marketPolicy,
          marketTimezone: def.marketTimezone
        },
        provider: 'vndirect',
        range: '2Y',
        records: candidates,
        now,
        freshness: 'delayed',
        historyCapabilities: { close: true, ohlc: true, volume: true },
        applyRangeFilter: false,
        excludeIncomplete: true
      });
      if (useCache) setCached(cacheKey, normalized.bars);
      return normalized.bars;
    })
    .finally(() => {
      if (useCache) _inflight.delete(cacheKey);
    });

  if (useCache) _inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Fetches S&P 500 completed daily history from Yahoo Finance.
 * Reuses existing Yahoo provider getHistory adapter via the canonical asset shim.
 * Excludes current US-market day per America/New_York timezone.
 *
 * @param {string} fromDateKey - YYYY-MM-DD
 * @param {string} toDateKey   - YYYY-MM-DD (completed)
 * @param {Date} now
 * @param {Object} options     - Injectable { getYahooHistoryFn }
 * @returns {Promise<Array<{date, close}>>}
 */
async function fetchSp500History(fromDateKey, toDateKey, now, options = {}) {
  const def = BENCHMARK_REGISTRY[BENCHMARK_IDS.SP500];

  // Current completed date in NY timezone
  const todayNy = getCanonicalDate(now, def.marketTimezone);
  const safeToKey = toDateKey < todayNy ? toDateKey : addCalendarDays(todayNy, -1);

  if (fromDateKey > safeToKey) return [];

  const cacheKey = makeCacheKey(def.id, fromDateKey, safeToKey);
  const useCache = shouldUseCache(options);
  const cached = useCache ? getCached(cacheKey) : null;
  if (cached) return cached;

  if (useCache && _inflight.has(cacheKey)) {
    return _inflight.get(cacheKey);
  }

  // Use injectable Yahoo history function or built-in fetch shim
  const getYahooHistoryFn = options.getYahooHistoryFn || _defaultYahooHistoryFn;

  const promise = getYahooHistoryFn(def, fromDateKey, safeToKey, now, options)
    .then((bars) => {
      const filtered = bars.filter((b) => b.date >= fromDateKey && b.date <= safeToKey && b.date < todayNy);
      if (useCache) setCached(cacheKey, filtered);
      return filtered;
    })
    .finally(() => {
      if (useCache) _inflight.delete(cacheKey);
    });

  if (useCache) _inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Default Yahoo history fetcher for ^GSPC using Yahoo's v8 chart API and the
 * existing hardened Yahoo history normalizer. This layer owns only the
 * benchmark request identity; it does not duplicate Yahoo bar parsing.
 */
async function _defaultYahooHistoryFn(def, fromDateKey, toDateKey, now, options) {
  const USER_AGENT_YAHOO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Request 1Y range — wide enough to cover any supported performance range
  const symbol = def.providerIdentifier; // ^GSPC
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`;
  const fetchFn = options.fetchFn || fetch;

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    response = await fetchFn(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT_YAHOO }
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const e = new Error(`S&P 500 benchmark data request timed out`);
      e.code = 'PROVIDER_TIMEOUT'; e.status = 504; throw e;
    }
    const e = new Error(`S&P 500 benchmark provider connection error: ${err.message}`);
    e.code = 'PROVIDER_CONNECTION_ERROR'; e.status = 502; throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const e = new Error(`S&P 500 benchmark provider returned HTTP ${response.status}`);
    e.code = response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
    e.status = response.status === 429 ? 503 : 502;
    throw e;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const e = new Error('S&P 500 benchmark provider returned non-JSON response');
    e.code = 'PROVIDER_MALFORMED_RESPONSE'; e.status = 502; throw e;
  }

  const result = data?.chart?.result?.[0];
  if (!result) {
    const e = new Error('No S&P 500 benchmark data available');
    e.code = 'PROVIDER_NO_DATA'; e.status = 502; throw e;
  }

  const providerCurrency = typeof result.meta?.currency === 'string'
    ? result.meta.currency.trim().toUpperCase()
    : null;
  if (providerCurrency && providerCurrency !== def.quoteCurrency) {
    const error = new Error('S&P 500 benchmark provider currency conflicts with the registry');
    error.code = 'PROVIDER_CURRENCY_MISMATCH';
    error.status = 502;
    throw error;
  }

  const normalized = normalizeYahooHistoricalData(result, def.id, '2Y', {
    asset: {
      symbol: def.id,
      assetType: 'benchmark',
      quoteCurrency: def.quoteCurrency,
      marketPolicy: def.marketPolicy,
      marketTimezone: def.marketTimezone
    },
    now,
    applyRangeFilter: false,
    excludeIncomplete: true
  });

  return normalized.bars;
}

// ---------------------------------------------------------------------------
// 4. BENCHMARK HISTORY DISPATCH
// ---------------------------------------------------------------------------

/**
 * Dispatches benchmark history fetch to the correct provider adapter.
 *
 * @param {Object} def        - Benchmark definition from BENCHMARK_REGISTRY
 * @param {string} fromDateKey
 * @param {string} toDateKey
 * @param {Date} now
 * @param {Object} options
 * @returns {Promise<Array<{date, close}>>}
 */
async function getBenchmarkHistory(def, fromDateKey, toDateKey, now, options = {}) {
  if (def.id === BENCHMARK_IDS.VN_INDEX) {
    return fetchVnIndexHistory(fromDateKey, toDateKey, now, options);
  }
  if (def.id === BENCHMARK_IDS.SP500) {
    return fetchSp500History(fromDateKey, toDateKey, now, options);
  }
  const err = new Error(`No history fetcher registered for benchmark '${def.id}'`);
  err.code = 'BENCHMARK_PROVIDER_UNSUPPORTED';
  err.status = 500;
  throw err;
}

// ---------------------------------------------------------------------------
// 5. COMPARISON ENGINE (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Determines whether portfolio TWR is financially valid for benchmark comparison.
 *
 * @param {Object} performance - Result from calculatePortfolioPerformance / getPortfolioPerformance
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function portfolioTwrIsValid(performance) {
  if (!performance) return { valid: false, reason: 'PORTFOLIO_PERFORMANCE_UNAVAILABLE' };
  if (performance.benchmarkEligibility?.status === 'not_applicable') {
    return {
      valid: false,
      reason: performance.benchmarkEligibility.reason || 'BENCHMARK_NOT_APPLICABLE'
    };
  }
  if (performance.valuationCoverage && performance.valuationCoverage.status !== 'complete') {
    return {
      valid: false,
      reason: performance.valuationCoverage.reasons?.[0] || 'INCOMPLETE_VALUATION_COVERAGE'
    };
  }
  if (performance.twr?.status !== 'available') {
    return { valid: false, reason: performance.twr?.reason || 'TWR_UNAVAILABLE' };
  }
  if (typeof performance.twr?.returnPct !== 'number' || !Number.isFinite(performance.twr.returnPct)) {
    return { valid: false, reason: 'TWR_NON_NUMERIC' };
  }
  return { valid: true, reason: null };
}

/**
 * Pure benchmark comparison engine.
 *
 * @param {Object} params
 * @param {Object} params.portfolioPerformance - Feature 25B performance result
 * @param {Object} params.benchmarkDef         - Benchmark definition
 * @param {Array}  params.benchmarkBars        - [{date, close}] — completed bars only
 * @param {Date}   params.now                  - Reference time
 * @returns {Object} Comparison result
 */
export function calculateBenchmarkComparison({
  portfolioPerformance,
  benchmarkDef,
  benchmarkBars,
  now
}) {
  // --- 5a. Portfolio TWR validity gate ---
  const { valid: twrValid, reason: twrInvalidReason } = portfolioTwrIsValid(portfolioPerformance);

  if (!twrValid) {
    return {
      status: 'unavailable',
      reason: twrInvalidReason || 'TWR_UNAVAILABLE',
      benchmark: _benchmarkPublicMetadata(benchmarkDef),
      period: null,
      portfolio: { returnType: 'TWR', returnPctOnCommonPeriod: null },
      benchmarkReturnPct: null,
      returnDifferencePctPoints: null,
      series: [],
      provenance: _buildProvenance(benchmarkDef, null, null, null, 0)
    };
  }

  // --- 5b. Build portfolio date → twrIndex map ---
  const portfolioSeries = Array.isArray(portfolioPerformance.series)
    ? portfolioPerformance.series
    : [];

  // Map from YYYY-MM-DD → twrIndex
  const portfolioMap = new Map();
  for (const pt of portfolioSeries) {
    if (
      pt.date &&
      typeof pt.twrIndex === 'number' &&
      Number.isFinite(pt.twrIndex)
    ) {
      portfolioMap.set(pt.date, pt.twrIndex);
    }
  }

  // --- 5c. Build benchmark date → close map ---
  const benchmarkMap = new Map();
  for (const bar of Array.isArray(benchmarkBars) ? benchmarkBars : []) {
    if (bar.date && typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0) {
      benchmarkMap.set(bar.date, bar.close);
    }
  }

  // --- 5d. Intersection: dates present in BOTH portfolio and benchmark ---
  const commonDates = [];
  for (const [date] of portfolioMap.entries()) {
    if (benchmarkMap.has(date)) {
      commonDates.push(date);
    }
  }
  commonDates.sort(); // ascending

  // --- 5e. Minimum common dates guard ---
  if (commonDates.length < 2) {
    const latestBenchmarkDate = [...benchmarkMap.keys()].sort().at(-1) ?? null;
    return {
      status: 'insufficient_data',
      reason: 'INSUFFICIENT_COMMON_DATES',
      benchmark: _benchmarkPublicMetadata(benchmarkDef),
      period: null,
      portfolio: { returnType: 'TWR', returnPctOnCommonPeriod: null },
      benchmarkReturnPct: null,
      returnDifferencePctPoints: null,
      series: [],
      provenance: _buildProvenance(benchmarkDef, latestBenchmarkDate, null, null, commonDates.length)
    };
  }

  const commonStartDate = commonDates[0];
  const commonEndDate = commonDates[commonDates.length - 1];

  // --- 5f. Base100 rebasing ---
  const P_start = portfolioMap.get(commonStartDate); // twrIndex at common start
  const B_start = benchmarkMap.get(commonStartDate); // benchmark close at common start

  const series = commonDates.map((date) => {
    const P_t = portfolioMap.get(date);
    const B_t = benchmarkMap.get(date);
    return {
      date,
      portfolioBase100: 100.0 * P_t / P_start,
      benchmarkBase100: 100.0 * B_t / B_start
    };
  });

  // --- 5g. Same-endpoint return comparison ---
  const P_end = portfolioMap.get(commonEndDate);
  const B_end = benchmarkMap.get(commonEndDate);

  const portfolioReturnPctOnCommonPeriod = (P_end / P_start - 1.0) * 100.0;
  const benchmarkReturnPct = (B_end / B_start - 1.0) * 100.0;

  // returnDifferencePctPoints only for VND_COMPARABLE benchmarks
  const returnDifferencePctPoints = benchmarkDef.comparability === 'VND_COMPARABLE'
    ? portfolioReturnPctOnCommonPeriod - benchmarkReturnPct
    : null;

  // --- 5h. Period metadata ---
  const perfPeriod = portfolioPerformance.period || {};
  const latestBenchmarkDate = [...benchmarkMap.keys()].sort().at(-1) ?? null;

  return {
    status: 'available',
    reason: null,
    benchmark: _benchmarkPublicMetadata(benchmarkDef),
    period: {
      range: perfPeriod.range || null,
      portfolioActualStartDate: perfPeriod.actualStartDate || null,
      portfolioActualEndDate: perfPeriod.endDate || null,
      commonStartDate,
      commonEndDate,
      commonDatesCount: commonDates.length
    },
    portfolio: {
      returnType: 'TWR',
      returnPctOnCommonPeriod: portfolioReturnPctOnCommonPeriod
    },
    benchmarkReturnPct,
    returnDifferencePctPoints,
    series,
    provenance: _buildProvenance(
      benchmarkDef,
      latestBenchmarkDate,
      commonStartDate,
      commonEndDate,
      commonDates.length
    )
  };
}

function _benchmarkPublicMetadata(def) {
  const meta = {
    id: def.id,
    name: def.name,
    provider: def.provider,
    providerIdentifier: def.providerIdentifier,
    quoteCurrency: def.quoteCurrency,
    returnType: def.returnType,
    comparability: def.comparability,
    currencyAdjusted: def.currencyAdjusted
  };
  // For reference-only benchmarks, expose currency mismatch details
  if (def.comparability === 'REFERENCE_ONLY_CURRENCY_MISMATCH') {
    meta.portfolioReportingCurrency = 'VND';
    meta.benchmarkQuoteCurrency = def.quoteCurrency;
    meta.currencyMismatchReason = def.currencyMismatchReason;
  }
  return meta;
}

function _buildProvenance(def, latestBenchmarkDate, commonStart, commonEnd, commonCount) {
  return {
    benchmarkId: def.id,
    provider: def.provider,
    providerIdentifier: def.providerIdentifier,
    quoteCurrency: def.quoteCurrency,
    returnType: def.returnType,
    comparability: def.comparability,
    latestCompletedDate: latestBenchmarkDate,
    commonStartDate: commonStart,
    commonEndDate: commonEnd,
    commonDatesCount: commonCount
  };
}

// ---------------------------------------------------------------------------
// 6. PUBLIC SERVICE FUNCTION
// ---------------------------------------------------------------------------

/**
 * Retrieves portfolio benchmark comparison.
 *
 * @param {Object} params
 * @param {string}   params.benchmarkId        - Validated benchmark ID (e.g. 'VN_INDEX')
 * @param {string}   params.range              - Performance range (e.g. '1M')
 * @param {Date}     [params.now]              - Reference time
 * @param {Function} [params.getPortfolioPerformanceFn] - Injectable performance service
 * @param {Function} [params.fetchFn]          - Injectable fetch (for testing)
 * @param {Function} [params.getYahooHistoryFn] - Injectable Yahoo history (for testing)
 * @returns {Promise<Object>} Benchmark comparison result
 */
export async function getPortfolioBenchmark({
  benchmarkId,
  range = '1M',
  now = new Date(),
  getPortfolioPerformanceFn,
  fetchFn,
  getYahooHistoryFn
} = {}) {
  // 1. Resolve benchmark definition (throws 400 on invalid/unknown)
  const def = resolveBenchmark(benchmarkId);
  const normalizedRange = typeof range === 'string' ? range.trim().toUpperCase() : '';
  if (!PUBLIC_PERFORMANCE_RANGES.includes(normalizedRange)) {
    const error = new Error(`Invalid benchmark range '${range}'`);
    error.code = 'INVALID_PERFORMANCE_RANGE';
    error.status = 400;
    throw error;
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    const error = new Error('Benchmark now must be a valid Date object');
    error.code = 'INVALID_TIME_CONTEXT';
    error.status = 400;
    throw error;
  }

  // 2. Get portfolio performance (Feature 25B authoritative)
  // Import lazily to avoid circular — caller must inject or we import here
  let getPerf = getPortfolioPerformanceFn;
  if (!getPerf) {
    const perfMod = await import('./performance.js');
    getPerf = perfMod.getPortfolioPerformance;
  }

  const portfolioPerformance = await getPerf({ range: normalizedRange, now });

  // 3. Determine if TWR is valid enough to fetch benchmark history
  const { valid: twrValid, reason: twrInvalidReason } = portfolioTwrIsValid(portfolioPerformance);

  if (!twrValid) {
    return {
      status: 'unavailable',
      reason: twrInvalidReason || 'TWR_UNAVAILABLE',
      benchmark: _benchmarkPublicMetadata(def),
      period: null,
      portfolio: { returnType: 'TWR', returnPctOnCommonPeriod: null },
      benchmarkReturnPct: null,
      returnDifferencePctPoints: null,
      series: [],
      provenance: _buildProvenance(def, null, null, null, 0)
    };
  }

  // 4. Determine date range for benchmark history fetch
  const perfPeriod = portfolioPerformance.period;
  const actualStartDate = perfPeriod?.actualStartDate;
  const actualEndDate = perfPeriod?.endDate;

  if (!actualStartDate || !actualEndDate) {
    return {
      status: 'unavailable',
      reason: 'PORTFOLIO_PERIOD_UNAVAILABLE',
      benchmark: _benchmarkPublicMetadata(def),
      period: null,
      portfolio: { returnType: 'TWR', returnPctOnCommonPeriod: null },
      benchmarkReturnPct: null,
      returnDifferencePctPoints: null,
      series: [],
      provenance: _buildProvenance(def, null, null, null, 0)
    };
  }

  // 5. Fetch benchmark history for the portfolio's actual period
  let benchmarkBars;
  try {
    benchmarkBars = await getBenchmarkHistory(
      def,
      actualStartDate,
      actualEndDate,
      now,
      { fetchFn, getYahooHistoryFn }
    );
  } catch (err) {
    // Provider failure is isolated — return controlled unavailable, not 500
    const providerErr = new Error(`Benchmark data for '${def.id}' is temporarily unavailable`);
    providerErr.code = err.code || 'PROVIDER_ERROR';
    providerErr.status = err.status || 502;
    throw providerErr;
  }

  // 6. Run pure comparison engine
  return calculateBenchmarkComparison({
    portfolioPerformance,
    benchmarkDef: def,
    benchmarkBars,
    now
  });
}
