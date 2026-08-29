import { getMarketHistory, getMarketSnapshot } from './market.js';
import { getHistoryRangeStart, PUBLIC_HISTORY_RANGES } from './history.js';

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
      priceSource: options.snapshot.priceSource || null
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

export const ANALYSIS_METHODOLOGY_VERSION = 'v2';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function createAnalysisError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function metricStatus(status, reason = null) {
  return { status, reason };
}

function isValidCanonicalDate(dateKey) {
  if (typeof dateKey !== 'string') return false;
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === dateKey;
}

function optionalPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function optionalVolume(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeSnapshotContext(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    price: optionalPositiveNumber(snapshot.price),
    priceAsOf: typeof snapshot.priceAsOf === 'string' && snapshot.priceAsOf ? snapshot.priceAsOf : null,
    freshness: typeof snapshot.freshness === 'string' && snapshot.freshness ? snapshot.freshness : null,
    priceSource: typeof snapshot.priceSource === 'string' && snapshot.priceSource ? snapshot.priceSource : null
  };
}

function validateHistoryCapabilities(historyCapabilities) {
  if (
    !historyCapabilities ||
    typeof historyCapabilities.close !== 'boolean' ||
    typeof historyCapabilities.ohlc !== 'boolean' ||
    typeof historyCapabilities.volume !== 'boolean'
  ) {
    throw createAnalysisError(
      'Canonical history capability metadata is required for analysis',
      'INVALID_HISTORY_CAPABILITIES',
      500
    );
  }
  if (!historyCapabilities.close) {
    throw createAnalysisError(
      'Completed close history is unsupported for this asset',
      'UNSUPPORTED_HISTORY',
      422
    );
  }
  return {
    close: true,
    ohlc: historyCapabilities.ohlc,
    volume: historyCapabilities.volume
  };
}

function validateCanonicalHistoryMetadata(historyResult) {
  const metadata = {
    symbol: typeof historyResult.symbol === 'string' ? historyResult.symbol.trim().toUpperCase() : '',
    assetType: typeof historyResult.assetType === 'string' ? historyResult.assetType.trim() : '',
    marketPolicy: typeof historyResult.marketPolicy === 'string' ? historyResult.marketPolicy.trim() : '',
    marketTimezone: typeof historyResult.marketTimezone === 'string' ? historyResult.marketTimezone.trim() : '',
    quoteCurrency: typeof historyResult.quoteCurrency === 'string' ? historyResult.quoteCurrency.trim() : ''
  };
  if (Object.values(metadata).some((value) => !value)) {
    throw createAnalysisError(
      'Canonical asset metadata is required for analysis',
      'INVALID_HISTORY_METADATA',
      500
    );
  }
  if (!['complete', 'partial'].includes(historyResult.dataCompleteness)) {
    throw createAnalysisError(
      'Canonical history completeness metadata is required for analysis',
      'INVALID_HISTORY_METADATA',
      500
    );
  }
  return metadata;
}

function normalizeCanonicalBars(rawBars, symbol) {
  if (!Array.isArray(rawBars) || rawBars.length === 0) {
    throw createAnalysisError(`No historical data available for '${symbol}'`, 'NO_HISTORY', 404);
  }

  const bars = [];
  let rejectedBarCount = 0;
  for (const bar of rawBars) {
    const timestampMs = Date.parse(bar?.timestamp);
    if (
      !bar ||
      bar.isComplete !== true ||
      !isValidCanonicalDate(bar.date) ||
      !Number.isFinite(timestampMs) ||
      optionalPositiveNumber(bar.close) === null
    ) {
      rejectedBarCount++;
      continue;
    }
    bars.push({
      timestamp: new Date(timestampMs).toISOString(),
      date: bar.date,
      open: optionalPositiveNumber(bar.open),
      high: optionalPositiveNumber(bar.high),
      low: optionalPositiveNumber(bar.low),
      close: bar.close,
      volume: optionalVolume(bar.volume),
      isComplete: true
    });
  }

  if (bars.length === 0) {
    throw createAnalysisError(
      `No valid completed close series found for '${symbol}'`,
      'INVALID_CLOSE_SERIES',
      422
    );
  }

  bars.sort((left, right) => left.date.localeCompare(right.date) || left.timestamp.localeCompare(right.timestamp));
  return { bars, rejectedBarCount };
}

function computeSampleDailyVolatilityPct(closes) {
  const changes = [];
  for (let index = 1; index < closes.length; index++) {
    changes.push((closes[index] / closes[index - 1]) - 1);
  }
  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const squaredDeviations = changes.reduce((sum, value) => sum + ((value - mean) ** 2), 0);
  return Math.sqrt(squaredDeviations / (changes.length - 1)) * 100;
}

function computeMaxDrawdownPct(closes) {
  let runningMax = closes[0];
  let minimumDrawdown = 0;
  for (const close of closes) {
    runningMax = Math.max(runningMax, close);
    minimumDrawdown = Math.min(minimumDrawdown, (close / runningMax) - 1);
  }
  return Math.abs(minimumDrawdown) * 100;
}

function createPeriodAnalysis(periodBars, historyCapabilities) {
  const usableCompletedBarCount = periodBars.length;
  const firstBar = periodBars[0] || null;
  const lastBar = periodBars.at(-1) || null;
  const closes = periodBars.map((bar) => bar.close);
  const hasMovementData = usableCompletedBarCount >= 2;
  const insufficient = metricStatus('insufficient_data', 'INSUFFICIENT_BARS');
  const available = () => metricStatus('available');
  const metricStatusMap = {};

  const periodStartPrice = firstBar?.close ?? null;
  const periodEndPrice = lastBar?.close ?? null;
  metricStatusMap.periodStartPrice = firstBar ? available() : metricStatus('unavailable', 'NO_HISTORY');
  metricStatusMap.periodEndPrice = lastBar ? available() : metricStatus('unavailable', 'NO_HISTORY');

  const absoluteChange = hasMovementData ? periodEndPrice - periodStartPrice : null;
  const priceChangePct = hasMovementData ? ((periodEndPrice / periodStartPrice) - 1) * 100 : null;
  metricStatusMap.absoluteChange = hasMovementData ? available() : insufficient;
  metricStatusMap.priceChangePct = hasMovementData ? available() : insufficient;

  const highestCompletedClose = firstBar ? Math.max(...closes) : null;
  const lowestCompletedClose = firstBar ? Math.min(...closes) : null;
  metricStatusMap.highestCompletedClose = firstBar ? available() : metricStatus('unavailable', 'NO_HISTORY');
  metricStatusMap.lowestCompletedClose = firstBar ? available() : metricStatus('unavailable', 'NO_HISTORY');

  let completedCloseRangePositionPct = null;
  if (!hasMovementData) {
    metricStatusMap.completedCloseRangePositionPct = insufficient;
  } else if (highestCompletedClose === lowestCompletedClose) {
    metricStatusMap.completedCloseRangePositionPct = metricStatus('unavailable', 'FLAT_CLOSE_RANGE');
  } else {
    completedCloseRangePositionPct =
      ((periodEndPrice - lowestCompletedClose) / (highestCompletedClose - lowestCompletedClose)) * 100;
    metricStatusMap.completedCloseRangePositionPct = available();
  }

  const distanceBelowHighestCompletedClosePct = hasMovementData
    ? ((highestCompletedClose - periodEndPrice) / highestCompletedClose) * 100
    : null;
  metricStatusMap.distanceBelowHighestCompletedClosePct = hasMovementData ? available() : insufficient;

  let positiveCloseTransitionRatio = null;
  if (hasMovementData) {
    let positiveTransitionCount = 0;
    for (let index = 1; index < closes.length; index++) {
      if (closes[index] > closes[index - 1]) positiveTransitionCount++;
    }
    positiveCloseTransitionRatio = positiveTransitionCount / (closes.length - 1);
  }
  metricStatusMap.positiveCloseTransitionRatio = hasMovementData ? available() : insufficient;

  const dailyVolatilityPct = usableCompletedBarCount >= 3
    ? computeSampleDailyVolatilityPct(closes)
    : null;
  metricStatusMap.dailyVolatilityPct = usableCompletedBarCount >= 3 ? available() : insufficient;

  const maxDrawdownPct = hasMovementData ? computeMaxDrawdownPct(closes) : null;
  metricStatusMap.maxDrawdownPct = hasMovementData ? available() : insufficient;

  let intradayHighPrice = null;
  let intradayLowPrice = null;
  let intradayRangePositionPct = null;
  let distanceBelowIntradayHighPct = null;

  if (!historyCapabilities.ohlc) {
    const unsupportedOhlc = metricStatus('unsupported', 'METRIC_REQUIRES_OHLC');
    metricStatusMap.intradayHighPrice = unsupportedOhlc;
    metricStatusMap.intradayLowPrice = unsupportedOhlc;
    metricStatusMap.intradayRangePositionPct = unsupportedOhlc;
    metricStatusMap.distanceBelowIntradayHighPct = unsupportedOhlc;
  } else {
    const completeHighs = periodBars.every((bar) => bar.high !== null);
    const completeLows = periodBars.every((bar) => bar.low !== null);
    const incompleteOhlc = metricStatus('unavailable', 'INCOMPLETE_OHLC');

    if (completeHighs && firstBar) {
      intradayHighPrice = Math.max(...periodBars.map((bar) => bar.high));
      metricStatusMap.intradayHighPrice = available();
    } else {
      metricStatusMap.intradayHighPrice = incompleteOhlc;
    }

    if (completeLows && firstBar) {
      intradayLowPrice = Math.min(...periodBars.map((bar) => bar.low));
      metricStatusMap.intradayLowPrice = available();
    } else {
      metricStatusMap.intradayLowPrice = incompleteOhlc;
    }

    if (intradayHighPrice === null || intradayLowPrice === null) {
      metricStatusMap.intradayRangePositionPct = incompleteOhlc;
    } else if (intradayHighPrice === intradayLowPrice) {
      metricStatusMap.intradayRangePositionPct = metricStatus('unavailable', 'FLAT_CLOSE_RANGE');
    } else if (periodEndPrice < intradayLowPrice || periodEndPrice > intradayHighPrice) {
      metricStatusMap.intradayRangePositionPct = metricStatus('unavailable', 'INVALID_CLOSE_SERIES');
    } else {
      intradayRangePositionPct =
        ((periodEndPrice - intradayLowPrice) / (intradayHighPrice - intradayLowPrice)) * 100;
      metricStatusMap.intradayRangePositionPct = available();
    }

    if (intradayHighPrice === null) {
      metricStatusMap.distanceBelowIntradayHighPct = incompleteOhlc;
    } else if (periodEndPrice > intradayHighPrice) {
      metricStatusMap.distanceBelowIntradayHighPct = metricStatus('unavailable', 'INVALID_CLOSE_SERIES');
    } else {
      distanceBelowIntradayHighPct = ((intradayHighPrice - periodEndPrice) / intradayHighPrice) * 100;
      metricStatusMap.distanceBelowIntradayHighPct = available();
    }
  }

  return {
    status: hasMovementData ? 'available' : 'insufficient_data',
    observedStartAt: firstBar?.timestamp ?? null,
    observedEndAt: lastBar?.timestamp ?? null,
    observedStartDate: firstBar?.date ?? null,
    observedEndDate: lastBar?.date ?? null,
    usableCompletedBarCount,
    validSessionCount: usableCompletedBarCount,
    periodStartPrice,
    periodEndPrice,
    absoluteChange,
    priceChangePct,
    highestCompletedClose,
    lowestCompletedClose,
    completedCloseRangePositionPct,
    distanceBelowHighestCompletedClosePct,
    positiveCloseTransitionRatio,
    dailyVolatilityPct,
    maxDrawdownPct,
    intradayHighPrice,
    intradayLowPrice,
    intradayRangePositionPct,
    distanceBelowIntradayHighPct,
    periodHighPrice: intradayHighPrice,
    periodLowPrice: intradayLowPrice,
    rangePositionPct: intradayRangePositionPct,
    distanceBelowHighPct: distanceBelowIntradayHighPct,
    metricStatus: metricStatusMap
  };
}

/**
 * Pure V2 analysis of provider-neutral canonical completed daily history.
 */
export function analyzeCanonicalHistory(historyResult, options = {}) {
  if (!historyResult || typeof historyResult !== 'object') {
    throw createAnalysisError('Canonical history is required for analysis', 'NO_HISTORY', 404);
  }

  const metadata = validateCanonicalHistoryMetadata(historyResult);
  const symbol = metadata.symbol;
  const historyCapabilities = validateHistoryCapabilities(historyResult.historyCapabilities);
  const { bars, rejectedBarCount } = normalizeCanonicalBars(historyResult.bars, symbol);
  const lastBar = bars.at(-1);
  const requestedRange = options.requestedRange ?? null;
  if (requestedRange !== null && !PUBLIC_HISTORY_RANGES.includes(requestedRange)) {
    throw createAnalysisError(`Invalid analysis range '${requestedRange}'`, 'INVALID_HISTORY_RANGE', 400);
  }
  const periodKeys = requestedRange ? [requestedRange] : ANALYSIS_PERIODS;
  const periods = {};

  for (const periodKey of periodKeys) {
    const periodBars = requestedRange
      ? bars
      : bars.filter((bar) => bar.date >= getHistoryRangeStart(lastBar.date, periodKey));
    periods[periodKey] = createPeriodAnalysis(periodBars, historyCapabilities);
  }

  let positivePeriodCount = 0;
  let negativePeriodCount = 0;
  let zeroChangePeriodCount = 0;
  const legacyBreadthSupported = metadata.marketPolicy === 'VN_EXCHANGE';
  if (legacyBreadthSupported) {
    for (const [periodKey, period] of Object.entries(periods)) {
      if (
        period.metricStatus.priceChangePct.status !== 'available' ||
        period.usableCompletedBarCount < PERIOD_THRESHOLDS[periodKey]
      ) {
        continue;
      }
      if (period.priceChangePct > 0) positivePeriodCount++;
      else if (period.priceChangePct < 0) negativePeriodCount++;
      else zeroChangePeriodCount++;
    }
  }
  const validPeriodCount = positivePeriodCount + negativePeriodCount + zeroChangePeriodCount;
  const positivePeriodRatio = validPeriodCount >= 3 ? positivePeriodCount / validPeriodCount : null;

  const canonicalHistoryCompleteness = historyResult.dataCompleteness === 'partial' || rejectedBarCount > 0
    ? 'partial'
    : 'complete';
  const availableRanges = periodKeys.filter((periodKey) => periods[periodKey].usableCompletedBarCount > 0);
  const unavailableRanges = periodKeys.filter((periodKey) => periods[periodKey].usableCompletedBarCount === 0);
  const warnings = Array.isArray(historyResult.warnings) ? [...historyResult.warnings] : [];
  if (rejectedBarCount > 0) {
    warnings.push({
      code: 'INVALID_CLOSE_SERIES',
      message: `${rejectedBarCount} non-canonical historical bar(s) were excluded from analysis.`
    });
  }

  const analysisPriceSource = 'last_completed_daily_close';
  return {
    symbol,
    assetType: metadata.assetType,
    marketPolicy: metadata.marketPolicy,
    marketTimezone: metadata.marketTimezone,
    quoteCurrency: metadata.quoteCurrency,
    requestedRange,
    analysisPrice: lastBar.close,
    analysisPriceDate: lastBar.date,
    analysisAsOf: lastBar.timestamp,
    analysisPriceSource,
    dataAsOf: historyResult.dataAsOf ?? lastBar.date,
    freshness: historyResult.freshness ?? null,
    historyCapabilities,
    methodologyVersion: ANALYSIS_METHODOLOGY_VERSION,
    snapshot: normalizeSnapshotContext(options.snapshot),
    periods,
    crossPeriod: {
      positivePeriodRatio,
      positivePeriodCount,
      negativePeriodCount,
      zeroChangePeriodCount,
      validPeriodCount
    },
    dataCompleteness: {
      availabilityLevel: canonicalHistoryCompleteness,
      canonicalHistoryCompleteness,
      requestedRange,
      usableCompletedBarCount: bars.length,
      observedStartDate: bars[0].date,
      observedEndDate: lastBar.date,
      dataAsOf: historyResult.dataAsOf ?? lastBar.date,
      availableRanges,
      unavailableRanges,
      periodCompletenessRatio: null,
      warnings
    },
    methodology: {
      methodologyVersion: ANALYSIS_METHODOLOGY_VERSION,
      analysisPriceSource,
      priceChangeMetric: 'unadjusted_completed_close_price_change',
      priceChangeUnit: 'percent',
      completedCloseRangeUnit: 'percent',
      positiveCloseTransitionRatioUnit: 'ratio',
      dailyVolatilityMetric: 'sample_stddev_daily_close_changes',
      dailyVolatilityAnnualized: false,
      maxDrawdownMetric: 'completed_close_running_peak',
      dividendsIncluded: false,
      distributionsIncluded: false,
      feesIncluded: false,
      fundingIncluded: false,
      stakingYieldIncluded: false,
      corporateActionsModeled: false,
      legacyFields: {
        positivePeriodRatio: 'deprecated_cross_period_positive_breadth',
        periodHighPrice: 'intradayHighPrice',
        periodLowPrice: 'intradayLowPrice',
        rangePositionPct: 'intradayRangePositionPct',
        distanceBelowHighPct: 'distanceBelowIntradayHighPct',
        validSessionCount: 'usableCompletedBarCount'
      }
    }
  };
}

/**
 * Fetches one canonical Feature 21 history window and produces V2 analysis.
 */
export async function getAssetAnalysis(rawSymbol, options = {}) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    throw createAnalysisError('Invalid symbol parameter', 'INVALID_SYMBOL', 400);
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const requestedRange = options.range === undefined || options.range === null || options.range === ''
    ? null
    : String(options.range).trim().toUpperCase();
  if (requestedRange !== null && !PUBLIC_HISTORY_RANGES.includes(requestedRange)) {
    throw createAnalysisError(
      `Invalid range '${options.range}'. Supported ranges: 1W, 1M, 3M, 6M, 1Y`,
      'INVALID_HISTORY_RANGE',
      400
    );
  }

  const historyRange = requestedRange || '1Y';
  const historyFn = options.getMarketHistoryFn || options.getAnalysisHistoryFn || getMarketHistory;
  const snapshotFn = options.getMarketSnapshotFn || getMarketSnapshot;
  const now = options.now === undefined ? new Date() : options.now;
  const historyResult = await historyFn(symbol, historyRange, { now });

  let snapshot = null;
  try {
    snapshot = await snapshotFn(symbol);
  } catch (_snapshotError) {
    snapshot = null;
  }

  return analyzeCanonicalHistory(historyResult, { requestedRange, snapshot });
}
