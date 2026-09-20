import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildPortfolioSummaryDisplay } from '../../client/src/utils/portfolioSnapshotDisplay.js';
import { getFxRate } from '../src/fx.js';
import { calculatePortfolioValuation } from '../src/portfolio.js';
import { buildPortfolioSnapshot } from '../src/portfolioSnapshot.js';
import {
  COINMARKETCAP_CURRENT_RATE_CONTRACT,
  createCoinMarketCapCurrentRateCache,
  getCoinMarketCapCurrentUsdtVndRate
} from '../src/providers/coinmarketcap.js';

const NOW = '2026-09-20T03:00:00.000Z';
const FAKE_API_KEY = 'fake-coinmarketcap-key-for-tests-only';

function response({ status = 200, data, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'retry-after' ? retryAfter : null;
      }
    },
    async json() {
      return data;
    }
  };
}

function fiatPayload({ includeVnd = true } = {}) {
  return {
    data: includeVnd
      ? [{ id: 9999, name: 'Vietnamese Dong', sign: '₫', symbol: 'VND' }]
      : [{ id: 2781, name: 'United States Dollar', sign: '$', symbol: 'USD' }],
    status: { timestamp: NOW, error_code: 0, error_message: '' }
  };
}

function conversionPayload(overrides = {}) {
  const sourceLastUpdated = overrides.sourceLastUpdated ?? NOW;
  const quoteLastUpdated = overrides.quoteLastUpdated ?? NOW;
  const quoteCurrency = overrides.quoteCurrency ?? 'VND';
  return {
    data: {
      id: overrides.id ?? 825,
      symbol: overrides.symbol ?? 'USDT',
      name: overrides.name ?? 'Tether USDt',
      amount: overrides.amount ?? 1,
      last_updated: sourceLastUpdated,
      quote: {
        [quoteCurrency]: {
          price: overrides.rate ?? 25_000,
          last_updated: quoteLastUpdated
        }
      }
    },
    status: { timestamp: NOW, error_code: 0, error_message: '' }
  };
}

function providerFetch({ conversion = conversionPayload(), includeVnd = true, inspect } = {}) {
  return async (requestUrl, options) => {
    const url = new URL(requestUrl);
    inspect?.(url, options);
    if (url.pathname === '/v1/fiat/map') {
      return response({ data: fiatPayload({ includeVnd }) });
    }
    assert.equal(url.pathname, '/v2/tools/price-conversion');
    return response({ data: conversion });
  };
}

function providerOptions(overrides = {}) {
  return {
    apiKey: FAKE_API_KEY,
    now: new Date(NOW),
    cache: null,
    fetchFn: providerFetch(),
    ...overrides
  };
}

describe('CoinMarketCap current USDT/VND valuation provider', () => {
  test('A-D. authenticated direct ID 825 conversion verifies VND and returns positive evidence', async () => {
    const requests = [];
    const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      fetchFn: providerFetch({
        inspect(url, options) {
          requests.push({ url, options });
        }
      })
    }));

    assert.equal(result.availability, 'available');
    assert.equal(result.rate, 25_000);
    assert.equal(result.baseCurrency, 'USDT');
    assert.equal(result.quoteCurrency, 'VND');
    assert.equal(result.provider, 'COINMARKETCAP');
    assert.equal(result.sourceAssetId, 825);
    assert.equal(result.sourceAssetSymbol, 'USDT');
    assert.equal(result.providerTimestamp, NOW);
    assert.equal(result.lastUpdated, NOW);
    assert.equal(result.fetchedAt, NOW);
    assert.deepEqual(COINMARKETCAP_CURRENT_RATE_CONTRACT, {
      provider: 'COINMARKETCAP',
      sourceAssetId: 825,
      baseCurrency: 'USDT',
      quoteCurrency: 'VND'
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, '/v1/fiat/map');
    assert.equal(requests[1].url.searchParams.get('amount'), '1');
    assert.equal(requests[1].url.searchParams.get('id'), '825');
    assert.equal(requests[1].url.searchParams.get('convert'), 'VND');
    assert.equal(requests[1].options.headers['X-CMC_PRO_API_KEY'], FAKE_API_KEY);
    assert.equal(requests.some(({ url }) => url.href.includes(FAKE_API_KEY)), false);
  });

  test('C. missing VND fiat-map support fails closed without substituting USD', async () => {
    let conversionCalls = 0;
    const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      fetchFn: providerFetch({
        includeVnd: false,
        inspect(url) {
          if (url.pathname === '/v2/tools/price-conversion') conversionCalls += 1;
        }
      })
    }));

    assert.equal(result.availability, 'unavailable');
    assert.equal(result.rate, null);
    assert.equal(result.reason, 'FX_QUOTE_CURRENCY_UNSUPPORTED');
    assert.equal(conversionCalls, 0);
  });

  test('D-F. non-positive, non-finite, stale, and malformed responses fail closed', async () => {
    const cases = [
      [conversionPayload({ rate: 0 }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ rate: -1 }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ rate: Number.NaN }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ id: 1 }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ symbol: 'USD' }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ quoteCurrency: 'USD' }), 'MALFORMED_PROVIDER_RESPONSE'],
      [conversionPayload({ quoteLastUpdated: '2026-09-20T02:49:59.999Z' }), 'FX_OBSERVATION_STALE'],
      [conversionPayload({ sourceLastUpdated: 'not-a-time' }), 'MALFORMED_PROVIDER_RESPONSE']
    ];

    for (const [conversion, reason] of cases) {
      const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
        fetchFn: providerFetch({ conversion })
      }));
      assert.equal(result.availability, 'unavailable');
      assert.equal(result.rate, null);
      assert.equal(result.reason, reason);
    }
  });

  test('E. an observation exactly ten minutes old remains valid at the hard boundary', async () => {
    const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      fetchFn: providerFetch({
        conversion: conversionPayload({
          sourceLastUpdated: '2026-09-20T02:50:00.000Z',
          quoteLastUpdated: '2026-09-20T02:50:00.000Z'
        })
      })
    }));
    assert.equal(result.availability, 'available');
    assert.equal(result.rate, 25_000);
  });

  test('G-I. 401, 403, 429, and 5xx responses become explicit unavailable states', async () => {
    for (const [status, expectedReason] of [
      [401, 'FX_PROVIDER_ACCESS_DENIED'],
      [403, 'FX_PROVIDER_ACCESS_DENIED'],
      [429, 'FX_PROVIDER_RATE_LIMITED'],
      [500, 'FX_PROVIDER_UNAVAILABLE'],
      [503, 'FX_PROVIDER_UNAVAILABLE']
    ]) {
      const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
        fetchFn: async () => response({ status, data: {} })
      }));
      assert.equal(result.availability, 'unavailable');
      assert.equal(result.rate, null);
      assert.equal(result.reason, expectedReason);
    }
  });

  test('J. timeout fails closed', async () => {
    const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      timeoutMs: 5,
      fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    }));

    assert.equal(result.availability, 'unavailable');
    assert.equal(result.reason, 'FX_PROVIDER_TIMEOUT');
  });

  test('K-L. shared cache reuses five-minute rates and refreshes after expiration', async () => {
    const cache = createCoinMarketCapCurrentRateCache();
    let fiatCalls = 0;
    let conversionCalls = 0;
    const fetchFn = providerFetch({
      inspect(url) {
        if (url.pathname === '/v1/fiat/map') fiatCalls += 1;
        if (url.pathname === '/v2/tools/price-conversion') conversionCalls += 1;
      }
    });

    const first = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({ cache, fetchFn }));
    const reused = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      cache,
      fetchFn,
      now: new Date('2026-09-20T03:04:59.999Z')
    }));
    const refreshed = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      cache,
      fetchFn,
      now: new Date('2026-09-20T03:06:00.000Z')
    }));

    assert.equal(first.cacheStatus, 'refreshed');
    assert.equal(reused.cacheStatus, 'hit');
    assert.equal(refreshed.cacheStatus, 'refreshed');
    assert.equal(fiatCalls, 1);
    assert.equal(conversionCalls, 2);
  });

  test('H. a rate-limit response enters bounded shared backoff without aggressive retries', async () => {
    const cache = createCoinMarketCapCurrentRateCache();
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return response({ status: 429, data: {}, retryAfter: '1' });
    };

    const first = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({ cache, fetchFn }));
    const second = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      cache,
      fetchFn,
      now: new Date('2026-09-20T03:01:00.000Z')
    }));

    assert.equal(first.reason, 'FX_PROVIDER_RATE_LIMITED');
    assert.equal(second.reason, 'FX_PROVIDER_RATE_LIMITED');
    assert.equal(calls, 1);
    assert.ok(cache.backoffUntilMs >= Date.parse('2026-09-20T03:05:00.000Z'));
  });

  test('hard freshness rejects a cached observation older than ten minutes', async () => {
    const cache = createCoinMarketCapCurrentRateCache();
    const first = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({ cache }));
    assert.equal(first.availability, 'available');

    const stale = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      cache,
      now: new Date('2026-09-20T03:10:00.001Z'),
      fetchFn: async () => response({ status: 503, data: {} })
    }));
    assert.equal(stale.availability, 'unavailable');
    assert.equal(stale.rate, null);
    assert.equal(stale.reason, 'FX_PROVIDER_UNAVAILABLE');
  });

  test('M-N. USDT stays distinct from USD and the resolver never falls back to CoinGecko', async () => {
    let currentProviderCalls = 0;
    let accountingRateCalls = 0;
    const unsupported = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      baseCurrency: 'USD',
      fetchFn: async () => {
        throw new Error('must not fetch');
      }
    }));
    assert.equal(unsupported.reason, 'FX_PAIR_UNSUPPORTED');

    const result = await getFxRate('USDT', 'VND', {
      getCurrentUsdtVndRateFn: async ({ baseCurrency, quoteCurrency }) => {
        currentProviderCalls += 1;
        assert.deepEqual([baseCurrency, quoteCurrency], ['USDT', 'VND']);
        return {
          availability: 'unavailable',
          provider: 'COINMARKETCAP',
          reason: 'FX_PROVIDER_UNAVAILABLE'
        };
      },
      getAccountingRateFn: async () => {
        accountingRateCalls += 1;
        throw new Error('CoinGecko must not be used');
      }
    });
    assert.equal(result.availability, 'unavailable');
    assert.equal(currentProviderCalls, 1);
    assert.equal(accountingRateCalls, 0);
  });

  test('O. provider failures never expose the server-side key', async () => {
    const secret = 'fake-secret-that-must-not-appear-in-result';
    const result = await getCoinMarketCapCurrentUsdtVndRate(providerOptions({
      apiKey: secret,
      fetchFn: async () => {
        throw new Error(`upstream rejected ${secret}`);
      }
    }));

    assert.equal(result.availability, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.deepEqual(Object.keys(result).includes('apiKey'), false);
  });

  test('portfolio converts exact current ONDO native value while historical VND basis stays null', () => {
    const holding = {
      id: 'holding-ondo',
      asset_id: 'asset-ondo',
      quantity: 226,
      average_cost: null,
      native_average_cost: 0.36402,
      native_cost_currency: 'USDT',
      asset: {
        id: 'asset-ondo',
        symbol: 'ONDO',
        name: 'Ondo',
        asset_type: 'crypto',
        quote_currency: 'USD'
      }
    };
    const currentNative = {
      ONDO: {
        price: 0.4323,
        currency: 'USDT',
        source: 'Binance',
        priceAsOf: NOW,
        freshness: 'realtime'
      }
    };
    const result = calculatePortfolioValuation(
      { cash_available: 0 },
      [holding],
      {},
      {
        USDT: {
          availability: 'available',
          baseCurrency: 'USDT',
          quoteCurrency: 'VND',
          rate: 25_000,
          provider: 'COINMARKETCAP',
          sourceTimestamp: NOW,
          freshness: 'current'
        }
      },
      currentNative
    );

    const valued = result.holdings[0];
    assert.equal(Number(valued.nativeMarketValue.toFixed(4)), 97.6998);
    assert.equal(valued.nativeCurrency, 'USDT');
    assert.equal(Math.round(valued.reportingMarketValue), 2_442_495);
    assert.equal(Math.round(result.summary.totalMarketValue), 2_442_495);
    assert.equal(Math.round(result.summary.totalPortfolioValue), 2_442_495);
    assert.equal(valued.averageCost, null);
    assert.equal(valued.costBasis, null);
    assert.equal(valued.unrealizedPnL, null);
    assert.equal(valued.pnlStatus, 'unavailable');
    assert.ok(Math.abs(valued.nativeUnrealizedPnL - (226 * (0.4323 - 0.36402))) < 1e-12);
  });

  test('provider outage preserves native value and renders unknown VND total as unavailable, not zero', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: 0 },
      [{
        id: 'holding-ondo',
        asset_id: 'asset-ondo',
        quantity: 226,
        average_cost: null,
        native_average_cost: 0.36402,
        native_cost_currency: 'USDT',
        asset: {
          id: 'asset-ondo', symbol: 'ONDO', name: 'Ondo',
          asset_type: 'crypto', quote_currency: 'USD'
        }
      }],
      {},
      {},
      {
        ONDO: {
          price: 0.4323, currency: 'USDT', source: 'Binance',
          priceAsOf: NOW, freshness: 'realtime'
        }
      }
    );

    assert.equal(Number(overview.holdings[0].nativeMarketValue.toFixed(4)), 97.6998);
    assert.equal(overview.holdings[0].reportingMarketValue, null);
    assert.equal(overview.summary.totalMarketValue, null);
    assert.equal(overview.summary.totalPortfolioValue, null);

    const snapshot = buildPortfolioSnapshot({
      profileId: 'profile-test',
      overview,
      calculatedAt: NOW
    });
    const display = buildPortfolioSummaryDisplay(snapshot);
    assert.equal(snapshot.status, 'PARTIAL');
    assert.equal(snapshot.summary.metricStates.investedMarketValue, 'UNAVAILABLE');
    assert.equal(snapshot.summary.metricStates.totalPortfolioValue, 'UNAVAILABLE');
    assert.equal(display.total, null);
    assert.equal(display.invested, null);
    assert.notEqual(display.total, 0);
  });
});
