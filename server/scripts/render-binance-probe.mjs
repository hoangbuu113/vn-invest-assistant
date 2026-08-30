const TARGETS = [
  {
    host: 'data-api.binance.vision',
    endpoint: 'klines',
    path: '/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1',
    isValidShape(payload) {
      const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
      return Array.isArray(row)
        && row.length >= 12
        && Number.isFinite(Number(row[0]))
        && Number(row[0]) > 0
        && [row[1], row[2], row[3], row[4]].every((value) => Number.isFinite(Number(value)) && Number(value) > 0)
        && Number.isFinite(Number(row[5]))
        && Number(row[5]) >= 0;
    }
  },
  {
    host: 'data-api.binance.vision',
    endpoint: 'exchangeInfo',
    path: '/api/v3/exchangeInfo?symbol=BTCUSDT',
    isValidShape(payload) {
      const symbol = Array.isArray(payload?.symbols) ? payload.symbols[0] : null;
      return symbol?.symbol === 'BTCUSDT'
        && symbol?.status === 'TRADING'
        && symbol?.baseAsset === 'BTC'
        && symbol?.quoteAsset === 'USDT';
    }
  },
  {
    host: 'api-gcp.binance.com',
    endpoint: 'klines',
    path: '/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1',
    isValidShape(payload) {
      const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
      return Array.isArray(row)
        && row.length >= 12
        && Number.isFinite(Number(row[0]))
        && Number(row[0]) > 0
        && [row[1], row[2], row[3], row[4]].every((value) => Number.isFinite(Number(value)) && Number(value) > 0)
        && Number.isFinite(Number(row[5]))
        && Number(row[5]) >= 0;
    }
  },
  {
    host: 'api-gcp.binance.com',
    endpoint: 'exchangeInfo',
    path: '/api/v3/exchangeInfo?symbol=BTCUSDT',
    isValidShape(payload) {
      const symbol = Array.isArray(payload?.symbols) ? payload.symbols[0] : null;
      return symbol?.symbol === 'BTCUSDT'
        && symbol?.status === 'TRADING'
        && symbol?.baseAsset === 'BTC'
        && symbol?.quoteAsset === 'USDT';
    }
  }
];

for (const target of TARGETS) {
  let httpStatus = 'NETWORK_ERROR';
  let validJson = false;
  let validBinanceShape = false;

  try {
    const response = await fetch(`https://${target.host}${target.path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
    httpStatus = response.status;

    try {
      const payload = await response.json();
      validJson = true;
      validBinanceShape = response.ok && target.isValidShape(payload);
    } catch {
      validJson = false;
    }
  } catch {
    httpStatus = 'NETWORK_ERROR';
  }

  console.log(
    `[BinanceProbe] host=${target.host} endpoint=${target.endpoint} http=${httpStatus} `
    + `validJson=${validJson ? 'YES' : 'NO'} validBinanceShape=${validBinanceShape ? 'YES' : 'NO'}`
  );
}
