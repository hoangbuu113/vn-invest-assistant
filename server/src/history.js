const SUPPORTED_POLICIES = Object.freeze([
  'VN_EXCHANGE',
  'CONTINUOUS_24_7',
  'GLOBAL_24_5'
]);

export const PUBLIC_HISTORY_RANGES = Object.freeze(['1W', '1M', '3M', '6M', '1Y']);

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatterCache = new Map();

function createHistoryError(message, code, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getDateFormatter(timeZone) {
  if (formatterCache.has(timeZone)) return formatterCache.get(timeZone);

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (_error) {
    throw createHistoryError(
      `Invalid canonical market timezone '${timeZone || ''}'`,
      'INVALID_MARKET_TIMEZONE',
      500
    );
  }

  formatterCache.set(timeZone, formatter);
  return formatter;
}

function parseDateKey(dateKey) {
  if (typeof dateKey !== 'string') return null;
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getCanonicalDate(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw createHistoryError('Invalid historical timestamp', 'INVALID_HISTORY_TIMESTAMP', 400);
  }

  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(dateKey, days) {
  const parts = parseDateKey(dateKey);
  if (!parts || !Number.isInteger(days)) {
    throw createHistoryError('Invalid calendar date arithmetic', 'INVALID_HISTORY_RANGE', 400);
  }
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function subtractCalendarMonths(dateKey, months) {
  const parts = parseDateKey(dateKey);
  const targetMonthIndex = parts.month - 1 - months;
  const targetMonthStart = new Date(Date.UTC(parts.year, targetMonthIndex, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth() + 1;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return formatDateKey(targetYear, targetMonth, Math.min(parts.day, daysInTargetMonth));
}

function subtractCalendarYear(dateKey) {
  const parts = parseDateKey(dateKey);
  const daysInTargetMonth = new Date(Date.UTC(parts.year - 1, parts.month, 0)).getUTCDate();
  return formatDateKey(parts.year - 1, parts.month, Math.min(parts.day, daysInTargetMonth));
}

export function getHistoryRangeStart(today, range) {
  if (!parseDateKey(today) || !PUBLIC_HISTORY_RANGES.includes(range)) {
    throw createHistoryError(`Invalid historical range '${range}'`, 'INVALID_HISTORY_RANGE', 400);
  }

  if (range === '1W') return addCalendarDays(today, -7);
  if (range === '1M') return subtractCalendarMonths(today, 1);
  if (range === '3M') return subtractCalendarMonths(today, 3);
  if (range === '6M') return subtractCalendarMonths(today, 6);
  return subtractCalendarYear(today);
}

export function getHistoryWindow(asset, range, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('History now must be a valid Date object');
  }
  const timeZone = asset?.marketTimezone ?? asset?.market_timezone;
  const today = getCanonicalDate(now, timeZone);
  return {
    today,
    startDate: getHistoryRangeStart(today, range)
  };
}

function isWeekend(dateKey) {
  const parts = parseDateKey(dateKey);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 || day === 6;
}

function normalizedPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizedVolume(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isContradictoryOhlc({ open, high, low, close }) {
  if (high !== null && high < close) return true;
  if (low !== null && low > close) return true;
  if (open !== null && high !== null && high < open) return true;
  if (open !== null && low !== null && low > open) return true;
  if (high !== null && low !== null && high < low) return true;
  return false;
}

function financialFieldsEqual(left, right) {
  return left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume;
}

function pushUniqueWarning(warnings, warning) {
  const key = `${warning.code}:${warning.sessionKey || warning.date || ''}`;
  if (!warnings.some((item) => `${item.code}:${item.sessionKey || item.date || ''}` === key)) {
    warnings.push(warning);
  }
}

function assertPolicyContract(asset) {
  const marketPolicy = asset?.marketPolicy ?? asset?.market_policy;
  const marketTimezone = asset?.marketTimezone ?? asset?.market_timezone;

  if (!SUPPORTED_POLICIES.includes(marketPolicy)) {
    throw createHistoryError(
      `Historical market data policy '${marketPolicy || 'unavailable'}' is unsupported for '${asset?.symbol || 'asset'}'`,
      'UNSUPPORTED_MARKET_POLICY'
    );
  }
  getDateFormatter(marketTimezone);

  if (marketPolicy === 'VN_EXCHANGE' && marketTimezone !== 'Asia/Ho_Chi_Minh') {
    throw createHistoryError('VN_EXCHANGE history requires Asia/Ho_Chi_Minh timezone', 'INVALID_MARKET_TIMEZONE', 500);
  }
  if (marketPolicy === 'CONTINUOUS_24_7' && marketTimezone !== 'UTC') {
    throw createHistoryError('CONTINUOUS_24_7 history requires UTC timezone', 'INVALID_MARKET_TIMEZONE', 500);
  }

  return { marketPolicy, marketTimezone };
}

function createDerivedTimestamp(dateKey, marketTimezone) {
  if (marketTimezone !== 'UTC') return null;
  return `${dateKey}T00:00:00.000Z`;
}

function normalizeRecordIdentity(record, marketTimezone) {
  const suppliedDate = parseDateKey(record?.date) ? record.date : null;
  const sourceTimestamp = normalizeTimestamp(record?.timestamp);

  if (sourceTimestamp) {
    const timestampDate = getCanonicalDate(sourceTimestamp, marketTimezone);
    if (suppliedDate && suppliedDate !== timestampDate) {
      return { errorCode: 'PROVIDER_DATE_TIMESTAMP_MISMATCH', date: suppliedDate };
    }
    return {
      date: suppliedDate || timestampDate,
      timestamp: sourceTimestamp,
      timestampDerived: false
    };
  }

  if (suppliedDate && record?.timestampDerived === true) {
    const derivedTimestamp = createDerivedTimestamp(suppliedDate, marketTimezone);
    if (derivedTimestamp) {
      return {
        date: suppliedDate,
        timestamp: derivedTimestamp,
        timestampDerived: true
      };
    }
  }

  return { errorCode: 'INVALID_HISTORY_TIMESTAMP', date: suppliedDate };
}

/**
 * Shared provider-neutral completed daily history normalizer.
 * Provider adapters supply truthful raw fields; this function owns calendar policy,
 * range filtering, deduplication, integrity checks, metrics, and metadata.
 */
export function normalizeDailyHistory({
  asset,
  provider,
  range,
  records,
  now,
  freshness = 'delayed',
  applyRangeFilter = true,
  excludeIncomplete = true,
  initialWarnings = []
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('History now must be a valid Date object');
  }
  if (!Array.isArray(records)) {
    throw createHistoryError(`Malformed historical response for '${asset?.symbol || 'asset'}'`, 'MALFORMED_PROVIDER_RESPONSE', 502);
  }

  const { marketPolicy, marketTimezone } = assertPolicyContract(asset);
  const symbol = asset.symbol;
  const today = getCanonicalDate(now, marketTimezone);
  const startDate = applyRangeFilter ? getHistoryRangeStart(today, range) : null;
  const warnings = Array.isArray(initialWarnings) ? [...initialWarnings] : [];
  const partialWarningCodes = new Set([
    'INVALID_HISTORY_TIMESTAMP',
    'PROVIDER_DATE_TIMESTAMP_MISMATCH',
    'INVALID_CLOSE',
    'CONTRADICTORY_OHLC',
    'CONFLICTING_DUPLICATE_SESSION',
    'NON_TRADING_DATE_EXCLUDED'
  ]);
  const sessionMap = new Map();
  let coverageReachedStart = !applyRangeFilter;
  let usedDerivedTimestamp = false;

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    const identity = normalizeRecordIdentity(record, marketTimezone);
    if (identity.errorCode) {
      pushUniqueWarning(warnings, {
        code: identity.errorCode,
        date: identity.date || null,
        message: 'Historical record has invalid or incompatible timestamp provenance.'
      });
      continue;
    }

    const date = identity.date;
    if (excludeIncomplete && date >= today) continue;

    if ((marketPolicy === 'VN_EXCHANGE' || marketPolicy === 'GLOBAL_24_5') && isWeekend(date)) {
      if (!applyRangeFilter || date >= startDate) {
        pushUniqueWarning(warnings, {
          code: 'NON_TRADING_DATE_EXCLUDED',
          date,
          message: `Non-trading weekend date ${date} was excluded by ${marketPolicy}.`
        });
      }
      continue;
    }

    const close = normalizedPositiveNumber(record.close);
    const open = normalizedPositiveNumber(record.open);
    const high = normalizedPositiveNumber(record.high);
    const low = normalizedPositiveNumber(record.low);
    const volume = normalizedVolume(record.volume);
    const financialBar = { open, high, low, close, volume };

    if (close === null) {
      if (!applyRangeFilter || date >= startDate) {
        pushUniqueWarning(warnings, {
          code: 'INVALID_CLOSE',
          date,
          message: `Historical record for ${date} has no valid positive close.`
        });
      }
      continue;
    }

    if (isContradictoryOhlc(financialBar)) {
      if (!applyRangeFilter || date >= startDate) {
        pushUniqueWarning(warnings, {
          code: 'CONTRADICTORY_OHLC',
          date,
          message: `Historical OHLC values for ${date} are internally contradictory.`
        });
      }
      continue;
    }

    if (applyRangeFilter && date <= startDate) coverageReachedStart = true;
    if (applyRangeFilter && date < startDate) continue;

    const bar = {
      timestamp: identity.timestamp,
      date,
      open,
      high,
      low,
      close,
      volume,
      isComplete: true
    };
    usedDerivedTimestamp ||= identity.timestampDerived;

    const existing = sessionMap.get(date);
    if (!existing) {
      sessionMap.set(date, { status: 'valid', bar });
      continue;
    }
    if (existing.status === 'conflict') continue;

    if (financialFieldsEqual(existing.bar, bar)) {
      if (Date.parse(bar.timestamp) < Date.parse(existing.bar.timestamp)) {
        existing.bar.timestamp = bar.timestamp;
      }
      continue;
    }

    existing.status = 'conflict';
    pushUniqueWarning(warnings, {
      code: 'CONFLICTING_DUPLICATE_SESSION',
      sessionKey: date,
      message: `Conflicting duplicate records found for session ${date}. Dropping session.`
    });
  }

  const bars = Array.from(sessionMap.values())
    .filter((session) => session.status === 'valid')
    .map((session) => session.bar)
    .sort((left, right) => left.date.localeCompare(right.date) || Date.parse(left.timestamp) - Date.parse(right.timestamp));

  if (applyRangeFilter && !coverageReachedStart && bars.length > 0) {
    pushUniqueWarning(warnings, {
      code: 'PARTIAL_HISTORY_COVERAGE',
      date: startDate,
      message: `Provider history does not establish coverage at the requested ${range} lower boundary ${startDate}.`
    });
  }

  if (usedDerivedTimestamp) {
    pushUniqueWarning(warnings, {
      code: 'DERIVED_PERIOD_TIMESTAMP',
      message: `Provider supplied date-only history; timestamps are canonical ${marketTimezone} period starts.`
    });
  }

  if (bars.length === 0) {
    const error = createHistoryError(
      `No usable completed historical price records found for '${symbol}'`,
      'NO_USABLE_HISTORY',
      404
    );
    if (warnings.length > 0) error.warnings = warnings;
    throw error;
  }

  const periodStartPrice = bars[0].close;
  const latestPrice = bars.at(-1).close;
  const validHighs = bars.map((bar) => bar.high).filter((value) => value !== null);
  const validLows = bars.map((bar) => bar.low).filter((value) => value !== null);
  const hasIntegrityLoss = warnings.some((warning) => partialWarningCodes.has(warning.code)) ||
    warnings.some((warning) => warning.code === 'PARTIAL_HISTORY_COVERAGE');

  const payload = {
    symbol,
    range,
    interval: '1d',
    freshness,
    provider,
    marketPolicy,
    marketTimezone,
    quoteCurrency: asset.quoteCurrency ?? asset.quote_currency ?? null,
    updatedAt: bars.at(-1).timestamp,
    dataAsOf: bars.at(-1).date,
    dataCompleteness: hasIntegrityLoss ? 'partial' : 'complete',
    bars,
    metrics: {
      periodStartPrice,
      latestPrice,
      absoluteChange: bars.length >= 2 ? latestPrice - periodStartPrice : null,
      percentageChange: bars.length >= 2 ? ((latestPrice / periodStartPrice) - 1) * 100 : null,
      periodHigh: validHighs.length > 0 ? Math.max(...validHighs) : null,
      periodLow: validLows.length > 0 ? Math.min(...validLows) : null,
      validSessions: bars.length
    }
  };

  if (warnings.length > 0) payload.warnings = warnings;
  return payload;
}
