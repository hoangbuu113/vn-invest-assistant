import { getAssets } from '../supabase.js';
import { getMarketHistory } from '../market.js';
import { SOURCE_FAMILIES, DEPENDENCY_GROUPS } from '../claims/sourceFamily.js';
import {
  recordJobHealth,
  HEALTH_STATES,
  OBSERVED_JOBS,
  ERROR_CATEGORIES
} from '../observability/dataHealth.js';
import {
  createEquityEvidence,
  EQUITY_EVIDENCE_FRESHNESS,
  EQUITY_EVIDENCE_METHODOLOGY,
  EQUITY_EVIDENCE_TYPES
} from './evidenceModel.js';
import { persistEquityEvidence } from './repository.js';

export const VN_EQUITY_MARKET_SOURCE = Object.freeze({
  sourceId: 'yahoo',
  sourceName: 'Yahoo Finance',
  sourceFamily: SOURCE_FAMILIES.MARKET_DATA,
  dependencyGroup: DEPENDENCY_GROUPS.MARKET_DATA,
  authorityLevel: 'MARKET_REFERENCE'
});

const PRICE_METRICS = Object.freeze([
  ['open', 'VND'],
  ['high', 'VND'],
  ['low', 'VND'],
  ['close', 'VND'],
  ['volume', 'share']
]);

function isFiniteMetric(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return metric === 'volume' ? value >= 0 : value > 0;
}

export function isCanonicalVietnamStock(asset) {
  return Boolean(
    asset
    && (asset.assetType ?? asset.asset_type) === 'stock'
    && (asset.marketPolicy ?? asset.market_policy) === 'VN_EXCHANGE'
    && (asset.quoteCurrency ?? asset.quote_currency) === 'VND'
    && asset.is_active !== false
    && asset.isActive !== false
  );
}

/**
 * Converts already-normalized completed daily history into immutable equity
 * evidence. Missing OHLCV values are omitted, never replaced with zero/close.
 */
export function buildMarketEvidenceFromHistory(asset, history, { now } = {}) {
  if (!isCanonicalVietnamStock(asset)) {
    throw new TypeError('Market equity evidence requires a canonical active VN stock');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Equity evidence collection requires an explicit valid now');
  }

  const symbol = asset.symbol.trim().toUpperCase();
  const exchange = String(asset.exchange || asset.marketCode || asset.market_code || '').trim().toUpperCase();
  const companyName = String(asset.name || '').trim();
  if (!exchange || !companyName) throw new TypeError('Canonical VN stock metadata is incomplete');

  const bars = Array.isArray(history?.bars) ? history.bars : [];
  const evidence = [];
  for (const bar of bars) {
    if (!bar || bar.isComplete !== true || typeof bar.date !== 'string') continue;
    for (const [metric, unit] of PRICE_METRICS) {
      if (!isFiniteMetric(metric, bar[metric])) continue;
      evidence.push(createEquityEvidence({
        assetId: asset.id,
        symbol,
        exchange,
        companyName,
        evidenceType: EQUITY_EVIDENCE_TYPES.MARKET_PRICE,
        metric,
        numericValue: bar[metric],
        unit,
        currency: metric === 'volume' ? null : 'VND',
        referencePeriod: bar.date,
        observedAt: bar.timestamp,
        publishedAt: null,
        sourceAvailableAt: bar.timestamp,
        fetchedAt: now.toISOString(),
        firstSeenAt: now.toISOString(),
        ...VN_EQUITY_MARKET_SOURCE,
        provenance: {
          provider: history.provider || 'yahoo',
          providerRole: 'canonical_completed_daily_market_history',
          marketPolicy: history.marketPolicy || 'VN_EXCHANGE',
          marketTimezone: history.marketTimezone || 'Asia/Ho_Chi_Minh',
          sessionDate: bar.date,
          completionSemantics: 'completed_daily_bar'
        },
        freshness: EQUITY_EVIDENCE_FRESHNESS.DELAYED,
        methodologyVersion: EQUITY_EVIDENCE_METHODOLOGY
      }));
    }
  }
  return evidence;
}

async function recordCollectorHealthSafely(payload, recordHealthFn) {
  try {
    await recordHealthFn(payload);
  } catch {
    // Evidence outcome remains authoritative even if telemetry persistence fails.
  }
}

export async function runVietnamEquityEvidenceCollector({
  now,
  client,
  getAssetsFn = getAssets,
  getMarketHistoryFn = getMarketHistory,
  persistEvidenceFn = persistEquityEvidence,
  recordHealthFn = recordJobHealth
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('runVietnamEquityEvidenceCollector requires an explicit valid now');
  }

  const startedAt = Date.now();
  let stocks;
  try {
    const assets = await getAssetsFn(client);
    stocks = (Array.isArray(assets) ? assets : []).filter(isCanonicalVietnamStock);
  } catch (error) {
    await recordCollectorHealthSafely({
      jobName: OBSERVED_JOBS.VN_EQUITY_EVIDENCE_REFRESH,
      status: HEALTH_STATES.FAILED,
      durationMs: Date.now() - startedAt,
      error,
      policyVersion: EQUITY_EVIDENCE_METHODOLOGY,
      client,
      now
    }, recordHealthFn);
    throw error;
  }

  const sourceResults = await Promise.allSettled(stocks.map(async (asset) => {
    const history = await getMarketHistoryFn(asset.symbol, '1M', { now });
    const evidence = buildMarketEvidenceFromHistory(asset, history, { now });
    return { asset, history, evidence };
  }));

  const collected = [];
  const failures = [];
  let barsRead = 0;
  sourceResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      collected.push(...result.value.evidence);
      barsRead += Array.isArray(result.value.history?.bars) ? result.value.history.bars.length : 0;
    } else {
      failures.push({
        symbol: stocks[index]?.symbol || null,
        code: result.reason?.code || 'EQUITY_SOURCE_UNAVAILABLE'
      });
    }
  });

  let persistence;
  try {
    persistence = await persistEvidenceFn(collected, client);
  } catch (error) {
    await recordCollectorHealthSafely({
      jobName: OBSERVED_JOBS.VN_EQUITY_EVIDENCE_REFRESH,
      status: HEALTH_STATES.FAILED,
      durationMs: Date.now() - startedAt,
      recordsRead: barsRead,
      recordsWritten: 0,
      dataAsOf: collected.reduce((latest, item) => (
        !latest || item.referencePeriod > latest ? item.referencePeriod : latest
      ), null),
      policyVersion: EQUITY_EVIDENCE_METHODOLOGY,
      error,
      errorCode: 'EQUITY_EVIDENCE_PERSISTENCE_FAILED',
      errorCategory: ERROR_CATEGORIES.DATABASE,
      client,
      now
    }, recordHealthFn);
    throw error;
  }
  const persistenceFailed = persistence.failedPersistence > 0 || (!persistence.isDurable && collected.length > 0);
  const noUsableSource = stocks.length === 0 || collected.length === 0;
  const healthStatus = persistenceFailed || noUsableSource
    ? HEALTH_STATES.FAILED
    : (failures.length > 0 ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY);
  const healthErrorCode = persistenceFailed
    ? 'EQUITY_EVIDENCE_PERSISTENCE_FAILED'
    : (noUsableSource ? 'EQUITY_EVIDENCE_UNAVAILABLE' : (failures.length > 0 ? 'EQUITY_SOURCE_PARTIAL' : null));

  await recordCollectorHealthSafely({
    jobName: OBSERVED_JOBS.VN_EQUITY_EVIDENCE_REFRESH,
    status: healthStatus,
    durationMs: Date.now() - startedAt,
    recordsRead: barsRead,
    recordsWritten: persistence.durablyAccepted || 0,
    dataAsOf: collected.reduce((latest, item) => (
      !latest || item.referencePeriod > latest ? item.referencePeriod : latest
    ), null),
    policyVersion: EQUITY_EVIDENCE_METHODOLOGY,
    errorCode: healthErrorCode,
    errorCategory: persistenceFailed ? ERROR_CATEGORIES.DATABASE : (failures.length > 0 ? ERROR_CATEGORIES.UPSTREAM_PROVIDER : null),
    metadata: {
      stockCount: stocks.length,
      successfulStockCount: sourceResults.filter((result) => result.status === 'fulfilled').length,
      failedStockCount: failures.length
    },
    client,
    now
  }, recordHealthFn);

  return {
    success: healthStatus !== HEALTH_STATES.FAILED,
    status: healthStatus,
    stockCount: stocks.length,
    successfulStockCount: sourceResults.filter((result) => result.status === 'fulfilled').length,
    failedStockCount: failures.length,
    barsRead,
    evidenceCount: collected.length,
    isDurable: persistence.isDurable,
    durablyAccepted: persistence.durablyAccepted,
    failedPersistence: persistence.failedPersistence,
    failures
  };
}
