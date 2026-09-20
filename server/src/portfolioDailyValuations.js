import { createHash } from 'node:crypto';

import { getCashLedger } from './cash.js';
import { addCalendarDays, getCanonicalDate } from './history.js';
import { getPortfolioSnapshot } from './portfolioSnapshot.js';
import { privateSupabase } from './supabase.js';
import { getPortfolioTransactions } from './transactions.js';

export const DAILY_VALUATION_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const DAILY_VALUATION_CAPTURE_HOUR = 23;
export const DAILY_VALUATION_CAPTURE_MINUTE = 45;
export const DAILY_VALUATION_SCHEMA_VERSION = 1;

const OBSERVATION_STATUSES = new Set(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireClient(client) {
  if (!client) throw new Error('Private database access is not configured');
  return client;
}

function finiteNumber(value, { nonNegative = false } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(normalized) || (nonNegative && normalized < 0)) return null;
  return normalized;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

export function createDailyValuationEvidenceHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function zonedParts(now, timeZone = DAILY_VALUATION_TIMEZONE) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Daily valuation clock is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export function getDailyValuationSchedule(now = new Date()) {
  const parts = zonedParts(now);
  return {
    ...parts,
    timeZone: DAILY_VALUATION_TIMEZONE,
    due: parts.hour === DAILY_VALUATION_CAPTURE_HOUR
      && parts.minute >= DAILY_VALUATION_CAPTURE_MINUTE
  };
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function transactionTimestamp(transaction) {
  return transaction?.executedAt || transaction?.executed_at || null;
}

function cashTimestamp(entry) {
  return entry?.transactionExecutedAt
    || entry?.transaction_executed_at
    || entry?.effectiveAt
    || entry?.effective_at
    || null;
}

function inBoundaryInterval(timestamp, startExclusive, endInclusive) {
  if (!validTimestamp(timestamp) || !validTimestamp(endInclusive)) return false;
  const time = Date.parse(timestamp);
  return time <= Date.parse(endInclusive)
    && (!startExclusive || time > Date.parse(startExclusive));
}

function sanitizedFlowEvent({ sourceType, sourceId, eventType, economicAt, amountVnd, status }) {
  return {
    sourceType,
    sourceId: sourceId || null,
    eventType,
    economicAt,
    amountVnd,
    status
  };
}

/**
 * Builds actual external capital-flow evidence over one exact valuation
 * boundary interval: (startExclusive, endInclusive]. Internal tracked-cash
 * BUY/SELL movements are intentionally excluded.
 */
export function buildBoundaryExternalFlowEvidence({
  startExclusive = null,
  endInclusive,
  cashEntries = [],
  transactions = []
} = {}) {
  if (!validTimestamp(endInclusive) || (startExclusive && !validTimestamp(startExclusive))) {
    throw new TypeError('A valid external-flow boundary interval is required');
  }
  if (startExclusive && Date.parse(startExclusive) >= Date.parse(endInclusive)) {
    throw new TypeError('External-flow interval start must precede its end');
  }

  const events = [];
  let netExternalFlowVnd = 0;
  let available = true;

  for (const entry of cashEntries) {
    const type = entry?.entryType || entry?.entry_type;
    if (!['DEPOSIT', 'WITHDRAWAL'].includes(type)) continue;
    const economicAt = cashTimestamp(entry);
    if (!inBoundaryInterval(economicAt, startExclusive, endInclusive)) continue;
    const amount = finiteNumber(entry?.amount, { nonNegative: true });
    const signedAmount = amount === null ? null : (type === 'DEPOSIT' ? amount : -amount);
    if (signedAmount === null) available = false;
    else netExternalFlowVnd += signedAmount;
    events.push(sanitizedFlowEvent({
      sourceType: 'CASH_LEDGER',
      sourceId: entry?.id,
      eventType: type,
      economicAt,
      amountVnd: signedAmount,
      status: signedAmount === null ? 'UNAVAILABLE' : 'AVAILABLE'
    }));
  }

  for (const transaction of transactions) {
    const settlementMode = transaction?.settlementMode
      || transaction?.settlement_mode
      || 'INTERNAL_VND_CASH';
    if (settlementMode !== 'EXTERNAL_SETTLEMENT') continue;
    const economicAt = transactionTimestamp(transaction);
    if (!inBoundaryInterval(economicAt, startExclusive, endInclusive)) continue;
    const type = transaction?.transactionType || transaction?.transaction_type;
    if (!['BUY', 'SELL', 'BUY_REVERSAL', 'SELL_REVERSAL'].includes(type)) continue;
    const quantity = finiteNumber(transaction?.quantity, { nonNegative: true });
    const price = finiteNumber(transaction?.price, { nonNegative: true });
    const absoluteAmount = quantity === null || price === null ? null : quantity * price;
    const direction = type === 'BUY'
      ? 1
      : type === 'SELL'
        ? -1
        : type === 'BUY_REVERSAL'
          ? -1
          : 1;
    const signedAmount = absoluteAmount === null ? null : absoluteAmount * direction;
    if (signedAmount === null) available = false;
    else netExternalFlowVnd += signedAmount;
    events.push(sanitizedFlowEvent({
      sourceType: 'PORTFOLIO_TRANSACTION',
      sourceId: transaction?.id,
      eventType: type,
      economicAt,
      amountVnd: signedAmount,
      status: signedAmount === null ? 'UNAVAILABLE' : 'AVAILABLE'
    }));
  }

  events.sort((left, right) => (
    Date.parse(left.economicAt) - Date.parse(right.economicAt)
    || String(left.sourceType).localeCompare(String(right.sourceType))
    || String(left.sourceId).localeCompare(String(right.sourceId))
  ));

  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    netExternalFlowVnd: available ? netExternalFlowVnd : null,
    startExclusive,
    endInclusive,
    events
  };
}

function normalizeObservationStatus(snapshot) {
  const status = String(snapshot?.status || '').toUpperCase();
  return OBSERVATION_STATUSES.has(status) ? status : 'PARTIAL';
}

function sanitizeHoldingEvidence(holding) {
  return {
    assetId: holding?.assetId || null,
    symbol: holding?.symbol || null,
    quantity: finiteNumber(holding?.quantity, { nonNegative: true }),
    quantityUnit: holding?.quantityUnit || null,
    nativePrice: finiteNumber(holding?.nativePrice, { nonNegative: true }),
    nativeCurrency: holding?.nativeCurrency || null,
    nativeMarketValue: finiteNumber(holding?.nativeMarketValue, { nonNegative: true }),
    reportingCurrency: holding?.reportingCurrency || 'VND',
    reportingMarketValueVnd: finiteNumber(holding?.reportingMarketValue, { nonNegative: true }),
    valuationStatus: holding?.valuationStatus || 'unavailable',
    valuationReason: holding?.valuationReason || null,
    priceProvider: holding?.marketProvider || null,
    priceAsOf: holding?.marketUpdatedAt || holding?.priceAsOf || null,
    priceFreshness: holding?.marketFreshness || null,
    fxRateToVnd: finiteNumber(holding?.fxRateToReporting, { nonNegative: true }),
    fxProvider: holding?.fxProvider || null,
    fxAsOf: holding?.fxRateTimestamp || holding?.fxAsOf || null,
    fxFreshness: holding?.fxFreshness || null
  };
}

function sanitizeSourceEvidence(snapshot) {
  const prices = (Array.isArray(snapshot?.sources?.prices) ? snapshot.sources.prices : []).map((price) => ({
    assetId: price?.assetId || null,
    symbol: price?.symbol || null,
    source: price?.source || null,
    priceAsOf: price?.priceAsOf || null,
    freshness: price?.freshness || null,
    status: price?.status || null
  }));
  prices.sort((left, right) => (
    String(left.assetId).localeCompare(String(right.assetId))
    || String(left.symbol).localeCompare(String(right.symbol))
  ));
  const fx = (Array.isArray(snapshot?.sources?.fx) ? snapshot.sources.fx : []).map((item) => ({
    assetId: item?.assetId || null,
    baseCurrency: item?.baseCurrency || null,
    quoteCurrency: item?.quoteCurrency || null,
    provider: item?.provider || null,
    rate: finiteNumber(item?.rate, { nonNegative: true }),
    asOf: item?.asOf || null,
    freshness: item?.freshness || null,
    status: item?.status || null
  }));
  fx.sort((left, right) => (
    String(left.assetId).localeCompare(String(right.assetId))
    || String(left.baseCurrency).localeCompare(String(right.baseCurrency))
    || String(left.quoteCurrency).localeCompare(String(right.quoteCurrency))
  ));
  return {
    prices,
    fx
  };
}

export function buildPortfolioDailyValuationObservation({
  profileId,
  valuationDate,
  observedAt,
  snapshot,
  previousObservation = null,
  boundaryFlow = null
} = {}) {
  if (typeof profileId !== 'string' || !profileId.trim()) {
    throw new TypeError('Daily valuation profileId is required');
  }
  if (!DATE_KEY_PATTERN.test(valuationDate || '')) {
    throw new TypeError('Daily valuation date is invalid');
  }
  if (!validTimestamp(observedAt)) throw new TypeError('Daily valuation observedAt is invalid');
  if (getCanonicalDate(observedAt, DAILY_VALUATION_TIMEZONE) !== valuationDate) {
    throw new TypeError('Daily valuation date conflicts with observedAt');
  }
  if (!snapshot || snapshot.profileId !== profileId) {
    throw new TypeError('Daily valuation snapshot profile is inconsistent');
  }

  const previousDate = previousObservation?.valuationDate || previousObservation?.valuation_date || null;
  const expectedPreviousDate = addCalendarDays(valuationDate, -1);
  const isFirstObservation = !previousObservation;
  const isConsecutive = previousDate === expectedPreviousDate;
  const intervalType = isFirstObservation
    ? 'FIRST_OBSERVATION'
    : isConsecutive
      ? 'CONSECUTIVE_DAILY_BOUNDARY'
      : 'MULTI_DAY_GAP';
  const flow = isFirstObservation
    ? {
        status: 'NOT_APPLICABLE',
        netExternalFlowVnd: null,
        startExclusive: null,
        endInclusive: observedAt,
        events: []
      }
    : boundaryFlow;
  if (!flow || flow.endInclusive !== observedAt) {
    throw new TypeError('Daily valuation boundary flow is inconsistent');
  }

  const holdings = (Array.isArray(snapshot.holdings) ? snapshot.holdings : [])
    .map(sanitizeHoldingEvidence)
    .sort((left, right) => String(left.assetId).localeCompare(String(right.assetId)));
  const status = normalizeObservationStatus(snapshot);
  const coverageReasons = Array.from(new Set([
    ...(status === 'PARTIAL' ? ['INCOMPLETE_DAILY_VALUATION'] : []),
    ...(status === 'UNAVAILABLE' ? ['DAILY_VALUATION_UNAVAILABLE'] : []),
    ...holdings.map((holding) => holding.valuationReason).filter(Boolean)
  ]));

  const evidence = {
    schemaVersion: DAILY_VALUATION_SCHEMA_VERSION,
    valuation: {
      valuationDate,
      valuationTimezone: DAILY_VALUATION_TIMEZONE,
      observedAt,
      snapshotId: snapshot.snapshotId,
      ledgerRevision: snapshot.ledgerRevision,
      status,
      reportingCurrency: 'VND',
      cashVnd: finiteNumber(snapshot?.cash?.value, { nonNegative: true }),
      investedMarketValueVnd: finiteNumber(snapshot?.investedMarketValue, { nonNegative: true }),
      totalPortfolioValueVnd: finiteNumber(snapshot?.totalPortfolioValue, { nonNegative: true }),
      unrealizedPnlVnd: finiteNumber(snapshot?.unrealizedPnL),
      unrealizedPnlStatus: snapshot?.completeness?.unrealizedPnl || 'UNAVAILABLE',
      coverageReasons
    },
    holdings,
    sources: sanitizeSourceEvidence(snapshot),
    flowInterval: {
      type: intervalType,
      startExclusive: flow.startExclusive,
      endInclusive: flow.endInclusive,
      status: flow.status,
      netExternalFlowVnd: flow.netExternalFlowVnd,
      events: flow.events
    }
  };
  const evidenceHash = createDailyValuationEvidenceHash({ profileId, evidence });
  const valuedHoldingsCount = holdings.filter((holding) => (
    ['available', 'stale'].includes(holding.valuationStatus)
    && holding.reportingMarketValueVnd !== null
  )).length;

  return {
    profileId,
    valuationDate,
    valuationTimezone: DAILY_VALUATION_TIMEZONE,
    observedAt,
    snapshotId: snapshot.snapshotId,
    ledgerRevision: snapshot.ledgerRevision,
    reportingCurrency: 'VND',
    status,
    cashVnd: evidence.valuation.cashVnd,
    investedMarketValueVnd: evidence.valuation.investedMarketValueVnd,
    totalPortfolioValueVnd: evidence.valuation.totalPortfolioValueVnd,
    unrealizedPnlVnd: evidence.valuation.unrealizedPnlVnd,
    totalHoldingsCount: holdings.length,
    valuedHoldingsCount,
    boundaryExternalFlowVnd: flow.netExternalFlowVnd,
    flowStatus: flow.status,
    flowIntervalStart: flow.startExclusive,
    flowIntervalEnd: flow.endInclusive,
    flowIntervalType: intervalType,
    evidenceHash,
    observationEvidence: evidence
  };
}

export function normalizePortfolioDailyValuation(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    valuationDate: row.valuation_date || row.valuationDate,
    valuationTimezone: row.valuation_timezone || row.valuationTimezone,
    observedAt: row.observed_at || row.observedAt,
    snapshotId: row.snapshot_id || row.snapshotId,
    ledgerRevision: row.ledger_revision || row.ledgerRevision,
    reportingCurrency: row.reporting_currency || row.reportingCurrency,
    status: row.status,
    cashVnd: finiteNumber(row.cash_vnd ?? row.cashVnd, { nonNegative: true }),
    investedMarketValueVnd: finiteNumber(
      row.invested_market_value_vnd ?? row.investedMarketValueVnd,
      { nonNegative: true }
    ),
    totalPortfolioValueVnd: finiteNumber(
      row.total_portfolio_value_vnd ?? row.totalPortfolioValueVnd,
      { nonNegative: true }
    ),
    unrealizedPnlVnd: finiteNumber(row.unrealized_pnl_vnd ?? row.unrealizedPnlVnd),
    totalHoldingsCount: Number(row.total_holdings_count ?? row.totalHoldingsCount),
    valuedHoldingsCount: Number(row.valued_holdings_count ?? row.valuedHoldingsCount),
    boundaryExternalFlowVnd: finiteNumber(
      row.boundary_external_flow_vnd ?? row.boundaryExternalFlowVnd
    ),
    flowStatus: row.flow_status || row.flowStatus,
    flowIntervalStart: row.flow_interval_start || row.flowIntervalStart || null,
    flowIntervalEnd: row.flow_interval_end || row.flowIntervalEnd,
    flowIntervalType: row.flow_interval_type || row.flowIntervalType,
    evidenceHash: row.evidence_hash || row.evidenceHash,
    observationEvidence: row.observation_evidence || row.observationEvidence || {},
    createdAt: row.created_at || row.createdAt || null
  };
}

function observationRow(observation) {
  return {
    profile_id: observation.profileId,
    valuation_date: observation.valuationDate,
    valuation_timezone: observation.valuationTimezone,
    observed_at: observation.observedAt,
    snapshot_id: observation.snapshotId,
    ledger_revision: observation.ledgerRevision,
    reporting_currency: observation.reportingCurrency,
    status: observation.status,
    cash_vnd: observation.cashVnd,
    invested_market_value_vnd: observation.investedMarketValueVnd,
    total_portfolio_value_vnd: observation.totalPortfolioValueVnd,
    unrealized_pnl_vnd: observation.unrealizedPnlVnd,
    total_holdings_count: observation.totalHoldingsCount,
    valued_holdings_count: observation.valuedHoldingsCount,
    boundary_external_flow_vnd: observation.boundaryExternalFlowVnd,
    flow_status: observation.flowStatus,
    flow_interval_start: observation.flowIntervalStart,
    flow_interval_end: observation.flowIntervalEnd,
    flow_interval_type: observation.flowIntervalType,
    evidence_hash: observation.evidenceHash,
    observation_evidence: observation.observationEvidence
  };
}

export async function getPortfolioDailyValuationByDate({ profileId, valuationDate } = {}, client = privateSupabase) {
  const db = requireClient(client);
  const { data, error } = await db
    .from('portfolio_daily_valuations')
    .select('*')
    .eq('profile_id', profileId)
    .eq('valuation_date', valuationDate)
    .maybeSingle();
  if (error) throw new Error(`Failed to read portfolio daily valuation: ${error.message}`);
  return normalizePortfolioDailyValuation(data);
}

export async function getLatestPortfolioDailyValuationBeforeDate(
  { profileId, valuationDate } = {},
  client = privateSupabase
) {
  const db = requireClient(client);
  const { data, error } = await db
    .from('portfolio_daily_valuations')
    .select('*')
    .eq('profile_id', profileId)
    .lt('valuation_date', valuationDate)
    .order('valuation_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to read prior portfolio daily valuation: ${error.message}`);
  return normalizePortfolioDailyValuation(data);
}

export async function listPortfolioDailyValuations(
  { profileId, startDate, endDate } = {},
  client = privateSupabase
) {
  const db = requireClient(client);
  let query = db
    .from('portfolio_daily_valuations')
    .select('*')
    .eq('profile_id', profileId)
    .order('valuation_date', { ascending: true });
  if (startDate) query = query.gte('valuation_date', startDate);
  if (endDate) query = query.lte('valuation_date', endDate);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list portfolio daily valuations: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('Database returned malformed portfolio daily valuations');
  return data.map(normalizePortfolioDailyValuation);
}

export async function persistPortfolioDailyValuation(observation, client = privateSupabase) {
  const db = requireClient(client);
  const { data, error } = await db
    .from('portfolio_daily_valuations')
    .insert(observationRow(observation))
    .select('*')
    .single();
  if (!error) return { observation: normalizePortfolioDailyValuation(data), replayed: false };
  if (error.code !== '23505') {
    throw new Error(`Failed to persist portfolio daily valuation: ${error.message}`);
  }
  const existing = await getPortfolioDailyValuationByDate({
    profileId: observation.profileId,
    valuationDate: observation.valuationDate
  }, db);
  if (!existing) throw new Error('Daily valuation uniqueness conflict could not be reconciled');
  return { observation: existing, replayed: true };
}

export async function listDailyValuationProfileIds(client = privateSupabase) {
  const db = requireClient(client);
  const { data, error } = await db
    .from('investor_profile')
    .select('id')
    .order('id', { ascending: true });
  if (error) throw new Error(`Failed to list daily valuation profiles: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('Database returned malformed investor profiles');
  return data.map((row) => row.id).filter(Boolean);
}

export async function capturePortfolioDailyValuationForProfile({
  profileId,
  now = new Date(),
  client = privateSupabase,
  getExistingFn = getPortfolioDailyValuationByDate,
  getPreviousFn = getLatestPortfolioDailyValuationBeforeDate,
  getSnapshotFn = getPortfolioSnapshot,
  getCashLedgerFn = getCashLedger,
  getTransactionsFn = getPortfolioTransactions,
  persistFn = persistPortfolioDailyValuation
} = {}) {
  const observedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const valuationDate = getCanonicalDate(observedAt, DAILY_VALUATION_TIMEZONE);
  const existing = await getExistingFn({ profileId, valuationDate }, client);
  if (existing) return { observation: existing, replayed: true };

  const previousObservation = await getPreviousFn({ profileId, valuationDate }, client);
  const [snapshot, cashEntries, transactions] = await Promise.all([
    getSnapshotFn({ profileId, now: () => new Date(observedAt) }),
    getCashLedgerFn(client, { profileId }),
    getTransactionsFn({ profileId }, client, { profileId })
  ]);
  const boundaryFlow = previousObservation
    ? buildBoundaryExternalFlowEvidence({
        startExclusive: previousObservation.observedAt,
        endInclusive: observedAt,
        cashEntries,
        transactions
      })
    : null;
  const observation = buildPortfolioDailyValuationObservation({
    profileId,
    valuationDate,
    observedAt,
    snapshot,
    previousObservation,
    boundaryFlow
  });
  return persistFn(observation, client);
}

export async function runScheduledPortfolioDailyValuationCapture({
  now = new Date(),
  client = privateSupabase,
  listProfileIdsFn = listDailyValuationProfileIds,
  captureProfileFn = capturePortfolioDailyValuationForProfile
} = {}) {
  const schedule = getDailyValuationSchedule(now);
  if (!schedule.due) {
    return {
      due: false,
      valuationDate: schedule.dateKey,
      capturedCount: 0,
      replayedCount: 0,
      failedCount: 0
    };
  }

  const profileIds = await listProfileIdsFn(client);
  let capturedCount = 0;
  let replayedCount = 0;
  let failedCount = 0;
  for (const profileId of profileIds) {
    try {
      const result = await captureProfileFn({ profileId, now, client });
      if (result.replayed) replayedCount += 1;
      else capturedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    due: true,
    valuationDate: schedule.dateKey,
    profileCount: profileIds.length,
    capturedCount,
    replayedCount,
    failedCount
  };
}
