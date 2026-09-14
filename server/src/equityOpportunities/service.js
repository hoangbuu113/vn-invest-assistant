import { getAssetBySymbol, getAssets } from '../supabase.js';
import {
  buildEquityEvidenceResponse,
  buildFundamentalsResponse,
  EQUITY_EVIDENCE_STATUS,
  EQUITY_EVIDENCE_TYPES,
  getEquityFundamentals,
  selectLatestEquityEvidence,
  toReplayCompatibleEquityObservation
} from '../equities/index.js';
import { fetchEquityEvidenceVintages } from '../equities/repository.js';
import { resolveEvidenceAvailabilityTime } from '../replay/availability.js';
import {
  ERROR_CATEGORIES,
  HEALTH_STATES,
  OBSERVED_JOBS,
  recordJobHealth
} from '../observability/dataHealth.js';
import { explainEquityOpportunity } from './explanation.js';
import {
  buildOpportunityEvidenceRef,
  compareEquityOpportunityCandidates,
  createEquityOpportunityCandidate,
  EQUITY_OPPORTUNITY_POLICY_VERSION,
  EQUITY_QUALIFICATION_STATUS
} from './model.js';
import {
  fetchLatestEquityOpportunityEvaluations,
  persistEquityOpportunityEvaluations
} from './repository.js';

const EXPECTED_MARKET_METRICS = Object.freeze(['open', 'high', 'low', 'close', 'volume']);

function assetValue(asset, camelKey, snakeKey) {
  return asset?.[camelKey] ?? asset?.[snakeKey] ?? null;
}

function isVietnamStockAsset(asset) {
  return Boolean(
    asset
    && assetValue(asset, 'assetType', 'asset_type') === 'stock'
    && assetValue(asset, 'marketPolicy', 'market_policy') === 'VN_EXCHANGE'
    && assetValue(asset, 'quoteCurrency', 'quote_currency') === 'VND'
  );
}

function isActiveAsset(asset) {
  return assetValue(asset, 'isActive', 'is_active') !== false;
}

function normalizeAsOf(asOf) {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new TypeError('Equity opportunity evaluation requires an explicit valid asOf Date');
  }
  return asOf;
}

function replayEligibleEvidence(evidence, asOf) {
  const asOfMs = asOf.getTime();
  const eligible = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const replayItem = toReplayCompatibleEquityObservation(item);
    const availability = resolveEvidenceAvailabilityTime(replayItem);
    if (
      availability.replaySafe
      && availability.availabilityTimestampMs !== null
      && availability.availabilityTimestampMs <= asOfMs
    ) {
      eligible.push(item);
    }
  }
  return eligible;
}

function qualificationReason(code, evidenceRefs = []) {
  return { code, evidenceRefs };
}

export function evaluateEquityOpportunityAsOf({ asset, evidence = [], fundamentals = null, asOf } = {}) {
  const evaluationTime = normalizeAsOf(asOf);
  if (!isVietnamStockAsset(asset)) {
    const error = new Error('Equity opportunity evaluation supports canonical Vietnam stocks only');
    error.code = 'UNSUPPORTED_EQUITY_OPPORTUNITY';
    error.status = 422;
    throw error;
  }

  const symbol = String(asset.symbol || '').trim().toUpperCase();
  const exchange = String(asset.exchange || asset.marketCode || asset.market_code || '').trim().toUpperCase();
  const companyName = String(asset.name || '').trim();
  if (!symbol || !exchange || !companyName) {
    throw new TypeError('Equity opportunity asset metadata is incomplete');
  }

  const assetEvidence = (Array.isArray(evidence) ? evidence : []).filter((item) => (
    item?.assetId === asset.id && item?.symbol === symbol
  ));
  const eligibleVintages = replayEligibleEvidence(assetEvidence, evaluationTime);
  const latestEvidence = selectLatestEquityEvidence(eligibleVintages);
  const authoritativeFundamentals = fundamentals || buildFundamentalsResponse(asset, [], {
    asOf: evaluationTime
  });
  const evidenceResponse = buildEquityEvidenceResponse(asset, latestEvidence, {
    now: evaluationTime,
    fundamentals: authoritativeFundamentals
  });
  const close = evidenceResponse.domains.marketPrice.facts.find((item) => item.metric === 'close') || null;
  const closePeriod = close?.referencePeriod || null;
  const samePeriodMarketFacts = closePeriod
    ? evidenceResponse.domains.marketPrice.facts.filter((item) => item.referencePeriod === closePeriod)
    : [];
  const nonMarketFacts = latestEvidence.filter((item) => (
    item.evidenceType !== EQUITY_EVIDENCE_TYPES.MARKET_PRICE
    && item.evidenceType !== EQUITY_EVIDENCE_TYPES.FUNDAMENTAL
  ));
  const participatingEvidence = [...samePeriodMarketFacts, ...nonMarketFacts]
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  const evidenceRefs = participatingEvidence.map(buildOpportunityEvidenceRef);
  const availableMetrics = new Set(samePeriodMarketFacts.map((item) => item.metric));
  const missingMarketMetrics = EXPECTED_MARKET_METRICS.filter((metric) => !availableMetrics.has(metric));
  const volume = samePeriodMarketFacts.find((item) => item.metric === 'volume') || null;
  const disclosureCount = nonMarketFacts.filter(
    (item) => item.evidenceType === EQUITY_EVIDENCE_TYPES.DISCLOSURE
  ).length;

  let qualificationStatus = EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE;
  const qualificationReasons = [];
  const disqualificationReasons = [];
  const missingRequirements = [];

  if (!isActiveAsset(asset)) {
    qualificationStatus = EQUITY_QUALIFICATION_STATUS.REJECTED;
    disqualificationReasons.push(qualificationReason('ASSET_INACTIVE'));
  } else if (!close) {
    missingRequirements.push('REPLAY_SAFE_COMPLETED_CLOSE');
  } else if (close.status === EQUITY_EVIDENCE_STATUS.STALE) {
    missingRequirements.push('CURRENT_COMPLETED_CLOSE');
  } else {
    // No calibrated value/trend/liquidity threshold is approved. A validated,
    // current completed close can therefore support WATCH only, never an
    // investment qualification claim.
    qualificationStatus = EQUITY_QUALIFICATION_STATUS.WATCH;
    qualificationReasons.push(qualificationReason(
      'REPLAY_SAFE_COMPLETED_CLOSE_AVAILABLE',
      [close.observationId]
    ));
  }

  if (!volume) missingRequirements.push('COMPLETED_SESSION_VOLUME');
  const fundamentalsAvailability = evidenceResponse.domains.fundamentals.availability;
  if (fundamentalsAvailability === 'NOT_INGESTED') {
    missingRequirements.push('OFFICIAL_FUNDAMENTALS_NOT_INGESTED');
  } else if (fundamentalsAvailability === 'SOURCE_NOT_PROVISIONED') {
    missingRequirements.push('OFFICIAL_FUNDAMENTALS_SOURCE_NOT_PROVISIONED');
  } else if (fundamentalsAvailability === 'UNSUPPORTED_COMPANY_TYPE') {
    missingRequirements.push('OFFICIAL_FUNDAMENTALS_UNSUPPORTED_COMPANY_TYPE');
  }
  missingRequirements.push('VALUATION_POLICY_NOT_PROVISIONED');
  if (disclosureCount === 0) missingRequirements.push('OFFICIAL_DISCLOSURES_SOURCE_NOT_PROVISIONED');
  missingRequirements.push('CALIBRATED_NUMERIC_QUALIFICATION_POLICY_NOT_PROVISIONED');

  const dataQualityStatus = !close
    ? 'insufficient'
    : (close.status === EQUITY_EVIDENCE_STATUS.STALE ? 'stale' : 'partial');
  const dataQuality = {
    status: dataQualityStatus,
    availableEvidenceCount: evidenceRefs.length,
    referencePeriod: closePeriod,
    missingMarketMetrics,
    dimensions: {
      price: close
        ? (close.status === EQUITY_EVIDENCE_STATUS.STALE ? 'stale' : 'available')
        : 'unavailable',
      liquidity: volume ? 'raw_volume_available_no_liquidity_judgment' : 'unavailable',
      valuation: 'source_not_provisioned',
      fundamentals: {
        AVAILABLE: 'evidence_available_no_screening_rule',
        PARTIAL: 'evidence_available_no_screening_rule',
        NOT_INGESTED: 'not_ingested',
        UNSUPPORTED_COMPANY_TYPE: 'unsupported_company_type',
        SOURCE_NOT_PROVISIONED: 'source_not_provisioned'
      }[fundamentalsAvailability] || 'unavailable',
      disclosures: disclosureCount > 0 ? 'evidence_available_no_screening_rule' : 'source_not_provisioned'
    }
  };

  return createEquityOpportunityCandidate({
    assetId: asset.id,
    symbol,
    exchange,
    companyName,
    asOf: evaluationTime.toISOString(),
    evidenceRefs,
    qualificationStatus,
    qualificationReasons,
    disqualificationReasons,
    dataQuality,
    missingRequirements,
    evaluatedAt: evaluationTime.toISOString(),
    generatedAt: evaluationTime.toISOString(),
    policyVersion: EQUITY_OPPORTUNITY_POLICY_VERSION
  });
}

/**
 * Provider-free point-in-time evaluation over persisted canonical 01F evidence.
 * The shared 01D resolver inside evaluateEquityOpportunityAsOf remains the
 * authority for whether each vintage was knowable at the requested time.
 */
export async function evaluateOpportunityAsOf(symbol, asOf, {
  client,
  getAssetBySymbolFn = getAssetBySymbol,
  fetchEvidenceFn = fetchEquityEvidenceVintages,
  getFundamentalsFn = getEquityFundamentals
} = {}) {
  const evaluationTime = normalizeAsOf(asOf);
  const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (!normalizedSymbol) throw new TypeError('Equity opportunity evaluation requires a symbol');

  const asset = await getAssetBySymbolFn(normalizedSymbol, client);
  if (!asset) {
    const error = new Error('Canonical equity asset not found');
    error.code = 'EQUITY_OPPORTUNITY_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const [evidence, fundamentals] = await Promise.all([
    fetchEvidenceFn(normalizedSymbol, client),
    getFundamentalsFn(normalizedSymbol, {
      client,
      now: evaluationTime,
      asOf: evaluationTime.toISOString(),
      getAssetBySymbolFn: async () => asset
    })
  ]);
  return evaluateEquityOpportunityAsOf({ asset, evidence, fundamentals, asOf: evaluationTime });
}

export function buildEquityOpportunityShortlist(candidates = [], { generatedAt = null } = {}) {
  const ordered = [...(Array.isArray(candidates) ? candidates : [])]
    .sort(compareEquityOpportunityCandidates);
  const shortlist = ordered.filter((candidate) => (
    candidate.qualificationStatus === EQUITY_QUALIFICATION_STATUS.QUALIFIED
    || candidate.qualificationStatus === EQUITY_QUALIFICATION_STATUS.WATCH
  ));
  const asOf = ordered.reduce((latest, candidate) => (
    !latest || candidate.asOf > latest ? candidate.asOf : latest
  ), null);
  return {
    policyVersion: EQUITY_OPPORTUNITY_POLICY_VERSION,
    status: ordered.length === 0 ? 'empty' : 'available',
    generatedAt: generatedAt || asOf,
    asOf,
    ordering: {
      fields: ['qualificationStatus', 'availableEvidenceCount', 'symbol'],
      meaning: 'DETERMINISTIC_DISPLAY_ORDER_NOT_INVESTMENT_PREFERENCE'
    },
    counts: {
      total: ordered.length,
      qualified: ordered.filter((item) => item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.QUALIFIED).length,
      watch: ordered.filter((item) => item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.WATCH).length,
      insufficientEvidence: ordered.filter((item) => item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE).length,
      rejected: ordered.filter((item) => item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.REJECTED).length
    },
    shortlist,
    candidates: ordered
  };
}

async function recordHealthSafely(payload, recordHealthFn) {
  try {
    await recordHealthFn(payload);
  } catch {
    // Opportunity output remains authoritative if telemetry itself is unavailable.
  }
}

export async function runVietnamEquityOpportunityRefresh({
  now,
  client,
  getAssetsFn = getAssets,
  fetchEvidenceFn = fetchEquityEvidenceVintages,
  getFundamentalsFn = getEquityFundamentals,
  persistEvaluationsFn = persistEquityOpportunityEvaluations,
  explainFn = explainEquityOpportunity,
  recordHealthFn = recordJobHealth
} = {}) {
  const evaluationTime = normalizeAsOf(now);
  const startedAt = Date.now();
  try {
    const assets = await getAssetsFn(client);
    const stocks = (Array.isArray(assets) ? assets : []).filter(isVietnamStockAsset);
    const candidates = [];
    const records = [];
    let evidenceRead = 0;

    for (const asset of stocks) {
      const [evidence, fundamentals] = await Promise.all([
        fetchEvidenceFn(asset.symbol, client),
        getFundamentalsFn(asset.symbol, {
          client,
          now: evaluationTime,
          asOf: evaluationTime.toISOString(),
          getAssetBySymbolFn: async () => asset
        })
      ]);
      evidenceRead += Array.isArray(evidence) ? evidence.length : 0;
      const candidate = evaluateEquityOpportunityAsOf({
        asset,
        evidence,
        fundamentals,
        asOf: evaluationTime
      });
      const explanation = await explainFn(candidate);
      candidates.push(candidate);
      records.push({ candidate, explanation });
    }

    const persistence = await persistEvaluationsFn(records, client);
    const isFatalPersistence = persistence.failedPersistence > 0
      && (persistence.durablyAccepted === 0 || !persistence.durablyAccepted);
    const isDurableMissing = records.length > 0 && !persistence.isDurable && !persistence.memoryOnly;

    if (isFatalPersistence || isDurableMissing) {
      await recordHealthSafely({
        jobName: OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH,
        status: HEALTH_STATES.FAILED,
        durationMs: Date.now() - startedAt,
        recordsRead: evidenceRead,
        recordsWritten: 0,
        dataAsOf: evaluationTime.toISOString(),
        errorCode: 'EQUITY_OPPORTUNITY_PERSISTENCE_FAILED',
        errorCategory: ERROR_CATEGORIES.DATABASE,
        policyVersion: EQUITY_OPPORTUNITY_POLICY_VERSION,
        client,
        now: evaluationTime
      }, recordHealthFn);
      return {
        success: false,
        status: HEALTH_STATES.FAILED,
        isDurable: false,
        failedPersistence: persistence.failedPersistence || records.length,
        candidates: buildEquityOpportunityShortlist(candidates, { generatedAt: evaluationTime.toISOString() })
      };
    }

    const isPartialPersistence = persistence.failedPersistence > 0
      && (persistence.durablyAccepted || 0) > 0;
    const isUniverseEmpty = stocks.length === 0 || candidates.length === 0;

    let status = HEALTH_STATES.HEALTHY;
    let errorCode = null;
    let errorCategory = null;

    if (isPartialPersistence) {
      status = HEALTH_STATES.DEGRADED;
      errorCode = 'PARTIAL_PERSISTENCE';
      errorCategory = ERROR_CATEGORIES.DATABASE;
    } else if (isUniverseEmpty) {
      status = HEALTH_STATES.DEGRADED;
      errorCode = 'EMPTY_EQUITY_UNIVERSE';
      errorCategory = ERROR_CATEGORIES.VALIDATION;
    }

    const shortlist = buildEquityOpportunityShortlist(candidates, {
      generatedAt: evaluationTime.toISOString()
    });

    const watchCount = candidates.filter((item) => (
      item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.WATCH
    )).length;
    const qualifiedCount = candidates.filter((item) => (
      item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.QUALIFIED
    )).length;
    const insufficientCount = candidates.filter((item) => (
      item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE
    )).length;
    const rejectedCount = candidates.filter((item) => (
      item.qualificationStatus === EQUITY_QUALIFICATION_STATUS.REJECTED
    )).length;

    await recordHealthSafely({
      jobName: OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH,
      status,
      durationMs: Date.now() - startedAt,
      recordsRead: evidenceRead,
      recordsWritten: persistence.durablyAccepted || 0,
      dataAsOf: evaluationTime.toISOString(),
      errorCode,
      errorCategory,
      policyVersion: EQUITY_OPPORTUNITY_POLICY_VERSION,
      metadata: {
        candidateCount: candidates.length,
        shortlistCount: shortlist.shortlist.length,
        qualifiedCount,
        watchCount,
        insufficientEvidenceCount: insufficientCount,
        rejectedCount
      },
      client,
      now: evaluationTime
    }, recordHealthFn);

    return {
      success: true,
      status,
      isDurable: persistence.isDurable,
      failedPersistence: persistence.failedPersistence || 0,
      durablyAccepted: persistence.durablyAccepted || 0,
      candidates: shortlist
    };
  } catch (error) {
    await recordHealthSafely({
      jobName: OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH,
      status: HEALTH_STATES.FAILED,
      durationMs: Date.now() - startedAt,
      recordsWritten: 0,
      dataAsOf: evaluationTime.toISOString(),
      error,
      policyVersion: EQUITY_OPPORTUNITY_POLICY_VERSION,
      client,
      now: evaluationTime
    }, recordHealthFn);
    throw error;
  }
}

export async function getPublishedEquityOpportunities({ client, symbol = null } = {}) {
  const normalizedSymbol = typeof symbol === 'string' && symbol.trim()
    ? symbol.trim().toUpperCase()
    : null;
  const candidates = await fetchLatestEquityOpportunityEvaluations(normalizedSymbol, client);
  return buildEquityOpportunityShortlist(candidates);
}
