import { analyzeCanonicalHistory, ANALYSIS_METHODOLOGY_VERSION } from './analysis.js';
import { resolveProviderMapping } from './assets.js';
import { PUBLIC_HISTORY_RANGES } from './history.js';
import {
  getAssetMarketCapabilities,
  getMarketHistory,
  getMarketSnapshot,
  getProviderAdapter
} from './market.js';

/**
 * Feature 11: Asset Comparison Helper Functions
 * Pure deterministic helpers for asset selection validation, price normalization, and descriptive labeling.
 */

/**
 * Validates and sanitizes a list of asset symbols selected for comparison.
 * - Prevents duplicate symbols (case-insensitive deduplication).
 * - Enforces minimum 2 and maximum 4 assets limit.
 *
 * @param {Array<string>} symbols - Array of asset symbols
 * @param {Array<string>} availableSymbols - Optional array of valid system symbols to check against
 * @returns {{ valid: boolean, symbols: string[], error: string|null }}
 */
export function validateComparisonSelection(symbols, availableSymbols = null) {
  if (!Array.isArray(symbols)) {
    return {
      valid: false,
      symbols: [],
      error: 'Danh sách tài sản so sánh không hợp lệ.'
    };
  }

  // Deduplicate and normalize
  const seen = new Set();
  const deduped = [];

  for (const rawSym of symbols) {
    if (typeof rawSym !== 'string') continue;
    const sym = rawSym.trim().toUpperCase();
    if (!sym) continue;

    if (availableSymbols && Array.isArray(availableSymbols)) {
      const isAvailable = availableSymbols.some(
        (s) => typeof s === 'string' && s.trim().toUpperCase() === sym
      );
      if (!isAvailable) {
        continue; // skip symbols not in system
      }
    }

    if (!seen.has(sym)) {
      seen.add(sym);
      deduped.push(sym);
    }
  }

  // Cap at maximum 4
  const capped = deduped.slice(0, 4);

  if (capped.length < 2) {
    return {
      valid: false,
      symbols: capped,
      error: 'Chọn từ 2 đến 4 tài sản để so sánh.'
    };
  }

  return {
    valid: true,
    symbols: capped,
    error: null
  };
}

/**
 * Calculates normalized relative prices with Base = 100 at the start of the period.
 * Pure deterministic transformation of daily historical bars for side-by-side visual comparison.
 *
 * Formula: normalizedValue_i = (close_i / baseClose) * 100
 *
 * @param {Array<Object>} bars - Array of historical daily bars with { timestamp, close }
 * @returns {Array<Object>|null} Array of normalized points or null if insufficient valid data
 */
export function normalizeHistoricalPrices(bars) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return null;
  }

  // Filter valid bars with positive close price and valid timestamp
  const validBars = bars.filter(
    (b) => b && typeof b === 'object' && typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0 && b.timestamp
  );

  if (validBars.length < 2) {
    return null;
  }

  const baseBar = validBars[0];
  const baseClose = baseBar.close;

  if (typeof baseClose !== 'number' || !Number.isFinite(baseClose) || baseClose <= 0) {
    return null;
  }

  return validBars.map((bar) => {
    const rawRatio = bar.close / baseClose;
    const normalizedValue = rawRatio * 100;

    return {
      timestamp: bar.timestamp,
      close: bar.close,
      normalizedValue: Number.isFinite(normalizedValue) ? normalizedValue : null
    };
  });
}

/**
 * Descriptive Vietnamese data completeness translation.
 * complete -> Đầy đủ
 * partial -> Một phần
 * limited -> Hạn chế
 * unavailable -> Chưa đủ dữ liệu
 *
 * @param {string} level - Availability level from backend analysis
 * @returns {string} Vietnamese translated label
 */
export function translateDataCompleteness(level) {
  switch (level) {
    case 'complete':
      return 'Đầy đủ';
    case 'partial':
      return 'Một phần';
    case 'limited':
      return 'Hạn chế';
    case 'unavailable':
    default:
      return 'Chưa đủ dữ liệu';
  }
}

export const MIN_COMMON_COMPARISON_OBSERVATIONS = 2;

const UNIVERSAL_METRICS = Object.freeze([
  'priceChangePct',
  'completedCloseRangePositionPct',
  'distanceBelowHighestCompletedClosePct',
  'positiveCloseTransitionRatio',
  'dailyVolatilityPct',
  'maxDrawdownPct'
]);

function comparisonError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeComparisonNow(now) {
  const resolved = now === undefined ? new Date() : now;
  if (!(resolved instanceof Date) || !Number.isFinite(resolved.getTime())) {
    throw comparisonError('Comparison now must be a valid Date object', 'INVALID_TIME_CONTEXT');
  }
  return resolved;
}

function errorContext(error, fallbackCode) {
  return {
    code: typeof error?.code === 'string' ? error.code : fallbackCode,
    message: typeof error?.message === 'string' ? error.message : null
  };
}

function projectSnapshot(snapshot, asset, error = null) {
  const price = typeof snapshot?.price === 'number' && Number.isFinite(snapshot.price) && snapshot.price > 0
    ? snapshot.price
    : null;
  return {
    status: price === null ? 'unavailable' : 'available',
    price,
    quoteCurrency: asset.quoteCurrency ?? asset.quote_currency ?? null,
    priceAsOf: snapshot?.priceAsOf ?? null,
    freshness: snapshot?.freshness ?? null,
    priceSource: snapshot?.priceSource ?? null,
    change: snapshot?.change ?? null,
    changePercent: snapshot?.changePercent ?? null,
    changeBasis: snapshot?.changeBasis ?? 'UNAVAILABLE',
    volume: snapshot?.volume ?? null,
    volumeSemantics: snapshot?.volumeSemantics ?? 'UNAVAILABLE',
    error: error ? errorContext(error, 'SNAPSHOT_UNAVAILABLE') : null
  };
}

function projectUniversalAnalysis(analysis, range) {
  const period = analysis.periods?.[range];
  if (!period) {
    return {
      status: 'unavailable',
      reason: 'ANALYSIS_RANGE_UNAVAILABLE',
      methodologyVersion: analysis.methodologyVersion ?? ANALYSIS_METHODOLOGY_VERSION,
      metrics: {},
      metricStatus: {}
    };
  }

  const metrics = {};
  const metricStatus = {};
  for (const metricName of UNIVERSAL_METRICS) {
    metrics[metricName] = period[metricName] ?? null;
    metricStatus[metricName] = period.metricStatus?.[metricName] ?? {
      status: 'unavailable',
      reason: 'METRIC_UNAVAILABLE'
    };
  }

  return {
    status: period.status,
    reason: null,
    methodologyVersion: analysis.methodologyVersion,
    analysisAsOf: analysis.analysisAsOf,
    analysisPrice: analysis.analysisPrice,
    observedStartDate: period.observedStartDate,
    observedEndDate: period.observedEndDate,
    usableCompletedBarCount: period.usableCompletedBarCount,
    metrics,
    metricStatus
  };
}

function canonicalBarsByDate(history) {
  const bars = new Map();
  for (const bar of Array.isArray(history?.bars) ? history.bars : []) {
    if (
      typeof bar?.date !== 'string' ||
      typeof bar?.close !== 'number' ||
      !Number.isFinite(bar.close) ||
      bar.close <= 0 ||
      typeof bar?.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(bar.timestamp))
    ) {
      continue;
    }
    bars.set(bar.date, bar);
  }
  return bars;
}

/**
 * Builds a comparison curve exclusively from genuine common canonical dates.
 * No dates are borrowed, shifted, synthesized, or forward-filled.
 */
export function buildCommonDateBase100(historyEntries, minimumObservations = MIN_COMMON_COMPARISON_OBSERVATIONS) {
  if (!Array.isArray(historyEntries) || historyEntries.length < 2) {
    return {
      status: 'insufficient_data',
      reason: 'INSUFFICIENT_HISTORY_ASSETS',
      commonStartDate: null,
      commonEndDate: null,
      commonObservationCount: 0,
      series: []
    };
  }

  const normalized = historyEntries.map((entry) => ({
    symbol: entry.symbol,
    quoteCurrency: entry.quoteCurrency ?? null,
    barsByDate: canonicalBarsByDate(entry.history)
  }));

  let commonDates = new Set(normalized[0].barsByDate.keys());
  for (const entry of normalized.slice(1)) {
    commonDates = new Set([...commonDates].filter((date) => entry.barsByDate.has(date)));
  }
  const dates = [...commonDates].sort();

  if (dates.length < minimumObservations) {
    return {
      status: 'insufficient_data',
      reason: 'INSUFFICIENT_COMMON_OBSERVATIONS',
      commonStartDate: dates[0] ?? null,
      commonEndDate: dates.at(-1) ?? null,
      commonObservationCount: dates.length,
      series: []
    };
  }

  return {
    status: 'available',
    reason: null,
    commonStartDate: dates[0],
    commonEndDate: dates.at(-1),
    commonObservationCount: dates.length,
    series: normalized.map((entry) => {
      const baseClose = entry.barsByDate.get(dates[0]).close;
      return {
        symbol: entry.symbol,
        quoteCurrency: entry.quoteCurrency,
        points: dates.map((date) => {
          const bar = entry.barsByDate.get(date);
          return {
            date,
            timestamp: bar.timestamp,
            close: bar.close,
            base100: (bar.close / baseClose) * 100
          };
        })
      };
    })
  };
}

/**
 * Provider-neutral multi-asset comparison contract for 2-4 canonical assets.
 * Uses one evaluation clock and Feature 21/22 history + analysis semantics.
 */
export async function getAssetComparison(rawSymbols, rawRange = '1M', options = {}) {
  const selection = validateComparisonSelection(rawSymbols);
  if (!selection.valid) {
    throw comparisonError(selection.error, 'INVALID_COMPARISON_SELECTION');
  }

  const range = String(rawRange || '1M').trim().toUpperCase();
  if (!PUBLIC_HISTORY_RANGES.includes(range)) {
    throw comparisonError(
      `Invalid range '${rawRange}'. Supported ranges: ${PUBLIC_HISTORY_RANGES.join(', ')}`,
      'INVALID_HISTORY_RANGE'
    );
  }

  const now = normalizeComparisonNow(options.now);
  const resolveProviderMappingFn = options.resolveProviderMappingFn || resolveProviderMapping;
  const getProviderAdapterFn = options.getProviderAdapterFn || getProviderAdapter;
  const getMarketSnapshotFn = options.getMarketSnapshotFn || getMarketSnapshot;
  const getMarketHistoryFn = options.getMarketHistoryFn || getMarketHistory;

  const resolvedAssets = await Promise.all(selection.symbols.map(async (symbol) => {
    const { asset, mapping } = await resolveProviderMappingFn(
      symbol,
      null,
      options.providerResolverOptions || {}
    );
    const adapter = getProviderAdapterFn(mapping.provider);
    if (!adapter) {
      throw comparisonError(
        `Provider '${mapping.provider}' is unsupported for asset '${asset.symbol}'`,
        'UNSUPPORTED_PROVIDER',
        422
      );
    }
    return {
      asset,
      mapping,
      adapter,
      capabilities: getAssetMarketCapabilities(asset, adapter)
    };
  }));

  const results = await Promise.all(resolvedAssets.map(async (resolved) => {
    const { asset, mapping, adapter, capabilities } = resolved;
    const providerOptions = {
      ...options.providerOptions,
      now,
      resolveProviderMappingFn: async () => ({ asset, mapping }),
      providerAdapter: adapter
    };

    let snapshot = null;
    let snapshotError = null;
    if (capabilities.snapshot) {
      try {
        snapshot = await getMarketSnapshotFn(asset.symbol, providerOptions);
      } catch (error) {
        snapshotError = error;
      }
    }

    let history = null;
    let historyError = null;
    if (capabilities.history) {
      try {
        history = await getMarketHistoryFn(asset.symbol, range, providerOptions);
      } catch (error) {
        historyError = error;
      }
    }

    let analysis = null;
    let analysisError = null;
    if (capabilities.analysis && history) {
      try {
        analysis = analyzeCanonicalHistory(history, { requestedRange: range, snapshot });
      } catch (error) {
        analysisError = error;
      }
    }

    return {
      asset,
      capabilities,
      snapshot: projectSnapshot(snapshot, asset, snapshotError),
      history,
      historyStatus: capabilities.history
        ? (history ? { status: 'available', reason: null } : {
            status: 'unavailable',
            reason: errorContext(historyError, 'HISTORY_UNAVAILABLE').code
          })
        : { status: 'unsupported', reason: 'UNSUPPORTED_HISTORY' },
      analysis: !capabilities.analysis
        ? { status: 'unsupported', reason: 'UNSUPPORTED_HISTORY' }
        : analysis
          ? projectUniversalAnalysis(analysis, range)
          : {
              status: 'unavailable',
              reason: errorContext(analysisError || historyError, 'ANALYSIS_UNAVAILABLE').code
            }
    };
  }));

  const expectedHistoryAssets = results.filter((result) => result.capabilities.history);
  const unavailableHistoryAssets = expectedHistoryAssets.filter((result) => !result.history);
  let base100;
  if (unavailableHistoryAssets.length > 0) {
    base100 = {
      status: 'unavailable',
      reason: 'HISTORY_UNAVAILABLE_FOR_SELECTED_ASSET',
      commonStartDate: null,
      commonEndDate: null,
      commonObservationCount: 0,
      series: []
    };
  } else {
    base100 = buildCommonDateBase100(expectedHistoryAssets.map((result) => ({
      symbol: result.asset.symbol,
      quoteCurrency: result.asset.quoteCurrency ?? result.asset.quote_currency ?? null,
      history: result.history
    })));
  }

  return {
    range,
    evaluatedAt: now.toISOString(),
    methodologyVersion: ANALYSIS_METHODOLOGY_VERSION,
    assets: results.map((result) => ({
      assetId: result.asset.id ?? null,
      symbol: result.asset.symbol,
      name: result.asset.name ?? result.asset.symbol,
      assetType: result.asset.assetType ?? result.asset.asset_type ?? null,
      quoteCurrency: result.asset.quoteCurrency ?? result.asset.quote_currency ?? null,
      marketPolicy: result.asset.marketPolicy ?? result.asset.market_policy ?? null,
      marketTimezone: result.asset.marketTimezone ?? result.asset.market_timezone ?? null,
      capabilities: result.capabilities,
      snapshot: result.snapshot,
      historyStatus: result.historyStatus,
      analysis: result.analysis
    })),
    base100
  };
}
