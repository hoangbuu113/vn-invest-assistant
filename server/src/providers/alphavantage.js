import { normalizeDailyHistory } from '../history.js';

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
      const isRateLimit = response.status === 429;
      const err = new Error(
        response.status === 404
          ? `Market data for '${symbol}' not found on Alpha Vantage`
          : isRateLimit
            ? 'Nhà cung cấp dữ liệu đang tạm thời giới hạn yêu cầu. Vui lòng thử lại sau.'
            : 'Không thể kết nối nhà cung cấp dữ liệu'
      );
      err.status = response.status === 404 ? 404 : isRateLimit ? 503 : 502;
      err.code = response.status === 404 ? 'MARKET_DATA_NOT_FOUND' : isRateLimit ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw err;
    }

    const data = await response.json();

    if (data?.['Error Message']) {
      const err = new Error(`Market data for '${symbol}' not found on Alpha Vantage`);
      err.status = 404;
      err.code = 'MARKET_DATA_NOT_FOUND';
      throw err;
    }

    if (data?.['Note'] || data?.['Information']) {
      const message = data['Note'] || data['Information'];
      const isRateLimit = typeof message === 'string' && /rate|frequency|limit|thank you/i.test(message);
      const err = new Error(
        isRateLimit
          ? 'Nhà cung cấp dữ liệu đang tạm thời giới hạn yêu cầu. Vui lòng thử lại sau.'
          : 'Không thể kết nối nhà cung cấp dữ liệu'
      );
      err.status = 502;
      err.code = isRateLimit ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
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
      freshness: 'delayed',
      changeBasis: 'UNAVAILABLE',
      volumeSemantics: 'UNAVAILABLE'
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

export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || 'GOLD';
  const providerSymbol = mapping?.providerSymbol ?? mapping?.provider_symbol;
  const normalizedProviderSymbol = typeof providerSymbol === 'string' ? providerSymbol.trim().toUpperCase() : '';
  if (normalizedProviderSymbol !== 'XAU') {
    const err = new Error(`Alpha Vantage Gold Spot history requires explicit XAU mapping for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }
  if (asset?.marketPolicy !== 'GLOBAL_24_5' || asset?.marketTimezone !== 'UTC') {
    const err = new Error(`Alpha Vantage Gold Spot history is unsupported for market policy '${asset?.marketPolicy || 'unavailable'}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }
  if (asset?.quoteCurrency !== 'USD') {
    const err = new Error(`Alpha Vantage Gold Spot history conflicts with canonical currency '${asset?.quoteCurrency || 'unavailable'}'`);
    err.status = 502;
    err.code = 'PROVIDER_CURRENCY_MISMATCH';
    throw err;
  }

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    const err = new Error('Alpha Vantage API key is not configured');
    err.status = 422;
    err.code = 'PROVIDER_UNCONFIGURED';
    throw err;
  }

  const range = (options.range || '1M').toString().trim().toUpperCase();
  const now = options.now instanceof Date ? options.now : new Date();
  const url = `https://www.alphavantage.co/query?function=GOLD_SILVER_HISTORY&symbol=XAU&interval=daily&apikey=${encodeURIComponent(apiKey)}`;
  const fetchFn = options.fetchFn || fetch;

  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!response.ok) {
      const isRateLimit = response.status === 429;
      const err = new Error(
        response.status === 404
          ? `Historical Gold Spot data for '${symbol}' not found on Alpha Vantage`
          : isRateLimit
            ? 'Nhà cung cấp dữ liệu đang tạm thời giới hạn yêu cầu. Vui lòng thử lại sau.'
            : 'Không thể kết nối nhà cung cấp dữ liệu'
      );
      err.status = response.status === 404 ? 404 : isRateLimit ? 503 : 502;
      err.code = response.status === 404 ? 'HISTORY_NOT_FOUND' : isRateLimit ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw err;
    }

    const data = await response.json();
    if (data?.['Error Message']) {
      const err = new Error(`Historical Gold Spot data for '${symbol}' not found on Alpha Vantage`);
      err.status = 404;
      err.code = 'HISTORY_NOT_FOUND';
      throw err;
    }
    if (data?.Note || data?.Information) {
      const message = data.Note || data.Information;
      const isRateLimit = typeof message === 'string' && /rate|frequency|limit|thank you/i.test(message);
      const err = new Error(
        isRateLimit
          ? 'Nhà cung cấp dữ liệu đang tạm thời giới hạn yêu cầu. Vui lòng thử lại sau.'
          : 'Không thể kết nối nhà cung cấp dữ liệu'
      );
      err.status = isRateLimit ? 503 : 502;
      err.code = isRateLimit ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw err;
    }
    if (!Array.isArray(data?.data)) {
      const err = new Error(`Malformed Alpha Vantage historical response for '${symbol}'`);
      err.status = 502;
      err.code = 'MALFORMED_PROVIDER_RESPONSE';
      throw err;
    }

    const records = data.data.map((row) => {
      const rawPrice = row?.price;
      return {
        date: row?.date,
        timestamp: null,
        timestampDerived: true,
        open: null,
        high: null,
        low: null,
        close: (typeof rawPrice === 'number' || (typeof rawPrice === 'string' && rawPrice.trim()))
          ? Number(rawPrice)
          : null,
        volume: null
      };
    });

    return normalizeDailyHistory({
      asset,
      provider: 'alphavantage',
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
      const timeoutErr = new Error('Alpha Vantage market history request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching Alpha Vantage market history');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const alphavantageProvider = Object.freeze({
  name: 'alphavantage',
  capabilities: Object.freeze({
    snapshot: true,
    history: true,
    analysis: true,
    ohlcHistory: false,
    snapshotChangeBasis: 'UNAVAILABLE'
  }),
  getSnapshot,
  getHistory
});
