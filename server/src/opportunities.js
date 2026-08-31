import {
  getAssets,
  getHoldings,
  getInvestorProfile,
  getWatchlist
} from './supabase.js';
import { getAssetAnalysis } from './analysis.js';
import { getPortfolioComposition } from './composition.js';
import { getVietnamRegime } from './regime.js';

export const OPPORTUNITY_METHODOLOGY_VERSION = 'opportunity-v1';

export const OPPORTUNITY_COHORTS = Object.freeze({
  VN_STOCK: Object.freeze({ id: 'VN_STOCK', label: 'Cổ phiếu Việt Nam' }),
  VN_ETF: Object.freeze({ id: 'VN_ETF', label: 'ETF Việt Nam' }),
  CRYPTO: Object.freeze({ id: 'CRYPTO', label: 'Crypto' }),
  GOLD: Object.freeze({ id: 'GOLD', label: 'Vàng' })
});

export const OPPORTUNITY_COHORT_ORDER = Object.freeze([
  'VN_STOCK',
  'VN_ETF',
  'CRYPTO',
  'GOLD'
]);

export const HORIZON_RANGE_PROXY = Object.freeze({
  short: '1M',
  medium: '3M',
  long: '1Y'
});

const REQUIRED_METRICS = Object.freeze([
  'priceChangePct',
  'positiveCloseTransitionRatio',
  'dailyVolatilityPct',
  'maxDrawdownPct'
]);

const SUPPORTED_ANALYSIS_ERRORS = new Set([
  'UNSUPPORTED_HISTORY',
  'UNSUPPORTED_MARKET_POLICY',
  'UNSUPPORTED_PROVIDER',
  'INVALID_HISTORY_CAPABILITIES'
]);

const PROVIDER_FAILURE_CODES = new Set([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'MALFORMED_PROVIDER_RESPONSE'
]);

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function canonicalAssetValue(asset, camelKey, snakeKey) {
  return asset?.[camelKey] ?? asset?.[snakeKey] ?? null;
}

function canonicalSymbol(asset) {
  return typeof asset?.symbol === 'string' ? asset.symbol.trim().toUpperCase() : '';
}

function isActiveAsset(asset) {
  const value = canonicalAssetValue(asset, 'isActive', 'is_active');
  return value !== false;
}

export function getAnalysisRangeProxy(investmentHorizon) {
  const normalized = typeof investmentHorizon === 'string'
    ? investmentHorizon.trim().toLowerCase()
    : '';
  return HORIZON_RANGE_PROXY[normalized] || null;
}

export function getOpportunityCohort(asset) {
  const assetType = canonicalAssetValue(asset, 'assetType', 'asset_type');
  const marketPolicy = canonicalAssetValue(asset, 'marketPolicy', 'market_policy');
  if (assetType === 'stock' && marketPolicy === 'VN_EXCHANGE') return 'VN_STOCK';
  if (assetType === 'etf' && marketPolicy === 'VN_EXCHANGE') return 'VN_ETF';
  if (assetType === 'crypto' && marketPolicy === 'CONTINUOUS_24_7') return 'CRYPTO';
  if (assetType === 'gold' && marketPolicy === 'GLOBAL_24_5') return 'GOLD';
  return null;
}

export function nearestRankPercentile(values, percentile) {
  const validValues = (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (validValues.length === 0 || !Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    return null;
  }
  return validValues[Math.ceil(percentile * validValues.length) - 1];
}

function baseCandidate(asset, cohortId) {
  return {
    assetId: asset?.id ?? null,
    symbol: canonicalSymbol(asset),
    name: asset?.name ?? null,
    assetType: canonicalAssetValue(asset, 'assetType', 'asset_type'),
    marketPolicy: canonicalAssetValue(asset, 'marketPolicy', 'market_policy'),
    canonicalQuoteCurrency: canonicalAssetValue(asset, 'quoteCurrency', 'quote_currency'),
    cohort: cohortId,
    candidateState: 'unsupported',
    reasons: [],
    descriptiveRank: null,
    screenMatch: null,
    evidence: {
      priceChangePct: null,
      positiveCloseTransitionRatio: null,
      dailyVolatilityPct: null,
      maxDrawdownPct: null,
      completedCloseRangePositionPct: null,
      distanceBelowHighestCompletedClosePct: null
    },
    metricStatus: {},
    analysisAsOf: null,
    analysisPriceDate: null,
    analysisQuoteCurrency: null,
    analysisFreshness: null,
    usableCompletedBarCount: null,
    dataCompleteness: null,
    held: false,
    watchlisted: false,
    currentExposurePct: null,
    exposureStatus: 'unavailable',
    exposureBasis: null,
    profileFit: {
      status: 'not_assessed',
      reason: 'CANDIDATE_NOT_ELIGIBLE'
    }
  };
}

function errorReason(error) {
  return typeof error?.code === 'string' && error.code ? error.code : 'ANALYSIS_UNAVAILABLE';
}

function isProviderFailure(error) {
  if (PROVIDER_FAILURE_CODES.has(error?.code)) return true;
  return Number.isInteger(error?.status) && error.status >= 500;
}

function candidateFromError(asset, cohortId, error) {
  const candidate = baseCandidate(asset, cohortId);
  candidate.candidateState = SUPPORTED_ANALYSIS_ERRORS.has(error?.code)
    ? 'unsupported'
    : 'insufficient_data';
  candidate.reasons = [errorReason(error)];
  candidate.acquisitionFailure = isProviderFailure(error);
  return candidate;
}

function metricAvailable(period, metricName) {
  const value = finiteNumber(period?.[metricName]);
  const status = period?.metricStatus?.[metricName]?.status;
  return value !== null && (status === undefined || status === 'available');
}

function candidateFromAnalysis(asset, cohortId, analysis, analysisRangeProxy) {
  const candidate = baseCandidate(asset, cohortId);
  const period = analysis?.periods?.[analysisRangeProxy];
  const reasons = [];

  if (analysis?.methodologyVersion !== 'v2') {
    candidate.candidateState = 'unsupported';
    candidate.reasons = ['UNSUPPORTED_ANALYSIS_METHODOLOGY'];
    return candidate;
  }

  const completeness = analysis?.dataCompleteness?.canonicalHistoryCompleteness
    ?? analysis?.dataCompleteness?.availabilityLevel
    ?? null;
  if (completeness !== 'complete') reasons.push('INCOMPLETE_HISTORY');
  if (!period || period.status !== 'available') reasons.push('PERIOD_UNAVAILABLE');

  for (const metricName of REQUIRED_METRICS) {
    if (!metricAvailable(period, metricName)) {
      const metricReason = period?.metricStatus?.[metricName]?.reason;
      reasons.push(metricReason || `MISSING_${metricName.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
    }
  }

  candidate.evidence = {
    priceChangePct: finiteNumber(period?.priceChangePct),
    positiveCloseTransitionRatio: finiteNumber(period?.positiveCloseTransitionRatio),
    dailyVolatilityPct: finiteNumber(period?.dailyVolatilityPct),
    maxDrawdownPct: finiteNumber(period?.maxDrawdownPct),
    completedCloseRangePositionPct: finiteNumber(period?.completedCloseRangePositionPct),
    distanceBelowHighestCompletedClosePct: finiteNumber(period?.distanceBelowHighestCompletedClosePct)
  };
  candidate.metricStatus = period?.metricStatus && typeof period.metricStatus === 'object'
    ? period.metricStatus
    : {};
  candidate.analysisAsOf = analysis?.analysisAsOf ?? null;
  candidate.analysisPriceDate = analysis?.analysisPriceDate ?? null;
  candidate.analysisQuoteCurrency = analysis?.quoteCurrency ?? null;
  candidate.analysisFreshness = analysis?.freshness ?? null;
  candidate.usableCompletedBarCount = Number.isInteger(period?.usableCompletedBarCount)
    ? period.usableCompletedBarCount
    : null;
  candidate.dataCompleteness = completeness;
  candidate.reasons = [...new Set(reasons)];
  candidate.candidateState = candidate.reasons.length === 0 ? 'eligible' : 'insufficient_data';
  candidate.screenMatch = candidate.candidateState === 'eligible'
    ? candidate.evidence.priceChangePct > 0 && candidate.evidence.positiveCloseTransitionRatio > 0.5
    : null;
  candidate.acquisitionFailure = false;
  return candidate;
}

function compareCandidates(left, right) {
  if (left.screenMatch !== right.screenMatch) return left.screenMatch ? -1 : 1;
  if (left.evidence.priceChangePct !== right.evidence.priceChangePct) {
    return right.evidence.priceChangePct - left.evidence.priceChangePct;
  }
  if (left.evidence.positiveCloseTransitionRatio !== right.evidence.positiveCloseTransitionRatio) {
    return right.evidence.positiveCloseTransitionRatio - left.evidence.positiveCloseTransitionRatio;
  }
  if (left.evidence.maxDrawdownPct !== right.evidence.maxDrawdownPct) {
    return left.evidence.maxDrawdownPct - right.evidence.maxDrawdownPct;
  }
  if (left.evidence.dailyVolatilityPct !== right.evidence.dailyVolatilityPct) {
    return left.evidence.dailyVolatilityPct - right.evidence.dailyVolatilityPct;
  }
  return left.symbol.localeCompare(right.symbol);
}

function exposureContext(
  assetId,
  holdingsByAssetId,
  watchlistAssetIds,
  compositionByAssetId,
  composition,
  holdingsStatus,
  watchlistStatus
) {
  const held = holdingsStatus === 'unavailable' ? null : holdingsByAssetId.has(assetId);
  const watchlisted = watchlistStatus === 'unavailable' ? null : watchlistAssetIds.has(assetId);
  const allocation = compositionByAssetId.get(assetId);
  const allocationBasis = composition?.allocationBasis ?? null;
  const coverage = composition?.valuationCoverageLevel ?? null;

  let exposureStatus = held === false ? 'not_held' : 'unavailable';
  let currentExposurePct = null;
  if (held && allocation?.isPriced === true && finiteNumber(allocation.weightPct) !== null) {
    currentExposurePct = allocation.weightPct;
    exposureStatus = coverage === 'complete' && allocationBasis === 'full_portfolio_value'
      ? 'available'
      : 'partial_basis';
  }

  return {
    held,
    watchlisted,
    currentExposurePct,
    exposureStatus,
    exposureBasis: allocationBasis
  };
}

function applyProfileFit(cohort, riskTolerance) {
  const eligible = cohort.candidates.filter((candidate) => candidate.candidateState === 'eligible');
  if (eligible.length < 10) {
    cohort.profileFitCutoffs = null;
    for (const candidate of eligible) {
      candidate.profileFit = {
        status: 'not_assessed',
        reason: 'INSUFFICIENT_COHORT_SIZE'
      };
    }
    return;
  }

  const volatilityValues = eligible.map((candidate) => candidate.evidence.dailyVolatilityPct);
  const drawdownValues = eligible.map((candidate) => candidate.evidence.maxDrawdownPct);
  const cutoffs = {
    p33: {
      dailyVolatilityPct: nearestRankPercentile(volatilityValues, 1 / 3),
      maxDrawdownPct: nearestRankPercentile(drawdownValues, 1 / 3)
    },
    p67: {
      dailyVolatilityPct: nearestRankPercentile(volatilityValues, 2 / 3),
      maxDrawdownPct: nearestRankPercentile(drawdownValues, 2 / 3)
    }
  };
  cohort.profileFitCutoffs = cutoffs;

  for (const candidate of eligible) {
    let withinPreference = true;
    let appliedCutoff = null;
    if (riskTolerance === 'low') {
      appliedCutoff = 'p33';
      withinPreference = candidate.evidence.dailyVolatilityPct <= cutoffs.p33.dailyVolatilityPct
        && candidate.evidence.maxDrawdownPct <= cutoffs.p33.maxDrawdownPct;
    } else if (riskTolerance === 'moderate') {
      appliedCutoff = 'p67';
      withinPreference = candidate.evidence.dailyVolatilityPct <= cutoffs.p67.dailyVolatilityPct
        && candidate.evidence.maxDrawdownPct <= cutoffs.p67.maxDrawdownPct;
    }
    candidate.profileFit = {
      status: withinPreference ? 'within_preference' : 'outside_preference',
      reason: withinPreference ? null : 'ABOVE_COHORT_RISK_CUTOFF',
      appliedCutoff
    };
  }
}

function normalizeContextList(value) {
  return Array.isArray(value) ? value : [];
}

export function buildOpportunityReport({
  assets,
  profile,
  analysisByAssetId,
  holdings = [],
  watchlist = [],
  composition = null,
  vietnamRegime = null,
  contextStatus = {},
  now
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Opportunity report requires a valid shared request Date');
  }
  if (!Array.isArray(assets)) throw new TypeError('Opportunity report requires canonical assets');

  const investmentHorizon = typeof profile?.investment_horizon === 'string'
    ? profile.investment_horizon.trim().toLowerCase()
    : '';
  const riskTolerance = typeof profile?.risk_tolerance === 'string'
    ? profile.risk_tolerance.trim().toLowerCase()
    : '';
  const analysisRangeProxy = getAnalysisRangeProxy(investmentHorizon);
  if (!analysisRangeProxy || !['low', 'moderate', 'high'].includes(riskTolerance)) {
    const error = new Error('Investor profile preferences are invalid');
    error.code = 'INVALID_INVESTOR_PROFILE';
    error.status = 500;
    throw error;
  }

  const cohorts = OPPORTUNITY_COHORT_ORDER.map((cohortId) => ({
    ...OPPORTUNITY_COHORTS[cohortId],
    eligibleCohortSize: 0,
    profileFitCutoffs: null,
    candidates: []
  }));
  const cohortMap = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const excludedCandidates = [];
  const holdingsByAssetId = new Set(normalizeContextList(holdings).map((holding) => holding?.asset_id ?? holding?.assetId));
  const watchlistAssetIds = new Set(normalizeContextList(watchlist).map((item) => item?.asset_id ?? item?.assetId));
  const compositionByAssetId = new Map(
    normalizeContextList(composition?.holdingAllocations).map((item) => [item?.assetId, item])
  );
  const normalizedAnalysis = analysisByAssetId instanceof Map
    ? analysisByAssetId
    : new Map(Object.entries(analysisByAssetId || {}));

  for (const asset of assets) {
    const symbol = canonicalSymbol(asset);
    const cohortId = getOpportunityCohort(asset);

    if (!isActiveAsset(asset)) {
      const candidate = baseCandidate(asset, cohortId);
      candidate.candidateState = 'excluded';
      candidate.reasons = ['ASSET_INACTIVE'];
      excludedCandidates.push(candidate);
      continue;
    }
    if (symbol === 'USD/VND' || canonicalAssetValue(asset, 'assetType', 'asset_type') === 'fx') {
      const candidate = baseCandidate(asset, null);
      candidate.candidateState = 'excluded';
      candidate.reasons = ['NON_INVESTMENT_CONTEXT'];
      excludedCandidates.push(candidate);
      continue;
    }
    if (!cohortId) {
      const candidate = baseCandidate(asset, null);
      candidate.candidateState = 'unsupported';
      candidate.reasons = ['UNSUPPORTED_ASSET_CLASS'];
      excludedCandidates.push(candidate);
      continue;
    }

    const observation = normalizedAnalysis.get(asset?.id) ?? normalizedAnalysis.get(symbol);
    let candidate;
    if (observation?.status === 'fulfilled') {
      candidate = candidateFromAnalysis(asset, cohortId, observation.value, analysisRangeProxy);
    } else if (observation?.analysis) {
      candidate = candidateFromAnalysis(asset, cohortId, observation.analysis, analysisRangeProxy);
    } else {
      candidate = candidateFromError(asset, cohortId, observation?.reason ?? observation?.error ?? null);
    }
    Object.assign(
      candidate,
      exposureContext(
        asset?.id,
        holdingsByAssetId,
        watchlistAssetIds,
        compositionByAssetId,
        composition,
        contextStatus.holdings,
        contextStatus.watchlist
      )
    );
    cohortMap.get(cohortId).candidates.push(candidate);
  }

  for (const cohort of cohorts) {
    const eligible = cohort.candidates
      .filter((candidate) => candidate.candidateState === 'eligible')
      .sort(compareCandidates);
    cohort.eligibleCohortSize = eligible.length;
    if (!(cohort.id === 'GOLD' && eligible.length === 1)) {
      eligible.forEach((candidate, index) => {
        candidate.descriptiveRank = index + 1;
      });
    }
    applyProfileFit(cohort, riskTolerance);
    const rankByAssetId = new Map(eligible.map((candidate) => [candidate.assetId, candidate.descriptiveRank]));
    cohort.candidates.sort((left, right) => {
      if (left.candidateState === 'eligible' && right.candidateState !== 'eligible') return -1;
      if (left.candidateState !== 'eligible' && right.candidateState === 'eligible') return 1;
      if (left.candidateState === 'eligible' && right.candidateState === 'eligible') {
        return (rankByAssetId.get(left.assetId) ?? Number.MAX_SAFE_INTEGER)
          - (rankByAssetId.get(right.assetId) ?? Number.MAX_SAFE_INTEGER);
      }
      return left.symbol.localeCompare(right.symbol);
    });
  }

  const allCandidates = [...cohorts.flatMap((cohort) => cohort.candidates), ...excludedCandidates];
  const counts = {
    total: allCandidates.length,
    eligible: allCandidates.filter((candidate) => candidate.candidateState === 'eligible').length,
    insufficientData: allCandidates.filter((candidate) => candidate.candidateState === 'insufficient_data').length,
    unsupported: allCandidates.filter((candidate) => candidate.candidateState === 'unsupported').length,
    excluded: allCandidates.filter((candidate) => candidate.candidateState === 'excluded').length
  };
  const attemptedCandidates = cohorts.flatMap((cohort) => cohort.candidates);
  const serviceWideAcquisitionFailure = attemptedCandidates.length > 0
    && attemptedCandidates.every((candidate) => candidate.acquisitionFailure === true);
  for (const candidate of allCandidates) delete candidate.acquisitionFailure;

  return {
    methodologyVersion: OPPORTUNITY_METHODOLOGY_VERSION,
    status: serviceWideAcquisitionFailure ? 'unavailable' : 'ok',
    partial: counts.insufficientData > 0 || counts.unsupported > 0
      || Object.values(contextStatus).some((status) => status === 'unavailable'),
    generatedAt: now.toISOString(),
    analysisRangeProxy,
    profileContext: {
      riskTolerance,
      investmentHorizon,
      longHorizonDisclosure: investmentHorizon === 'long'
        ? '1Y is the longest available analysis proxy, not a complete long-term investment assessment.'
        : null
    },
    counts,
    cohorts,
    excludedCandidates,
    portfolioContext: {
      status: contextStatus.portfolio ?? (composition ? 'available' : 'unavailable'),
      valuationCoverageLevel: composition?.valuationCoverageLevel ?? null,
      allocationBasis: composition?.allocationBasis ?? null
    },
    holdingsContext: {
      status: contextStatus.holdings ?? 'available'
    },
    watchlistContext: {
      status: contextStatus.watchlist ?? 'available'
    },
    vietnamRegime: vietnamRegime || null,
    methodology: {
      methodologyVersion: OPPORTUNITY_METHODOLOGY_VERSION,
      rankingScope: 'within_asset_class_only',
      rankingTerminology: 'Xếp hạng mô tả trong nhóm tài sản',
      screenRule: 'priceChangePct > 0 AND positiveCloseTransitionRatio > 0.5',
      profileFitAffectsRank: false,
      profileFitMinimumEligibleCohortSize: 10,
      requiredMetrics: [...REQUIRED_METRICS],
      evidenceOnlyMetrics: [
        'completedCloseRangePositionPct',
        'distanceBelowHighestCompletedClosePct'
      ]
    }
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getOpportunities({
  now = new Date(),
  concurrency = 6,
  getAssetsFn = getAssets,
  getInvestorProfileFn = getInvestorProfile,
  getHoldingsFn = getHoldings,
  getWatchlistFn = getWatchlist,
  getPortfolioCompositionFn = getPortfolioComposition,
  getAssetAnalysisFn = getAssetAnalysis,
  getVietnamRegimeFn = getVietnamRegime
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Opportunity acquisition requires a valid shared request Date');
  }

  const [assets, profile] = await Promise.all([getAssetsFn(), getInvestorProfileFn()]);
  const analysisRangeProxy = getAnalysisRangeProxy(profile?.investment_horizon);
  if (!analysisRangeProxy) {
    const error = new Error('Investor profile investment horizon is invalid');
    error.code = 'INVALID_INVESTOR_PROFILE';
    error.status = 500;
    throw error;
  }

  const analyzableAssets = assets.filter((asset) => (
    isActiveAsset(asset)
    && canonicalSymbol(asset) !== 'USD/VND'
    && getOpportunityCohort(asset)
  ));

  const [analysisResults, holdingsResult, watchlistResult, compositionResult, regimeResult] = await Promise.all([
    mapWithConcurrency(analyzableAssets, concurrency, (asset) => getAssetAnalysisFn(canonicalSymbol(asset), {
      range: analysisRangeProxy,
      now,
      getMarketSnapshotFn: async () => null
    })),
    Promise.resolve().then(() => getHoldingsFn()).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    ),
    Promise.resolve().then(() => getWatchlistFn()).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    ),
    Promise.resolve().then(() => getPortfolioCompositionFn()).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    ),
    Promise.resolve().then(() => getVietnamRegimeFn({ now })).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    )
  ]);

  const analysisByAssetId = new Map();
  analyzableAssets.forEach((asset, index) => analysisByAssetId.set(asset.id, analysisResults[index]));

  return buildOpportunityReport({
    assets,
    profile,
    analysisByAssetId,
    holdings: holdingsResult.status === 'fulfilled' ? holdingsResult.value : [],
    watchlist: watchlistResult.status === 'fulfilled' ? watchlistResult.value : [],
    composition: compositionResult.status === 'fulfilled' ? compositionResult.value : null,
    vietnamRegime: regimeResult.status === 'fulfilled' ? regimeResult.value : null,
    contextStatus: {
      holdings: holdingsResult.status === 'fulfilled' ? 'available' : 'unavailable',
      watchlist: watchlistResult.status === 'fulfilled' ? 'available' : 'unavailable',
      portfolio: compositionResult.status === 'fulfilled' ? 'available' : 'unavailable',
      regime: regimeResult.status === 'fulfilled' ? 'available' : 'unavailable'
    },
    now
  });
}
