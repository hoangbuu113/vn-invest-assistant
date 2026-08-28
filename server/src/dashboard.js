/**
 * Helper to compute top gainer and top decliner within a watchlist.
 *
 * Rules:
 * 1. Pure descriptive sorting based only on current delayed percentage change.
 * 2. Items missing price or changePercent (or with invalid numbers) are excluded.
 * 3. Requires at least 2 valid priced items to compute relative movers; otherwise returns null.
 * 4. topGainer is the item with the highest positive changePercent (or null if none > 0).
 * 5. topDecliner is the item with the lowest negative changePercent (or null if none < 0).
 * 6. Never fabricates 0%, dummy prices, or rankings.
 */
export function computeWatchlistMovers(watchlistItems, marketDataMap = {}) {
  if (!Array.isArray(watchlistItems) || watchlistItems.length === 0) {
    return { topGainer: null, topDecliner: null, validCount: 0 };
  }

  const validItems = [];

  for (const item of watchlistItems) {
    const sym = item.asset?.symbol || item.symbol;
    if (!sym || typeof sym !== 'string') continue;

    const mkt = marketDataMap[sym] || item.marketData;
    if (!mkt || typeof mkt !== 'object') continue;

    const price = typeof mkt.price === 'number' && !isNaN(mkt.price) && Number.isFinite(mkt.price) && mkt.price > 0
      ? mkt.price
      : null;

    const change = typeof mkt.change === 'number' && !isNaN(mkt.change) && Number.isFinite(mkt.change)
      ? mkt.change
      : null;

    const changePercent = typeof mkt.changePercent === 'number' && !isNaN(mkt.changePercent) && Number.isFinite(mkt.changePercent)
      ? mkt.changePercent
      : null;

    if (price !== null && changePercent !== null) {
      validItems.push({
        id: item.id || item.asset_id || sym,
        symbol: sym,
        name: item.asset?.name || item.name || sym,
        assetType: item.asset?.asset_type || item.assetType,
        price,
        change,
        changePercent,
        currency: mkt.currency || 'VND',
        updatedAt: mkt.updatedAt || null
      });
    }
  }

  if (validItems.length < 2) {
    return {
      topGainer: null,
      topDecliner: null,
      validCount: validItems.length
    };
  }

  // Sort descending by changePercent
  const sorted = [...validItems].sort((a, b) => b.changePercent - a.changePercent);

  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];

  const topGainer = highest && highest.changePercent > 0 ? highest : null;
  const topDecliner = lowest && lowest.changePercent < 0 ? lowest : null;

  return {
    topGainer,
    topDecliner,
    validCount: validItems.length
  };
}

