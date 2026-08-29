import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createApp } from '../index.js';
import {
  getAnalysisHistory,
  getHistoryRangeStart,
  getMarketHistory,
  getMarketSnapshot,
  normalizeDailyHistory
} from '../src/market.js';
import { alphavantageProvider } from '../src/providers/alphavantage.js';
import { coingeckoProvider } from '../src/providers/coingecko.js';
import { yahooProvider } from '../src/providers/yahoo.js';

const VN_ASSET = Object.freeze({
  id: 'asset-fpt',
  symbol: 'FPT',
  quoteCurrency: 'VND',
  marketPolicy: 'VN_EXCHANGE',
  marketTimezone: 'Asia/Ho_Chi_Minh'
});

const BTC_ASSET = Object.freeze({
  id: 'asset-btc',
  symbol: 'BTC',
  quoteCurrency: 'USD',
  marketPolicy: 'CONTINUOUS_24_7',
  marketTimezone: 'UTC'
});

const GOLD_ASSET = Object.freeze({
  id: 'asset-gold',
  symbol: 'XAU/USD',
  quoteCurrency: 'USD',
  marketPolicy: 'GLOBAL_24_5',
  marketTimezone: 'UTC'
});

function utcRecord(date, close, overrides = {}) {
  return {
    timestamp: `${date}T00:00:00.000Z`,
    open: null,
    high: null,
    low: null,
    close,
    volume: null,
    ...overrides
  };
}

describe('Feature 21 — Asset-Class Market & Historical Semantics', () => {
  test('A/B/D/F/G. shared core preserves valid OHLCV/full precision and honest close-only bars', () => {
    const yahoo = normalizeDailyHistory({
      asset: VN_ASSET,
      provider: 'yahoo',
      range: '1W',
      now: new Date('2026-08-29T04:00:00.000Z'),
      records: [
        {
          timestamp: '2026-08-28T02:00:00.000Z',
          open: 126.111111,
          high: 132.222222,
          low: 125.555555,
          close: 130.987654,
          volume: 12345.6789
        },
        {
          timestamp: '2026-08-21T02:00:00.000Z',
          open: 118,
          high: 121,
          low: 117,
          close: 120,
          volume: 100
        },
        {
          timestamp: '2026-08-24T02:00:00.000Z',
          open: 122.111111,
          high: 125,
          low: 120,
          close: 123.456789,
          volume: 50.25
        }
      ]
    });

    assert.deepEqual(yahoo.bars.map((bar) => bar.date), ['2026-08-24', '2026-08-28']);
    assert.equal(yahoo.bars[0].isComplete, true);
    assert.equal(yahoo.bars[1].volume, 12345.6789);
    assert.equal(yahoo.metrics.percentageChange, ((130.987654 / 123.456789) - 1) * 100);
    assert.equal(yahoo.dataCompleteness, 'complete');
    assert.deepEqual(yahoo.historyCapabilities, { close: true, ohlc: true, volume: true });

    const closeOnly = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'coingecko',
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      records: [
        utcRecord('2026-08-21', 90),
        utcRecord('2026-08-22', 100.123456789),
        utcRecord('2026-08-28', 110.987654321)
      ]
    });

    assert.equal(closeOnly.bars[0].open, null);
    assert.equal(closeOnly.bars[0].high, null);
    assert.deepEqual(closeOnly.historyCapabilities, { close: true, ohlc: false, volume: false });
    assert.equal(closeOnly.bars[0].low, null);
    assert.equal(closeOnly.bars[0].volume, null);
    assert.equal(closeOnly.metrics.periodHigh, null);
    assert.equal(closeOnly.metrics.periodLow, null);
  });

  test('C/E. invalid closes and contradictory OHLC are excluded with partial warnings', () => {
    const result = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'fixture',
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      records: [
        utcRecord('2026-08-21', 90),
        utcRecord('2026-08-22', 100),
        utcRecord('2026-08-23', 0),
        utcRecord('2026-08-24', 100, { open: 99, high: 95, low: 90 }),
        utcRecord('2026-08-25', 110)
      ]
    });

    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-22', '2026-08-25']);
    assert.equal(result.dataCompleteness, 'partial');
    assert.ok(result.warnings.some((warning) => warning.code === 'INVALID_CLOSE'));
    assert.ok(result.warnings.some((warning) => warning.code === 'CONTRADICTORY_OHLC'));
  });

  test('H/I. canonical-date duplicates collapse deterministically or are excluded on conflict', () => {
    const early = utcRecord('2026-08-22', 100);
    const late = { ...early, timestamp: '2026-08-22T12:00:00.000Z' };
    const result = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'fixture',
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      records: [
        utcRecord('2026-08-21', 90),
        late,
        early,
        utcRecord('2026-08-23', 101),
        { ...utcRecord('2026-08-23', 102), timestamp: '2026-08-23T10:00:00.000Z' },
        utcRecord('2026-08-24', 103)
      ]
    });

    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-22', '2026-08-24']);
    assert.equal(result.bars[0].timestamp, '2026-08-22T00:00:00.000Z');
    assert.ok(result.warnings.some(
      (warning) => warning.code === 'CONFLICTING_DUPLICATE_SESSION' && warning.sessionKey === '2026-08-23'
    ));
  });

  test('J. all-invalid completed records fail with controlled no-data semantics', () => {
    assert.throws(
      () => normalizeDailyHistory({
        asset: BTC_ASSET,
        provider: 'fixture',
        range: '1W',
        now: new Date('2026-08-29T12:00:00.000Z'),
        records: [utcRecord('2026-08-22', null), utcRecord('2026-08-23', -1)]
      }),
      (error) => error.status === 404 && error.code === 'NO_USABLE_HISTORY' &&
        error.warnings.some((warning) => warning.code === 'INVALID_CLOSE')
    );
  });

  test('K–N. VN policy uses IANA local dates and excludes current/weekend dates without synthesis', () => {
    const result = normalizeDailyHistory({
      asset: VN_ASSET,
      provider: 'yahoo',
      range: '1W',
      now: new Date('2026-08-22T18:00:00.000Z'), // 2026-08-23 in Vietnam
      records: [
        {
          timestamp: '2026-08-21T16:59:59.000Z', // 2026-08-21 23:59:59 Vietnam
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 10
        },
        {
          timestamp: '2026-08-21T17:00:00.000Z', // Saturday 2026-08-22 Vietnam
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 10
        },
        {
          timestamp: '2026-08-22T17:00:00.000Z', // current Vietnam date
          open: 100,
          high: 110,
          low: 90,
          close: 105,
          volume: 10
        }
      ]
    });

    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-21']);
    assert.ok(result.warnings.some((warning) => warning.code === 'NON_TRADING_DATE_EXCLUDED'));
    assert.equal(result.bars.length, 1);
  });

  test('K–N integration. Yahoo fetches a superset and delegates public VN completion/range semantics to the core', async () => {
    let capturedUrl;
    const toSeconds = (value) => Math.floor(Date.parse(value) / 1000);
    const result = await yahooProvider.getHistory(
      VN_ASSET,
      { provider: 'yahoo', providerSymbol: 'FPT.VN' },
      {
        range: '1W',
        now: new Date('2026-08-29T04:00:00.000Z'),
        fetchFn: async (url) => {
          capturedUrl = new URL(url);
          return {
            ok: true,
            json: async () => ({
              chart: {
                result: [{
                  meta: { symbol: 'FPT.VN' },
                  timestamp: [
                    toSeconds('2026-08-21T02:00:00.000Z'),
                    toSeconds('2026-08-24T02:00:00.000Z'),
                    toSeconds('2026-08-28T02:00:00.000Z'),
                    toSeconds('2026-08-29T02:00:00.000Z')
                  ],
                  indicators: {
                    quote: [{
                      open: [90, 100, 110, 999],
                      high: [95, 105, 115, 1000],
                      low: [85, 95, 105, 998],
                      close: [92, 102, 112, 999],
                      volume: [10, 20, 30, 40]
                    }]
                  }
                }]
              }
            })
          };
        }
      }
    );

    assert.equal(capturedUrl.searchParams.get('interval'), '1d');
    assert.equal(capturedUrl.searchParams.get('range'), '1mo');
    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-24', '2026-08-28']);
    assert.equal(result.dataAsOf, '2026-08-28');
    assert.equal(result.provider, 'yahoo');
    assert.equal(result.dataCompleteness, 'complete');
  });

  test('O–Q. continuous 24/7 policy uses UTC, excludes current day, and keeps weekends', () => {
    const result = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'coingecko',
      range: '1W',
      now: new Date('2026-08-31T12:00:00.000Z'),
      records: [
        utcRecord('2026-08-23', 95),
        utcRecord('2026-08-29', 100),
        utcRecord('2026-08-30', 101),
        utcRecord('2026-08-31', 102)
      ]
    });

    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-29', '2026-08-30']);
    assert.equal(result.dataAsOf, '2026-08-30');
  });

  test('AC–AG. every public range uses its exact calendar lower boundary', () => {
    const today = '2026-08-31';
    const expectedStarts = {
      '1W': '2026-08-24',
      '1M': '2026-07-31',
      '3M': '2026-05-31',
      '6M': '2026-02-28',
      '1Y': '2025-08-31'
    };

    for (const [range, startDate] of Object.entries(expectedStarts)) {
      assert.equal(getHistoryRangeStart(today, range), startDate);
      const dayBefore = new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
      const result = normalizeDailyHistory({
        asset: BTC_ASSET,
        provider: 'fixture',
        range,
        now: new Date(`${today}T12:00:00.000Z`),
        records: [
          utcRecord(dayBefore, 90),
          utcRecord(startDate, 100),
          utcRecord(today, 110)
        ]
      });
      assert.deepEqual(result.bars.map((bar) => bar.date), [startDate]);
      assert.equal(result.dataCompleteness, 'complete');
    }
  });

  test('AH/AI. sparse usable history is partial while an empty completed window is controlled no-data', () => {
    const sparse = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'fixture',
      range: '1M',
      now: new Date('2026-08-29T12:00:00.000Z'),
      records: [utcRecord('2026-08-27', 100), utcRecord('2026-08-28', 101)]
    });
    assert.equal(sparse.dataCompleteness, 'partial');
    assert.ok(sparse.warnings.some((warning) => warning.code === 'PARTIAL_HISTORY_COVERAGE'));

    assert.throws(
      () => normalizeDailyHistory({
        asset: BTC_ASSET,
        provider: 'fixture',
        range: '1W',
        now: new Date('2026-08-29T12:00:00.000Z'),
        records: [utcRecord('2026-08-29', 100)]
      }),
      (error) => error.code === 'NO_USABLE_HISTORY' && error.status === 404
    );
  });

  test('R–U. CoinGecko uses explicit ID and explicit daily UTC close-only observations', async () => {
    let capturedUrl;
    const prices = [
      ['2026-08-20', 95.25],
      ['2026-08-22', 100.123456789],
      ['2026-08-23', 101.5],
      ['2026-08-28', 110.987654321],
      ['2026-08-29', 999]
    ].map(([date, price]) => [Date.parse(`${date}T00:00:00.000Z`), price]);

    const result = await coingeckoProvider.getHistory(
      BTC_ASSET,
      { provider: 'coingecko', providerSymbol: 'bitcoin' },
      {
        apiKey: 'test-key',
        now: new Date('2026-08-29T12:00:00.000Z'),
        range: '1W',
        fetchFn: async (url) => {
          capturedUrl = new URL(url);
          return { ok: true, json: async () => ({ prices, market_caps: [], total_volumes: [] }) };
        }
      }
    );

    assert.equal(capturedUrl.pathname, '/api/v3/coins/bitcoin/market_chart/range');
    assert.equal(capturedUrl.searchParams.get('interval'), 'daily');
    assert.equal(capturedUrl.searchParams.get('vs_currency'), 'usd');
    assert.equal(capturedUrl.searchParams.get('precision'), 'full');
    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-22', '2026-08-23', '2026-08-28']);
    assert.ok(result.bars.every((bar) => bar.open === null && bar.high === null && bar.low === null && bar.volume === null));
    assert.equal(result.provider, 'coingecko');
    assert.equal(result.marketPolicy, 'CONTINUOUS_24_7');
    assert.equal(result.quoteCurrency, 'USD');
    assert.deepEqual(result.historyCapabilities, { close: true, ohlc: false, volume: false });
  });

  test('W–AA. Alpha Vantage maps date-only Gold Spot history to completed UTC close-only bars', async () => {
    let capturedUrl;
    const result = await alphavantageProvider.getHistory(
      GOLD_ASSET,
      { provider: 'alphavantage', providerSymbol: 'XAU' },
      {
        apiKey: 'test-key',
        now: new Date('2026-08-31T12:00:00.000Z'),
        range: '1W',
        fetchFn: async (url) => {
          capturedUrl = new URL(url);
          return {
            ok: true,
            json: async () => ({
              nominal: 'XAUUSD',
              data: [
                { date: '2026-08-31', price: '9999' },
                { date: '2026-08-30', price: '2600' },
                { date: '2026-08-28', price: '2512.45000000' },
                { date: '2026-08-24', price: '2499.12345678' },
                { date: '2026-08-21', price: '2480' }
              ]
            })
          };
        }
      }
    );

    assert.equal(capturedUrl.searchParams.get('function'), 'GOLD_SILVER_HISTORY');
    assert.equal(capturedUrl.searchParams.get('symbol'), 'XAU');
    assert.equal(capturedUrl.searchParams.get('interval'), 'daily');
    assert.deepEqual(result.bars.map((bar) => bar.date), ['2026-08-24', '2026-08-28']);
    assert.equal(result.bars[0].timestamp, '2026-08-24T00:00:00.000Z');
    assert.ok(result.bars.every((bar) => bar.open === null && bar.high === null && bar.low === null && bar.volume === null));
    assert.deepEqual(result.historyCapabilities, { close: true, ohlc: false, volume: false });
    assert.ok(result.warnings.some((warning) => warning.code === 'DERIVED_PERIOD_TIMESTAMP'));
    assert.ok(result.warnings.some((warning) => warning.code === 'NON_TRADING_DATE_EXCLUDED'));
  });

  test('structured provider failures distinguish rate limits and malformed responses', async () => {
    await assert.rejects(
      () => coingeckoProvider.getHistory(
        BTC_ASSET,
        { provider: 'coingecko', providerSymbol: 'bitcoin' },
        {
          apiKey: 'test-key',
          now: new Date('2026-08-29T12:00:00.000Z'),
          range: '1W',
          fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) })
        }
      ),
      (error) => error.status === 503 && error.code === 'PROVIDER_RATE_LIMITED'
    );

    await assert.rejects(
      () => alphavantageProvider.getHistory(
        GOLD_ASSET,
        { provider: 'alphavantage', providerSymbol: 'XAU' },
        {
          apiKey: 'test-key',
          now: new Date('2026-08-29T12:00:00.000Z'),
          range: '1W',
          fetchFn: async () => ({ ok: true, json: async () => ({ nominal: 'XAUUSD' }) })
        }
      ),
      (error) => error.status === 502 && error.code === 'MALFORMED_PROVIDER_RESPONSE'
    );
  });

  test('AB. USD/VND history remains explicitly unsupported without touching FX snapshot resolution', async () => {
    const fxAsset = {
      id: 'asset-usdvnd',
      symbol: 'USD/VND',
      quoteCurrency: 'VND',
      marketPolicy: 'GLOBAL_24_5',
      marketTimezone: 'Asia/Ho_Chi_Minh'
    };

    await assert.rejects(
      () => getMarketHistory('USD/VND', '1M', {
        now: new Date('2026-08-29T12:00:00.000Z'),
        resolveProviderMappingFn: async () => ({
          asset: fxAsset,
          mapping: { provider: 'twelvedata', providerSymbol: 'USD/VND' }
        })
      }),
      (error) => error.status === 422 && error.code === 'UNSUPPORTED_HISTORY'
    );
  });

  test('AJ. snapshot and completed history remain independent when their prices differ', async () => {
    const adapter = {
      getSnapshot: async () => ({ symbol: 'BTC', price: 999, currency: 'USD' }),
      getHistory: async (asset, _mapping, options) => normalizeDailyHistory({
        asset,
        provider: 'fixture',
        range: options.range,
        now: options.now,
        records: [utcRecord('2026-08-21', 90), utcRecord('2026-08-22', 100), utcRecord('2026-08-28', 110)]
      })
    };
    const resolver = async () => ({
      asset: BTC_ASSET,
      mapping: { provider: 'fixture', providerSymbol: 'bitcoin' }
    });

    const snapshot = await getMarketSnapshot('BTC', { resolveProviderMappingFn: resolver, providerAdapter: adapter });
    const history = await getMarketHistory('BTC', '1W', {
      resolveProviderMappingFn: resolver,
      providerAdapter: adapter,
      now: new Date('2026-08-29T12:00:00.000Z')
    });

    assert.equal(snapshot.price, 999);
    assert.equal(history.metrics.latestPrice, 110);
    assert.notEqual(snapshot.price, history.metrics.latestPrice);
  });

  test('AK. current Feature 07 analysis remains restricted to VN_EXCHANGE before provider access', async () => {
    let adapterCalled = false;
    await assert.rejects(
      () => getAnalysisHistory('BTC', {
        resolveProviderMappingFn: async () => ({
          asset: BTC_ASSET,
          mapping: { provider: 'coingecko', providerSymbol: 'bitcoin' }
        }),
        providerAdapter: {
          getHistory: async () => {
            adapterCalled = true;
            return {};
          }
        }
      }),
      (error) => error.status === 422 && error.code === 'UNSUPPORTED_MARKET_POLICY'
    );
    assert.equal(adapterCalled, false);
  });

  test('public route preserves existing fields and adds authoritative history metadata', async () => {
    const history = normalizeDailyHistory({
      asset: BTC_ASSET,
      provider: 'coingecko',
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      records: [utcRecord('2026-08-21', 90), utcRecord('2026-08-22', 100), utcRecord('2026-08-28', 110)]
    });
    const app = createApp({ getMarketHistoryFn: async () => history });
    const server = app.listen(0);

    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/BTC/history?range=1W`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      for (const field of ['symbol', 'range', 'interval', 'freshness', 'updatedAt', 'bars', 'metrics']) {
        assert.ok(Object.hasOwn(body.data, field));
      }
      assert.equal(body.data.provider, 'coingecko');
      assert.equal(body.data.marketPolicy, 'CONTINUOUS_24_7');
      assert.equal(body.data.marketTimezone, 'UTC');
      assert.equal(body.data.quoteCurrency, 'USD');
      assert.equal(body.data.dataAsOf, '2026-08-28');
      assert.equal(body.data.dataCompleteness, 'complete');
      assert.equal(body.data.bars[0].isComplete, true);
    } finally {
      server.close();
    }
  });

  test('public route preserves structured history error codes and warnings', async () => {
    const app = createApp({
      getMarketHistoryFn: async () => {
        const error = new Error('No usable completed history');
        error.status = 404;
        error.code = 'NO_USABLE_HISTORY';
        error.warnings = [{ code: 'CONFLICTING_DUPLICATE_SESSION', sessionKey: '2026-08-28' }];
        throw error;
      }
    });
    const server = app.listen(0);

    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/FPT/history?range=1W`);
      const body = await response.json();
      assert.equal(response.status, 404);
      assert.equal(body.status, 'error');
      assert.equal(body.code, 'NO_USABLE_HISTORY');
      assert.equal(body.warnings[0].code, 'CONFLICTING_DUPLICATE_SESSION');
    } finally {
      server.close();
    }
  });
});
