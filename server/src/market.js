const SYMBOL_MAP = {
  FPT: 'FPT.VN',
  VCB: 'VCB.VN',
  HPG: 'HPG.VN',
  VNM: 'VNM.VN',
  E1VFVN30: 'E1VFVN30.VN'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

