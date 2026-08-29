import { addCalendarDays, getHistoryWindow, normalizeDailyHistory } from '../history.js';

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

export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'CRYPTO';
  const coinId = mapping?.providerSymbol ?? mapping?.provider_symbol;
  if (!coinId || typeof coinId !== 'string' || !coinId.trim()) {
    const err = new Error(`No CoinGecko coin ID mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }
  if (asset?.marketPolicy !== 'CONTINUOUS_24_7' || asset?.marketTimezone !== 'UTC') {
    const err = new Error(`CoinGecko history is unsupported for market policy '${asset?.marketPolicy || 'unavailable'}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
  if (asset?.quoteCurrency !== 'USD') {
    const err = new Error(`CoinGecko USD history conflicts with canonical currency '${asset?.quoteCurrency || 'unavailable'}'`);
    err.status = 502;
    err.code = 'PROVIDER_CURRENCY_MISMATCH';
    throw err;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const range = (options.range || '1M').toString().trim().toUpperCase();
  const { startDate } = getHistoryWindow(asset, range, now);
  const fromDate = addCalendarDays(startDate, -2);
  const from = Math.floor(Date.parse(`${fromDate}T00:00:00.000Z`) / 1000);
  const to = Math.floor(now.getTime() / 1000);
  const normalizedCoinId = coinId.trim().toLowerCase();
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.COINGECKO_API_KEY;
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(normalizedCoinId)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}&interval=daily&precision=full`;
  const fetchFn = options.fetchFn || fetch;
  const headers = { 'User-Agent': USER_AGENT };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetchFn(url, { signal: controller.signal, headers });

    if (!response.ok) {
      const err = new Error(
        response.status === 404
          ? `Historical market data for '${symbol}' not found on CoinGecko`
          : response.status === 429
            ? 'CoinGecko history rate limit exceeded'
            : `CoinGecko returned status ${response.status}`
      );
      err.status = response.status === 404 ? 404 : response.status === 429 ? 503 : 502;
      err.code = response.status === 404 ? 'HISTORY_NOT_FOUND' : response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
      throw err;
    }

    const data = await response.json();
    if (data?.status?.error_code || data?.error) {
      const err = new Error(data?.status?.error_message || data?.error || 'CoinGecko history provider error');
      err.status = data?.status?.error_code === 429 ? 503 : 502;
      err.code = data?.status?.error_code === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
      throw err;
    }
    if (!Array.isArray(data?.prices)) {
      const err = new Error(`Malformed CoinGecko historical response for '${symbol}'`);
      err.status = 502;
      err.code = 'MALFORMED_PROVIDER_RESPONSE';
      throw err;
    }

    const records = data.prices.map((row) => {
      const timestampMs = Array.isArray(row) ? row[0] : null;
      const rawPrice = Array.isArray(row) ? row[1] : null;
      const price = (typeof rawPrice === 'number' || (typeof rawPrice === 'string' && rawPrice.trim()))
        ? Number(rawPrice)
        : null;
      return {
        timestamp: typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0
          ? new Date(timestampMs).toISOString()
          : null,
        open: null,
        high: null,
        low: null,
        close: price,
        volume: null
      };
    });

    return normalizeDailyHistory({
      asset,
      provider: 'coingecko',
      range,
      records,
      now,
      freshness: 'delayed',
      historyCapabilities: {
        close: true,
        ohlc: false,
        volume: false
      }
    });
  } catch (err) {
    if (err.status) throw err;
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('CoinGecko market history request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching CoinGecko market history');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const coingeckoProvider = Object.freeze({
  name: 'coingecko',
  getSnapshot,
  getHistory
});
