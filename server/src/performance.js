import {
  getCanonicalDate,
  addCalendarDays,
  PUBLIC_HISTORY_RANGES
} from './history.js';
import { REPORTING_CURRENCY } from './fx.js';
import {
  getAssets,
  getCashActivation,
  getHoldings,
  getPositionOpeningBaselines,
  privateSupabase
} from './supabase.js';
import { getCashLedger } from './cash.js';
import { getPortfolioTransactions } from './transactions.js';
import { getMarketHistory } from './market.js';

export const PERFORMANCE_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const PUBLIC_PERFORMANCE_RANGES = PUBLIC_HISTORY_RANGES;

export const PERFORMANCE_METHODOLOGY = Object.freeze({
  twrMethodology: 'DAILY_CHAINED_EOD_EXTERNAL_FLOW',
  twrExact: false,
  mwrMethodology: 'XIRR',
  dayCountConvention: 'ACT/365',
  feesIncluded: false,
  taxesIncluded: false,
  dividendsIncluded: false,
  corporateActionsAdjusted: false
});

const WEEKEND_CARRY_POLICIES = new Set(['VN_EXCHANGE', 'GLOBAL_24_5']);

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function performanceError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function parseDateKey(dateKey) {
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

export function calendarDaysDifference(dateKeyA, dateKeyB) {
  const pA = parseDateKey(dateKeyA);
  const pB = parseDateKey(dateKeyB);
  if (!pA || !pB) {
    throw performanceError('Invalid date key in calendar arithmetic', 'INVALID_PERFORMANCE_DATE');
  }
  const utcA = Date.UTC(pA.year, pA.month - 1, pA.day);
  const utcB = Date.UTC(pB.year, pB.month - 1, pB.day);
  return Math.round((utcB - utcA) / 86400000);
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

export function getPerformanceRangeStart(endDateKey, range) {
  if (!parseDateKey(endDateKey) || !PUBLIC_PERFORMANCE_RANGES.includes(range)) {
    throw performanceError(`Invalid performance range '${range}'`, 'INVALID_PERFORMANCE_RANGE', 400);
  }

  if (range === '1W') return addCalendarDays(endDateKey, -7);
  if (range === '1M') return subtractCalendarMonths(endDateKey, 1);
  if (range === '3M') return subtractCalendarMonths(endDateKey, 3);
  if (range === '6M') return subtractCalendarMonths(endDateKey, 6);
  return subtractCalendarYear(endDateKey);
}

export function getPerformanceCalendarWindow(range, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw performanceError('Performance now must be a valid Date object', 'INVALID_TIME_CONTEXT');
  }

  const todayKey = getCanonicalDate(now, PERFORMANCE_TIMEZONE);
  const completedEndDate = addCalendarDays(todayKey, -1);
  const requestedStartDate = getPerformanceRangeStart(completedEndDate, range);

  return {
    todayKey,
    completedEndDate,
    requestedStartDate,
    range
  };
}

export function generateDateSpan(startDateKey, endDateKey) {
  const span = [];
  let current = startDateKey;
  while (current <= endDateKey) {
    span.push(current);
    current = addCalendarDays(current, 1);
  }
  return span;
}

function normalizeTimestampToDateKey(timestamp) {
  if (!timestamp) return null;
  return getCanonicalDate(timestamp, PERFORMANCE_TIMEZONE);
}

function requireAuthoritativeCashNumber(value, field) {
  const isNumber = typeof value === 'number';
  const isNumericString = typeof value === 'string' && value.trim().length > 0;
  const normalized = isNumber ? value : (isNumericString ? Number(value.trim()) : NaN);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw performanceError(
      `Authoritative ${field} is unavailable`,
      'AUTHORITATIVE_CASH_UNAVAILABLE',
      503
    );
  }
  return normalized;
}

function isWeekendDateKey(dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) return false;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return day === 0 || day === 6;
}

function isCadenceEligibleCarryForward(priceDate, targetDate, marketPolicy) {
  if (!WEEKEND_CARRY_POLICIES.has(marketPolicy) || priceDate >= targetDate) return false;
  let cursor = addCalendarDays(priceDate, 1);
  while (cursor <= targetDate) {
    if (!isWeekendDateKey(cursor)) return false;
    cursor = addCalendarDays(cursor, 1);
  }
  return true;
}

function cashEntryLinkId(entry) {
  return entry?.portfolioTransactionId
    || entry?.portfolio_transaction_id
    || entry?.transactionId
    || null;
}

function transactionId(transaction) {
  return transaction?.id || transaction?.transactionId || transaction?.transaction_id || null;
}

/**
 * Resolves the governed economic timestamp for a cash-ledger entry.
 * Linked BUY/SELL cash movements inherit the immutable transaction execution
 * time; createdAt remains only the recording/audit time.
 */
export function resolveCashEntryEconomicTimestamp(entry, transactions = []) {
  const type = entry?.entryType || entry?.entry_type;
  const linkId = cashEntryLinkId(entry);

  if (!linkId || !['BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL'].includes(type)) {
    return entry?.effectiveAt || entry?.effective_at || null;
  }

  const matches = transactions.filter((candidate) => transactionId(candidate) === linkId);
  if (matches.length !== 1) {
    throw performanceError(
      'Linked cash movement cannot be reconciled to exactly one portfolio transaction',
      'AMBIGUOUS_LINKED_CASH_EVENT',
      503
    );
  }

  const linked = matches[0];
  const linkedType = linked.transactionType || linked.transaction_type;
  const cashProfileId = entry.profileId || entry.profile_id || null;
  const transactionProfileId = linked.profileId || linked.profile_id || null;
  const executedAt = linked.executedAt || linked.executed_at || null;

  if (
    linkedType !== type
    || (cashProfileId && transactionProfileId && cashProfileId !== transactionProfileId)
    || !normalizeTimestampToDateKey(executedAt)
  ) {
    throw performanceError(
      'Linked cash movement conflicts with its authoritative portfolio transaction',
      'AMBIGUOUS_LINKED_CASH_EVENT',
      503
    );
  }

  return executedAt;
}

/**
 * Reconstructs cash balance as of a given calendar date.
 */
export function reconstructCashBalance(dateKey, cashActivation, cashEntries = [], transactions = []) {
  if (!cashActivation) {
    throw performanceError(
      'Authoritative cash activation is unavailable',
      'AUTHORITATIVE_CASH_UNAVAILABLE',
      503
    );
  }
  let balance = requireAuthoritativeCashNumber(
    cashActivation.openingBalanceAmount ?? cashActivation.opening_balance_amount,
    'opening cash balance'
  );

  for (const entry of cashEntries) {
    const entryDate = normalizeTimestampToDateKey(resolveCashEntryEconomicTimestamp(entry, transactions));
    if (!entryDate || entryDate > dateKey) continue;

    const amount = requireAuthoritativeCashNumber(entry.amount, 'cash ledger amount');
    const type = entry.entryType || entry.entry_type;

    if (type === 'DEPOSIT') {
      balance += amount;
    } else if (type === 'WITHDRAWAL') {
      balance -= amount;
    } else if (type === 'BUY') {
      balance -= amount;
    } else if (type === 'SELL') {
      balance += amount;
    } else if (type === 'BUY_REVERSAL') {
      balance += amount;
    } else if (type === 'SELL_REVERSAL') {
      balance -= amount;
    }
  }

  return balance;
}

/**
 * Reconstructs holding positions and average cost for all assets as of a given calendar date.
 */
export function reconstructHoldingsState(dateKey, positionBaselines = [], transactions = []) {
  const holdingsMap = new Map();

  // 1. Initialize from non-cancelled opening baselines
  for (const baseline of positionBaselines) {
    if (baseline.cancelledAt || baseline.cancelled_at) continue;
    const cutoffDate = normalizeTimestampToDateKey(baseline.accountingCutoffAt || baseline.accounting_cutoff_at);
    if (!cutoffDate || cutoffDate > dateKey) continue;

    const assetId = baseline.assetId || baseline.asset_id;
    const qty = typeof baseline.openingQuantity === 'number'
      ? baseline.openingQuantity
      : Number(baseline.openingQuantity || baseline.opening_quantity || 0);
    const rawAverageCost = baseline.openingAverageCost ?? baseline.opening_average_cost;
    const parsedAverageCost = typeof rawAverageCost === 'number'
      ? rawAverageCost
      : Number(rawAverageCost);
    const avgCost = rawAverageCost !== null
      && rawAverageCost !== undefined
      && Number.isFinite(parsedAverageCost)
      && parsedAverageCost >= 0
      ? parsedAverageCost
      : null;

    holdingsMap.set(assetId, {
      assetId,
      quantity: qty,
      averageCost: avgCost,
      baselineCutoff: baseline.accountingCutoffAt || baseline.accounting_cutoff_at,
      hasBaseline: true
    });
  }

  // 2. Sort transactions chronologically
  const sortedTransactions = [...transactions].sort((a, b) => {
    const timeA = new Date(a.executedAt || a.executed_at || a.createdAt || a.created_at).getTime();
    const timeB = new Date(b.executedAt || b.executed_at || b.createdAt || b.created_at).getTime();
    return timeA - timeB;
  });

  // 3. Apply subsequent transactions
  for (const tx of sortedTransactions) {
    const txDate = normalizeTimestampToDateKey(tx.executedAt || tx.executed_at);
    if (!txDate || txDate > dateKey) continue;

    const assetId = tx.assetId || tx.asset_id;
    const txType = tx.transactionType || tx.transaction_type;
    const qty = typeof tx.quantity === 'number' ? tx.quantity : Number(tx.quantity || 0);
    const price = typeof tx.price === 'number' ? tx.price : Number(tx.price || 0);

    let holding = holdingsMap.get(assetId);
    if (!holding) {
      holding = {
        assetId,
        quantity: 0,
        averageCost: 0,
        baselineCutoff: null,
        hasBaseline: false
      };
      holdingsMap.set(assetId, holding);
    }

    // If asset has opening baseline, ignore transactions created/executed before the baseline cutoff
    if (holding.hasBaseline && holding.baselineCutoff) {
      const txCreated = new Date(tx.createdAt || tx.created_at || tx.executedAt || tx.executed_at).getTime();
      const cutoffTime = new Date(holding.baselineCutoff).getTime();
      if (txCreated <= cutoffTime) {
        continue;
      }
    }

    if (txType === 'BUY') {
      const newQty = holding.quantity + qty;
      const newAverageCost = holding.quantity > 0 && holding.averageCost === null
        ? null
        : ((holding.quantity * holding.averageCost) + (qty * price)) / newQty;
      holding.quantity = newQty;
      holding.averageCost = newAverageCost;
    } else if (txType === 'SELL') {
      const newQty = Math.max(0, holding.quantity - qty);
      holding.quantity = newQty;
      if (newQty === 0) {
        holding.averageCost = 0;
      }
    } else if (txType === 'BUY_REVERSAL') {
      const newQty = Math.max(0, holding.quantity - qty);
      let newAverageCost = holding.averageCost;
      if (newQty === 0) {
        newAverageCost = 0;
      } else if (holding.averageCost !== null) {
        const remainingTotalCost = (holding.quantity * holding.averageCost) - (qty * price);
        newAverageCost = remainingTotalCost > 0 ? remainingTotalCost / newQty : 0;
      }
      holding.quantity = newQty;
      holding.averageCost = newAverageCost;
    } else if (txType === 'SELL_REVERSAL') {
      const restoredQty = holding.quantity + qty;
      const preTradeAvgCost = tx.preTradeAverageCost ?? tx.pre_trade_average_cost ?? holding.averageCost;
      holding.quantity = restoredQty;
      holding.averageCost = restoredQty === 0 ? 0 : preTradeAvgCost;
    }
  }

  return holdingsMap;
}

/**
 * Finds the latest authoritative completed close price on or before a given performance date.
 */
export function getValuationMark(asset, dateKey, priceHistoryMap = {}) {
  const symbol = asset?.symbol;
  const quoteCurrency = asset?.quoteCurrency || asset?.quote_currency || 'VND';
  const bars = symbol ? (priceHistoryMap[symbol] || []) : [];

  // Filter bars on or before dateKey with finite positive close
  const eligibleBars = bars.filter(
    (b) => b && typeof b.close === 'number' && Number.isFinite(b.close) && b.close > 0 && b.date && b.date <= dateKey
  );

  if (eligibleBars.length === 0) {
    return {
      price: null,
      priceDate: null,
      isCarriedForward: false,
      isEligible: false,
      isStale: false,
      isMissing: true,
      reason: 'MISSING_VALUATION_MARK',
      quoteCurrency
    };
  }

  // Latest bar on or before dateKey
  const latestBar = eligibleBars[eligibleBars.length - 1];
  const isCarriedForward = latestBar.date < dateKey;
  const marketPolicy = asset?.marketPolicy || asset?.market_policy || null;
  const isEligible = !isCarriedForward
    || isCadenceEligibleCarryForward(latestBar.date, dateKey, marketPolicy);

  return {
    price: latestBar.close,
    priceDate: latestBar.date,
    isCarriedForward,
    isEligible,
    isStale: !isEligible,
    isMissing: false,
    reason: isEligible ? null : 'STALE_VALUATION_MARK',
    quoteCurrency
  };
}

/**
 * Computes authoritative performance authority start and inception date.
 */
export function determineAuthorityStart(cashActivation, positionBaselines = []) {
  if (!cashActivation || !cashActivation.activatedAt) {
    return null;
  }

  const activeBaselines = positionBaselines.filter((b) => !b.cancelledAt && !b.cancelled_at);
  const activationTime = new Date(cashActivation.activatedAt).getTime();

  if (activeBaselines.length === 0) {
    return new Date(activationTime);
  }

  let maxTime = activationTime;
  for (const b of activeBaselines) {
    const cutoffTime = new Date(b.accountingCutoffAt || b.accounting_cutoff_at).getTime();
    if (cutoffTime > maxTime) {
      maxTime = cutoffTime;
    }
  }

  return new Date(maxTime);
}

/**
 * Finds the earliest complete positive valuation date at or after authorityStart.
 */
export function findPerformanceInceptionDate({
  authorityStart,
  cashActivation,
  cashEntries = [],
  positionBaselines = [],
  transactions = [],
  assetMap = {},
  priceHistoryMap = {},
  completedEndDate
}) {
  if (!authorityStart) return null;

  const authStartDateKey = getCanonicalDate(authorityStart, PERFORMANCE_TIMEZONE);
  if (authStartDateKey > completedEndDate) return null;

  const candidateDates = generateDateSpan(authStartDateKey, completedEndDate);

  for (const dateKey of candidateDates) {
    const cash = reconstructCashBalance(dateKey, cashActivation, cashEntries, transactions);
    const holdingsMap = reconstructHoldingsState(dateKey, positionBaselines, transactions);

    let isComplete = true;
    let holdingsValue = 0;
    let hasHeldAssets = false;

    for (const [assetId, holding] of holdingsMap.entries()) {
      if (holding.quantity <= 0) continue;
      hasHeldAssets = true;

      const asset = assetMap[assetId];
      if (!asset) {
        isComplete = false;
        break;
      }

      if (asset.quoteCurrency !== REPORTING_CURRENCY && asset.quote_currency !== REPORTING_CURRENCY) {
        // Non-VND asset without historical FX makes valuation incomplete
        isComplete = false;
        break;
      }

      const mark = getValuationMark(asset, dateKey, priceHistoryMap);
      if (mark.isMissing || !mark.isEligible || mark.price === null) {
        isComplete = false;
        break;
      }

      holdingsValue += holding.quantity * mark.price;
    }

    if (isComplete) {
      const totalPortfolioValue = cash + holdingsValue;
      if (totalPortfolioValue > 0) {
        return {
          inceptionDateKey: dateKey,
          inceptionValue: totalPortfolioValue
        };
      }
    }
  }

  // 2. If no complete valuation date exists (e.g. portfolio contains non-VND assets or unpriced assets),
  // anchor inception to the first date with non-zero state so coverage degradation is reported truthfully.
  for (const dateKey of candidateDates) {
    const cash = reconstructCashBalance(dateKey, cashActivation, cashEntries, transactions);
    const holdingsMap = reconstructHoldingsState(dateKey, positionBaselines, transactions);

    let hasAnyPositions = false;
    for (const holding of holdingsMap.values()) {
      if (holding.quantity > 0) {
        hasAnyPositions = true;
        break;
      }
    }

    if (cash > 0 || hasAnyPositions) {
      return {
        inceptionDateKey: dateKey,
        inceptionValue: null
      };
    }
  }

  return null;
}

/**
 * Solves unique root for XIRR when cash flows transition signs exactly once.
 */
export function solveXirr(cashFlows) {
  // Filter and sort cash flows chronologically
  const sorted = [...cashFlows].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  if (sorted.length < 2) {
    return { status: 'insufficient_data', annualizedReturnPct: null, reason: 'INSUFFICIENT_CASH_FLOW_COUNT' };
  }

  // Same-day aggregation
  const aggregatedMap = new Map();
  for (const cf of sorted) {
    const current = aggregatedMap.get(cf.dateKey) || 0;
    aggregatedMap.set(cf.dateKey, current + cf.amount);
  }

  const aggregated = Array.from(aggregatedMap.entries())
    .map(([dateKey, amount]) => ({ dateKey, amount }))
    .filter((cf) => Math.abs(cf.amount) > 1e-9);

  if (aggregated.length < 2) {
    return { status: 'insufficient_data', annualizedReturnPct: null, reason: 'INSUFFICIENT_DATE_SPAN' };
  }

  const baseDateKey = aggregated[0].dateKey;
  const terminalDateKey = aggregated[aggregated.length - 1].dateKey;
  if (baseDateKey >= terminalDateKey) {
    return { status: 'insufficient_data', annualizedReturnPct: null, reason: 'INSUFFICIENT_DATE_SPAN' };
  }

  if (calendarDaysDifference(baseDateKey, terminalDateKey) < 365) {
    return {
      status: 'insufficient_data',
      annualizedReturnPct: null,
      methodology: 'XIRR',
      dayCountConvention: 'ACT/365',
      reason: 'INSUFFICIENT_HISTORY'
    };
  }

  // Sign feasibility & count transitions
  const signs = aggregated.map((cf) => Math.sign(cf.amount));
  let signTransitions = 0;
  for (let i = 1; i < signs.length; i += 1) {
    if (signs[i] !== signs[i - 1]) {
      signTransitions += 1;
    }
  }

  if (signTransitions === 0) {
    return { status: 'unavailable', annualizedReturnPct: null, reason: 'NO_SIGN_CHANGE' };
  }

  if (signTransitions > 1) {
    return { status: 'unavailable', annualizedReturnPct: null, reason: 'AMBIGUOUS_XIRR_ROOT' };
  }

  // Exactly 1 sign transition: Solve in x-space (x = ln(1 + r))
  // NPV(x) = SUM(CF_k * exp(-x * days_k / 365))
  const cfTerms = aggregated.map((cf) => ({
    amount: cf.amount,
    timeFactor: calendarDaysDifference(baseDateKey, cf.dateKey) / 365.0
  }));

  function npv(x) {
    let sum = 0;
    for (const term of cfTerms) {
      sum += term.amount * Math.exp(-x * term.timeFactor);
    }
    return sum;
  }

  // Expanding bracket search in x-space
  let xLow = -2.0;
  let xHigh = 2.0;
  let npvLow = npv(xLow);
  let npvHigh = npv(xHigh);

  let iterations = 0;
  while (npvLow * npvHigh > 0 && iterations < 30) {
    xLow -= 2.0;
    xHigh += 2.0;
    npvLow = npv(xLow);
    npvHigh = npv(xHigh);
    iterations += 1;
  }

  if (npvLow * npvHigh > 0) {
    return { status: 'unavailable', annualizedReturnPct: null, reason: 'NO_SOLUTION_FOUND' };
  }

  // Bisection / Brent refinement
  let a = xLow;
  let b = xHigh;
  let fa = npvLow;
  let fb = npvHigh;

  for (let i = 0; i < 100; i += 1) {
    const mid = (a + b) / 2.0;
    const fmid = npv(mid);

    if (Math.abs(fmid) < 1e-9 || Math.abs(b - a) < 1e-9) {
      const solvedRate = Math.exp(mid) - 1.0;
      return {
        status: 'available',
        annualizedReturnPct: solvedRate * 100.0,
        methodology: 'XIRR',
        dayCountConvention: 'ACT/365',
        reason: null
      };
    }

    if (fa * fmid < 0) {
      b = mid;
      fb = fmid;
    } else {
      a = mid;
      fa = fmid;
    }
  }

  const finalMid = (a + b) / 2.0;
  const finalRate = Math.exp(finalMid) - 1.0;
  return {
    status: 'available',
    annualizedReturnPct: finalRate * 100.0,
    methodology: 'XIRR',
    dayCountConvention: 'ACT/365',
    reason: null
  };
}

export function getExternalSettlementFlowForDate(dateKey, transactions = []) {
  let contributions = 0;
  let withdrawals = 0;

  for (const tx of transactions) {
    const mode = tx.settlementMode || tx.settlement_mode || 'INTERNAL_VND_CASH';
    if (mode !== 'EXTERNAL_SETTLEMENT') continue;

    const txDate = normalizeTimestampToDateKey(tx.executedAt || tx.executed_at);
    if (txDate !== dateKey) continue;

    const type = tx.transactionType || tx.transaction_type;
    const qty = typeof tx.quantity === 'number' ? tx.quantity : Number(tx.quantity || 0);
    const price = typeof tx.price === 'number' ? tx.price : Number(tx.price || 0);
    const amount = qty * price;

    if (type === 'BUY') {
      contributions += amount;
    } else if (type === 'SELL') {
      withdrawals += amount;
    } else if (type === 'BUY_REVERSAL') {
      contributions -= amount;
    } else if (type === 'SELL_REVERSAL') {
      withdrawals -= amount;
    }
  }

  return {
    contributions,
    withdrawals,
    netExternalSettlementFlow: contributions - withdrawals
  };
}

/**
 * Pure calculation engine for Feature 25B portfolio performance.
 */
export function calculatePortfolioPerformance({
  range = '1M',
  now = new Date(),
  cashActivation = null,
  cashEntries = [],
  positionBaselines = [],
  transactions = [],
  assets = [],
  priceHistoryMap = {}
}) {
  const calendarWindow = getPerformanceCalendarWindow(range, now);
  const { completedEndDate, requestedStartDate, todayKey } = calendarWindow;

  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));

  const authorityStart = determineAuthorityStart(cashActivation, positionBaselines);
  if (!authorityStart) {
    return {
      status: 'unavailable',
      reportingCurrency: REPORTING_CURRENCY,
      period: {
        range,
        requestedStartDate,
        actualStartDate: null,
        endDate: completedEndDate,
        inceptionDate: null,
        clippedToInception: false,
        performanceTimezone: PERFORMANCE_TIMEZONE
      },
      valuationCoverage: {
        status: 'unavailable',
        valuationMarks: 0,
        carriedForwardMarks: 0,
        missingValuationMarks: 0,
        reasons: ['NO_AUTHORITY_START']
      },
      twr: { status: 'unavailable', returnPct: null, methodology: PERFORMANCE_METHODOLOGY.twrMethodology, exact: false, reason: 'NO_AUTHORITY_START' },
      mwr: { status: 'unavailable', annualizedReturnPct: null, methodology: PERFORMANCE_METHODOLOGY.mwrMethodology, dayCountConvention: PERFORMANCE_METHODOLOGY.dayCountConvention, reason: 'NO_AUTHORITY_START' },
      pnl: { status: 'unavailable', currency: REPORTING_CURRENCY, asOfDate: completedEndDate, realizedPnlDuringPeriod: null, cumulativeRealizedPnlToEnd: null, unrealizedPnlAtEnd: null, totalAccountingPnlAtEnd: null, reason: 'NO_AUTHORITY_START' },
      drawdown: { status: 'unavailable', currentDrawdownPct: null, maxDrawdownPct: null, peakDate: null, troughDate: null, reason: 'NO_AUTHORITY_START' },
      methodology: PERFORMANCE_METHODOLOGY,
      series: []
    };
  }

  const inception = findPerformanceInceptionDate({
    authorityStart,
    cashActivation,
    cashEntries,
    positionBaselines,
    transactions,
    assetMap,
    priceHistoryMap,
    completedEndDate
  });

  if (!inception) {
    return {
      status: 'unavailable',
      reportingCurrency: REPORTING_CURRENCY,
      period: {
        range,
        requestedStartDate,
        actualStartDate: null,
        endDate: completedEndDate,
        inceptionDate: null,
        clippedToInception: false,
        performanceTimezone: PERFORMANCE_TIMEZONE
      },
      valuationCoverage: {
        status: 'unavailable',
        valuationMarks: 0,
        carriedForwardMarks: 0,
        missingValuationMarks: 0,
        reasons: ['NO_STARTING_VALUATION']
      },
      twr: { status: 'unavailable', returnPct: null, methodology: PERFORMANCE_METHODOLOGY.twrMethodology, exact: false, reason: 'NO_STARTING_VALUATION' },
      mwr: { status: 'unavailable', annualizedReturnPct: null, methodology: PERFORMANCE_METHODOLOGY.mwrMethodology, dayCountConvention: PERFORMANCE_METHODOLOGY.dayCountConvention, reason: 'NO_STARTING_VALUATION' },
      pnl: { status: 'unavailable', currency: REPORTING_CURRENCY, asOfDate: completedEndDate, realizedPnlDuringPeriod: null, cumulativeRealizedPnlToEnd: null, unrealizedPnlAtEnd: null, totalAccountingPnlAtEnd: null, reason: 'NO_STARTING_VALUATION' },
      drawdown: { status: 'unavailable', currentDrawdownPct: null, maxDrawdownPct: null, peakDate: null, troughDate: null, reason: 'NO_STARTING_VALUATION' },
      methodology: PERFORMANCE_METHODOLOGY,
      series: []
    };
  }

  const { inceptionDateKey } = inception;
  const actualStartDate = requestedStartDate < inceptionDateKey ? inceptionDateKey : requestedStartDate;
  const actualEndDate = completedEndDate;
  const clippedToInception = requestedStartDate < inceptionDateKey;

  if (actualStartDate > actualEndDate) {
    return {
      status: 'insufficient_data',
      reportingCurrency: REPORTING_CURRENCY,
      period: {
        range,
        requestedStartDate,
        actualStartDate,
        endDate: actualEndDate,
        inceptionDate: inceptionDateKey,
        clippedToInception,
        performanceTimezone: PERFORMANCE_TIMEZONE
      },
      valuationCoverage: {
        status: 'unavailable',
        valuationMarks: 0,
        carriedForwardMarks: 0,
        missingValuationMarks: 0,
        reasons: ['INSUFFICIENT_DATE_SPAN']
      },
      twr: { status: 'insufficient_data', returnPct: null, methodology: PERFORMANCE_METHODOLOGY.twrMethodology, exact: false, reason: 'INSUFFICIENT_DATE_SPAN' },
      mwr: { status: 'insufficient_data', annualizedReturnPct: null, methodology: PERFORMANCE_METHODOLOGY.mwrMethodology, dayCountConvention: PERFORMANCE_METHODOLOGY.dayCountConvention, reason: 'INSUFFICIENT_DATE_SPAN' },
      pnl: { status: 'insufficient_data', currency: REPORTING_CURRENCY, asOfDate: actualEndDate, realizedPnlDuringPeriod: null, cumulativeRealizedPnlToEnd: null, unrealizedPnlAtEnd: null, totalAccountingPnlAtEnd: null, reason: 'INSUFFICIENT_DATE_SPAN' },
      drawdown: { status: 'insufficient_data', currentDrawdownPct: null, maxDrawdownPct: null, peakDate: null, troughDate: null, reason: 'INSUFFICIENT_DATE_SPAN' },
      methodology: PERFORMANCE_METHODOLOGY,
      series: []
    };
  }

  // Build daily valuation marks and external flows for each calendar date in actual span
  const dateSpan = generateDateSpan(actualStartDate, actualEndDate);
  const valuationSeries = [];
  const coverageReasons = new Set();
  let totalValuationMarks = 0;
  let totalCarriedForwardMarks = 0;
  let totalMissingMarks = 0;
  let hasCoverageDegradation = false;
  let hasInvestedAssets = false;

  for (const dateKey of dateSpan) {
    const cash = reconstructCashBalance(dateKey, cashActivation, cashEntries, transactions);
    const holdingsMap = reconstructHoldingsState(dateKey, positionBaselines, transactions);

    // Compute external flows on this date
    let deposits = 0;
    let withdrawals = 0;
    for (const entry of cashEntries) {
      const entryDate = normalizeTimestampToDateKey(entry.effectiveAt || entry.effective_at);
      if (entryDate === dateKey) {
        const amount = requireAuthoritativeCashNumber(entry.amount, 'cash ledger amount');
        const type = entry.entryType || entry.entry_type;
        if (type === 'DEPOSIT') deposits += amount;
        if (type === 'WITHDRAWAL') withdrawals += amount;
      }
    }
    const cashCapitalFlow = deposits - withdrawals;
    const externalSettlement = getExternalSettlementFlowForDate(dateKey, transactions);
    const externalSettlementFlow = externalSettlement.netExternalSettlementFlow;
    const netExternalFlow = cashCapitalFlow + externalSettlementFlow;

    let holdingsValue = 0;
    let dateHasMissing = false;
    let dateHasNonVnd = false;

    for (const [assetId, holding] of holdingsMap.entries()) {
      if (holding.quantity <= 0) continue;
      hasInvestedAssets = true;

      const asset = assetMap[assetId];
      if (!asset) {
        dateHasMissing = true;
        totalMissingMarks += 1;
        coverageReasons.add('MISSING_VALUATION_MARK');
        continue;
      }

      if (asset.quoteCurrency !== REPORTING_CURRENCY && asset.quote_currency !== REPORTING_CURRENCY) {
        dateHasNonVnd = true;
        totalMissingMarks += 1;
        coverageReasons.add('NON_VND_HISTORICAL_FX_UNAVAILABLE');
        continue;
      }

      const mark = getValuationMark(asset, dateKey, priceHistoryMap);
      if (mark.isMissing || !mark.isEligible || mark.price === null) {
        dateHasMissing = true;
        totalMissingMarks += 1;
        coverageReasons.add(mark.reason || 'MISSING_VALUATION_MARK');
      } else {
        totalValuationMarks += 1;
        if (mark.isCarriedForward) {
          totalCarriedForwardMarks += 1;
        }
        holdingsValue += holding.quantity * mark.price;
      }
    }

    const isComplete = !dateHasMissing && !dateHasNonVnd;
    if (!isComplete) {
      hasCoverageDegradation = true;
    }

    const portfolioValue = isComplete ? (cash + holdingsValue) : null;

    valuationSeries.push({
      dateKey,
      portfolioValue,
      cash,
      holdingsValue,
      netExternalFlow,
      cashCapitalFlow,
      externalSettlementFlow,
      externalSettlementContributions: externalSettlement.contributions,
      externalSettlementWithdrawals: externalSettlement.withdrawals,
      deposits,
      withdrawals,
      isComplete
    });
  }

  const coverageStatus = hasCoverageDegradation ? 'partial' : 'complete';

  // --- TWR & Wealth Index Calculation ---
  let twrStatus = 'available';
  let twrReason = null;
  let twrReturnPct = null;
  let twrIndex = 100.0;
  let peakIndex = 100.0;
  let maxDrawdownPct = 0.0;
  let peakDate = actualStartDate;
  let troughDate = actualStartDate;

  const series = [];

  if (hasCoverageDegradation) {
    twrStatus = 'unavailable';
    twrReason = Array.from(coverageReasons)[0] || 'INCOMPLETE_VALUATION_COVERAGE';
  }

  if (twrStatus === 'available') {
    // Process first point
    const firstPoint = valuationSeries[0];
    if (firstPoint.portfolioValue === null || firstPoint.portfolioValue <= 0) {
      twrStatus = 'unavailable';
      twrReason = 'ZERO_STARTING_VALUATION';
    } else {
      series.push({
        date: firstPoint.dateKey,
        portfolioValueVnd: firstPoint.portfolioValue,
        netExternalFlowVnd: firstPoint.netExternalFlow,
        cashCapitalFlowVnd: firstPoint.cashCapitalFlow,
        externalSettlementFlowVnd: firstPoint.externalSettlementFlow,
        twrIndex: 100.0,
        drawdownPct: 0.0
      });

      for (let i = 1; i < valuationSeries.length; i += 1) {
        const prev = valuationSeries[i - 1];
        const curr = valuationSeries[i];

        if (prev.portfolioValue === null || prev.portfolioValue <= 0) {
          twrStatus = 'unavailable';
          twrReason = 'ZERO_CAPITAL_BREAK';
          break;
        }

        const subperiodReturn = (curr.portfolioValue - curr.netExternalFlow) / prev.portfolioValue - 1.0;
        twrIndex = twrIndex * (1.0 + subperiodReturn);

        if (twrIndex > peakIndex) {
          peakIndex = twrIndex;
          peakDate = curr.dateKey;
        }

        const currentDrawdown = ((twrIndex - peakIndex) / peakIndex) * 100.0;
        if (currentDrawdown < maxDrawdownPct) {
          maxDrawdownPct = currentDrawdown;
          troughDate = curr.dateKey;
        }

        series.push({
          date: curr.dateKey,
          portfolioValueVnd: curr.portfolioValue,
          netExternalFlowVnd: curr.netExternalFlow,
          cashCapitalFlowVnd: curr.cashCapitalFlow,
          externalSettlementFlowVnd: curr.externalSettlementFlow,
          twrIndex: Number.isFinite(twrIndex) ? twrIndex : null,
          drawdownPct: Number.isFinite(currentDrawdown) ? currentDrawdown : null
        });
      }

      if (twrStatus === 'available') {
        twrReturnPct = (twrIndex / 100.0 - 1.0) * 100.0;
      }
    }
  }

  // Fallback series if TWR is unavailable
  const finalSeries = twrStatus === 'available' ? series : valuationSeries.map((v) => ({
    date: v.dateKey,
    portfolioValueVnd: v.portfolioValue,
    netExternalFlowVnd: v.netExternalFlow,
    cashCapitalFlowVnd: v.cashCapitalFlow,
    externalSettlementFlowVnd: v.externalSettlementFlow,
    twrIndex: null,
    drawdownPct: null
  }));

  const currentDrawdownPct = twrStatus === 'available' && finalSeries.length > 0
    ? finalSeries[finalSeries.length - 1].drawdownPct
    : null;

  const drawdownResult = twrStatus === 'available'
    ? {
        status: 'available',
        currentDrawdownPct,
        maxDrawdownPct,
        peakDate,
        troughDate,
        reason: null
      }
    : {
        status: 'unavailable',
        currentDrawdownPct: null,
        maxDrawdownPct: null,
        peakDate: null,
        troughDate: null,
        reason: twrReason || 'TWR_UNAVAILABLE'
      };

  // --- MWR / XIRR Calculation ---
  let mwrResult;
  if (hasCoverageDegradation) {
    mwrResult = {
      status: 'unavailable',
      annualizedReturnPct: null,
      methodology: PERFORMANCE_METHODOLOGY.mwrMethodology,
      dayCountConvention: PERFORMANCE_METHODOLOGY.dayCountConvention,
      reason: Array.from(coverageReasons)[0] || 'INCOMPLETE_VALUATION_COVERAGE'
    };
  } else {
    const xirrFlows = [];
    const firstPoint = valuationSeries[0];
    const lastPoint = valuationSeries[valuationSeries.length - 1];

    if (firstPoint && firstPoint.portfolioValue !== null) {
      xirrFlows.push({ dateKey: actualStartDate, amount: -firstPoint.portfolioValue });
    }

    for (let i = 1; i < valuationSeries.length - 1; i += 1) {
      const pt = valuationSeries[i];
      if (pt.netExternalFlow !== 0) {
        xirrFlows.push({ dateKey: pt.dateKey, amount: -pt.netExternalFlow });
      }
    }

    if (lastPoint && lastPoint.portfolioValue !== null) {
      xirrFlows.push({
        dateKey: actualEndDate,
        amount: lastPoint.portfolioValue - lastPoint.netExternalFlow
      });
    }

    mwrResult = solveXirr(xirrFlows);
  }

  // --- Accounting P/L As-Of Actual End Date ---
  let pnlStatus = 'available';
  let pnlReason = null;
  let realizedPnlDuringPeriod = 0;
  let cumulativeRealizedPnlToEnd = 0;
  let unrealizedPnlAtEnd = null;
  let totalAccountingPnlAtEnd = null;

  for (const tx of transactions) {
    const txDate = normalizeTimestampToDateKey(tx.executedAt || tx.executed_at);
    if (!txDate) continue;

    const realized = typeof tx.realizedPnL === 'number'
      ? tx.realizedPnL
      : (typeof tx.realized_pnl === 'number' ? tx.realized_pnl : Number(tx.realized_pnl || 0));

    if (txDate <= actualEndDate) {
      cumulativeRealizedPnlToEnd += realized;
    }
    if (txDate > actualStartDate && txDate <= actualEndDate) {
      realizedPnlDuringPeriod += realized;
    }
  }

  // Calculate unrealized P/L at actualEndDate
  const endHoldingsMap = reconstructHoldingsState(actualEndDate, positionBaselines, transactions);
  let endUnrealizedSum = 0;
  let endPnlComplete = true;

  for (const [assetId, holding] of endHoldingsMap.entries()) {
    if (holding.quantity <= 0) continue;

    const asset = assetMap[assetId];
    if (!asset || (asset.quoteCurrency !== REPORTING_CURRENCY && asset.quote_currency !== REPORTING_CURRENCY)) {
      endPnlComplete = false;
      break;
    }

    if (holding.averageCost === null || !Number.isFinite(holding.averageCost)) {
      endPnlComplete = false;
      break;
    }

    const mark = getValuationMark(asset, actualEndDate, priceHistoryMap);
    if (mark.isMissing || !mark.isEligible || mark.price === null) {
      endPnlComplete = false;
      break;
    }

    const costBasis = holding.quantity * holding.averageCost;
    const marketValue = holding.quantity * mark.price;
    endUnrealizedSum += (marketValue - costBasis);
  }

  if (endPnlComplete) {
    unrealizedPnlAtEnd = endUnrealizedSum;
    totalAccountingPnlAtEnd = cumulativeRealizedPnlToEnd + unrealizedPnlAtEnd;
  } else {
    pnlStatus = 'partial';
    pnlReason = 'NON_VND_OR_MISSING_END_PRICE';
  }

  return {
    status: coverageStatus === 'complete' && twrStatus === 'available' ? 'available' : (hasCoverageDegradation ? 'partial' : 'available'),
    reportingCurrency: REPORTING_CURRENCY,
    period: {
      range,
      requestedStartDate,
      actualStartDate,
      endDate: actualEndDate,
      inceptionDate: inceptionDateKey,
      clippedToInception,
      performanceTimezone: PERFORMANCE_TIMEZONE
    },
    valuationCoverage: {
      status: coverageStatus,
      valuationMarks: totalValuationMarks,
      carriedForwardMarks: totalCarriedForwardMarks,
      missingValuationMarks: totalMissingMarks,
      reasons: Array.from(coverageReasons)
    },
    twr: {
      status: twrStatus,
      returnPct: twrReturnPct,
      methodology: PERFORMANCE_METHODOLOGY.twrMethodology,
      exact: false,
      reason: twrReason
    },
    mwr: mwrResult,
    pnl: {
      status: pnlStatus,
      currency: REPORTING_CURRENCY,
      asOfDate: actualEndDate,
      realizedPnlDuringPeriod,
      cumulativeRealizedPnlToEnd,
      unrealizedPnlAtEnd,
      totalAccountingPnlAtEnd,
      reason: pnlReason
    },
    drawdown: drawdownResult,
    benchmarkEligibility: hasInvestedAssets
      ? { status: 'eligible', reason: null }
      : { status: 'not_applicable', reason: 'CASH_ONLY_PORTFOLIO' },
    methodology: {
      feesIncluded: false,
      taxesIncluded: false,
      dividendsIncluded: false,
      corporateActionsAdjusted: false
    },
    series: finalSeries
  };
}

/**
 * Service function to retrieve and compute portfolio performance from database & market adapters.
 */
export async function getPortfolioPerformance({
  profileId,
  range = '1M',
  now = new Date(),
  client = privateSupabase,
  getCashActivationFn = getCashActivation,
  getCashLedgerFn = getCashLedger,
  getPositionOpeningBaselinesFn = getPositionOpeningBaselines,
  getPortfolioTransactionsFn = getPortfolioTransactions,
  getAssetsFn = getAssets,
  getMarketHistoryFn = getMarketHistory
} = {}) {
  const profileOptions = profileId ? { profileId } : {};

  // 1. Fetch immutable data concurrently
  const [
    cashActivation,
    cashEntries,
    positionBaselines,
    transactions,
    assets
  ] = await Promise.all([
    getCashActivationFn(client, profileOptions),
    getCashLedgerFn(client, profileOptions),
    getPositionOpeningBaselinesFn(client, profileOptions),
    getPortfolioTransactionsFn(profileOptions, client, profileOptions),
    getAssetsFn(client)
  ]);

  // 2. Identify all asset symbols that need historical price bars
  const requiredAssetIds = new Set([
    ...positionBaselines
      .filter((baseline) => !baseline.cancelledAt && !baseline.cancelled_at)
      .map((baseline) => baseline.assetId || baseline.asset_id),
    ...transactions.map((transaction) => transaction.assetId || transaction.asset_id)
  ].filter(Boolean));

  const relevantAssets = assets.filter((asset) => requiredAssetIds.has(asset.id));
  const assetSymbols = Array.from(new Set(
    relevantAssets
      .map((a) => a.symbol)
      .filter((sym) => typeof sym === 'string' && sym.trim().length > 0)
  ));

  // 3. Fetch completed daily history for each asset (1Y lookback to cover full history needed)
  const priceHistoryEntries = await Promise.all(
    assetSymbols.map(async (symbol) => {
      try {
        const history = await getMarketHistoryFn(symbol, '1Y', now);
        return [symbol, history?.bars || []];
      } catch {
        return [symbol, []];
      }
    })
  );

  const priceHistoryMap = Object.fromEntries(priceHistoryEntries);

  // 4. Calculate pure deterministic performance
  return calculatePortfolioPerformance({
    range,
    now,
    cashActivation,
    cashEntries,
    positionBaselines,
    transactions,
    assets: relevantAssets,
    priceHistoryMap
  });
}
