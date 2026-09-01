import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAssetAnalysis } from '../src/analysis.js';
import { getMarketHistory, getMarketSnapshot } from '../src/market.js';
import {
  ALPHA_VANTAGE_CACHE_POLICY,
  alphavantageProvider,
  createAlphaVantageRequestCache
} from '../src/providers/alphavantage.js';

const GOLD_ASSET = Object.freeze({
  id: 'asset-gold',
  symbol: 'XAU/USD',
  assetType: 'gold',
  quoteCurrency: 'USD',
  marketPolicy: 'GLOBAL_24_5',
  marketTimezone: 'UTC'
});
const GOLD_MAPPING = Object.freeze({ provider: 'alphavantage', providerSymbol: 'XAU' });
const NOW = new Date('2026-09-01T12:00:00.000Z');
const CACHE_NOW_MS = NOW.getTime();

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

function snapshotBody(price = '2512.45000000') {
  return {
    nominal: 'XAUUSD',
    timestamp: '2026-09-01 10:00:00',
    price
  };
}

function historyBody(count = 280) {
  const endMs = Date.parse('2026-08-31T00:00:00.000Z');
  const data = [];
  let cursor = endMs;
  while (data.length < count) {
    const date = new Date(cursor);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      data.push({
        date: date.toISOString().slice(0, 10),
        price: String(2200.123456 + data.length)
      });
    }
    cursor -= 24 * 60 * 60 * 1000;
  }
  return { data };
}

describe('V1.1 Improvement 03 — Alpha Vantage Gold reliability', () => {
  test('coalesces concurrent Gold snapshot requests into one upstream call', async () => {
    const cache = createAlphaVantageRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse(snapshotBody());
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn };

    const [first, second, third] = await Promise.all([
      alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, options),
      alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, options),
      alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, options)
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(first.price, 2512.45);
    assert.equal(first.currency, 'USD');
    assert.equal(first.cacheStatus, 'fresh');
  });

  test('shares one raw daily history acquisition across ranges while snapshot remains a separate endpoint', async () => {
    const cache = createAlphaVantageRequestCache();
    const calls = { snapshot: 0, history: 0 };
    const fetchFn = async (url) => {
      const fn = new URL(url).searchParams.get('function');
      if (fn === 'GOLD_SILVER_SPOT') {
        calls.snapshot += 1;
        return mockResponse(snapshotBody());
      }
      calls.history += 1;
      return mockResponse(historyBody());
    };
    const options = { cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn, now: NOW };

    const [snapshotA, snapshotB, oneMonth, oneYear] = await Promise.all([
      alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, options),
      alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, options),
      alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, { ...options, range: '1M' }),
      alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, { ...options, range: '1Y' })
    ]);

    assert.deepEqual(calls, { snapshot: 1, history: 1 });
    assert.equal(snapshotA.price, snapshotB.price);
    assert.equal(oneMonth.range, '1M');
    assert.equal(oneYear.range, '1Y');
    assert.equal(oneMonth.historyCapabilities.ohlc, false);
    assert.equal(oneYear.historyCapabilities.volume, false);
  });

  test('production market and Analysis V2 paths share the same two Gold acquisitions', async () => {
    const cache = createAlphaVantageRequestCache();
    const calls = { snapshot: 0, history: 0 };
    const fetchFn = async (url) => {
      const fn = new URL(url).searchParams.get('function');
      if (fn === 'GOLD_SILVER_SPOT') {
        calls.snapshot += 1;
        return mockResponse(snapshotBody());
      }
      calls.history += 1;
      return mockResponse(historyBody());
    };
    const providerOptions = {
      cache,
      cacheNowMs: CACHE_NOW_MS,
      apiKey: 'test-key',
      fetchFn,
      now: NOW,
      resolveProviderMappingFn: async () => ({ asset: GOLD_ASSET, mapping: GOLD_MAPPING }),
      providerAdapter: alphavantageProvider
    };
    const snapshotFn = (symbol) => getMarketSnapshot(symbol, providerOptions);
    const historyFn = (symbol, range, options = {}) => getMarketHistory(symbol, range, {
      ...providerOptions,
      ...options,
      cache,
      cacheNowMs: CACHE_NOW_MS,
      fetchFn,
      apiKey: 'test-key',
      resolveProviderMappingFn: providerOptions.resolveProviderMappingFn,
      providerAdapter: alphavantageProvider
    });

    const [snapshot, history, analysis] = await Promise.all([
      snapshotFn('XAU/USD'),
      historyFn('XAU/USD', '1M'),
      getAssetAnalysis('XAU/USD', {
        now: NOW,
        range: '1Y',
        getMarketSnapshotFn: snapshotFn,
        getMarketHistoryFn: historyFn
      })
    ]);

    assert.deepEqual(calls, { snapshot: 1, history: 1 });
    assert.equal(snapshot.provider, 'alphavantage');
    assert.equal(history.provider, 'alphavantage');
    assert.equal(analysis.methodologyVersion, 'v2');
    assert.equal(analysis.symbol, 'XAU/USD');
    assert.equal(analysis.historyCapabilities.ohlc, false);
    assert.equal(analysis.periods['1Y'].maxDrawdownPct !== null, true);
  });

  test('serves a snapshot cache hit and refreshes only after the two-hour TTL', async () => {
    const cache = createAlphaVantageRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse(snapshotBody(String(2500 + calls)));
    };

    const first = await alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
      cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn
    });
    const hit = await alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS + ALPHA_VANTAGE_CACHE_POLICY.snapshotFreshMs - 1,
      apiKey: 'test-key',
      fetchFn
    });
    const refreshed = await alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
      cache,
      cacheNowMs: CACHE_NOW_MS + ALPHA_VANTAGE_CACHE_POLICY.snapshotFreshMs + 1,
      apiKey: 'test-key',
      fetchFn
    });

    assert.equal(calls, 2);
    assert.equal(first.price, 2501);
    assert.equal(hit.price, 2501);
    assert.equal(refreshed.price, 2502);
  });

  test('turns HTTP and payload quota responses into one shared controlled cooldown', async () => {
    const cache = createAlphaVantageRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse({}, 429, { 'retry-after': '30' });
    };

    await assert.rejects(
      () => alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
        cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn
      }),
      (error) => error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );
    await assert.rejects(
      () => alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, {
        cache,
        cacheNowMs: CACHE_NOW_MS + 1000,
        apiKey: 'test-key',
        fetchFn,
        now: NOW,
        range: '1M'
      }),
      (error) => error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );
    assert.equal(calls, 1);

    const payloadCache = createAlphaVantageRequestCache();
    await assert.rejects(
      () => alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
        cache: payloadCache,
        cacheNowMs: CACHE_NOW_MS,
        apiKey: 'test-key',
        fetchFn: async () => mockResponse({ Note: 'API call frequency limit reached' })
      }),
      (error) => error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );
  });

  test('rejects malformed snapshot and history payloads without creating values or bars', async () => {
    await assert.rejects(
      () => alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
        cache: null,
        apiKey: 'test-key',
        fetchFn: async () => mockResponse({ price: 'not-a-price', timestamp: 'invalid' })
      }),
      (error) => error.status === 502 && error.code === 'MALFORMED_PROVIDER_RESPONSE'
    );
    await assert.rejects(
      () => alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, {
        cache: null,
        apiKey: 'test-key',
        fetchFn: async () => mockResponse({ data: 'not-an-array' }),
        now: NOW,
        range: '1M'
      }),
      (error) => error.status === 502 && error.code === 'MALFORMED_PROVIDER_RESPONSE'
    );
  });

  test('aborts a bounded timeout with a sanitized provider timeout error', async () => {
    const fetchFn = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('upstream details must not escape');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });

    await assert.rejects(
      () => alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
        cache: null,
        apiKey: 'test-key',
        fetchFn,
        timeoutMs: 10
      }),
      (error) => error.status === 504 && error.code === 'PROVIDER_TIMEOUT'
    );
  });

  test('serves bounded snapshot last-good data only with explicit age and preserved timestamps', async () => {
    const cache = createAlphaVantageRequestCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return calls === 1
        ? mockResponse(snapshotBody('2512.45'))
        : mockResponse({ Information: 'rate limit reached' });
    };

    const first = await alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
      cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn
    });
    const staleAt = CACHE_NOW_MS + ALPHA_VANTAGE_CACHE_POLICY.snapshotFreshMs + 1;
    const stale = await alphavantageProvider.getSnapshot(GOLD_ASSET, GOLD_MAPPING, {
      cache, cacheNowMs: staleAt, apiKey: 'test-key', fetchFn
    });

    assert.equal(calls, 2);
    assert.equal(stale.price, first.price);
    assert.equal(stale.priceAsOf, first.priceAsOf);
    assert.equal(stale.cachedAt, first.cachedAt);
    assert.equal(stale.freshness, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.equal(stale.cacheAgeMs, ALPHA_VANTAGE_CACHE_POLICY.snapshotFreshMs + 1);
  });

  test('serves validated completed history as stale without fabricating or shifting bars', async () => {
    const cache = createAlphaVantageRequestCache();
    let calls = 0;
    const providerHistory = historyBody();
    providerHistory.data.unshift({ date: '2026-09-01', price: '9999.99' });
    const fetchFn = async () => {
      calls += 1;
      return calls === 1
        ? mockResponse(providerHistory)
        : mockResponse({ Note: 'daily quota limit reached' });
    };

    const first = await alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, {
      cache, cacheNowMs: CACHE_NOW_MS, apiKey: 'test-key', fetchFn, now: NOW, range: '1M'
    });
    const nextDay = new Date('2026-09-02T00:01:00.000Z');
    const stale = await alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, {
      cache,
      cacheNowMs: nextDay.getTime(),
      apiKey: 'test-key',
      fetchFn,
      now: nextDay,
      range: '1M'
    });

    assert.equal(calls, 2);
    assert.deepEqual(stale.bars, first.bars);
    assert.equal(stale.updatedAt, first.updatedAt);
    assert.equal(stale.dataAsOf, first.dataAsOf);
    assert.equal(stale.freshness, 'stale');
    assert.equal(stale.cacheStatus, 'stale');
    assert.equal(stale.staleReason, 'PROVIDER_RATE_LIMITED');
    assert.ok(stale.warnings.some((warning) => warning.code === 'STALE_PROVIDER_DATA'));
    assert.equal(stale.bars.some((bar) => bar.date === '2026-09-01'), false);
  });

  test('returns unavailable history on quota without last-good data and never emits a fake bar', async () => {
    let upstreamResult;
    try {
      upstreamResult = await alphavantageProvider.getHistory(GOLD_ASSET, GOLD_MAPPING, {
        cache: createAlphaVantageRequestCache(),
        cacheNowMs: CACHE_NOW_MS,
        apiKey: 'test-key',
        fetchFn: async () => mockResponse({ Note: 'daily quota limit reached' }),
        now: NOW,
        range: '1M'
      });
      assert.fail('quota-limited history without last-good data must reject');
    } catch (error) {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'PROVIDER_RATE_LIMITED');
    }
    assert.equal(upstreamResult, undefined);
  });

  test('rejects missing or proxy instrument mappings before any provider request', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return mockResponse(snapshotBody());
    };

    for (const providerSymbol of [undefined, 'GC=F', 'GLD', 'XAUUSD']) {
      await assert.rejects(
        () => alphavantageProvider.getSnapshot(
          GOLD_ASSET,
          { provider: 'alphavantage', providerSymbol },
          { cache: null, apiKey: 'test-key', fetchFn }
        ),
        (error) => error.status === 422 && error.code === 'UNSUPPORTED_PROVIDER'
      );
    }
    assert.equal(calls, 0);
  });
});
