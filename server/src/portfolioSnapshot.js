import { createHash } from 'node:crypto';

import { calculatePortfolioComposition } from './composition.js';
import { getPortfolioOverview } from './portfolio.js';

export const PORTFOLIO_DATA_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  STALE: 'STALE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  UNAVAILABLE: 'UNAVAILABLE'
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function digest(value, length = 24) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, length);
}

function requireClock(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Portfolio snapshot requires an explicit valid Date');
  }
  return value.toISOString();
}

function stateFromLegacy(value, unavailableFallback = PORTFOLIO_DATA_STATES.UNAVAILABLE) {
  switch (value) {
    case 'available':
    case 'complete':
      return PORTFOLIO_DATA_STATES.AVAILABLE;
    case 'partial':
      return PORTFOLIO_DATA_STATES.PARTIAL;
    case 'stale':
      return PORTFOLIO_DATA_STATES.STALE;
    case 'not_applicable':
      return PORTFOLIO_DATA_STATES.NOT_APPLICABLE;
    case 'insufficient_history':
      return PORTFOLIO_DATA_STATES.INSUFFICIENT_HISTORY;
    case 'unavailable':
      return PORTFOLIO_DATA_STATES.UNAVAILABLE;
    default:
      return unavailableFallback;
  }
}

function holdingCheckpoint(holding) {
  return {
    holdingId: holding?.id ?? null,
    assetId: holding?.assetId ?? null,
    openingPositionId: holding?.openingPositionId ?? null,
    quantity: holding?.quantity ?? null,
    vndAverageCost: holding?.averageCost ?? null,
    nativeAverageCost: holding?.nativeAverageCost ?? null,
    nativeCostCurrency: holding?.nativeCostCurrency ?? null,
    holdingUpdatedAt: holding?.holdingUpdatedAt ?? null,
    openingPositionUpdatedAt: holding?.openingPositionUpdatedAt ?? null
  };
}

function sortedHoldingCheckpoints(holdings) {
  return holdings
    .map(holdingCheckpoint)
    .sort((left, right) => {
      const assetComparison = String(left.assetId).localeCompare(String(right.assetId));
      if (assetComparison !== 0) return assetComparison;
      return String(left.holdingId).localeCompare(String(right.holdingId));
    });
}

export function createPortfolioLedgerCheckpoint(profileId, overview) {
  const summary = overview?.summary || {};
  const holdings = Array.isArray(overview?.holdings) ? overview.holdings : [];
  const identity = {
    profileId: profileId || null,
    cash: {
      amount: summary.cashAvailable ?? null,
      status: summary.cashStatus ?? 'unavailable',
      entryCount: summary.cashLedgerEntryCount ?? null,
      ledgerStartAt: summary.cashLedgerStartAt ?? null
    },
    holdings: sortedHoldingCheckpoints(holdings)
  };
  return `ledger_${digest(identity)}`;
}

function holdingValuationIdentity(holding) {
  return {
    assetId: holding?.assetId ?? null,
    symbol: holding?.symbol ?? null,
    name: holding?.name ?? null,
    assetType: holding?.assetType ?? null,
    exchange: holding?.exchange ?? null,
    quantityUnit: holding?.quantityUnit ?? null,
    quantity: holding?.quantity ?? null,
    nativePrice: holding?.nativePrice ?? null,
    nativeCurrency: holding?.nativeCurrency ?? null,
    reportingMarketValue: holding?.reportingMarketValue ?? null,
    costBasis: holding?.costBasis ?? null,
    unrealizedPnL: holding?.unrealizedPnL ?? null,
    nativeAverageCost: holding?.nativeAverageCost ?? null,
    nativeCostCurrency: holding?.nativeCostCurrency ?? null,
    nativeCurrentPrice: holding?.nativeCurrentPrice ?? null,
    nativeUnrealizedPnL: holding?.nativeUnrealizedPnL ?? null,
    valuationStatus: holding?.valuationStatus ?? 'unavailable',
    valuationReason: holding?.valuationReason ?? null,
    pnlStatus: holding?.pnlStatus ?? 'unavailable',
    pnlReason: holding?.pnlReason ?? null,
    priceAsOf: holding?.marketUpdatedAt ?? null,
    priceProvider: holding?.marketProvider ?? null,
    priceFreshness: holding?.marketFreshness ?? null,
    priceCacheStatus: holding?.marketCacheStatus ?? null,
    nativePriceAsOf: holding?.nativeCurrentPriceAsOf ?? null,
    nativePriceSource: holding?.nativeCurrentPriceSource ?? null,
    nativePriceFreshness: holding?.nativeCurrentPriceFreshness ?? null,
    fxAsOf: holding?.fxRateTimestamp ?? null,
    fxRateToReporting: holding?.fxRateToReporting ?? null,
    fxProvider: holding?.fxProvider ?? null,
    fxFreshness: holding?.fxFreshness ?? null
  };
}

function snapshotStatus(overview, composition) {
  const cashAvailable = overview?.summary?.cashStatus === 'available';
  const pricedHoldingsCount = composition?.pricedHoldingsCount || 0;
  const holdingsCount = composition?.totalHoldingsCount || 0;

  if (!cashAvailable && pricedHoldingsCount === 0) {
    return PORTFOLIO_DATA_STATES.UNAVAILABLE;
  }
  if (overview?.summary?.valuationStatus === 'partial') {
    return PORTFOLIO_DATA_STATES.PARTIAL;
  }
  if (overview?.summary?.valuationStatus === 'stale') {
    return PORTFOLIO_DATA_STATES.STALE;
  }
  if (holdingsCount > pricedHoldingsCount) {
    return PORTFOLIO_DATA_STATES.PARTIAL;
  }
  return PORTFOLIO_DATA_STATES.AVAILABLE;
}

function concentrationStatus(composition) {
  if (!composition?.hasHoldings) return PORTFOLIO_DATA_STATES.NOT_APPLICABLE;
  if (composition.pricedHoldingsCount === 0) return PORTFOLIO_DATA_STATES.UNAVAILABLE;
  if (composition.unpricedHoldingsCount > 0) return PORTFOLIO_DATA_STATES.PARTIAL;
  if (composition.valuationCoverageLevel === 'stale') return PORTFOLIO_DATA_STATES.STALE;
  return PORTFOLIO_DATA_STATES.AVAILABLE;
}

function investedValueStatus(composition) {
  if (!composition?.hasHoldings) return PORTFOLIO_DATA_STATES.AVAILABLE;
  if (composition.pricedHoldingsCount === 0) return PORTFOLIO_DATA_STATES.UNAVAILABLE;
  if (composition.unpricedHoldingsCount > 0) return PORTFOLIO_DATA_STATES.PARTIAL;
  if (composition.valuationCoverageLevel === 'stale') return PORTFOLIO_DATA_STATES.STALE;
  return PORTFOLIO_DATA_STATES.AVAILABLE;
}

function buildSourceMetadata(holdings) {
  return {
    prices: holdings.map((holding) => ({
      assetId: holding.assetId,
      symbol: holding.symbol,
      source: holding.marketProvider || null,
      priceAsOf: holding.marketUpdatedAt,
      freshness: holding.marketFreshness,
      status: stateFromLegacy(holding.pricingStatus),
      nativeCostReference: holding.nativeCurrentPrice === null
        ? null
        : {
            currency: holding.nativeCostCurrency,
            source: holding.nativeCurrentPriceSource,
            priceAsOf: holding.nativeCurrentPriceAsOf,
            freshness: holding.nativeCurrentPriceFreshness,
            status: stateFromLegacy(holding.nativePnlStatus)
          }
    })),
    fx: holdings
      .filter((holding) => holding.nativeCurrency && holding.nativeCurrency !== 'VND')
      .map((holding) => ({
        assetId: holding.assetId,
        baseCurrency: holding.nativeCurrency,
        quoteCurrency: 'VND',
        provider: holding.fxProvider,
        rate: holding.fxRateToReporting,
        asOf: holding.fxRateTimestamp,
        freshness: holding.fxFreshness,
        status: holding.fxRateToReporting === null
          ? PORTFOLIO_DATA_STATES.UNAVAILABLE
          : stateFromLegacy(holding.fxFreshness, PORTFOLIO_DATA_STATES.AVAILABLE)
      }))
  };
}

function assertOverviewConsistency(overview) {
  const valuedHoldingsTotal = overview.holdings.reduce((sum, holding) => {
    return ['available', 'stale'].includes(holding?.valuationStatus)
      && typeof holding.reportingMarketValue === 'number'
      && Number.isFinite(holding.reportingMarketValue)
      ? sum + holding.reportingMarketValue
      : sum;
  }, 0);
  const valuedHoldingsCount = overview.holdings.filter((holding) => (
    ['available', 'stale'].includes(holding?.valuationStatus)
    && typeof holding.reportingMarketValue === 'number'
    && Number.isFinite(holding.reportingMarketValue)
  )).length;
  const expectedInvestedValue = overview.holdings.length > 0 && valuedHoldingsCount === 0
    ? null
    : valuedHoldingsTotal;
  if (overview.summary.totalMarketValue !== expectedInvestedValue) {
    throw new Error('Portfolio overview invested market value is inconsistent with valued holdings');
  }

  if (overview.summary.cashStatus === 'available') {
    if (
      typeof overview.summary.cashAvailable !== 'number'
      || !Number.isFinite(overview.summary.cashAvailable)
      || overview.summary.cashAvailable < 0
    ) {
      throw new Error('Portfolio overview available cash must be a finite non-negative number');
    }
    const expectedTotal = expectedInvestedValue === null
      ? null
      : overview.summary.cashAvailable + expectedInvestedValue;
    if (overview.summary.totalPortfolioValue !== expectedTotal) {
      throw new Error('Portfolio overview total is inconsistent with cash plus valued holdings');
    }
  } else if (overview.summary.totalPortfolioValue !== null) {
    throw new Error('Portfolio overview total must be unavailable when authoritative cash is unavailable');
  }
}

export function buildPortfolioSnapshot({ profileId, overview, calculatedAt }) {
  if (!overview || typeof overview !== 'object' || !overview.summary || !Array.isArray(overview.holdings)) {
    throw new TypeError('A valid portfolio overview is required');
  }
  if (typeof calculatedAt !== 'string' || !Number.isFinite(Date.parse(calculatedAt))) {
    throw new TypeError('calculatedAt must be a valid ISO timestamp');
  }

  assertOverviewConsistency(overview);
  const composition = calculatePortfolioComposition(overview);
  const ledgerCheckpoint = createPortfolioLedgerCheckpoint(profileId, overview);
  const valuationIdentity = overview.holdings
    .map(holdingValuationIdentity)
    .sort((left, right) => String(left.assetId).localeCompare(String(right.assetId)));
  const snapshotId = `portfolio_${digest({
    profileId: profileId || null,
    ledgerCheckpoint,
    cash: overview.summary.cashAvailable ?? null,
    valuationIdentity
  })}`;
  const status = snapshotStatus(overview, composition);
  const totalPortfolioValueStatus = overview.summary.cashStatus === 'available'
    && overview.summary.totalPortfolioValue !== null
    ? status
    : PORTFOLIO_DATA_STATES.UNAVAILABLE;
  const investedStatus = investedValueStatus(composition);
  const investedMarketValue = investedStatus === PORTFOLIO_DATA_STATES.UNAVAILABLE
    ? null
    : overview.summary.totalMarketValue;
  const totalCostBasis = ['complete', 'partial', 'stale'].includes(overview.summary.costBasisStatus)
    ? overview.summary.totalCostBasis
    : null;
  const unrealizedPnL = ['complete', 'partial', 'stale'].includes(overview.summary.pnlCoverageStatus)
    ? overview.summary.totalUnrealizedPnL
    : null;
  const unrealizedPnLPercent = unrealizedPnL === null
    ? null
    : overview.summary.totalUnrealizedPnLPercent;
  const holdings = overview.holdings.map((holding) => ({
    ...holding,
    snapshotId,
    priceAsOf: holding.marketUpdatedAt ?? null,
    fxAsOf: holding.fxRateTimestamp ?? null,
    dataStatus: stateFromLegacy(holding.valuationStatus)
  }));
  const allocation = {
    ...composition,
    snapshotId,
    status: stateFromLegacy(composition.allocationStatus),
    concentrationStatus: concentrationStatus(composition)
  };
  const summary = {
    ...overview.summary,
    totalMarketValue: investedMarketValue,
    totalCostBasis,
    totalUnrealizedPnL: unrealizedPnL,
    totalUnrealizedPnLPercent: unrealizedPnLPercent,
    snapshotId,
    status,
    metricStates: {
      cash: stateFromLegacy(overview.summary.cashStatus),
      investedMarketValue: investedStatus,
      totalPortfolioValue: totalPortfolioValueStatus,
      totalCostBasis: stateFromLegacy(overview.summary.costBasisStatus),
      unrealizedPnl: stateFromLegacy(overview.summary.pnlCoverageStatus)
    }
  };

  return {
    snapshotId,
    profileId: profileId || null,
    ledgerCheckpoint,
    ledgerRevision: ledgerCheckpoint,
    valuationAsOf: calculatedAt,
    calculatedAt,
    valuationBoundary: 'CALCULATION_TIME_WITH_SOURCE_SPECIFIC_AS_OF',
    status,
    completeness: {
      status,
      cash: stateFromLegacy(overview.summary.cashStatus),
      valuation: stateFromLegacy(overview.summary.valuationStatus),
      costBasis: stateFromLegacy(overview.summary.costBasisStatus),
      unrealizedPnl: stateFromLegacy(overview.summary.pnlCoverageStatus),
      allocation: stateFromLegacy(composition.allocationStatus),
      concentration: concentrationStatus(composition)
    },
    cash: {
      value: overview.summary.cashAvailable,
      currency: overview.summary.reportingCurrency || 'VND',
      status: stateFromLegacy(overview.summary.cashStatus),
      reason: overview.summary.cashReason || null,
      source: 'cash_ledger',
      asOf: null,
      entryCount: overview.summary.cashLedgerEntryCount ?? null,
      ledgerStartAt: overview.summary.cashLedgerStartAt ?? null
    },
    investedMarketValue,
    totalPortfolioValue: overview.summary.totalPortfolioValue,
    totalCostBasis,
    unrealizedPnL,
    unrealizedPnLPercent,
    valuationCoverage: {
      status: stateFromLegacy(composition.valuationCoverageLevel),
      totalHoldingsCount: composition.totalHoldingsCount,
      valuedHoldingsCount: composition.pricedHoldingsCount,
      unvaluedHoldingsCount: composition.unpricedHoldingsCount,
      allocationBasis: composition.allocationBasis
    },
    summary,
    holdings,
    allocation,
    sources: buildSourceMetadata(holdings)
  };
}

export async function getPortfolioSnapshot({
  profileId,
  now,
  getPortfolioOverviewFn = getPortfolioOverview,
  bypassTransientFailureBackoff = false
} = {}) {
  const overview = await getPortfolioOverviewFn({ profileId, bypassTransientFailureBackoff });
  const calculatedAt = requireClock(now);
  return buildPortfolioSnapshot({ profileId, overview, calculatedAt });
}
