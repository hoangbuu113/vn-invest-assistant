import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildCommonDateBase100,
  getAssetComparison,
  validateComparisonSelection,
  normalizeHistoricalPrices,
  translateDataCompleteness
} from '../src/comparison.js';
import { yahooProvider } from '../src/providers/yahoo.js';
import { coingeckoProvider } from '../src/providers/coingecko.js';
import { alphavantageProvider } from '../src/providers/alphavantage.js';
import { twelvedataProvider } from '../src/providers/twelvedata.js';
import { createApp } from '../index.js';

describe('Feature 11 — Asset Comparison / So sánh tài sản', () => {
  describe('Asset Selection & Deduplication Logic', () => {
    it('rejects invalid inputs and returns descriptive error', () => {
      const resultNull = validateComparisonSelection(null);
      assert.equal(resultNull.valid, false);
      assert.deepEqual(resultNull.symbols, []);
      assert.match(resultNull.error, /không hợp lệ/);

      const resultEmpty = validateComparisonSelection([]);
      assert.equal(resultEmpty.valid, false);
      assert.deepEqual(resultEmpty.symbols, []);
      assert.equal(resultEmpty.error, 'Chọn từ 2 đến 4 tài sản để so sánh.');
    });

    it('rejects single asset selection (< 2 assets)', () => {
      const result = validateComparisonSelection(['FPT']);
      assert.equal(result.valid, false);
      assert.deepEqual(result.symbols, ['FPT']);
      assert.equal(result.error, 'Chọn từ 2 đến 4 tài sản để so sánh.');
    });

    it('accepts 2 to 4 valid assets without duplicates', () => {
      const result2 = validateComparisonSelection(['FPT', 'VCB']);
      assert.equal(result2.valid, true);
      assert.deepEqual(result2.symbols, ['FPT', 'VCB']);
      assert.equal(result2.error, null);

      const result3 = validateComparisonSelection(['FPT', 'VCB', 'E1VFVN30']);
      assert.equal(result3.valid, true);
      assert.deepEqual(result3.symbols, ['FPT', 'VCB', 'E1VFVN30']);
      assert.equal(result3.error, null);

      const result4 = validateComparisonSelection(['FPT', 'VCB', 'E1VFVN30', 'MWG']);
      assert.equal(result4.valid, true);
      assert.deepEqual(result4.symbols, ['FPT', 'VCB', 'E1VFVN30', 'MWG']);
      assert.equal(result4.error, null);
    });

    it('deduplicates case-insensitive duplicate symbols', () => {
      const result = validateComparisonSelection(['FPT', 'fpt', 'VCB', 'FPT', 'vcb']);
      assert.equal(result.valid, true);
      assert.deepEqual(result.symbols, ['FPT', 'VCB']);
    });

    it('caps selection at maximum 4 assets preserving first 4 unique assets', () => {
      const result = validateComparisonSelection(['FPT', 'VCB', 'E1VFVN30', 'MWG', 'HPG', 'SSI']);
      assert.equal(result.valid, true);
      assert.deepEqual(result.symbols, ['FPT', 'VCB', 'E1VFVN30', 'MWG']);
      assert.equal(result.symbols.length, 4);
    });

    it('filters symbols against available system symbols if provided', () => {
      const available = ['FPT', 'VCB', 'E1VFVN30', 'MWG'];
      const result = validateComparisonSelection(['FPT', 'INVALID_SYM', 'VCB'], available);
      assert.equal(result.valid, true);
      assert.deepEqual(result.symbols, ['FPT', 'VCB']);

      const resultOnlyInvalid = validateComparisonSelection(['INVALID1', 'INVALID2'], available);
      assert.equal(resultOnlyInvalid.valid, false);
      assert.deepEqual(resultOnlyInvalid.symbols, []);
    });
  });

  describe('Historical Price Normalization (Base = 100)', () => {
    it('returns null for empty or single bar input', () => {
      assert.equal(normalizeHistoricalPrices(null), null);
      assert.equal(normalizeHistoricalPrices([]), null);
      assert.equal(normalizeHistoricalPrices([{ timestamp: '2026-08-01', close: 100000 }]), null);
    });

    it('correctly normalizes historical prices to base 100 at period start', () => {
      const rawBars = [
        { timestamp: '2026-08-01T00:00:00.000Z', close: 100000 },
        { timestamp: '2026-08-02T00:00:00.000Z', close: 105000 },
        { timestamp: '2026-08-03T00:00:00.000Z', close: 95000 },
        { timestamp: '2026-08-04T00:00:00.000Z', close: 110000 }
      ];

      const normalized = normalizeHistoricalPrices(rawBars);
      assert.equal(normalized.length, 4);

      // Base bar is exactly 100
      assert.equal(normalized[0].normalizedValue, 100);
      assert.equal(normalized[0].close, 100000);

      // Bar 2: (105000 / 100000) * 100 = 105
      assert.ok(Math.abs(normalized[1].normalizedValue - 105) < 1e-9);

      // Bar 3: (95000 / 100000) * 100 = 95
      assert.ok(Math.abs(normalized[2].normalizedValue - 95) < 1e-9);

      // Bar 4: (110000 / 100000) * 100 = 110
      assert.ok(Math.abs(normalized[3].normalizedValue - 110) < 1e-9);
    });

    it('filters out invalid bars without disrupting valid base normalization', () => {
      const rawBars = [
        { timestamp: '2026-08-01T00:00:00.000Z', close: 50000 },
        { timestamp: '2026-08-02T00:00:00.000Z', close: null },
        { timestamp: '2026-08-03T00:00:00.000Z', close: -100 },
        { timestamp: '2026-08-04T00:00:00.000Z', close: 'invalid' },
        { timestamp: '2026-08-05T00:00:00.000Z', close: 60000 }
      ];

      const normalized = normalizeHistoricalPrices(rawBars);
      assert.equal(normalized.length, 2);
      assert.equal(normalized[0].normalizedValue, 100);
      assert.ok(Math.abs(normalized[1].normalizedValue - 120) < 1e-9);
    });
  });

  describe('Data Completeness Translation', () => {
    it('translates all backend completeness levels to exact Vietnamese labels', () => {
      assert.equal(translateDataCompleteness('complete'), 'Đầy đủ');
      assert.equal(translateDataCompleteness('partial'), 'Một phần');
      assert.equal(translateDataCompleteness('limited'), 'Hạn chế');
      assert.equal(translateDataCompleteness('unavailable'), 'Chưa đủ dữ liệu');
      assert.equal(translateDataCompleteness(undefined), 'Chưa đủ dữ liệu');
      assert.equal(translateDataCompleteness(null), 'Chưa đủ dữ liệu');
    });
  });

  describe('Feature 24A provider-neutral comparison contract', () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    const assetFixtures = {
      FPT: {
        id: 'asset-fpt',
        symbol: 'FPT',
        name: 'FPT Corporation',
        assetType: 'stock',
        quoteCurrency: 'VND',
        marketPolicy: 'VN_EXCHANGE',
        marketTimezone: 'Asia/Ho_Chi_Minh'
      },
      BTC: {
        id: 'asset-btc',
        symbol: 'BTC',
        name: 'Bitcoin',
        assetType: 'crypto',
        quoteCurrency: 'USD',
        marketPolicy: 'CONTINUOUS_24_7',
        marketTimezone: 'UTC'
      },
      'XAU/USD': {
        id: 'asset-gold',
        symbol: 'XAU/USD',
        name: 'Gold Spot',
        assetType: 'gold',
        quoteCurrency: 'USD',
        marketPolicy: 'GLOBAL_24_5',
        marketTimezone: 'UTC'
      },
      'USD/VND': {
        id: 'asset-fx',
        symbol: 'USD/VND',
        name: 'US Dollar / Vietnamese Dong',
        assetType: 'fx',
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        marketPolicy: 'GLOBAL_24_5',
        marketTimezone: 'Asia/Ho_Chi_Minh'
      }
    };
    const adapters = {
      FPT: yahooProvider,
      BTC: coingeckoProvider,
      'XAU/USD': alphavantageProvider,
      'USD/VND': twelvedataProvider
    };

    function historyFixture(symbol, dates, closes, { ohlc = false } = {}) {
      const asset = assetFixtures[symbol];
      return {
        symbol,
        assetType: asset.assetType,
        range: '1M',
        marketPolicy: asset.marketPolicy,
        marketTimezone: asset.marketTimezone,
        quoteCurrency: asset.quoteCurrency,
        freshness: 'delayed',
        dataAsOf: dates.at(-1),
        dataCompleteness: 'complete',
        historyCapabilities: { close: true, ohlc, volume: ohlc },
        bars: dates.map((date, index) => ({
          date,
          timestamp: `${date}T00:00:00.000Z`,
          open: ohlc ? closes[index] - 1 : null,
          high: ohlc ? closes[index] + 2 : null,
          low: ohlc ? closes[index] - 2 : null,
          close: closes[index],
          volume: ohlc ? 1000 + index : null,
          isComplete: true
        }))
      };
    }

    it('uses V2 universal metrics and genuine common canonical dates with one evaluation clock', async () => {
      const histories = {
        FPT: historyFixture('FPT', ['2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05'], [100, 101, 110, 108], { ohlc: true }),
        BTC: historyFixture('BTC', ['2026-08-01', '2026-08-03', '2026-08-04', '2026-08-05'], [60000, 61000, 63000, 62000]),
        'XAU/USD': historyFixture('XAU/USD', ['2026-08-01', '2026-08-04', '2026-08-05'], [2500, 2525, 2510])
      };
      const snapshots = {
        FPT: { price: 109, currency: 'VND', priceAsOf: '2026-08-06T03:00:00.000Z', changeBasis: 'PREVIOUS_SESSION_CLOSE', volumeSemantics: 'SESSION_BASE_UNITS' },
        BTC: { price: 62500, currency: 'USD', priceAsOf: '2026-08-06T11:59:00.000Z', changeBasis: 'ROLLING_24H', volumeSemantics: 'ROLLING_24H_QUOTE_CURRENCY' },
        'XAU/USD': { price: 2512, currency: 'USD', priceAsOf: '2026-08-06T11:00:00.000Z', changeBasis: 'UNAVAILABLE', volumeSemantics: 'UNAVAILABLE' },
        'USD/VND': { price: 25450, currency: 'VND', priceAsOf: '2026-08-06T11:55:00.000Z', changeBasis: 'UNAVAILABLE', volumeSemantics: 'UNAVAILABLE' }
      };
      const observedNowObjects = [];
      const historyCalls = [];

      const comparison = await getAssetComparison(['FPT', 'BTC', 'XAU/USD', 'USD/VND'], '1M', {
        now,
        resolveProviderMappingFn: async (symbol) => ({
          asset: assetFixtures[symbol],
          mapping: { provider: adapters[symbol].name, providerSymbol: symbol }
        }),
        getProviderAdapterFn: (provider) => Object.values(adapters).find((adapter) => adapter.name === provider),
        getMarketSnapshotFn: async (symbol, options) => {
          observedNowObjects.push(options.now);
          return snapshots[symbol];
        },
        getMarketHistoryFn: async (symbol, range, options) => {
          observedNowObjects.push(options.now);
          historyCalls.push(symbol);
          assert.equal(range, '1M');
          return histories[symbol];
        }
      });

      assert.equal(comparison.evaluatedAt, now.toISOString());
      assert.ok(observedNowObjects.every((value) => value === now));
      assert.deepEqual(historyCalls.sort(), ['BTC', 'FPT', 'XAU/USD'].sort());
      assert.equal(historyCalls.includes('USD/VND'), false);

      assert.equal(comparison.assets.find((asset) => asset.symbol === 'FPT').snapshot.quoteCurrency, 'VND');
      assert.equal(comparison.assets.find((asset) => asset.symbol === 'BTC').snapshot.quoteCurrency, 'USD');
      assert.equal(comparison.assets.find((asset) => asset.symbol === 'XAU/USD').snapshot.quoteCurrency, 'USD');

      const cryptoAnalysis = comparison.assets.find((asset) => asset.symbol === 'BTC').analysis;
      assert.equal(cryptoAnalysis.methodologyVersion, 'v2');
      assert.equal(cryptoAnalysis.metricStatus.priceChangePct.status, 'available');
      assert.equal(cryptoAnalysis.metricStatus.dailyVolatilityPct.status, 'available');
      assert.equal('intradayHighPrice' in cryptoAnalysis.metrics, false);
      assert.equal('periodHighPrice' in cryptoAnalysis.metrics, false);

      const goldAnalysis = comparison.assets.find((asset) => asset.symbol === 'XAU/USD').analysis;
      assert.equal(goldAnalysis.methodologyVersion, 'v2');
      assert.equal(goldAnalysis.metricStatus.maxDrawdownPct.status, 'available');
      assert.equal('intradayHighPrice' in goldAnalysis.metrics, false);
      assert.equal('periodHighPrice' in goldAnalysis.metrics, false);

      const fx = comparison.assets.find((asset) => asset.symbol === 'USD/VND');
      assert.equal(fx.capabilities.snapshot, true);
      assert.equal(fx.capabilities.history, false);
      assert.equal(fx.capabilities.analysis, false);
      assert.deepEqual(fx.historyStatus, { status: 'unsupported', reason: 'UNSUPPORTED_HISTORY' });
      assert.deepEqual(fx.analysis, { status: 'unsupported', reason: 'UNSUPPORTED_HISTORY' });

      assert.equal(comparison.base100.status, 'available');
      assert.equal(comparison.base100.commonStartDate, '2026-08-01');
      assert.equal(comparison.base100.commonEndDate, '2026-08-05');
      assert.equal(comparison.base100.commonObservationCount, 3);
      for (const series of comparison.base100.series) {
        assert.deepEqual(series.points.map((point) => point.date), ['2026-08-01', '2026-08-04', '2026-08-05']);
        assert.equal(series.points[0].base100, 100);
        assert.ok(series.points.every((point) => point.timestamp.startsWith(point.date)));
      }
      assert.equal(JSON.stringify(comparison).includes('rank'), false);
      assert.equal(JSON.stringify(comparison).includes('score'), false);
      assert.equal(JSON.stringify(comparison).includes('recommend'), false);
    });

    it('reports insufficient data instead of index-aligning series without two common dates', () => {
      const result = buildCommonDateBase100([
        {
          symbol: 'FPT',
          quoteCurrency: 'VND',
          history: historyFixture('FPT', ['2026-08-01', '2026-08-02'], [100, 101], { ohlc: true })
        },
        {
          symbol: 'BTC',
          quoteCurrency: 'USD',
          history: historyFixture('BTC', ['2026-08-01', '2026-08-03'], [60000, 61000])
        }
      ]);

      assert.equal(result.status, 'insufficient_data');
      assert.equal(result.reason, 'INSUFFICIENT_COMMON_OBSERVATIONS');
      assert.equal(result.commonObservationCount, 1);
      assert.deepEqual(result.series, []);
    });

    it('exposes the production GET /api/comparison route contract', async () => {
      let receivedSymbols = null;
      let receivedRange = null;
      const app = createApp({
        getAssetComparisonFn: async (symbols, range) => {
          receivedSymbols = symbols;
          receivedRange = range;
          return {
            range,
            evaluatedAt: now.toISOString(),
            methodologyVersion: 'v2',
            assets: [],
            base100: { status: 'insufficient_data', series: [] }
          };
        }
      });
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));

      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/comparison?symbols=FPT,BTC&range=3M`);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(receivedSymbols, ['FPT', 'BTC']);
        assert.equal(receivedRange, '3M');
        assert.equal(body.data.methodologyVersion, 'v2');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
