import { getCanonicalDate, normalizeDailyHistory } from '../history.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RANGE_MAP = Object.freeze({
  '1W': '1mo',
  '1M': '3mo',
  '3M': '6mo',
  '6M': '1y',
  '1Y': '2y',
  '2Y': '2y',
  '2y': '2y'
});

/**
 * Logical session key based on Vietnam exchange-local date (UTC+7 / Asia/Ho_Chi_Minh).
 * @param {number} timestampSec - Unix epoch timestamp in seconds
 * @returns {string} - YYYY-MM-DD
 */
export function getVietnamSessionKey(timestampSec) {
  return getCanonicalDate(new Date(timestampSec * 1000), 'Asia/Ho_Chi_Minh');
}

/**
 * Normalizes Yahoo Finance chart meta quote data into a deterministic delayed market snapshot.
 *
 * Rules:
 * 1. price: finite AND > 0 -> valid; otherwise null
 * 2. previousClose: finite AND > 0 -> preserve; otherwise null
 * 3. change & changePercent: calculated using full source precision if price and previousClose are valid, otherwise null
 * 4. dayHigh & dayLow: finite AND > 0 -> preserve; otherwise null
 * 5. volume: finite AND >= 0 -> preserve exact numeric value; otherwise null
 * 6. priceAsOf & updatedAt: valid source timestamp (regularMarketTime) -> ISO string; otherwise null
 * 7. priceSource: "yahoo_delayed_snapshot", freshness: "delayed"
 */
export function normalizeMarketSnapshot(meta, symbol) {
  if (!meta || typeof meta !== 'object') {
    const err = new Error(`No market quote available for '${symbol}'`);
    err.status = 404;
    throw err;
  }

  const rawPrice = meta.regularMarketPrice;
  const price = typeof rawPrice === 'number' && !isNaN(rawPrice) && isFinite(rawPrice) && rawPrice > 0
    ? rawPrice
    : null;

  const rawPrevClose = meta.previousClose ?? meta.chartPreviousClose;
  const previousClose = typeof rawPrevClose === 'number' && !isNaN(rawPrevClose) && isFinite(rawPrevClose) && rawPrevClose > 0
    ? rawPrevClose
    : null;

  let change = null;
  let changePercent = null;

  if (price !== null && previousClose !== null) {
    change = price - previousClose;
    changePercent = ((price / previousClose) - 1) * 100;
  }

  const rawHigh = meta.regularMarketDayHigh;
  const dayHigh = typeof rawHigh === 'number' && !isNaN(rawHigh) && isFinite(rawHigh) && rawHigh > 0
    ? rawHigh
    : null;

  const rawLow = meta.regularMarketDayLow;
  const dayLow = typeof rawLow === 'number' && !isNaN(rawLow) && isFinite(rawLow) && rawLow > 0
    ? rawLow
    : null;

  const rawVol = meta.regularMarketVolume;
  const volume = typeof rawVol === 'number' && !isNaN(rawVol) && isFinite(rawVol) && rawVol >= 0
    ? rawVol
    : null;

  const rawMarketTime = meta.regularMarketTime;
  const priceAsOf = typeof rawMarketTime === 'number' && !isNaN(rawMarketTime) && isFinite(rawMarketTime) && rawMarketTime > 0
    ? new Date(rawMarketTime * 1000).toISOString()
    : null;

  const currency = typeof meta.currency === 'string' && meta.currency.trim().length > 0
    ? meta.currency.trim()
    : null;

  let exchange = null;
  const exchangeCandidates = [meta.fullExchangeName, meta.exchangeName];
  for (const cand of exchangeCandidates) {
    if (typeof cand === 'string' && cand.trim().length > 0) {
      exchange = cand.trim();
      break;
    }
  }

  return {
    symbol: symbol,
    currency: currency,
    exchange: exchange,
    price: price,
    previousClose: previousClose,
    change: change,
    changePercent: changePercent,
    dayHigh: dayHigh,
    dayLow: dayLow,
    volume: volume,
    updatedAt: priceAsOf,
    priceAsOf: priceAsOf,
    priceSource: 'yahoo_delayed_snapshot',
    freshness: 'delayed'
  };
}

/**
 * Normalizes Yahoo Finance historical chart data into deterministic bars and period metrics.
 *
 * Rules:
 * 1. Requires valid timestamp > 0, finite close > 0.
 * 2. Optional fields (open, high, low > 0, volume >= 0) preserved if finite and valid, otherwise null.
 * 3. Never fabricate or substitute missing values (no flooring/rounding of volume).
 * 4. Duplicate sessions on the same Vietnam trading date:
 *    - Identical values -> collapsed to 1 session, canonical timestamp is the earliest source timestamp.
 *    - Conflicting values -> drop the conflicting session completely and record structured warning.
 * 5. Calculate metrics on demand without intermediate rounding:
 *    - periodStartPrice = first valid close
 *    - latestPrice = last valid close
 *    - validSessions = number of valid normalized bars
 *    - absoluteChange = latestPrice - periodStartPrice (if validSessions >= 2)
 *    - percentageChange = ((latestPrice / periodStartPrice) - 1) * 100 (if validSessions >= 2 and periodStartPrice > 0)
 *    - periodHigh = max of valid high numbers across bars, or null if no valid highs
 *    - periodLow = min of valid low numbers across bars, or null if no valid lows
 * 6. updatedAt = timestamp of the most recent normalized historical bar actually returned.
 */
export function normalizeHistoricalData(result, symbol, range, options = {}) {
  if (!result || typeof result !== 'object') {
    const err = new Error(`No historical data available for '${symbol}'`);
    err.status = 404;
    err.code = 'HISTORY_NOT_FOUND';
    throw err;
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];

  const records = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    records.push({
      timestamp: typeof ts === 'number' && Number.isFinite(ts) && ts > 0
        ? new Date(ts * 1000).toISOString()
        : null,
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: volumes[i]
    });
  }

  const asset = options.asset || {
    symbol,
    quoteCurrency: 'VND',
    marketPolicy: 'VN_EXCHANGE',
    marketTimezone: 'Asia/Ho_Chi_Minh'
  };

  return normalizeDailyHistory({
    asset,
    provider: 'yahoo',
    range,
    records,
    now: options.now || new Date(),
    freshness: 'delayed',
    applyRangeFilter: options.applyRangeFilter === true,
    excludeIncomplete: options.excludeIncomplete !== false
  });
}

/**
 * Fetches and normalizes a delayed market data snapshot from Yahoo Finance.
 * @param {Object} asset - Canonical asset object
 * @param {Object} mapping - Asset provider mapping object
 * @param {Object} [options] - Options containing fetchFn etc.
 */
export async function getSnapshot(asset, mapping, options = {}) {
  const symbol = asset?.symbol || mapping?.providerSymbol || mapping?.provider_symbol;
  const yahooSymbol = mapping?.providerSymbol ?? mapping?.provider_symbol;
  if (!yahooSymbol) {
    const err = new Error(`No provider symbol mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
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
      const err = new Error(response.status === 404 ? `Market data for '${symbol}' not found` : `Upstream market provider returned status ${response.status}`);
      err.status = response.status === 404 ? 404 : 502;
      throw err;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.meta) {
      const err = new Error(`No market quote available for '${symbol}'`);
      err.status = 404;
      throw err;
    }

    return normalizeMarketSnapshot(result.meta, symbol);
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Market data request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching market data');
    internalErr.status = 500;
    throw internalErr;
  }
}

/**
 * Fetches and normalizes daily historical market data from Yahoo Finance.
 * @param {Object} asset - Canonical asset object
 * @param {Object} mapping - Asset provider mapping object
 * @param {Object} [options] - Options containing range, normalizedRange, fetchFn etc.
 */
export async function getHistory(asset, mapping, options = {}) {
  const symbol = asset?.symbol || mapping?.providerSymbol || mapping?.provider_symbol;
  const yahooSymbol = mapping?.providerSymbol ?? mapping?.provider_symbol;
  if (!yahooSymbol) {
    const err = new Error(`No provider symbol mapping available for '${symbol}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }
  if (asset?.marketPolicy !== 'VN_EXCHANGE' || asset?.marketTimezone !== 'Asia/Ho_Chi_Minh') {
    const err = new Error(`Yahoo history is unsupported for market policy '${asset?.marketPolicy || 'unavailable'}'`);
    err.status = 422;
    err.code = 'UNSUPPORTED_MARKET_POLICY';
    throw err;
  }

  const requestedRange = (options.range || '1M').toString().trim();
  const yahooRange = RANGE_MAP[requestedRange] || requestedRange;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${encodeURIComponent(yahooRange)}`;
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
      const err = new Error(response.status === 404 ? `Historical market data for '${symbol}' not found` : `Upstream market provider returned status ${response.status}`);
      err.status = response.status === 404 ? 404 : response.status === 429 ? 503 : 502;
      err.code = response.status === 404 ? 'HISTORY_NOT_FOUND' : response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
      throw err;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.meta) {
      const err = new Error(`No historical data available for '${symbol}'`);
      err.status = 404;
      throw err;
    }
    const providerCurrency = typeof result.meta.currency === 'string' ? result.meta.currency.trim().toUpperCase() : null;
    if (providerCurrency && asset.quoteCurrency && providerCurrency !== asset.quoteCurrency) {
      const err = new Error(`Yahoo history currency '${providerCurrency}' conflicts with canonical currency '${asset.quoteCurrency}'`);
      err.status = 502;
      err.code = 'PROVIDER_CURRENCY_MISMATCH';
      throw err;
    }

    return normalizeHistoricalData(result, symbol, options.normalizedRange || requestedRange, {
      asset,
      now: options.now || new Date(),
      applyRangeFilter: requestedRange.toLowerCase() !== '2y',
      excludeIncomplete: true
    });
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Market history request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching market history');
    internalErr.status = 502;
    internalErr.code = 'PROVIDER_ERROR';
    throw internalErr;
  }
}

export const yahooProvider = Object.freeze({
  name: 'yahoo',
  getSnapshot,
  getHistory,
  normalizeMarketSnapshot,
  normalizeHistoricalData
});
