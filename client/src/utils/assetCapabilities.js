/**
 * Canonical Asset Selector Capability Contracts
 *
 * Exposes explicit capability predicates for filtering canonical assets across
 * different features without duplicate lists, fake support, or hardcoded assumptions.
 */

export function normalizeAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const symbol = String(asset.symbol || '').trim().toUpperCase();
  if (!symbol) return null;
  const name = String(asset.name || symbol).trim();
  const assetType = String(asset.asset_type || asset.assetType || '').trim().toLowerCase();
  const quoteCurrency = String(asset.quote_currency || asset.quoteCurrency || 'VND').trim().toUpperCase();
  const baseCurrency = String(asset.base_currency || asset.baseCurrency || '').trim().toUpperCase();
  const marketPolicy = String(asset.market_policy || asset.marketPolicy || '').trim();
  const exchange = String(asset.exchange || '').trim();
  const suppliedPortfolioEligibility = String(
    asset.portfolio_eligibility || asset.portfolioEligibility || ''
  ).trim().toUpperCase();
  const portfolioEligibility = suppliedPortfolioEligibility
    || (assetType === 'fx' ? 'REFERENCE_ONLY' : 'PORTFOLIO_ELIGIBLE');
  const id = asset.id || symbol;

  return {
    id,
    symbol,
    name,
    assetType,
    quoteCurrency,
    baseCurrency,
    marketPolicy,
    exchange,
    portfolioEligibility,
    raw: asset
  };
}

/**
 * Returns true if an asset is a holdable VND asset under current portfolio accounting.
 * Excludes non-VND assets (Crypto in USD/USDT, Gold in USD) and FX rate pairs (USD/VND).
 */
export function isHoldableVndAsset(asset) {
  const norm = normalizeAsset(asset);
  if (!norm || !norm.symbol) return false;
  return norm.quoteCurrency === 'VND' && norm.assetType !== 'fx';
}

/**
 * Returns true if an asset is supported for portfolio trading (BUY / SELL transactions)
 * and opening positions under the VND-basis dual-settlement accounting architecture.
 * Supports VN Stocks, VN ETFs, Crypto, and Gold (XAU/USD).
 * Strictly excludes pure reference FX pairs (USD/VND).
 */
export function isPortfolioTradeableAsset(asset) {
  const norm = normalizeAsset(asset);
  if (!norm || !norm.symbol) return false;
  return norm.portfolioEligibility === 'PORTFOLIO_ELIGIBLE';
}

export function isOpeningPositionSupported(asset) {
  return isPortfolioTradeableAsset(asset);
}

export function isTransactionSupported(asset) {
  return isPortfolioTradeableAsset(asset);
}

/**
 * Returns true if an asset has completed daily historical bars for Base-100 comparison.
 * Supports VN Equities/ETFs, Gold (XAU/USD), and Cryptos (40 Binance spot mappings).
 * Excludes Twelve Data FX pairs (USD/VND) where history is intentionally unsupported.
 */
export function isHistoricalComparisonSupported(asset) {
  const norm = normalizeAsset(asset);
  if (!norm || !norm.symbol) return false;
  return norm.assetType !== 'fx' && norm.symbol !== 'USD/VND';
}

/**
 * Returns true if an asset is supported by the Analysis V2 engine.
 * Supports VN Equities/ETFs, Gold (XAU/USD), and Cryptos.
 * Excludes Twelve Data FX pairs (USD/VND).
 */
export function isAnalysisSupported(asset) {
  const norm = normalizeAsset(asset);
  if (!norm || !norm.symbol) return false;
  return norm.assetType !== 'fx' && norm.symbol !== 'USD/VND';
}

/**
 * Returns true if an asset has valid market snapshot capability.
 * Supported across all 49 canonical universe assets.
 */
export function isMarketSnapshotSupported(asset) {
  const norm = normalizeAsset(asset);
  if (!norm || !norm.symbol) return false;
  return true;
}

/**
 * Filters a list of raw assets according to capability.
 */
export function filterAssetsForCapability(assets, capability = 'all') {
  if (!Array.isArray(assets)) return [];

  return assets.filter((asset) => {
    switch (capability) {
      case 'opening_position':
        return isOpeningPositionSupported(asset);
      case 'transactions':
      case 'trading':
        return isTransactionSupported(asset);
      case 'holdable_vnd':
      case 'trading_vnd':
        return isHoldableVndAsset(asset);
      case 'comparison':
        return isHistoricalComparisonSupported(asset);
      case 'analysis':
        return isAnalysisSupported(asset);
      case 'snapshot':
      case 'watchlist':
      case 'alerts':
      case 'all':
      default:
        return isMarketSnapshotSupported(asset);
    }
  });
}
