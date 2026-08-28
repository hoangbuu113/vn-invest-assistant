const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetches and normalizes a Gold Spot market snapshot from Alpha Vantage.
 *
 * Rules:
 * 1. Uses CURRENCY_EXCHANGE_RATE with from_currency=XAU and to_currency=USD (Gold Spot, NOT futures).
 * 2. Normalizes into standard market snapshot contract with quote currency USD.
 * 3. Does not fabricate missing values (volume, high, low remain null).
 * 4. Error payloads (rate limits, invalid key, notes) degrade cleanly to standard error objects with status codes.
 */
export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'GOLD';
  const fromCurrency = (mapping?.providerSymbol ?? mapping?.provider_symbol ?? 'XAU').trim().toUpperCase();

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    const err = new Error('Alpha Vantage API key is not configured');
    err.status = 422;
    err.code = 'PROVIDER_UNCONFIGURED';
    throw err;
  }

  const url = `https://www.alphavantage.co/query?function=GOLD_SILVER_SPOT&symbol=${encodeURIComponent(fromCurrency)}&apikey=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn || fetch;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = new Error(
        response.status === 404
          ? `Market data for '${symbol}' not found on Alpha Vantage`
          : `Alpha Vantage returned status ${response.status}`
      );
      err.status = response.status === 404 ? 404 : 502;
      throw err;
    }

    const data = await response.json();

    if (data?.['Error Message']) {
      const err = new Error(data['Error Message']);
      err.status = 404;
      throw err;
    }

    if (data?.['Note'] || data?.['Information']) {
      const message = data['Note'] || data['Information'];
      const err = new Error(`Alpha Vantage notice: ${message}`);
      err.status = 502;
      throw err;
    }

    const rawPrice = Number(data?.price);
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;

    if (price === null) {
      const err = new Error(`No market quote available for '${symbol}' on Alpha Vantage`);
      err.status = 404;
      throw err;
    }

    const rawTime = data?.timestamp;
    let priceAsOf = null;
    if (typeof rawTime === 'string' && rawTime.trim()) {
      const timeStr = rawTime.trim();
      const parsed = Date.parse(timeStr.endsWith('Z') || timeStr.includes('+') ? timeStr : `${timeStr}Z`);
      if (Number.isFinite(parsed)) {
        priceAsOf = new Date(parsed).toISOString();
      }
    }

    return {
      symbol: asset.symbol,
      currency: 'USD',
      exchange: null,
      price,
      previousClose: null,
      change: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      volume: null,
      updatedAt: priceAsOf,
      priceAsOf,
      priceSource: 'alphavantage_gold_spot',
      freshness: 'delayed'
    };
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Alpha Vantage market data request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching Alpha Vantage market data');
    internalErr.status = 500;
    throw internalErr;
  }
}

/**
 * Historical bar fetching for gold spot is deferred to Feature 21 for 24/5 global session semantics.
 */
export async function getHistory(asset, mapping, options = {}) {
  const err = new Error(`Historical market data for gold provider 'alphavantage' is not supported yet (scheduled for Feature 21)`);
  err.status = 422;
  err.code = 'UNSUPPORTED_MARKET_POLICY';
  throw err;
}

export const alphavantageProvider = Object.freeze({
  name: 'alphavantage',
  getSnapshot,
  getHistory
});

