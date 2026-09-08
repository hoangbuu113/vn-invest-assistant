import { getPortfolioOverview } from './portfolio.js';

function compareTextAscending(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function holdingSymbolKey(holding) {
  return typeof holding.symbol === 'string' ? holding.symbol.trim().toUpperCase() : '';
}

function holdingStableKey(holding) {
  return String(holding.assetId ?? holding.id ?? '');
}

function compareHoldingAllocations(left, right) {
  if (left.isPriced !== right.isPriced) {
    return left.isPriced ? -1 : 1;
  }

  if (left.isPriced && left.marketValue !== right.marketValue) {
    return left.marketValue > right.marketValue ? -1 : 1;
  }

  const symbolComparison = compareTextAscending(holdingSymbolKey(left), holdingSymbolKey(right));
  if (symbolComparison !== 0) return symbolComparison;

  return compareTextAscending(holdingStableKey(left), holdingStableKey(right));
}

function normalizedAssetType(assetType) {
  return typeof assetType === 'string' && assetType.trim().length > 0
    ? assetType.trim()
    : 'unknown';
}

/**
 * Pure deterministic portfolio composition derived exclusively from the
 * production portfolio overview valuation contract.
 */
export function calculatePortfolioComposition(portfolioOverview) {
  if (!portfolioOverview || typeof portfolioOverview !== 'object') {
    throw new TypeError('A portfolio overview is required');
  }

  const cashValue = portfolioOverview.summary?.cashAvailable;
  const cashAvailable = typeof cashValue === 'number' && Number.isFinite(cashValue) && cashValue >= 0;
  if (cashValue !== null && cashValue !== undefined && !cashAvailable) {
    throw new TypeError('Portfolio overview cashAvailable must be a finite non-negative number');
  }

  const sourceHoldings = Array.isArray(portfolioOverview.holdings)
    ? portfolioOverview.holdings
    : [];

  const holdingAllocations = sourceHoldings.map((holding) => {
    const hasReportingValueField = Object.prototype.hasOwnProperty.call(
      holding || {},
      'reportingMarketValue'
    );
    const reportingMarketValue = hasReportingValueField
      ? holding.reportingMarketValue
      : holding?.marketValue;
    const reportingValuationStatus = holding?.valuationStatus ?? holding?.pricingStatus;
    const hasValidMarketValue = typeof reportingMarketValue === 'number'
      && Number.isFinite(reportingMarketValue)
      && reportingMarketValue >= 0;
    const isPriced = ['available', 'stale'].includes(reportingValuationStatus) && hasValidMarketValue;

    return {
      id: holding?.id ?? null,
      assetId: holding?.assetId ?? null,
      symbol: holding?.symbol ?? null,
      name: holding?.name ?? null,
      assetType: normalizedAssetType(holding?.assetType),
      marketValue: isPriced ? reportingMarketValue : null,
      weightPct: null,
      isPriced,
      pricingStatus: isPriced ? reportingValuationStatus : 'unavailable'
    };
  });

  const pricedHoldings = holdingAllocations.filter((holding) => holding.isPriced);
  const hasStalePricing = pricedHoldings.some((holding) => holding.pricingStatus === 'stale');
  const pricedHoldingsMarketValue = pricedHoldings.reduce(
    (sum, holding) => sum + holding.marketValue,
    0
  );
  const knownAllocationValue = cashAvailable ? cashValue + pricedHoldingsMarketValue : null;

  const totalHoldingsCount = holdingAllocations.length;
  const pricedHoldingsCount = pricedHoldings.length;
  const unpricedHoldingsCount = totalHoldingsCount - pricedHoldingsCount;
  const hasHoldings = totalHoldingsCount > 0;

  let valuationCoverageLevel;
  if (!cashAvailable) {
    valuationCoverageLevel = pricedHoldingsCount > 0 ? 'partial' : 'unavailable';
  } else if (!hasHoldings) {
    valuationCoverageLevel = 'not_applicable';
  } else if (pricedHoldingsCount === totalHoldingsCount) {
    valuationCoverageLevel = hasStalePricing ? 'stale' : 'complete';
  } else if (pricedHoldingsCount > 0) {
    valuationCoverageLevel = 'partial';
  } else {
    valuationCoverageLevel = 'unavailable';
  }

  let allocationBasis;
  if (!cashAvailable) {
    allocationBasis = 'cash_unavailable';
  } else if (!hasHoldings) {
    allocationBasis = cashValue > 0 ? 'cash_only' : 'no_known_value';
  } else if (unpricedHoldingsCount > 0) {
    allocationBasis = 'known_value_only';
  } else {
    allocationBasis = 'full_portfolio_value';
  }

  const allocationStatus = cashAvailable && knownAllocationValue > 0
    ? (hasStalePricing ? 'stale' : 'available')
    : 'unavailable';
  const cashWeightPct = cashAvailable && knownAllocationValue > 0
    ? (cashValue / knownAllocationValue) * 100
    : null;
  const pricedAssetsWeightPct = cashAvailable && knownAllocationValue > 0
    ? (pricedHoldingsMarketValue / knownAllocationValue) * 100
    : null;

  for (const holding of holdingAllocations) {
    if (holding.isPriced && cashAvailable && knownAllocationValue > 0) {
      holding.weightPct = (holding.marketValue / knownAllocationValue) * 100;
    }
  }

  holdingAllocations.sort(compareHoldingAllocations);

  const assetTypeMap = new Map();
  for (const holding of holdingAllocations) {
    if (!holding.isPriced) continue;

    const current = assetTypeMap.get(holding.assetType) || {
      assetType: holding.assetType,
      marketValue: 0,
      weightPct: null,
      holdingCount: 0
    };
    current.marketValue += holding.marketValue;
    current.holdingCount += 1;
    assetTypeMap.set(holding.assetType, current);
  }

  const assetTypeGroups = Array.from(assetTypeMap.values());
  for (const group of assetTypeGroups) {
    if (cashAvailable && knownAllocationValue > 0) {
      group.weightPct = (group.marketValue / knownAllocationValue) * 100;
    }
  }
  assetTypeGroups.sort((left, right) => {
    if (left.marketValue !== right.marketValue) {
      return left.marketValue > right.marketValue ? -1 : 1;
    }
    return compareTextAscending(left.assetType, right.assetType);
  });

  const sortedPricedHoldings = holdingAllocations.filter((holding) => holding.isPriced);
  const largestHolding = sortedPricedHoldings.length > 0
    ? {
        id: sortedPricedHoldings[0].id,
        assetId: sortedPricedHoldings[0].assetId,
        symbol: sortedPricedHoldings[0].symbol,
        name: sortedPricedHoldings[0].name,
        assetType: sortedPricedHoldings[0].assetType,
        marketValue: sortedPricedHoldings[0].marketValue,
        weightPct: sortedPricedHoldings[0].weightPct
      }
    : null;

  const top3Holdings = sortedPricedHoldings.slice(0, 3);
  const top3HoldingsWeightPct = top3Holdings.length > 0 && cashAvailable && knownAllocationValue > 0
    ? (top3Holdings.reduce((sum, holding) => sum + holding.marketValue, 0) / knownAllocationValue) * 100
    : null;

  return {
    hasHoldings,
    totalHoldingsCount,
    pricedHoldingsCount,
    unpricedHoldingsCount,
    valuationCoverageLevel,
    allocationBasis,
    allocationStatus,
    cashValue,
    cashStatus: cashAvailable ? 'available' : 'unavailable',
    pricedHoldingsMarketValue,
    knownAllocationValue,
    cashWeightPct,
    pricedAssetsWeightPct,
    holdingAllocations,
    assetTypeGroups,
    largestHolding,
    top3HoldingsWeightPct,
    pricedHoldingCountUsed: top3Holdings.length
  };
}

/**
 * Production integration: obtain the existing portfolio overview once, then
 * derive composition without re-fetching prices or recomputing valuation.
 */
export async function getPortfolioComposition(options = {}) {
  const getPortfolioOverviewFn = options.getPortfolioOverviewFn || getPortfolioOverview;
  const portfolioOverview = await getPortfolioOverviewFn();
  return calculatePortfolioComposition(portfolioOverview);
}
