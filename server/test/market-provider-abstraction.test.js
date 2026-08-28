import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeAsset } from '../src/assets.js';
import {
  getAnalysisHistory,
  getMarketHistory,
  getMarketSnapshot,
  getProviderAdapter,
  MARKET_PROVIDERS,
  normalizeHistoricalData,
  normalizeMarketSnapshot
} from '../src/market.js';
import { yahooProvider } from '../src/providers/yahoo.js';

const FPT_ID = '34ad7d87-9065-4111-b38d-ebc92c4a74dd';

function assetFixture(overrides = {}) {
  return {
    id: FPT_ID,
    symbol: 'FPT',
    name: 'FPT Corporation',
    asset_type: 'stock',
    exchange: 'HOSE',
    market_code: 'HOSE',
    quote_currency: 'VND',
    base_currency: null,
    market_policy: 'VN_EXCHANGE',
    market_timezone: 'Asia/Ho_Chi_Minh',
    quantity_unit: 'share',
    is_active: true,
    created_at: '2026-08-27T07:37:40.05645+00:00',
    ...overrides
  };
}

function yahooMapping(assetId = FPT_ID, providerSymbol = 'FPT.VN') {
  return {
    id: 'mapping-fpt-yahoo',
    asset_id: assetId,
    provider: 'yahoo',
    provider_symbol: providerSymbol,
    provider_market: null,
    created_at: '2026-08-28T00:00:00.000Z'
  };
}

describe('Feature 18 — Market Provider Abstraction', () => {

  test('A. FPT canonical symbol remains FPT and explicit Yahoo mapping resolves FPT.VN to Yahoo adapter', async () => {
    let capturedUrl = null;
    const fakeFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          chart: {
            result: [{
              meta: {
                regularMarketPrice: 72200,
                previousClose: 71000,
                regularMarketTime: 1787191200,
                currency: 'VND',
                exchangeName: 'HOSE'
              }
            }]
          }
        })
      };
    };

    const snapshot = await getMarketSnapshot('fpt', {
      resolveProviderMappingFn: async () => ({
        asset: normalizeAsset(assetFixture()),
        mapping: yahooMapping()
      }),
      fetchFn: fakeFetch
    });

    assert.equal(snapshot.symbol, 'FPT');
    assert.equal(snapshot.price, 72200);
    assert.match(capturedUrl, /\/chart\/FPT\.VN\?/);
  });

  test('B. getMarketSnapshot dispatches to provider adapter getSnapshot method', async () => {
    let adapterCalled = false;
    let receivedAsset = null;
    let receivedMapping = null;

    const fakeAdapter = {
      name: 'fake_provider',
      getSnapshot: async (asset, mapping) => {
        adapterCalled = true;
        receivedAsset = asset;
        receivedMapping = mapping;
        return {
          symbol: asset.symbol,
          price: 99000,
          currency: 'VND',
          priceSource: 'fake_snapshot',
          freshness: 'delayed'
        };
      }
    };

    const snapshot = await getMarketSnapshot('FPT', {
      resolveProviderMappingFn: async () => ({
        asset: normalizeAsset(assetFixture()),
        mapping: { provider: 'fake_provider', providerSymbol: 'FPT-FAKE' }
      }),
      getProviderAdapterFn: (provider) => {
        if (provider === 'fake_provider') return fakeAdapter;
        return null;
      }
    });

    assert.equal(adapterCalled, true);
    assert.equal(receivedAsset.symbol, 'FPT');
    assert.equal(receivedMapping.providerSymbol, 'FPT-FAKE');
    assert.equal(snapshot.symbol, 'FPT');
    assert.equal(snapshot.price, 99000);
    assert.equal(snapshot.priceSource, 'fake_snapshot');
  });

  test('C. getMarketHistory dispatches to provider adapter getHistory method with range', async () => {
    let adapterHistoryCalled = false;
    let receivedRange = null;

    const fakeAdapter = {
      name: 'fake_provider',
      getHistory: async (asset, mapping, options) => {
        adapterHistoryCalled = true;
        receivedRange = options.range;
        return {
          symbol: asset.symbol,
          range: options.range,
          interval: '1d',
          bars: [
            {
              timestamp: '2026-08-28T03:00:00.000Z',
              open: 70000,
              high: 72000,
              low: 69000,
              close: 71000,
              volume: 10000
            }
          ],
          metrics: {
            periodStartPrice: 71000,
            latestPrice: 71000,
            validSessions: 1
          }
        };
      }
    };

    const history = await getMarketHistory('FPT', '3M', {
      resolveProviderMappingFn: async () => ({
        asset: normalizeAsset(assetFixture()),
        mapping: { provider: 'fake_provider', providerSymbol: 'FPT-FAKE' }
      }),
      providerAdapter: fakeAdapter
    });

    assert.equal(adapterHistoryCalled, true);
    assert.equal(receivedRange, '3M');
    assert.equal(history.symbol, 'FPT');
    assert.equal(history.range, '3M');
    assert.equal(history.bars.length, 1);
  });

  test('D. no provider mapping rejects cleanly without inferring .VN or fetching', async () => {
    let fetchAttempted = false;

    await assert.rejects(
      getMarketSnapshot('UNKNOWN', {
        resolveProviderMappingFn: async () => {
          const err = new Error("Provider 'yahoo' is unsupported for asset 'UNKNOWN'");
          err.code = 'UNSUPPORTED_PROVIDER';
          err.status = 422;
          throw err;
        },
        fetchFn: async () => {
          fetchAttempted = true;
          throw new Error('Should never be called');
        }
      }),
      (err) => err.status === 422 && err.code === 'UNSUPPORTED_PROVIDER'
    );

    assert.equal(fetchAttempted, false);
  });

  test('E. unsupported provider returns clean unsupported error without crashing', async () => {
    await assert.rejects(
      getMarketSnapshot('FPT', {
        resolveProviderMappingFn: async () => ({
          asset: normalizeAsset(assetFixture()),
          mapping: { provider: 'unknown_provider', providerSymbol: 'FPT-UNK' }
        })
      }),
      (err) => err.status === 422 && err.code === 'UNSUPPORTED_PROVIDER' && err.message.includes('unknown_provider')
    );

    await assert.rejects(
      getMarketHistory('FPT', '1M', {
        resolveProviderMappingFn: async () => ({
          asset: normalizeAsset(assetFixture()),
          mapping: { provider: 'unsupported_exchange', providerSymbol: 'FPT-UNS' }
        })
      }),
      (err) => err.status === 422 && err.code === 'UNSUPPORTED_PROVIDER' && err.message.includes('unsupported_exchange')
    );
  });

  test('F. Yahoo normalization behavior remains identical and exported for compatibility', () => {
    const rawMeta = {
      regularMarketPrice: 85000,
      previousClose: 84000,
      regularMarketDayHigh: 86000,
      regularMarketDayLow: 83500,
      regularMarketVolume: 2500000,
      regularMarketTime: 1787191200,
      currency: 'VND',
      exchangeName: 'HOSE'
    };

    const snapshotFromMarket = normalizeMarketSnapshot(rawMeta, 'HPG');
    const snapshotFromYahoo = yahooProvider.normalizeMarketSnapshot(rawMeta, 'HPG');

    assert.deepEqual(snapshotFromMarket, snapshotFromYahoo);
    assert.equal(snapshotFromMarket.symbol, 'HPG');
    assert.equal(snapshotFromMarket.price, 85000);
    assert.equal(snapshotFromMarket.change, 1000);
    assert.equal(snapshotFromMarket.priceSource, 'yahoo_delayed_snapshot');
  });

  test('G. Provider registry resolves Yahoo adapter deterministically', () => {
    assert.equal(getProviderAdapter('yahoo'), yahooProvider);
    assert.equal(getProviderAdapter('YAHOO'), yahooProvider);
    assert.equal(getProviderAdapter('  yahoo  '), yahooProvider);
    assert.equal(getProviderAdapter('non_existent'), null);
    assert.equal(getProviderAdapter(null), null);
    assert.equal(getProviderAdapter(''), null);
    assert.ok(MARKET_PROVIDERS.yahoo);
  });

  test('H. getAnalysisHistory routes 2y range to provider adapter', async () => {
    let requestedRange = null;
    let normalizedRange = null;

    const fakeAdapter = {
      name: 'fake_provider',
      getHistory: async (asset, mapping, options) => {
        requestedRange = options.range;
        normalizedRange = options.normalizedRange;
        return {
          symbol: asset.symbol,
          range: options.normalizedRange || options.range,
          bars: []
        };
      }
    };

    const result = await getAnalysisHistory('FPT', {
      resolveProviderMappingFn: async () => ({
        asset: normalizeAsset(assetFixture()),
        mapping: { provider: 'fake_provider', providerSymbol: 'FPT' }
      }),
      providerAdapter: fakeAdapter
    });

    assert.equal(requestedRange, '2y');
    assert.equal(normalizedRange, '1Y');
    assert.equal(result.range, '1Y');
  });
});
