import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getAssetAnalysis } from '../src/analysis.js';
import { getMarketHistory, getMarketSnapshot } from '../src/market.js';
import { getPortfolioOverview } from '../src/portfolio.js';
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
const ETH_ASSET = Object.freeze({ ...BTC_ASSET, id: 'asset-eth', symbol: 'ETH' });
const ETH_MAPPING = Object.freeze({ provider: 'coingecko', providerSymbol: 'ethereum' });
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

  test('A2. concurrent different assets share one official multi-ID snapshot request', async () => {
    const cache = createCoinGeckoRequestCache();
    const requestedIds = [];
    let calls = 0;
    const fetchFn = async (url) => {
      calls += 1;
      requestedIds.push(new URL(url).searchParams.get('ids').split(',').sort());
      return mockResponse({
        ...snapshotBody('bitcoin', 64250.5),
        ...snapshotBody('ethereum', 3520.25)
      });
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    const [bitcoin, ethereum] = await Promise.all([
      coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options),
      coingeckoProvider.getSnapshot(ETH_ASSET, ETH_MAPPING, options)
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(requestedIds, [['bitcoin', 'ethereum']]);
    assert.equal(bitcoin.price, 64250.5);
    assert.equal(ethereum.price, 3520.25);
    assert.equal(bitcoin.currency, 'USD');
    assert.equal(ethereum.currency, 'USD');
    assert.equal(bitcoin.cacheStatus, 'fresh');
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
    await new Promise((resolve) => setTimeout(
      resolve,
      COINGECKO_CACHE_POLICY.snapshotBatchWindowMs + 5
    ));
    assert.equal(calls, 1);
    release();

    const [left, right] = await Promise.all([first, second]);
    assert.deepEqual(left, right);
  });

  test('B2. cache expiry refreshes once while an unexpired hit stays local', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse(snapshotBody('bitcoin', 64000 + calls));
    };

    const first = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key'
    });
    const hit = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS + COINGECKO_CACHE_POLICY.snapshotFreshMs - 1,
      fetchFn,
      apiKey: 'test-key'
    });
    const refreshed = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS + COINGECKO_CACHE_POLICY.snapshotFreshMs + 1,
      fetchFn,
      apiKey: 'test-key'
    });

    assert.equal(calls, 2);
    assert.equal(first.price, 64001);
    assert.equal(hit.price, 64001);
    assert.equal(refreshed.price, 64002);
  });

  test('B3. a partial batch resolves valid assets and never fabricates a missing quote', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse(snapshotBody('bitcoin', 64250.5));
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    const [bitcoin, ethereum] = await Promise.allSettled([
      coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options),
      coingeckoProvider.getSnapshot(ETH_ASSET, ETH_MAPPING, options)
    ]);

    assert.equal(calls, 1);
    assert.equal(bitcoin.status, 'fulfilled');
    assert.equal(bitcoin.value.price, 64250.5);
    assert.equal(ethereum.status, 'rejected');
    assert.equal(ethereum.reason.status, 502);
    assert.equal(ethereum.reason.code, 'PARTIAL_PROVIDER_RESPONSE');
    assert.equal(ethereum.reason.price, undefined);
  });

  test('B4. malformed batch payloads fail safely and do not populate the cache', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return calls === 1
        ? mockResponse([])
        : mockResponse(snapshotBody('bitcoin', 64250.5));
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, fetchFn, apiKey: 'test-key' };

    await assert.rejects(
      () => coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options),
      (error) => error.status === 502 && error.code === 'MALFORMED_PROVIDER_RESPONSE'
    );
    const recovered = await coingeckoProvider.getSnapshot(BTC_ASSET, BTC_MAPPING, options);

    assert.equal(calls, 2);
    assert.equal(recovered.price, 64250.5);
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

  test('D–E. production history rejects the CoinGecko valuation-only adapter before any request', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return historyResponse();
    };
    const baseOptions = {
      fetchFn,
      apiKey: 'test-key',
      resolveProviderMappingFn: async () => ({ asset: BTC_ASSET, mapping: BTC_MAPPING }),
      getProviderAdapterFn: () => coingeckoProvider
    };

    await assert.rejects(
      () => getMarketHistory('BTC', '1M', { ...baseOptions, now: NOW }),
      (error) => error.status === 422 && error.code === 'UNSUPPORTED_HISTORY'
    );
    assert.equal(calls, 0);
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
    const staleRoute = await requestApp(createApp({
      getMarketSnapshotFn: () => getMarketSnapshot('BTC', {
        cache,
        cacheNowMs: staleAt + 2000,
        fetchFn,
        apiKey: 'test-key',
        resolveProviderMappingFn: async () => ({ asset: BTC_ASSET, mapping: BTC_MAPPING }),
        providerAdapter: coingeckoProvider
      })
    }), '/api/market/BTC');

    assert.equal(first.price, 1.0042);
    assert.equal(stale.price, first.price);
    assert.equal(stale.priceAsOf, first.priceAsOf);
    assert.equal(stale.freshness, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.equal(stale.cachedAt, new Date(CACHE_NOW_MS).toISOString());
    assert.equal(stale.cacheAgeMs, COINGECKO_CACHE_POLICY.snapshotFreshMs + 1);
    assert.equal(cooledDown.price, stale.price);
    assert.equal(cooledDown.priceAsOf, stale.priceAsOf);
    assert.equal(cooledDown.cacheStatus, 'stale');
    assert.equal(cooledDown.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.equal(cooledDown.cacheAgeMs, stale.cacheAgeMs + 1000);
    assert.equal(staleRoute.status, 200);
    assert.equal(staleRoute.body.data.freshness, 'stale');
    assert.equal(staleRoute.body.data.cacheStatus, 'stale');
    assert.equal(staleRoute.body.data.priceAsOf, first.priceAsOf);
    assert.equal(staleRoute.body.data.cachedAt, first.cachedAt);
    assert.equal(staleRoute.body.data.cacheAgeMs, stale.cacheAgeMs + 2000);
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

  test('F, H–J. no cached snapshot data yields controlled 503 and CoinGecko cannot enter analysis', async () => {
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

    assert.equal(analysisRoute.status, 422);
    assert.equal(analysisRoute.body.code, 'UNSUPPORTED_HISTORY');
    assert.equal(analysisRoute.body.data, undefined);
  });

  test('J2. portfolio consumers share the canonical batched USD snapshot path without USDT substitution', async () => {
    const cache = createCoinGeckoRequestCache();
    let calls = 0;
    let requestedUrl;
    const fetchFn = async (url) => {
      calls += 1;
      requestedUrl = new URL(url);
      return mockResponse({
        ...snapshotBody('bitcoin', 64000),
        ...snapshotBody('ethereum', 3200)
      });
    };
    const resolutions = {
      BTC: { asset: BTC_ASSET, mapping: BTC_MAPPING },
      ETH: { asset: ETH_ASSET, mapping: ETH_MAPPING }
    };
    const holdings = [
      {
        id: 'holding-btc',
        asset_id: BTC_ASSET.id,
        quantity: 1,
        average_cost: 60000,
        asset: {
          id: BTC_ASSET.id,
          symbol: 'BTC',
          name: 'Bitcoin',
          asset_type: 'crypto',
          quote_currency: 'USD'
        }
      },
      {
        id: 'holding-eth',
        asset_id: ETH_ASSET.id,
        quantity: 2,
        average_cost: 3000,
        asset: {
          id: ETH_ASSET.id,
          symbol: 'ETH',
          name: 'Ethereum',
          asset_type: 'crypto',
          quote_currency: 'USD'
        }
      }
    ];

    const overview = await getPortfolioOverview({
      getCashOverviewFn: async () => ({ currentCash: 0 }),
      getHoldingsFn: async () => holdings,
      getMarketSnapshotFn: (symbol) => getMarketSnapshot(symbol, {
        cache,
        cacheNowMs: CACHE_NOW_MS,
        fetchFn,
        apiKey: 'test-key',
        resolveProviderMappingFn: async () => resolutions[symbol],
        providerAdapter: coingeckoProvider
      }),
      getFxRateFn: async () => ({
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        rate: 26000,
        provider: 'fixture_fx',
        sourceTimestamp: NOW.toISOString(),
        availability: 'available',
        freshness: 'delayed',
        reason: null
      })
    });

    assert.equal(calls, 1);
    assert.deepEqual(requestedUrl.searchParams.get('ids').split(',').sort(), ['bitcoin', 'ethereum']);
    assert.equal(requestedUrl.searchParams.get('vs_currencies'), 'usd');
    assert.doesNotMatch(requestedUrl.toString(), /usdt/i);
    assert.equal(overview.holdings[0].nativeCurrency, 'USD');
    assert.equal(overview.holdings[1].nativeCurrency, 'USD');
    assert.equal(overview.holdings[0].latestPrice, 64000);
    assert.equal(overview.holdings[1].latestPrice, 3200);
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
