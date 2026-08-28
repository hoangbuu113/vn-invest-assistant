const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetches and normalizes a cryptocurrency market snapshot from CoinGecko.
 *
 * Rules:
 * 1. Uses the immutable CoinGecko coin ID from asset_provider_mappings (e.g. 'bitcoin', 'ethereum', 'solana').
 * 2. Normalizes into standard market snapshot contract with quote currency USD.
 * 3. Does not invent missing values (dayHigh / dayLow remain null).
 * 4. Error responses degrade cleanly to standard error objects with status codes.
 */
export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'CRYPTO';
  const coinId = mapping?.providerSymbol ?? mapping?.provider_symbol;

  if (!coinId || typeof coinId !== 'string' || !coinId.trim()) {
    const err = new Error(`No CoinGecko coin ID mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }

  const normalizedCoinId = coinId.trim().toLowerCase();
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.COINGECKO_API_KEY;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(normalizedCoinId)}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;
  const fetchFn = options.fetchFn || fetch;

  const headers = {
    'User-Agent': USER_AGENT
  };
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = new Error(
        response.status === 404
          ? `Market data for '${symbol}' not found on CoinGecko`
          : `CoinGecko returned status ${response.status}`
      );
      err.status = response.status === 404 ? 404 : 502;
      throw err;
    }

    const data = await response.json();
    const coinData = data?.[normalizedCoinId];

    if (!coinData || typeof coinData !== 'object') {
      const err = new Error(`No market quote available for '${symbol}' on CoinGecko`);
      err.status = 404;
      throw err;
    }

    const rawPrice = Number(coinData.usd);
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;

    if (price === null) {
      const err = new Error(`Invalid market price received for '${symbol}'`);
      err.status = 404;
      throw err;
    }

    const rawChangePercent = Number(coinData.usd_24h_change);
    const changePercent = Number.isFinite(rawChangePercent) ? rawChangePercent : null;

    const rawVol = Number(coinData.usd_24h_vol);
    const volume = Number.isFinite(rawVol) && rawVol >= 0 ? rawVol : null;

    const rawTs = Number(coinData.last_updated_at);
    const priceAsOf = Number.isFinite(rawTs) && rawTs > 0
      ? new Date(rawTs * 1000).toISOString()
      : null;

    let previousClose = null;
    let change = null;
    if (price !== null && changePercent !== null && (1 + changePercent / 100) > 0) {
      previousClose = price / (1 + changePercent / 100);
      change = price - previousClose;
    }

    return {
      symbol: asset.symbol,
      currency: 'USD',
      exchange: null,
      price,
      previousClose,
      change,
      changePercent,
      dayHigh: null,
      dayLow: null,
      volume,
      updatedAt: priceAsOf,
      priceAsOf,
      priceSource: 'coingecko_market_snapshot',
      freshness: 'delayed'
    };
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('CoinGecko market data request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching CoinGecko market data');
    internalErr.status = 500;
    throw internalErr;
  }
}

/**
 * Historical bar fetching is deferred to Feature 21 for 24/7 crypto calendar semantics.
 */
export async function getHistory(asset, mapping, options = {}) {
  const err = new Error(`Historical market data for crypto provider 'coingecko' is not supported yet (scheduled for Feature 21)`);
  err.status = 422;
  err.code = 'UNSUPPORTED_MARKET_POLICY';
  throw err;
}

export const coingeckoProvider = Object.freeze({
  name: 'coingecko',
  getSnapshot,
  getHistory
});

