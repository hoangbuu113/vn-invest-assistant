import { getHoldings } from './supabase.js';
import { getMarketSnapshot } from './market.js';
import { getCashOverview } from './cash.js';

/**
 * Pure calculation function for portfolio holdings and aggregate summary.
 *
 * Rules:
 * 1. Holding priced ONLY if latestPrice is finite and > 0.
 * 2. Unpriced holdings have: latestPrice = null, marketValue = null, unrealizedPnL = null, unrealizedPnLPercent = null, pricingStatus = 'unavailable', marketUpdatedAt = null.
 * 3. Valuation status is 'partial' if any holding has pricingStatus !== 'available', otherwise 'complete'.
 * 4. Full precision math without intermediate rounding:
 *    - costBasis = quantity * averageCost
 *    - marketValue = quantity * latestPrice
 *    - unrealizedPnL = marketValue - costBasis
 *    - unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null
 * 5. Aggregates:
 *    - pricedCostBasis = sum(costBasis of priced holdings)
 *    - totalMarketValue = sum(marketValue of priced holdings)
 *    - totalUnrealizedPnL = totalMarketValue - pricedCostBasis
 *    - totalUnrealizedPnLPercent = pricedCostBasis > 0 ? (totalUnrealizedPnL / pricedCostBasis) * 100 : null
 *    - totalPortfolioValue = cashAvailable + totalMarketValue
 */
export function calculatePortfolioValuation(profile, holdings, snapshotsMap = {}) {
  const cashAvailable = profile && typeof profile.cash_available === 'number' && !isNaN(profile.cash_available) && isFinite(profile.cash_available)
    ? profile.cash_available
    : (typeof profile?.cash_available === 'string' && !isNaN(Number(profile.cash_available)) ? Number(profile.cash_available) : 0);

  const holdingsWithMarket = (Array.isArray(holdings) ? holdings : []).map((holding) => {
    const rawQuantity = holding.quantity;
    const quantity = typeof rawQuantity === 'number' && !isNaN(rawQuantity) && isFinite(rawQuantity)
      ? rawQuantity
      : Number(rawQuantity || 0);

    const rawAvgCost = holding.average_cost;
    const averageCost = typeof rawAvgCost === 'number' && !isNaN(rawAvgCost) && isFinite(rawAvgCost)
      ? rawAvgCost
      : Number(rawAvgCost || 0);

    const costBasis = quantity * averageCost;
    const symbol = holding.asset?.symbol || null;

    let latestPrice = null;
    let marketValue = null;
    let unrealizedPnL = null;
    let unrealizedPnLPercent = null;
    let marketUpdatedAt = null;
    let pricingStatus = 'unavailable';

    const snapshot = symbol ? snapshotsMap[symbol] : null;

    if (snapshot && typeof snapshot.price === 'number' && !isNaN(snapshot.price) && isFinite(snapshot.price) && snapshot.price > 0) {
      latestPrice = snapshot.price;
      marketValue = quantity * latestPrice;
      unrealizedPnL = marketValue - costBasis;
      unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
      marketUpdatedAt = snapshot.priceAsOf || snapshot.updatedAt || null;
      pricingStatus = 'available';
    }

    return {
      id: holding.id,
      assetId: holding.asset_id,
      symbol: symbol,
      name: holding.asset?.name || null,
      assetType: holding.asset?.asset_type || null,
      exchange: holding.asset?.exchange || null,
      quantity: quantity,
      averageCost: averageCost,
      costBasis: costBasis,
      latestPrice: latestPrice,
      marketValue: marketValue,
      unrealizedPnL: unrealizedPnL,
      unrealizedPnLPercent: unrealizedPnLPercent,
      marketUpdatedAt: marketUpdatedAt,
      pricingStatus: pricingStatus
    };
  });

  // Aggregate totals using full precision
  let totalCostBasis = 0;
  let pricedCostBasis = 0;
  let totalMarketValue = 0;
  let hasUnavailablePricing = false;

  for (const item of holdingsWithMarket) {
    totalCostBasis += item.costBasis;
    if (item.pricingStatus === 'available' && typeof item.marketValue === 'number') {
      pricedCostBasis += item.costBasis;
      totalMarketValue += item.marketValue;
    } else {
      hasUnavailablePricing = true;
    }
  }

  const totalUnrealizedPnL = totalMarketValue - pricedCostBasis;
  const totalUnrealizedPnLPercent = pricedCostBasis > 0
    ? (totalUnrealizedPnL / pricedCostBasis) * 100
    : null;

  const totalPortfolioValue = cashAvailable + totalMarketValue;
  const valuationStatus = hasUnavailablePricing ? 'partial' : 'complete';

  return {
    summary: {
      cashAvailable: cashAvailable,
      totalCostBasis: totalCostBasis,
      pricedCostBasis: pricedCostBasis,
      totalMarketValue: totalMarketValue,
      totalUnrealizedPnL: totalUnrealizedPnL,
      totalUnrealizedPnLPercent: totalUnrealizedPnLPercent,
      totalPortfolioValue: totalPortfolioValue,
      valuationStatus: valuationStatus
    },
    holdings: holdingsWithMarket
  };
}

/**
 * Calculates and returns a deterministic portfolio overview.
 * Combines ledger-authoritative cash, holdings, and delayed market prices without
 * mutating or persisting derived metrics.
 */
export async function getPortfolioOverview({
  getCashOverviewFn = getCashOverview,
  getHoldingsFn = getHoldings,
  getMarketSnapshotFn = getMarketSnapshot
} = {}) {
  const [cashOverview, holdings] = await Promise.all([
    getCashOverviewFn(),
    getHoldingsFn()
  ]);

  // Collect unique symbols
  const symbols = Array.from(new Set(
    (holdings || [])
      .map((h) => h.asset?.symbol)
      .filter((sym) => typeof sym === 'string' && sym.trim().length > 0)
  ));

  // Fetch market quotes concurrently
  const snapshotsEntries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const snapshot = await getMarketSnapshotFn(symbol);
        return [symbol, snapshot];
      } catch {
        return [symbol, null];
      }
    })
  );

  const snapshotsMap = Object.fromEntries(snapshotsEntries);

  return calculatePortfolioValuation(
    { cash_available: cashOverview.currentCash },
    holdings,
    snapshotsMap
  );
}
