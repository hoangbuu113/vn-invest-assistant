import { getAssetBySymbol } from '../supabase.js';
import { evaluateObservationFreshness } from '../context/freshnessPolicy.js';
import {
  EQUITY_EVIDENCE_METHODOLOGY,
  EQUITY_EVIDENCE_STATUS,
  EQUITY_EVIDENCE_TYPES
} from './evidenceModel.js';
import { fetchLatestEquityEvidence } from './repository.js';

export { runVietnamEquityEvidenceCollector } from './collector.js';
export * from './evidenceModel.js';
export * from './repository.js';

export const VN_EQUITY_SOURCE_HIERARCHY = Object.freeze({
  marketPrice: Object.freeze({
    preferredAuthority: 'VIETNAM_EXCHANGE_OFFICIAL',
    preferredStatus: 'not_provisioned',
    activeSource: 'yahoo',
    activeAuthority: 'MARKET_REFERENCE'
  }),
  fundamentals: Object.freeze({
    preferredAuthority: 'ISSUER_OR_EXCHANGE_OFFICIAL',
    preferredStatus: 'not_provisioned',
    activeSource: null
  }),
  disclosures: Object.freeze({
    preferredAuthority: 'ISSUER_OR_EXCHANGE_OFFICIAL',
    preferredStatus: 'not_provisioned',
    activeSource: null
  })
});

function applyMarketRuntimeFreshness(item, now) {
  if (!item || item.evidenceType !== EQUITY_EVIDENCE_TYPES.MARKET_PRICE) return item;
  const evaluated = evaluateObservationFreshness({
    factId: 'vn.market.vnindex.close',
    value: item.numericValue,
    status: item.status,
    referenceTime: item.referencePeriod,
    observedAt: item.observedAt
  }, now);
  return {
    ...item,
    freshness: evaluated.freshness,
    status: evaluated.isStale ? EQUITY_EVIDENCE_STATUS.STALE : item.status
  };
}

function unavailableDomain(reason, expectedMetrics) {
  return {
    status: EQUITY_EVIDENCE_STATUS.UNAVAILABLE,
    reason,
    facts: [],
    expectedMetrics
  };
}

export function buildEquityEvidenceResponse(asset, evidence = [], { now } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Equity evidence response requires an explicit valid now');
  }

  const marketFacts = evidence
    .filter((item) => item?.evidenceType === EQUITY_EVIDENCE_TYPES.MARKET_PRICE)
    .map((item) => applyMarketRuntimeFreshness(item, now));
  const close = marketFacts.find((item) => item.metric === 'close') || null;
  const volume = marketFacts.find((item) => item.metric === 'volume') || null;
  const marketStatus = close
    ? (close.status === EQUITY_EVIDENCE_STATUS.STALE
      ? EQUITY_EVIDENCE_STATUS.STALE
      : EQUITY_EVIDENCE_STATUS.AVAILABLE)
    : EQUITY_EVIDENCE_STATUS.UNAVAILABLE;

  const marketPrice = {
    status: marketStatus,
    reason: close ? null : 'NO_PERSISTED_MARKET_EVIDENCE',
    facts: marketFacts,
    missingMetrics: [
      ...(!close ? ['close'] : []),
      ...(!volume ? ['volume'] : [])
    ]
  };
  const fundamentals = unavailableDomain('SOURCE_NOT_PROVISIONED', [
    'market_cap', 'price_to_earnings', 'earnings_per_share', 'book_value_per_share'
  ]);
  const disclosures = unavailableDomain('SOURCE_NOT_PROVISIONED', [
    'issuer_disclosure', 'corporate_action'
  ]);
  const allFacts = marketFacts;
  const dataAsOf = allFacts.reduce((latest, item) => (
    !latest || item.referencePeriod > latest ? item.referencePeriod : latest
  ), null);
  const fetchedAt = allFacts.reduce((latest, item) => (
    !latest || item.fetchedAt > latest ? item.fetchedAt : latest
  ), null);

  return {
    methodologyVersion: EQUITY_EVIDENCE_METHODOLOGY,
    asset: {
      assetId: asset.id,
      symbol: asset.symbol,
      exchange: asset.exchange ?? asset.marketCode ?? asset.market_code ?? null,
      companyName: asset.name,
      assetType: asset.assetType ?? asset.asset_type,
      quoteCurrency: asset.quoteCurrency ?? asset.quote_currency,
      marketTimezone: asset.marketTimezone ?? asset.market_timezone
    },
    status: close ? 'partial' : 'unavailable',
    partial: true,
    dataAsOf,
    fetchedAt,
    domains: {
      marketPrice,
      fundamentals,
      disclosures
    },
    sourceHierarchy: VN_EQUITY_SOURCE_HIERARCHY,
    limitations: [
      'Official exchange or issuer fundamentals are not provisioned.',
      'Official issuer disclosures and corporate actions are not provisioned.',
      'Yahoo Finance completed daily data is market-reference evidence, not issuer or exchange authority.'
    ]
  };
}

export async function getVietnamEquityEvidence(symbol, {
  client,
  now = new Date(),
  getAssetBySymbolFn = getAssetBySymbol,
  fetchLatestEvidenceFn = fetchLatestEquityEvidence
} = {}) {
  if (typeof symbol !== 'string' || !symbol.trim()) {
    const error = new Error('Equity symbol is required');
    error.code = 'INVALID_EQUITY_SYMBOL';
    error.status = 400;
    throw error;
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    const error = new TypeError('Equity evidence now must be a valid Date');
    error.code = 'INVALID_TIME_CONTEXT';
    error.status = 400;
    throw error;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const asset = await getAssetBySymbolFn(normalizedSymbol, client);
  if (!asset) {
    const error = new Error(`Asset '${normalizedSymbol}' not found`);
    error.code = 'ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (
    (asset.assetType ?? asset.asset_type) !== 'stock'
    || (asset.marketPolicy ?? asset.market_policy) !== 'VN_EXCHANGE'
  ) {
    const error = new Error(`Equity evidence is unsupported for '${normalizedSymbol}'`);
    error.code = 'UNSUPPORTED_EQUITY_EVIDENCE';
    error.status = 422;
    throw error;
  }

  const evidence = await fetchLatestEvidenceFn(normalizedSymbol, client);
  return buildEquityEvidenceResponse(asset, evidence, { now });
}
