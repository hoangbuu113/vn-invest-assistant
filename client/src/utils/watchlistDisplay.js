function hasValidPrice(marketData) {
  return Boolean(
    marketData
    && typeof marketData.price === 'number'
    && Number.isFinite(marketData.price)
    && marketData.price > 0
  );
}

function normalizedCurrency(marketData) {
  return typeof marketData?.currency === 'string' && marketData.currency.trim()
    ? marketData.currency.trim().toUpperCase()
    : null;
}

export function isCryptoDisplayAsset(asset) {
  return String(asset?.assetType ?? asset?.asset_type ?? '').trim().toLowerCase() === 'crypto';
}

export function selectCryptoWatchlistDisplayData({ realtime, snapshot } = {}) {
  if (hasValidPrice(realtime) && normalizedCurrency(realtime) === 'USDT') {
    return realtime;
  }

  if (hasValidPrice(snapshot) && normalizedCurrency(snapshot) === 'USD') {
    return snapshot;
  }

  return null;
}

export function getWatchlistDisplayCurrency(marketData, asset) {
  return normalizedCurrency(marketData)
    || (typeof asset?.quoteCurrency === 'string' && asset.quoteCurrency.trim()
      ? asset.quoteCurrency.trim().toUpperCase()
      : null)
    || (typeof asset?.quote_currency === 'string' && asset.quote_currency.trim()
      ? asset.quote_currency.trim().toUpperCase()
      : null);
}
