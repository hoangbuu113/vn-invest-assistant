import { getInvestorProfile, getHoldings } from './supabase.js';
import { getMarketSnapshot } from './market.js';

/**
 * Calculates and returns a deterministic portfolio overview.
 * Combines profile cash, holdings, and delayed market prices without mutating or persisting derived metrics.
 */
export async function getPortfolioOverview() {
  const [profile, holdings] = await Promise.all([
    getInvestorProfile(),
    getHoldings()
  ]);

  const cashAvailable = profile && typeof profile.cash_available === 'number'
    ? profile.cash_available
    : Number(profile?.cash_available || 0);

  // Fetch market quotes concurrently for all holdings
  const holdingsWithMarket = await Promise.all(
    holdings.map(async (holding) => {
      const quantity = typeof holding.quantity === 'number' ? holding.quantity : Number(holding.quantity || 0);
      const averageCost = typeof holding.average_cost === 'number' ? holding.average_cost : Number(holding.average_cost || 0);
      const costBasis = Number((quantity * averageCost).toFixed(2));
      const symbol = holding.asset?.symbol || null;

      let latestPrice = null;
      let marketValue = null;
      let unrealizedPnL = null;
      let unrealizedPnLPercent = null;
      let marketUpdatedAt = null;
      let pricingStatus = 'unavailable';

      if (symbol) {
        try {
          const snapshot = await getMarketSnapshot(symbol);
          if (snapshot && typeof snapshot.price === 'number' && !isNaN(snapshot.price)) {
            latestPrice = snapshot.price;
            marketValue = Number((quantity * latestPrice).toFixed(2));
            unrealizedPnL = Number((marketValue - costBasis).toFixed(2));
            unrealizedPnLPercent = costBasis === 0 ? null : Number(((unrealizedPnL / costBasis) * 100).toFixed(2));
            marketUpdatedAt = snapshot.updatedAt || new Date().toISOString();
            pricingStatus = 'available';
          }
        } catch {
          // Market price lookup failed; preserve holding with pricingStatus = 'unavailable'
          latestPrice = null;
          marketValue = null;
          unrealizedPnL = null;
          unrealizedPnLPercent = null;
          marketUpdatedAt = null;
          pricingStatus = 'unavailable';
        }
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
    })
  );

  // Aggregate totals
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

  totalCostBasis = Number(totalCostBasis.toFixed(2));
  pricedCostBasis = Number(pricedCostBasis.toFixed(2));
  totalMarketValue = Number(totalMarketValue.toFixed(2));

  const totalUnrealizedPnL = Number((totalMarketValue - pricedCostBasis).toFixed(2));
  const totalUnrealizedPnLPercent = pricedCostBasis === 0
    ? null
    : Number(((totalUnrealizedPnL / pricedCostBasis) * 100).toFixed(2));

  const totalPortfolioValue = Number((cashAvailable + totalMarketValue).toFixed(2));
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

