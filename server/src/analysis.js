import { getAnalysisHistory, getMarketSnapshot } from './market.js';

export const PERIOD_THRESHOLDS = {
  '1W': 3,
  '1M': 15,
  '3M': 45,
  '6M': 90,
  '1Y': 180
};

export const ANALYSIS_PERIODS = ['1W', '1M', '3M', '6M', '1Y'];

/**
 * Returns YYYY-MM-DD string representing the Vietnam-local date (UTC+7) of a given timestamp or Date.
 * Pure deterministic date converter with no system clock fallback.
 * @param {number|string|Date} ts - Timestamp in seconds or ms, ISO string, or Date object
 * @returns {string} - YYYY-MM-DD
 */
export function getVietnamDateKey(ts) {
  if (ts === undefined || ts === null) {
    throw new Error('Timestamp or Date is required for getVietnamDateKey');
  }

  let dateObj;
  if (ts instanceof Date) {
    dateObj = ts;
  } else if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error('Invalid numeric timestamp for getVietnamDateKey');
    }
    dateObj = new Date(ts < 1e11 ? ts * 1000 : ts);
  } else if (typeof ts === 'string') {
    dateObj = new Date(ts);
  } else {
    throw new Error('Invalid timestamp type for getVietnamDateKey');
  }

  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid Date in getVietnamDateKey');
  }

  // Shift to UTC+7
  const vnTime = new Date(dateObj.getTime() + 7 * 3600 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

/**
 * Computes calendar lookback boundary date string (YYYY-MM-DD) relative to a given Vietnam date string (YYYY-MM-DD).
 * Lookback types: '1W', '1M', '3M', '6M', '1Y'
 * @param {string} vietnamDateStr - YYYY-MM-DD
 * @param {string} lookbackType - '1W' | '1M' | '3M' | '6M' | '1Y'
 * @returns {string} - YYYY-MM-DD
 */
export function computeLookbackDate(vietnamDateStr, lookbackType) {
  const parts = vietnamDateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1]; // 1-12
  const day = parts[2];

  if (lookbackType === '1W') {
    const d = new Date(Date.UTC(year, month - 1, day - 7));
    return d.toISOString().slice(0, 10);
  }

  let monthsBack = 1;
  if (lookbackType === '1M') monthsBack = 1;
  else if (lookbackType === '3M') monthsBack = 3;
  else if (lookbackType === '6M') monthsBack = 6;
  else if (lookbackType === '1Y') monthsBack = 12;

  let targetYear = year;
  let targetMonth = month - monthsBack;
  while (targetMonth < 1) {
    targetMonth += 12;
    targetYear -= 1;
  }

  // Days in target month
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/**
 * Pure deterministic quantitative analysis engine for a single asset's completed historical daily bars.
 *
 * Rules:
 * 1. Excludes current-day (or future) Vietnam calendar sessions to ensure only completed daily bars are analyzed.
 * 2. All lookback periods share one analysisPrice and one analysisAsOf from the latest completed bar.
 * 3. Calendar lookback windows (1W, 1M, 3M, 6M, 1Y) with strict session thresholds.
 * 4. Full precision priceChangePct, rangePositionPct, distanceBelowHighPct.
 * 5. Descriptive cross-period positive breadth ratio (requires >= 3 valid periods).
 * 6. Pure dataCompleteness assessment (no scoring / rating).
 * 7. Snapshot is kept strictly separated and does not affect calculations.
 * 8. NO HIDDEN CLOCK: options.now MUST strictly be a valid Date instance (instanceof Date && finite).
 *
 * @param {Array<Object>} rawBars - Normalized daily historical bars
 * @param {Object} options - Deterministic options (symbol, snapshot, now [REQUIRED Date instance], warnings)
 * @returns {Object} Deterministic asset analysis structure
 */
export function analyzeAssetHistory(rawBars, options = {}) {
  if (!Array.isArray(rawBars) || rawBars.length === 0) {
    const err = new Error(`No historical data available for '${options?.symbol || 'asset'}'`);
    err.status = 404;
    throw err;
  }

  // Pure engine must have NO hidden clock: options.now must strictly be a valid Date object
  if (!options || !(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
    throw new TypeError('options.now is required and must be a valid Date object');
  }

  const symbol = (options.symbol || 'UNKNOWN').toString().trim().toUpperCase();
  const currentVietnamDate = getVietnamDateKey(options.now);

  // Filter valid bars and exclude current-day/future Vietnam sessions
  let excludedCurrentDayCount = 0;
  const validCompletedBars = [];

  for (const bar of rawBars) {
    if (!bar || typeof bar !== 'object') continue;
    const ts = bar.timestamp;
    const c = bar.close;
    if (!ts || typeof c !== 'number' || !Number.isFinite(c) || c <= 0) {
      continue;
    }

    const barVietnamDate = getVietnamDateKey(ts);
    if (barVietnamDate >= currentVietnamDate) {
      excludedCurrentDayCount++;
      continue;
    }

    validCompletedBars.push({
      timestamp: typeof ts === 'string' ? ts : new Date(ts < 1e11 ? ts * 1000 : ts).toISOString(),
      open: typeof bar.open === 'number' && Number.isFinite(bar.open) && bar.open > 0 ? bar.open : null,
      high: typeof bar.high === 'number' && Number.isFinite(bar.high) && bar.high > 0 ? bar.high : null,
      low: typeof bar.low === 'number' && Number.isFinite(bar.low) && bar.low > 0 ? bar.low : null,
      close: c,
      volume: typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : null,
      vietnamDate: barVietnamDate,
      tsMs: new Date(ts < 1e11 && typeof ts === 'number' ? ts * 1000 : ts).getTime()
    });
  }

  if (validCompletedBars.length === 0) {
    const err = new Error(`No valid completed historical price records found for '${symbol}'`);
    err.status = 404;
    throw err;
  }

  // Sort completed bars chronologically oldest to newest
  validCompletedBars.sort((a, b) => a.tsMs - b.tsMs);

  // Authoritative analysis reference from latest completed bar
  const lastBar = validCompletedBars[validCompletedBars.length - 1];
  const analysisPrice = lastBar.close;
  const analysisAsOf = lastBar.timestamp;
  const analysisPriceSource = 'last_completed_daily_close';
  const analysisVietnamDate = lastBar.vietnamDate;

  // Process lookback periods
  const periods = {};

  for (const periodKey of ANALYSIS_PERIODS) {
    const threshold = PERIOD_THRESHOLDS[periodKey];
    const windowStartDate = computeLookbackDate(analysisVietnamDate, periodKey);

    // Select valid completed bars in calendar window [windowStartDate, analysisVietnamDate]
    const periodBars = validCompletedBars.filter(
      (b) => b.vietnamDate >= windowStartDate && b.vietnamDate <= analysisVietnamDate
    );

    const validSessionCount = periodBars.length;
    const unavailableReasons = [];

    if (validSessionCount < threshold) {
      unavailableReasons.push('insufficient_sessions');
      periods[periodKey] = {
        status: 'unavailable',
        unavailableReasons,
        observedStartAt: periodBars.length > 0 ? periodBars[0].timestamp : null,
        observedEndAt: analysisAsOf,
        validSessionCount,
        periodStartPrice: null,
        periodEndPrice: null,
        priceChangePct: null,
        absoluteChange: null,
        periodHighPrice: null,
        periodLowPrice: null,
        rangePositionPct: null,
        distanceBelowHighPct: null
      };
      continue;
    }

    const firstBar = periodBars[0];
    const periodStartPrice = firstBar.close;
    const observedStartAt = firstBar.timestamp;
    const observedEndAt = analysisAsOf;

    let priceChangePct = null;
    let absoluteChange = null;

    if (typeof periodStartPrice !== 'number' || !Number.isFinite(periodStartPrice) || periodStartPrice <= 0) {
      unavailableReasons.push('invalid_start_price');
    } else {
      priceChangePct = ((analysisPrice / periodStartPrice) - 1) * 100;
      absoluteChange = analysisPrice - periodStartPrice;
    }

    // High / Low observations
    const validHighs = periodBars
      .map((b) => b.high)
      .filter((h) => typeof h === 'number' && Number.isFinite(h) && h > 0);
    const validLows = periodBars
      .map((b) => b.low)
      .filter((l) => typeof l === 'number' && Number.isFinite(l) && l > 0);

    const hasMissingHigh = validHighs.length < periodBars.length;
    const hasMissingLow = validLows.length < periodBars.length;

    if (hasMissingHigh) {
      unavailableReasons.push('missing_high');
    }
    if (hasMissingLow) {
      unavailableReasons.push('missing_low');
    }

    const periodHighPrice = hasMissingHigh ? null : Math.max(...validHighs);
    const periodLowPrice = hasMissingLow ? null : Math.min(...validLows);

    let rangePositionPct = null;
    let distanceBelowHighPct = null;

    // Range Position Calculation
    if (periodHighPrice !== null && periodLowPrice !== null) {
      if (periodHighPrice === periodLowPrice) {
        unavailableReasons.push('flat_range');
      } else if (analysisPrice < periodLowPrice || analysisPrice > periodHighPrice) {
        unavailableReasons.push('analysis_price_outside_range');
      } else {
        rangePositionPct = (100 * (analysisPrice - periodLowPrice)) / (periodHighPrice - periodLowPrice);
      }
    }

    // Distance Below Period High Calculation
    if (periodHighPrice !== null) {
      if (analysisPrice > periodHighPrice) {
        if (!unavailableReasons.includes('analysis_price_outside_range')) {
          unavailableReasons.push('analysis_price_outside_range');
        }
      } else if (periodHighPrice === periodLowPrice && periodHighPrice === analysisPrice) {
        // Special case: periodHighPrice == periodLowPrice == analysisPrice > 0 -> distanceBelowHighPct = 0
        distanceBelowHighPct = 0;
      } else {
        distanceBelowHighPct = (100 * (periodHighPrice - analysisPrice)) / periodHighPrice;
      }
    }

    const status = priceChangePct !== null ? 'available' : 'unavailable';

    periods[periodKey] = {
      status,
      unavailableReasons: Array.from(new Set(unavailableReasons)),
      observedStartAt,
      observedEndAt,
      validSessionCount,
      periodStartPrice: typeof periodStartPrice === 'number' && periodStartPrice > 0 ? periodStartPrice : null,
      periodEndPrice: analysisPrice,
      priceChangePct,
      absoluteChange,
      periodHighPrice,
      periodLowPrice,
      rangePositionPct,
      distanceBelowHighPct
    };
  }

  // Cross-period positive breadth
  let positivePeriodCount = 0;
  let negativePeriodCount = 0;
  let zeroChangePeriodCount = 0;

  for (const periodKey of ANALYSIS_PERIODS) {
    const p = periods[periodKey];
    if (p && p.status === 'available' && typeof p.priceChangePct === 'number' && Number.isFinite(p.priceChangePct)) {
      if (p.priceChangePct > 0) {
        positivePeriodCount++;
      } else if (p.priceChangePct < 0) {
        negativePeriodCount++;
      } else {
        zeroChangePeriodCount++;
      }
    }
  }

  const validPeriodCount = positivePeriodCount + negativePeriodCount + zeroChangePeriodCount;
  const positivePeriodRatio = validPeriodCount >= 3 ? positivePeriodCount / validPeriodCount : null;

  // Data completeness
  const availableRanges = ANALYSIS_PERIODS.filter((pKey) => periods[pKey]?.status === 'available');
  const unavailableRanges = ANALYSIS_PERIODS.filter((pKey) => periods[pKey]?.status !== 'available');
  const periodCompletenessRatio = availableRanges.length / 5;

  let availabilityLevel = 'unavailable';
  if (availableRanges.length === 5) {
    availabilityLevel = 'complete';
  } else if (availableRanges.length >= 3) {
    availabilityLevel = 'partial';
  } else if (availableRanges.length >= 1) {
    availabilityLevel = 'limited';
  } else {
    availabilityLevel = 'unavailable';
  }

  const warnings = [];
  if (excludedCurrentDayCount > 0) {
    warnings.push(`Current-day Vietnam session excluded from analysis (last completed close used: ${analysisVietnamDate})`);
  }
  if (unavailableRanges.length > 0) {
    warnings.push(`Lookback periods unavailable due to insufficient sessions or invalid data: ${unavailableRanges.join(', ')}`);
  }
  if (Array.isArray(options.warnings)) {
    for (const w of options.warnings) {
      if (typeof w === 'string') warnings.push(w);
      else if (w && w.message) warnings.push(w.message);
    }
  }

  // Snapshot context (optional, non-participating)
  let snapshot = null;
  if (options.snapshot && typeof options.snapshot === 'object') {
    snapshot = {
      price: typeof options.snapshot.price === 'number' && Number.isFinite(options.snapshot.price) && options.snapshot.price > 0
        ? options.snapshot.price
        : null,
      priceAsOf: options.snapshot.priceAsOf || null,
      freshness: options.snapshot.freshness || 'delayed',
      priceSource: options.snapshot.priceSource || 'yahoo_delayed_snapshot'
    };
  }

  const methodology = {
    priceChangeMetric: 'unadjusted_close_change',
    dividendsIncluded: false,
    corporateActionsModeled: false,
    analysisPriceSource: 'last_completed_daily_close'
  };

  return {
    symbol,
    analysisPrice,
    analysisAsOf,
    analysisPriceSource,
    freshness: 'delayed',
    snapshot,
    periods,
    crossPeriod: {
      positivePeriodRatio,
      positivePeriodCount,
      negativePeriodCount,
      zeroChangePeriodCount,
      validPeriodCount
    },
    dataCompleteness: {
      periodCompletenessRatio,
      availabilityLevel,
      availableRanges,
      unavailableRanges,
      warnings
    },
    methodology
  };
}

/**
 * Integration function to fetch Yahoo historical daily bars (2Y superset) and produce deterministic asset analysis.
 * Obtains concrete system time once at integration boundary if not injected.
 * @param {string} rawSymbol - Asset symbol (e.g. 'FPT')
 * @param {Object} [options] - Injected services/context for testing
 */
export async function getAssetAnalysis(rawSymbol, options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();

  const getAnalysisHistoryFn = options.getAnalysisHistoryFn || options.getMarketHistoryFn || getAnalysisHistory;
  const getMarketSnapshotFn = options.getMarketSnapshotFn || getMarketSnapshot;

  // 1. Fetch 2Y daily history superset from dedicated Feature 07 analysis history provider
  const historyResult = await getAnalysisHistoryFn(symbol);

  // 2. Fetch market snapshot context (optional, provider failures do not invalidate historical analysis)
  let snapshot = null;
  try {
    snapshot = await getMarketSnapshotFn(symbol);
  } catch (_snapErr) {
    snapshot = null;
  }

  // 3. Obtain current time ONCE at integration boundary
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now : new Date();

  // 4. Run pure deterministic quantitative analysis
  return analyzeAssetHistory(historyResult.bars, {
    symbol,
    snapshot,
    now,
    warnings: historyResult.warnings
  });
}
