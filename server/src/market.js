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

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = Array.isArray(quote.open) ? quote.open : [];
    const highs = Array.isArray(quote.high) ? quote.high : [];
    const lows = Array.isArray(quote.low) ? quote.low : [];
    const closes = Array.isArray(quote.close) ? quote.close : [];
    const volumes = Array.isArray(quote.volume) ? quote.volume : [];

    // Filter, validate and deduplicate bars
    const barMap = new Map();

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (typeof ts !== 'number' || isNaN(ts) || ts <= 0) continue;

      const c = closes[i];
      // Ignore malformed/non-numeric price rows
      if (c === null || c === undefined || typeof c !== 'number' || isNaN(c) || !isFinite(c) || c <= 0) {
        continue;
      }

      const o = typeof opens[i] === 'number' && !isNaN(opens[i]) && isFinite(opens[i]) && opens[i] > 0 ? opens[i] : c;
      const h = typeof highs[i] === 'number' && !isNaN(highs[i]) && isFinite(highs[i]) && highs[i] > 0 ? highs[i] : Math.max(o, c);
      const l = typeof lows[i] === 'number' && !isNaN(lows[i]) && isFinite(lows[i]) && lows[i] > 0 ? lows[i] : Math.min(o, c);
      
      const rawVol = volumes[i];
      const vol = typeof rawVol === 'number' && !isNaN(rawVol) && isFinite(rawVol) && rawVol >= 0 ? Math.floor(rawVol) : 0;

      const dateIso = new Date(ts * 1000).toISOString();
      const dateKey = dateIso.slice(0, 10);

      // Deduplicate by trading date, keeping valid entry
      barMap.set(dateKey, {
        timestamp: dateIso,
        tsVal: ts,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: vol
      });
    }

    // Sort bars chronologically (oldest to newest)
    const sortedBars = Array.from(barMap.values())
      .sort((a, b) => a.tsVal - b.tsVal)
      .map(({ tsVal, ...bar }) => bar);

    if (sortedBars.length === 0) {
      const err = new Error(`No valid historical price records found for '${symbol}'`);
      err.status = 404;
      throw err;
    }

    // Calculate on-demand metrics
    const validSessions = sortedBars.length;
    const periodStartPrice = sortedBars[0].close;
    const latestPrice = sortedBars[validSessions - 1].close;

    const validHighs = sortedBars.map((b) => b.high).filter((v) => typeof v === 'number' && isFinite(v) && v > 0);
    const validLows = sortedBars.map((b) => b.low).filter((v) => typeof v === 'number' && isFinite(v) && v > 0);

    const periodHigh = validHighs.length > 0 ? Math.max(...validHighs) : latestPrice;
    const periodLow = validLows.length > 0 ? Math.min(...validLows) : latestPrice;

    let absoluteChange = null;
    let percentageChange = null;

    if (validSessions >= 2) {
      absoluteChange = Number((latestPrice - periodStartPrice).toFixed(2));
      if (periodStartPrice > 0) {
        percentageChange = Number(((absoluteChange / periodStartPrice) * 100).toFixed(2));
      } else {
        percentageChange = null;
      }
    }

    const updatedAt = result.meta?.regularMarketTime
      ? new Date(result.meta.regularMarketTime * 1000).toISOString()
      : (sortedBars.length > 0 ? sortedBars[sortedBars.length - 1].timestamp : new Date().toISOString());

    return {
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


