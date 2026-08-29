import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getAssetAnalysis } from '../src/analysis.js';
import { getMarketHistory } from '../src/market.js';
import {
  COINGECKO_CACHE_POLICY,
  coingeckoProvider,
  createCoinGeckoRequestCache
} from '../src/providers/coingecko.js';
import { createApp } from '../index.js';

const BTC_ASSET = Object.freeze({
  id: 'asset-btc',
  symbol: 'BTC',
  assetType: 'crypto',
  quoteCurrency: 'USD',
  marketPolicy: 'CONTINUOUS_24_7',
  marketTimezone: 'UTC'
});

const BTC_MAPPING = Object.freeze({ provider: 'coingecko', providerSymbol: 'bitcoin' });
const NOW = new Date('2026-08-29T12:00:00.000Z');
const CACHE_NOW_MS = Date.parse('2026-08-29T12:00:00.000Z');

function mockResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      }
    },
    json: async () => body
  };
}

function snapshotBody(coinId = 'bitcoin', price = 64250.5) {
  return {
    [coinId]: {
      usd: price,
      usd_24h_vol: 28500000000,
      usd_24h_change: 0.32,
      last_updated_at: 1788000000
    }
  };
}

function dailyPrices(startDate = '2025-08-29', count = 366) {
  const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => [
    startMs + (index * 86400000),
    100.123456 + index
  ]);
}

function historyResponse() {
  return mockResponse({
    prices: dailyPrices(),
    market_caps: [],
    total_volumes: []
  });
}

async function requestApp(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Feature 24A CoinGecko runtime resilience', () => {
  test('A. repeated snapshot requests within the five-minute display refresh window make one upstream call', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return mockResponse(snapshotBody());
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    const first = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);
    const second = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);

    assert.equal(calls, 1);
    assert.equal(first.price, 64250.5);
    assert.deepEqual(second, first);
    assert.equal(COINGECKO_CACHE_POLICY.snapshotFreshMs, 5 * 60 * 1000);
  });

  test('B. concurrent snapshot requests for the same canonical CoinGecko ID coalesce', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchFn = async () => {
      calls++;
      await gate;
      return mockResponse(snapshotBody());
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    const first = coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);
    const second = coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();

    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
  });

  test('C. one public-plan-safe daily superset serves repeated 1M and 1Y history requests', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    let requestedUrl;
    const fetchFn = async (url) => {
      calls++;
      requestedUrl = new URL(url);
      return historyResponse();
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key', now: NOW };

    const oneMonth = await coingeckoProvider.getHistory(BTC_ASSET, BTC_MAPPING, { ...options, range: '1M' });
    const oneYear = await coingeckoProvider.getHistory(BTC_ASSET, BTC_MAPPING, { ...options, range: '1Y' });

    const requestedSeconds = Number(requestedUrl.searchParams.get('to')) - Number(requestedUrl.searchParams.get('from'));
    assert.equal(calls, 1);
    assert.equal(requestedUrl.searchParams.get('interval'), 'daily');
    assert.ok(requestedSeconds <= COINGECKO_CACHE_POLICY.publicHistoryLookbackDays * 86400);
    assert.equal(oneMonth.range, '1M');
    assert.equal(oneYear.range, '1Y');
    assert.equal(oneYear.dataCompleteness, 'partial');
    assert.ok(oneYear.warnings.some((warning) => warning.code === 'PARTIAL_HISTORY_COVERAGE'));
  });

  test('D–E. concurrent detail history and production analysis reuse one CoinGecko history request', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchFn = async () => {
      calls++;
      await gate;
      return historyResponse();
    };
    const baseOptions = {
      cache,
      cacheNowMs: CACHE_NOW_MS,
      fetchFn,
      apiKey: 'test-key',
      resolveProviderMappingFn: async () => ({ asset: BTC_ASSET, mapping: BTC_MAPPING }),
      getProviderAdapterFn: () => coingeckoProvider
    };

    const detailHistory = getMarketHistory('BTC', '1M', { ...baseOptions, now: NOW });
    const analysis = getAssetAnalysis('BTC', {
      now: NOW,
      getMarketHistoryFn: (symbol, range, options) => getMarketHistory(symbol, range, {
        ...baseOptions,
        ...options
      }),
      getMarketSnapshotFn: async () => ({
        symbol: 'BTC',
        price: 999,
        priceAsOf: '2026-08-29T11:00:00.000Z',
        freshness: 'delayed',
        priceSource: 'fixture'
      })
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    const [history, result] = await Promise.all([detailHistory, analysis]);

    assert.equal(calls, 1);
    assert.equal(history.range, '1M');
    assert.equal(result.symbol, 'BTC');
    assert.equal(result.analysisPrice, historyResponsePriceAt('2026-08-28'));
  });

  test('F–I. a limited snapshot uses valid stale data explicitly, then observes cooldown without inventing a price', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return calls === 1
        ? mockResponse(snapshotBody('bitcoin', 1.0042))
        : mockResponse({}, 429);
    };

    const first = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS,
      fetchFn,
      apiKey: 'test-key'
    });
    const staleAt = CACHE_NOW_MS + COINGECKO_CACHE_POLICY.snapshotFreshMs + 1;
    const stale = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: staleAt,
      fetchFn,
      apiKey: 'test-key'
    });
    const cooledDown = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: staleAt + 1000,
      fetchFn,
      apiKey: 'test-key'
    });

    assert.equal(first.price, 1.0042);
    assert.equal(stale.price, first.price);
    assert.equal(stale.priceAsOf, first.priceAsOf);
    assert.equal(stale.freshness, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.deepEqual(cooledDown, stale);
    assert.equal(calls, 2);
  });

  test('G. completed history may fall back to stale only with preserved timestamps and explicit stale metadata', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return calls === 1 ? historyResponse() : mockResponse({}, 429);
    };

    const first = await coingeckoProvider.getHistory(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS,
      fetchFn,
      apiKey: 'test-key',
      now: NOW,
      range: '1M'
    });
    const stale = await coingeckoProvider.getHistory(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: Date.parse('2026-08-30T00:01:00.000Z'),
      fetchFn,
      apiKey: 'test-key',
      now: new Date('2026-08-30T00:01:00.000Z'),
      range: '1M'
    });

    assert.equal(calls, 2);
    assert.equal(stale.freshness, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.equal(stale.updatedAt, first.updatedAt);
    assert.equal(stale.dataAsOf, first.dataAsOf);
    assert.ok(stale.warnings.some((warning) => warning.code === 'STALE_PROVIDER_DATA'));
  });

  test('F, H–J. no cached provider data yields controlled 503 responses and never fake snapshot or analysis data', async () => {
    const snapshotCache = createCoinGeckoRequestCache();
    let snapshotCalls = 0;
    const limitedSnapshot = () => coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache: snapshotCache,
      cacheNowMs: CACHE_NOW_MS,
      apiKey: 'test-key',
      fetchFn: async () => {
        snapshotCalls++;
        return mockResponse({}, 429);
      }
    });

    await assert.rejects(limitedSnapshot, (error) =>
      error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );
    await assert.rejects(limitedSnapshot, (error) =>
      error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );
    assert.equal(snapshotCalls, 1);

    const snapshotRoute = await requestApp(createApp({
      getMarketSnapshotFn: limitedSnapshot
    }), '/api/market/BTC');
    assert.equal(snapshotRoute.status, 503);
    assert.equal(snapshotRoute.body.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(snapshotRoute.body.data, undefined);

    const historyCache = createCoinGeckoRequestCache();
    const limitedHistory = (_symbol, range, options) => getMarketHistory('BTC', range, {
      ...options,
      cache: historyCache,
      cacheNowMs: CACHE_NOW_MS,
      apiKey: 'test-key',
      fetchFn: async () => mockResponse({}, 429),
      resolveProviderMappingFn: async () => ({ asset: BTC_ASSET, mapping: BTC_MAPPING }),
      getProviderAdapterFn: () => coingeckoProvider
    });
    const analysisRoute = await requestApp(createApp({
      getAssetAnalysisFn: (symbol, options) => getAssetAnalysis(symbol, {
        ...options,
        now: NOW,
        getMarketHistoryFn: limitedHistory,
        getMarketSnapshotFn: async () => ({ price: 1 })
      })
    }), '/api/analysis/BTC');

    assert.equal(analysisRoute.status, 503);
    assert.equal(analysisRoute.body.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(analysisRoute.body.data, undefined);
  });

  test('K–M. cache keys isolate crypto assets and all probes remain mocked and read-only', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async (url) => {
      calls++;
      const coinId = new URL(url).searchParams.get('ids');
      return mockResponse(snapshotBody(coinId, coinId === 'bitcoin' ? 64000 : 3200));
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    const bitcoin = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);
    const ethereum = await coingeckoProvider.getSnapshot(
      { ...BTC_ASSET, id: 'asset-eth', symbol: 'ETH' },
      { provider: 'coingecko', providerSymbol: 'ethereum' },
      options
    );
    await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);

    assert.equal(calls, 2);
    assert.equal(bitcoin.price, 64000);
    assert.equal(ethereum.price, 3200);
  });
});

function historyResponsePriceAt(date) {
  const index = Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse('2025-08-29T00:00:00.000Z')) / 86400000);
  return 100.123456 + index;
}
