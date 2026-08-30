import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { getAssetAnalysis } from '../src/analysis.js';
import { getMarketHistory } from '../src/market.js';
import {
  BinanceHistoryCache,
  CircuitBreaker,
  _resetBinanceWsApiClient,
  binanceProvider,
  createBinanceWsApiClient,
  getBinanceWsApiClient,
  getHistory
} from '../src/providers/binance.js';

class MockWsApiSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sent = [];
    this.closed = false;
    MockWsApiSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  send(rawMessage) {
    this.sent.push(JSON.parse(rawMessage));
  }

  respond(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  serverClose() {
    this.onclose?.({ code: 1006, reason: 'fixture disconnect' });
  }

  close() {
    this.closed = true;
  }

  static reset() {
    MockWsApiSocket.instances = [];
  }
}

function rawKline(date, close = 100) {
  const open = close - 1;
  return [
    Date.parse(`${date}T00:00:00.000Z`),
    String(open),
    String(close + 2),
    String(open - 2),
    String(close),
    '123.456',
    Date.parse(`${date}T23:59:59.999Z`),
    '0',
    1,
    '0',
    '0',
    '0'
  ];
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Binance WebSocket API historical transport', () => {
  afterEach(() => {
    _resetBinanceWsApiClient();
    MockWsApiSocket.reset();
  });

  it('uses one singleton connection and multiplexes concurrent Kline requests by id', async () => {
    const firstClient = getBinanceWsApiClient({
      WebSocket: MockWsApiSocket,
      requestTimeoutMs: 100,
      closeWhenIdle: false,
      silent: true
    });
    const secondClient = getBinanceWsApiClient({
      WebSocket: class UnexpectedSecondSocket {},
      silent: true
    });
    assert.strictEqual(secondClient, firstClient);

    const btcPromise = firstClient.requestKlines('BTCUSDT');
    const aptPromise = secondClient.requestKlines('APTUSDT');

    assert.equal(MockWsApiSocket.instances.length, 1);
    const socket = MockWsApiSocket.instances[0];
    assert.equal(socket.url, 'wss://ws-api.binance.com:443/ws-api/v3');
    socket.open();
    await nextTurn();

    assert.equal(socket.sent.length, 2);
    assert.notEqual(socket.sent[0].id, socket.sent[1].id);
    assert.deepEqual(socket.sent.map(({ method, params }) => ({ method, params })), [
      { method: 'klines', params: { symbol: 'BTCUSDT', interval: '1d', limit: 1000 } },
      { method: 'klines', params: { symbol: 'APTUSDT', interval: '1d', limit: 1000 } }
    ]);

    const [btcRequest, aptRequest] = socket.sent;
    const btcRows = [rawKline('2026-08-28', 110)];
    const aptRows = [rawKline('2026-08-28', 9)];
    socket.respond({ id: aptRequest.id, status: 200, result: aptRows });
    socket.respond({ id: btcRequest.id, status: 200, result: btcRows });

    assert.deepEqual(await btcPromise, btcRows);
    assert.deepEqual(await aptPromise, aptRows);
    assert.equal(firstClient.getPendingCount(), 0);
    assert.equal(firstClient.getConnectionState(), 'CONNECTED');
  });

  it('times out one pending request and removes it without closing the shared connection', async () => {
    const client = createBinanceWsApiClient({
      WebSocket: MockWsApiSocket,
      requestTimeoutMs: 15,
      closeWhenIdle: false,
      silent: true
    });
    const request = client.requestKlines('BTCUSDT');
    MockWsApiSocket.instances[0].open();
    await nextTurn();
    assert.equal(client.getPendingCount(), 1);

    await assert.rejects(
      request,
      (error) => error.code === 'PROVIDER_TIMEOUT' && error.status === 504
    );
    assert.equal(client.getPendingCount(), 0);
    assert.equal(client.getConnectionState(), 'CONNECTED');
    client.destroy();
  });

  it('rejects in-flight work on disconnect and reconnects with bounded backoff without replaying it', async () => {
    const client = createBinanceWsApiClient({
      WebSocket: MockWsApiSocket,
      requestTimeoutMs: 100,
      reconnectBaseMs: 1,
      reconnectMaxMs: 1,
      randomFn: () => 0.5,
      closeWhenIdle: false,
      silent: true
    });

    const firstRequest = client.requestKlines('BTCUSDT');
    const firstSocket = MockWsApiSocket.instances[0];
    firstSocket.open();
    await nextTurn();
    assert.equal(firstSocket.sent.length, 1);
    firstSocket.serverClose();

    await assert.rejects(
      firstRequest,
      (error) => error.code === 'PROVIDER_UNAVAILABLE' && error.status === 503
    );
    assert.equal(firstSocket.sent.length, 1, 'The interrupted request must not be replayed');
    assert.equal(client.getPendingCount(), 0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(MockWsApiSocket.instances.length, 2);
    const secondSocket = MockWsApiSocket.instances[1];
    secondSocket.open();

    const secondRequest = client.requestKlines('APTUSDT');
    await nextTurn();
    assert.equal(secondSocket.sent.length, 1);
    secondSocket.respond({
      id: secondSocket.sent[0].id,
      status: 200,
      result: [rawKline('2026-08-28', 9)]
    });
    assert.equal((await secondRequest).length, 1);
    client.destroy();
  });

  it('maps a Binance rate-limit response to a safe typed error', async () => {
    const client = createBinanceWsApiClient({
      WebSocket: MockWsApiSocket,
      requestTimeoutMs: 100,
      closeWhenIdle: false,
      silent: true
    });
    const request = client.requestKlines('BTCUSDT');
    const socket = MockWsApiSocket.instances[0];
    socket.open();
    await nextTurn();
    socket.respond({
      id: socket.sent[0].id,
      status: 429,
      retryAfter: Date.now() + 1_000,
      error: { code: -1003, msg: 'raw upstream detail must not escape' }
    });

    await assert.rejects(
      request,
      (error) =>
        error.code === 'PROVIDER_RATE_LIMITED' &&
        error.status === 503 &&
        !error.message.includes('raw upstream')
    );
    client.destroy();
  });

  it('supports deterministic idle shutdown without reconnecting after the last test request', async () => {
    const client = createBinanceWsApiClient({
      WebSocket: MockWsApiSocket,
      requestTimeoutMs: 100,
      closeWhenIdle: true,
      silent: true
    });
    const request = client.requestKlines('BTCUSDT');
    const socket = MockWsApiSocket.instances[0];
    socket.open();
    await nextTurn();
    socket.respond({
      id: socket.sent[0].id,
      status: 200,
      result: [rawKline('2026-08-28', 110)]
    });

    assert.equal((await request).length, 1);
    assert.equal(socket.closed, true);
    assert.equal(client.getConnectionState(), 'DISCONNECTED');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(MockWsApiSocket.instances.length, 1);
    client.destroy();
  });

  it('routes getHistory exclusively through WS API while preserving completed UTC normalization', async () => {
    let wsRequestCount = 0;
    let restRequestCount = 0;
    const wsApiClient = {
      requestKlines: async (symbol) => {
        wsRequestCount += 1;
        assert.equal(symbol, 'BTCUSDT');
        return [
          rawKline('2026-08-28', 110),
          rawKline('2026-08-29', 120)
        ];
      }
    };
    const asset = {
      id: '1aca9503-acf1-4450-9b75-4f8935324398',
      symbol: 'BTC',
      marketPolicy: 'CONTINUOUS_24_7',
      marketTimezone: 'UTC'
    };
    const mapping = { provider: 'binance', providerSymbol: 'BTCUSDT' };

    const history = await getHistory(asset, mapping, {
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      cache: new BinanceHistoryCache(),
      circuitBreaker: new CircuitBreaker(),
      wsApiClient,
      fetchFn: async () => {
        restRequestCount += 1;
        throw new Error('REST history must never run');
      }
    });

    assert.equal(wsRequestCount, 1);
    assert.equal(restRequestCount, 0);
    assert.deepEqual(history.bars.map((bar) => bar.date), ['2026-08-28']);
    assert.equal(history.quoteCurrency, 'USDT');
    assert.deepEqual(history.historyCapabilities, { close: true, ohlc: true, volume: true });
  });

  it('serves production history and Analysis V2 from the same normalized cache entry', async () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const start = new Date('2025-08-30T00:00:00.000Z');
    const rows = [];
    for (let index = 0; index <= 365; index += 1) {
      const date = new Date(start.getTime() + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      rows.push(rawKline(date, 100.125 + index * 0.25));
    }

    let wsRequestCount = 0;
    const wsApiClient = {
      requestKlines: async () => {
        wsRequestCount += 1;
        return rows;
      }
    };
    const cache = new BinanceHistoryCache();
    const circuitBreaker = new CircuitBreaker();
    const asset = {
      id: '1aca9503-acf1-4450-9b75-4f8935324398',
      symbol: 'BTC',
      assetType: 'crypto',
      quoteCurrency: 'USD',
      marketPolicy: 'CONTINUOUS_24_7',
      marketTimezone: 'UTC'
    };
    const mapping = {
      provider: 'binance',
      providerSymbol: 'BTCUSDT',
      providerMarket: 'SPOT'
    };
    const resolver = async () => ({ asset, mapping });
    const sharedOptions = {
      now,
      resolveProviderMappingFn: resolver,
      providerAdapter: binanceProvider,
      cache,
      circuitBreaker,
      wsApiClient
    };

    const history = await getMarketHistory('BTC', '1Y', sharedOptions);
    const analysis = await getAssetAnalysis('BTC', {
      now,
      getMarketHistoryFn: (symbol, range, { now: analysisNow }) =>
        getMarketHistory(symbol, range, { ...sharedOptions, now: analysisNow }),
      getMarketSnapshotFn: async () => ({
        symbol: 'BTC',
        currency: 'USD',
        price: 999,
        analysisEligible: false
      })
    });

    assert.equal(wsRequestCount, 1);
    assert.equal(history.bars.at(-1).date, '2026-08-29');
    assert.equal(analysis.analysisAsOf, '2026-08-29T00:00:00.000Z');
    assert.equal(analysis.analysisPrice, history.bars.at(-1).close);
    assert.equal(analysis.quoteCurrency, 'USDT');
  });
});
