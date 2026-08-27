const SYMBOL_MAP = {
  FPT: 'FPT.VN',
  VCB: 'VCB.VN',
  HPG: 'HPG.VN',
  VNM: 'VNM.VN',
  E1VFVN30: 'E1VFVN30.VN'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RANGE_MAP = {
  '1W': '5d',
  '1M': '1mo',
  '3M': '3mo',
  '6M': '6mo',
  '1Y': '1y'
};

/**
 * Fetches and normalizes a delayed market data snapshot from Yahoo Finance.
 * @param {string} rawSymbol - The internal asset symbol (e.g. 'FPT')
 */
export async function getMarketSnapshot(rawSymbol) {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const yahooSymbol = SYMBOL_MAP[symbol] || (symbol.endsWith('.VN') ? symbol : `${symbol}.VN`);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
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

    const meta = result.meta;
    const price = meta.regularMarketPrice ?? null;
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;

    let change = null;
    let changePercent = null;

    if (price !== null && previousClose !== null && previousClose !== 0) {
      change = Number((price - previousClose).toFixed(2));
      changePercent = Number(((change / previousClose) * 100).toFixed(2));
    }

    const updatedAt = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString();

    return {
      symbol: symbol,
      currency: meta.currency || 'VND',
      exchange: meta.fullExchangeName || meta.exchangeName || 'HOSE',
      price: price,
      previousClose: previousClose,
      change: change,
      changePercent: changePercent,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      updatedAt: updatedAt,
      freshness: 'delayed'
    };
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
 * Logical session key based on Vietnam exchange-local date (UTC+7 / Asia/Ho_Chi_Minh).
 * @param {number} timestampSec - Unix epoch timestamp in seconds
 * @returns {string} - YYYY-MM-DD
 */
export function getVietnamSessionKey(timestampSec) {
  const d = new Date((timestampSec + 7 * 3600) * 1000);
  return d.toISOString().slice(0, 10);
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
export function normalizeHistoricalData(result, symbol, range) {
  if (!result || typeof result !== 'object') {
    const err = new Error(`No historical data available for '${symbol}'`);
    err.status = 404;
    throw err;
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];

  const sessionMap = new Map();
  const warnings = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (typeof ts !== 'number' || isNaN(ts) || !isFinite(ts) || ts <= 0) continue;

    const c = closes[i];
    // Close is required to be finite and > 0
    if (typeof c !== 'number' || isNaN(c) || !isFinite(c) || c <= 0) {
      continue;
    }

    // Optional fields: finite and valid -> preserve; otherwise -> null
    const o = typeof opens[i] === 'number' && !isNaN(opens[i]) && isFinite(opens[i]) && opens[i] > 0 ? opens[i] : null;
    const h = typeof highs[i] === 'number' && !isNaN(highs[i]) && isFinite(highs[i]) && highs[i] > 0 ? highs[i] : null;
    const l = typeof lows[i] === 'number' && !isNaN(lows[i]) && isFinite(lows[i]) && lows[i] > 0 ? lows[i] : null;
    const v = typeof volumes[i] === 'number' && !isNaN(volumes[i]) && isFinite(volumes[i]) && volumes[i] >= 0 ? volumes[i] : null;

    const dateIso = new Date(ts * 1000).toISOString();
    const sessionKey = getVietnamSessionKey(ts);

    const currentBar = {
      timestamp: dateIso,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v
    };

    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, {
        status: 'valid',
        bar: currentBar,
        tsVal: ts
      });
    } else {
      const existing = sessionMap.get(sessionKey);
      if (existing.status === 'conflict') {
        // Already marked as conflicting, ignore further entries for this session
        continue;
      }

      // Check if identical
      const isIdentical =
        existing.bar.open === currentBar.open &&
        existing.bar.high === currentBar.high &&
        existing.bar.low === currentBar.low &&
        existing.bar.close === currentBar.close &&
        existing.bar.volume === currentBar.volume;

      if (isIdentical) {
        // Collapse to one session using the earliest valid source timestamp
        if (ts < existing.tsVal) {
          existing.tsVal = ts;
          existing.bar.timestamp = dateIso;
        }
        continue;
      } else {
        // Conflicting duplicate session -> invalidate and drop
        existing.status = 'conflict';
        warnings.push({
          code: 'CONFLICTING_DUPLICATE_SESSION',
          sessionKey,
          message: `Conflicting duplicate records found for session ${sessionKey}. Dropping session.`
        });
      }
    }
  }

  // Filter only valid (non-conflicting) sessions and sort chronologically
  const sortedBars = Array.from(sessionMap.values())
    .filter((s) => s.status === 'valid')
    .sort((a, b) => a.tsVal - b.tsVal)
    .map((s) => s.bar);

  if (sortedBars.length === 0) {
    const err = new Error(`No valid historical price records found for '${symbol}'`);
    err.status = 404;
    if (warnings.length > 0) {
      err.warnings = warnings;
    }
    throw err;
  }

  // Calculate metrics
  const validSessions = sortedBars.length;
  const periodStartPrice = sortedBars[0].close;
  const latestPrice = sortedBars[validSessions - 1].close;

  const validHighs = sortedBars.map((b) => b.high).filter((val) => typeof val === 'number' && isFinite(val) && val > 0);
  const validLows = sortedBars.map((b) => b.low).filter((val) => typeof val === 'number' && isFinite(val) && val > 0);

  const periodHigh = validHighs.length > 0 ? Math.max(...validHighs) : null;
  const periodLow = validLows.length > 0 ? Math.min(...validLows) : null;

  let absoluteChange = null;
  let percentageChange = null;

  if (validSessions >= 2) {
    absoluteChange = latestPrice - periodStartPrice;
    if (periodStartPrice > 0) {
      percentageChange = ((latestPrice / periodStartPrice) - 1) * 100;
    }
  }

  // Historical updatedAt MUST represent the timestamp of the most recent normalized historical bar actually returned
  const updatedAt = sortedBars[validSessions - 1].timestamp;

  const responsePayload = {
    symbol: symbol,
    range: range,
    interval: '1d',
    freshness: 'delayed',
    updatedAt: updatedAt,
    bars: sortedBars,
    metrics: {
      periodStartPrice,
      latestPrice,
      absoluteChange,
      percentageChange,
      periodHigh,
      periodLow,
      validSessions
    }
  };

  if (warnings.length > 0) {
    responsePayload.warnings = warnings;
  }

  return responsePayload;
}

/**
 * Fetches and normalizes daily historical market data and calculates period metrics.
 * Supported ranges: '1W', '1M', '3M', '6M', '1Y'
 * @param {string} rawSymbol - The asset symbol (e.g. 'FPT')
 * @param {string} rawRange - Requested range (defaults to '1M')
 */
export async function getMarketHistory(rawSymbol, rawRange = '1M') {
  if (!rawSymbol || typeof rawSymbol !== 'string') {
    const err = new Error('Invalid symbol parameter');
    err.status = 400;
    throw err;
  }

  const symbol = rawSymbol.trim().toUpperCase();
  const range = (rawRange || '1M').toString().trim().toUpperCase();

  const yahooRange = RANGE_MAP[range];
  if (!yahooRange) {
    const err = new Error(`Invalid range '${rawRange}'. Supported ranges: 1W, 1M, 3M, 6M, 1Y`);
    err.status = 400;
    throw err;
  }

  const yahooSymbol = SYMBOL_MAP[symbol] || (symbol.endsWith('.VN') ? symbol : `${symbol}.VN`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${encodeURIComponent(yahooRange)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = new Error(response.status === 404 ? `Historical market data for '${symbol}' not found` : `Upstream market provider returned status ${response.status}`);
      err.status = response.status === 404 ? 404 : 502;
      throw err;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.meta) {
      const err = new Error(`No historical data available for '${symbol}'`);
      err.status = 404;
      throw err;
    }

    return normalizeHistoricalData(result, symbol, range);
  } catch (err) {
    if (err.status) {
      throw err;
    }
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Market history request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const internalErr = new Error(err.message || 'Error fetching market history');
    internalErr.status = 500;
    throw internalErr;
  }
}
