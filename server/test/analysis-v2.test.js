import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ANALYSIS_METHODOLOGY_VERSION,
  ANALYSIS_PERIODS,
  analyzeCanonicalHistory,
  getAssetAnalysis
} from '../src/analysis.js';
import { createApp } from '../index.js';

const ASSETS = Object.freeze({
  stock: Object.freeze({
    symbol: 'FPT',
    assetType: 'stock',
    marketPolicy: 'VN_EXCHANGE',
    marketTimezone: 'Asia/Ho_Chi_Minh',
    quoteCurrency: 'VND'
  }),
  etf: Object.freeze({
    symbol: 'E1VFVN30',
    assetType: 'etf',
    marketPolicy: 'VN_EXCHANGE',
    marketTimezone: 'Asia/Ho_Chi_Minh',
    quoteCurrency: 'VND'
  }),
  crypto: Object.freeze({
    symbol: 'BTC',
    assetType: 'crypto',
    marketPolicy: 'CONTINUOUS_24_7',
    marketTimezone: 'UTC',
    quoteCurrency: 'USD'
  }),
  gold: Object.freeze({
    symbol: 'XAU/USD',
    assetType: 'gold',
    marketPolicy: 'GLOBAL_24_5',
    marketTimezone: 'UTC',
    quoteCurrency: 'USD'
  })
});

const OHLCV_CAPABILITIES = Object.freeze({ close: true, ohlc: true, volume: true });
const CLOSE_ONLY_CAPABILITIES = Object.freeze({ close: true, ohlc: false, volume: false });

function canonicalBar(date, close, options = {}) {
  const hour = options.hour ?? '02:00:00.000Z';
  return {
    timestamp: `${date}T${hour}`,
    date,
    open: options.open === undefined ? close : options.open,
    high: options.high === undefined ? close + 5 : options.high,
    low: options.low === undefined ? close - 5 : options.low,
    close,
    volume: options.volume === undefined ? 1000 : options.volume,
    isComplete: true
  };
}

function canonicalHistory({
  asset = ASSETS.stock,
  bars,
  range = '1Y',
  capabilities = OHLCV_CAPABILITIES,
  completeness = 'complete',
  warnings = []
}) {
  return {
    ...asset,
    range,
    interval: '1d',
    freshness: 'delayed',
    historyCapabilities: { ...capabilities },
    updatedAt: bars.at(-1)?.timestamp ?? null,
    dataAsOf: bars.at(-1)?.date ?? null,
    dataCompleteness: completeness,
    bars,
    warnings
  };
}

function dailyBars(startDate, count, priceFn = (index) => 100 + index) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + (index * 86400000)).toISOString().slice(0, 10);
    return canonicalBar(date, priceFn(index));
  });
}

function closeOnlyBars(values, startDate = '2026-08-20') {
  return dailyBars(startDate, values.length, (index) => values[index]).map((bar) => ({
    ...bar,
    open: null,
    high: null,
    low: null,
    volume: null
  }));
}

describe('Feature 22 — Deterministic Analysis V2', () => {
  test('A. VN stock canonical OHLCV history is supported', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({ bars: dailyBars('2026-08-20', 4) }), {
      requestedRange: '1W'
    });
    assert.equal(result.assetType, 'stock');
    assert.equal(result.periods['1W'].status, 'available');
    assert.deepEqual(result.historyCapabilities, OHLCV_CAPABILITIES);
  });

  test('B. VN ETF canonical OHLCV history is supported', () => {
    const history = canonicalHistory({ asset: ASSETS.etf, bars: dailyBars('2026-08-20', 4) });
    const result = analyzeCanonicalHistory(history, { requestedRange: '1W' });
    assert.equal(result.symbol, 'E1VFVN30');
    assert.equal(result.assetType, 'etf');
    assert.equal(result.marketPolicy, 'VN_EXCHANGE');
  });

  test('C. crypto close-only canonical history is supported', () => {
    const history = canonicalHistory({
      asset: ASSETS.crypto,
      bars: closeOnlyBars([100, 105, 103]),
      capabilities: CLOSE_ONLY_CAPABILITIES
    });
    const result = analyzeCanonicalHistory(history, { requestedRange: '1W' });
    assert.equal(result.analysisPrice, 103);
    assert.equal(result.periods['1W'].priceChangePct, 3.0000000000000027);
  });

  test('D. crypto weekend completed dates remain usable observations', () => {
    const bars = [
      canonicalBar('2026-08-21', 100),
      canonicalBar('2026-08-22', 101),
      canonicalBar('2026-08-23', 102)
    ].map((bar) => ({ ...bar, open: null, high: null, low: null, volume: null }));
    const result = analyzeCanonicalHistory(canonicalHistory({
      asset: ASSETS.crypto,
      bars,
      capabilities: CLOSE_ONLY_CAPABILITIES
    }), { requestedRange: '1W' });
    assert.equal(result.periods['1W'].usableCompletedBarCount, 3);
    assert.equal(result.periods['1W'].positiveCloseTransitionRatio, 1);
  });

  test('E. gold close-only canonical history is supported', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      asset: ASSETS.gold,
      bars: closeOnlyBars([3300, 3310, 3295]),
      capabilities: CLOSE_ONLY_CAPABILITIES
    }), { requestedRange: '1W' });
    assert.equal(result.assetType, 'gold');
    assert.equal(result.quoteCurrency, 'USD');
    assert.equal(result.periods['1W'].status, 'available');
  });

  test('F. known FX asset with unsupported history returns HTTP 422 and code', async () => {
    const unsupportedHistory = async () => {
      const error = new Error('Historical data is unsupported');
      error.status = 422;
      error.code = 'UNSUPPORTED_HISTORY';
      throw error;
    };
    const app = createApp({
      getMarketHistoryFn: unsupportedHistory,
      getMarketSnapshotFn: async () => ({ price: 26000 })
    });
    const server = app.listen(0);
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analysis/USD%2FVND`);
      assert.equal(response.status, 422);
      const body = await response.json();
      assert.equal(body.code, 'UNSUPPORTED_HISTORY');
    } finally {
      server.close();
    }
  });

  test('G/H. analysis price and canonical date come from final completed close', () => {
    const bars = [canonicalBar('2026-08-20', 100), canonicalBar('2026-08-22', 123.456789)];
    const result = analyzeCanonicalHistory(canonicalHistory({ bars }), { requestedRange: '1W' });
    assert.equal(result.analysisPrice, 123.456789);
    assert.equal(result.analysisPriceDate, '2026-08-22');
    assert.equal(result.analysisAsOf, '2026-08-22T02:00:00.000Z');
  });

  test('I. newer snapshot does not alter analysis price or any historical formula', () => {
    const history = canonicalHistory({ bars: dailyBars('2026-08-20', 3) });
    const baseline = analyzeCanonicalHistory(history, { requestedRange: '1W', snapshot: null });
    const withSnapshot = analyzeCanonicalHistory(history, {
      requestedRange: '1W',
      snapshot: { price: 999999, priceAsOf: '2026-08-24T10:00:00.000Z', priceSource: 'fixture' }
    });
    assert.equal(withSnapshot.snapshot.price, 999999);
    assert.equal(withSnapshot.analysisPrice, baseline.analysisPrice);
    assert.deepEqual(withSnapshot.periods, baseline.periods);
  });

  test('J. price change uses direct full-precision closes', () => {
    const start = 33781.234567;
    const end = 35294.876543;
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: [canonicalBar('2026-08-20', start), canonicalBar('2026-08-21', end)]
    }), { requestedRange: '1W' });
    const period = result.periods['1W'];
    assert.equal(period.absoluteChange, end - start);
    assert.equal(period.priceChangePct, ((end / start) - 1) * 100);
    assert.notEqual(period.priceChangePct, ((Math.round((end - start) * 100) / 100) / start) * 100);
  });

  test('K/L/N. completed-close high, low, range position, and distance are exact', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: [
        canonicalBar('2026-08-20', 100, { high: 130, low: 90 }),
        canonicalBar('2026-08-21', 80, { high: 125, low: 70 }),
        canonicalBar('2026-08-22', 90, { high: 120, low: 75 })
      ]
    }), { requestedRange: '1W' });
    const period = result.periods['1W'];
    assert.equal(period.highestCompletedClose, 100);
    assert.equal(period.lowestCompletedClose, 80);
    assert.equal(period.completedCloseRangePositionPct, 50);
    assert.equal(period.distanceBelowHighestCompletedClosePct, 10);
  });

  test('M. flat completed-close range is null with explicit unavailable reason', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', 3, () => 100)
    }), { requestedRange: '1W' });
    const period = result.periods['1W'];
    assert.equal(period.completedCloseRangePositionPct, null);
    assert.deepEqual(period.metricStatus.completedCloseRangePositionPct, {
      status: 'unavailable',
      reason: 'FLAT_CLOSE_RANGE'
    });
    assert.equal(period.distanceBelowHighestCompletedClosePct, 0);
    assert.equal(period.metricStatus.distanceBelowHighestCompletedClosePct.status, 'available');
  });

  test('O. positive close transition ratio includes flat transitions in denominator', () => {
    const values = [100, 110, 110, 105, 120];
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', values.length, (index) => values[index])
    }), { requestedRange: '1W' });
    assert.equal(result.periods['1W'].positiveCloseTransitionRatio, 2 / 4);
    assert.equal(result.periods['1W'].metricStatus.positiveCloseTransitionRatio.status, 'available');
  });

  test('P. daily volatility is the full-precision non-annualized sample deviation', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', 3, (index) => [100, 110, 99][index])
    }), { requestedRange: '1W' });
    const changes = [(110 / 100) - 1, (99 / 110) - 1];
    const mean = (changes[0] + changes[1]) / changes.length;
    const expected = Math.sqrt(
      (((changes[0] - mean) ** 2) + ((changes[1] - mean) ** 2)) / (changes.length - 1)
    ) * 100;
    assert.equal(result.periods['1W'].dailyVolatilityPct, expected);
    assert.equal(result.methodology.dailyVolatilityAnnualized, false);
  });

  test('Q. volatility requires at least three closes', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', 2)
    }), { requestedRange: '1W' });
    assert.equal(result.periods['1W'].dailyVolatilityPct, null);
    assert.deepEqual(result.periods['1W'].metricStatus.dailyVolatilityPct, {
      status: 'insufficient_data',
      reason: 'INSUFFICIENT_BARS'
    });
  });

  test('R. maximum completed-close drawdown uses the running peak', () => {
    const values = [100, 120, 90, 108];
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', values.length, (index) => values[index])
    }), { requestedRange: '1W' });
    assert.equal(result.periods['1W'].maxDrawdownPct, 25);
  });

  test('S. monotonic and flat close series have legitimate available zero drawdown', () => {
    for (const values of [[100, 101, 102], [100, 100, 100]]) {
      const result = analyzeCanonicalHistory(canonicalHistory({
        bars: dailyBars('2026-08-20', values.length, (index) => values[index])
      }), { requestedRange: '1W' });
      assert.equal(result.periods['1W'].maxDrawdownPct, 0);
      assert.equal(result.periods['1W'].metricStatus.maxDrawdownPct.status, 'available');
    }
  });

  test('T. complete VN OHLC metrics and legacy aliases remain available and identical', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: [
        canonicalBar('2026-08-20', 100, { high: 120, low: 90 }),
        canonicalBar('2026-08-21', 110, { high: 130, low: 95 })
      ]
    }), { requestedRange: '1W' });
    const period = result.periods['1W'];
    assert.equal(period.intradayHighPrice, 130);
    assert.equal(period.intradayLowPrice, 90);
    assert.equal(period.intradayRangePositionPct, 50);
    assert.equal(period.distanceBelowIntradayHighPct, (20 / 130) * 100);
    assert.equal(period.periodHighPrice, period.intradayHighPrice);
    assert.equal(period.periodLowPrice, period.intradayLowPrice);
    assert.equal(period.rangePositionPct, period.intradayRangePositionPct);
    assert.equal(period.distanceBelowHighPct, period.distanceBelowIntradayHighPct);
  });

  test('U. close-only OHLC metrics and legacy aliases are unsupported, never fabricated', () => {
    for (const asset of [ASSETS.crypto, ASSETS.gold]) {
      const result = analyzeCanonicalHistory(canonicalHistory({
        asset,
        bars: closeOnlyBars([100, 101, 102]),
        capabilities: CLOSE_ONLY_CAPABILITIES
      }), { requestedRange: '1W' });
      const period = result.periods['1W'];
      for (const field of ['intradayHighPrice', 'intradayLowPrice', 'intradayRangePositionPct', 'distanceBelowIntradayHighPct']) {
        assert.equal(period[field], null);
        assert.deepEqual(period.metricStatus[field], {
          status: 'unsupported',
          reason: 'METRIC_REQUIRES_OHLC'
        });
      }
      assert.equal(period.periodHighPrice, null);
      assert.equal(period.rangePositionPct, null);
    }
  });

  test('V. declared OHLC capability with missing observations is unavailable', () => {
    const bars = [
      canonicalBar('2026-08-20', 100, { high: 110, low: 90 }),
      canonicalBar('2026-08-21', 105, { high: null, low: 95 })
    ];
    const period = analyzeCanonicalHistory(canonicalHistory({ bars }), {
      requestedRange: '1W'
    }).periods['1W'];
    assert.equal(period.intradayHighPrice, null);
    assert.deepEqual(period.metricStatus.intradayHighPrice, {
      status: 'unavailable',
      reason: 'INCOMPLETE_OHLC'
    });
    assert.equal(period.intradayLowPrice, 90);
    assert.equal(period.metricStatus.intradayLowPrice.status, 'available');
  });

  test('W. insufficient or unavailable metrics remain null rather than numeric zero', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: [canonicalBar('2026-08-20', 100)]
    }), { requestedRange: '1W' });
    const period = result.periods['1W'];
    assert.equal(period.priceChangePct, null);
    assert.equal(period.positiveCloseTransitionRatio, null);
    assert.equal(period.dailyVolatilityPct, null);
    assert.equal(period.maxDrawdownPct, null);
    assert.equal(period.status, 'insufficient_data');
  });

  test('X. different policy bar counts do not create a false completeness difference', () => {
    const stock = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', 3),
      completeness: 'complete'
    }), { requestedRange: '1W' });
    const crypto = analyzeCanonicalHistory(canonicalHistory({
      asset: ASSETS.crypto,
      bars: closeOnlyBars([100, 101, 102, 103, 104, 105, 106, 107]),
      capabilities: CLOSE_ONLY_CAPABILITIES,
      completeness: 'complete'
    }), { requestedRange: '1W' });
    assert.equal(stock.dataCompleteness.availabilityLevel, 'complete');
    assert.equal(crypto.dataCompleteness.availabilityLevel, 'complete');
    assert.notEqual(stock.dataCompleteness.usableCompletedBarCount, crypto.dataCompleteness.usableCompletedBarCount);
  });

  test('Y. every explicit Feature 21 range is forwarded and returns only its period', async () => {
    for (const range of ANALYSIS_PERIODS) {
      let capturedRange = null;
      const result = await getAssetAnalysis('FPT', {
        range,
        now: new Date('2026-08-29T12:00:00.000Z'),
        getMarketHistoryFn: async (_symbol, requestedRange) => {
          capturedRange = requestedRange;
          return canonicalHistory({ bars: dailyBars('2026-08-20', 3), range: requestedRange });
        },
        getMarketSnapshotFn: async () => null
      });
      assert.equal(capturedRange, range);
      assert.deepEqual(Object.keys(result.periods), [range]);
      assert.equal(result.requestedRange, range);
    }
  });

  test('Z/AA. omitted range uses one 1Y source, returns five periods, and shares one end price', async () => {
    let historyCallCount = 0;
    let capturedRange = null;
    const bars = dailyBars('2025-08-28', 366);
    const result = await getAssetAnalysis('FPT', {
      now: new Date('2026-08-29T12:00:00.000Z'),
      getMarketHistoryFn: async (_symbol, range) => {
        historyCallCount++;
        capturedRange = range;
        return canonicalHistory({ bars, range });
      },
      getMarketSnapshotFn: async () => null
    });
    assert.equal(historyCallCount, 1);
    assert.equal(capturedRange, '1Y');
    assert.deepEqual(Object.keys(result.periods), ANALYSIS_PERIODS);
    for (const period of Object.values(result.periods)) {
      assert.equal(period.periodEndPrice, result.analysisPrice);
      assert.equal(period.observedEndDate, result.analysisPriceDate);
    }
  });

  test('legacy positivePeriodRatio preserves VN threshold-based cross-period breadth only', () => {
    const vnResult = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-09', 20)
    }));
    assert.equal(vnResult.crossPeriod.validPeriodCount, 2);
    assert.equal(vnResult.crossPeriod.positivePeriodRatio, null);

    const cryptoResult = analyzeCanonicalHistory(canonicalHistory({
      asset: ASSETS.crypto,
      bars: closeOnlyBars([100, 101, 102, 103]),
      capabilities: CLOSE_ONLY_CAPABILITIES
    }));
    assert.equal(cryptoResult.crossPeriod.positivePeriodRatio, null);
    assert.equal(cryptoResult.crossPeriod.validPeriodCount, 0);
  });

  test('AB. explicit sparse window is not shifted backward to manufacture observations', () => {
    const bars = [canonicalBar('2026-08-25', 100), canonicalBar('2026-08-28', 110)];
    const period = analyzeCanonicalHistory(canonicalHistory({ bars, range: '1M' }), {
      requestedRange: '1M'
    }).periods['1M'];
    assert.equal(period.observedStartDate, '2026-08-25');
    assert.equal(period.usableCompletedBarCount, 2);
    assert.equal(period.periodStartPrice, 100);
  });

  test('AC. successful analysis exposes methodologyVersion v2 and exclusions', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({ bars: dailyBars('2026-08-20', 3) }), {
      requestedRange: '1W'
    });
    assert.equal(result.methodologyVersion, ANALYSIS_METHODOLOGY_VERSION);
    assert.equal(result.methodology.methodologyVersion, 'v2');
    for (const field of [
      'dividendsIncluded',
      'distributionsIncluded',
      'feesIncluded',
      'fundingIncluded',
      'stakingYieldIncluded',
      'corporateActionsModeled'
    ]) {
      assert.equal(result.methodology[field], false);
    }
  });

  test('AD. response contains no recommendation, score, confidence, or prediction fields', () => {
    const result = analyzeCanonicalHistory(canonicalHistory({ bars: dailyBars('2026-08-20', 3) }), {
      requestedRange: '1W'
    });
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ['recommendation', 'score', 'confidence', 'prediction', 'targetprice']) {
      assert.equal(serialized.includes(forbidden), false, `Unexpected forbidden term: ${forbidden}`);
    }
  });

  test('AE. V2 methodology source contains no provider-name branches or constants', async () => {
    const source = (await readFile(new URL('../src/analysis.js', import.meta.url), 'utf8')).toLowerCase();
    for (const providerName of ['yahoo', 'coingecko', 'alphavantage', 'twelvedata']) {
      assert.equal(source.includes(providerName), false, `Provider leaked into analysis methodology: ${providerName}`);
    }
  });

  test('AF/AG. injected production path makes no default provider call and no database write', async () => {
    let historyCalls = 0;
    let snapshotCalls = 0;
    const result = await getAssetAnalysis('BTC', {
      range: '1W',
      now: new Date('2026-08-29T12:00:00.000Z'),
      getMarketHistoryFn: async () => {
        historyCalls++;
        return canonicalHistory({
          asset: ASSETS.crypto,
          bars: closeOnlyBars([100, 101, 102]),
          range: '1W',
          capabilities: CLOSE_ONLY_CAPABILITIES
        });
      },
      getMarketSnapshotFn: async () => {
        snapshotCalls++;
        return null;
      }
    });
    assert.equal(historyCalls, 1);
    assert.equal(snapshotCalls, 1);
    assert.equal(result.symbol, 'BTC');
  });

  test('route rejects an invalid explicit analysis range with controlled 400', async () => {
    const app = createApp({
      getMarketHistoryFn: async () => assert.fail('history must not be called'),
      getMarketSnapshotFn: async () => assert.fail('snapshot must not be called')
    });
    const server = app.listen(0);
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analysis/FPT?range=2Y`);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, 'INVALID_HISTORY_RANGE');
    } finally {
      server.close();
    }
  });

  test('canonical partial completeness and normalization warnings propagate independently of metrics', () => {
    const warning = { code: 'PARTIAL_HISTORY_COVERAGE', message: 'boundary not established' };
    const result = analyzeCanonicalHistory(canonicalHistory({
      bars: dailyBars('2026-08-20', 3),
      completeness: 'partial',
      warnings: [warning]
    }), { requestedRange: '1W' });
    assert.equal(result.dataCompleteness.availabilityLevel, 'partial');
    assert.equal(result.dataCompleteness.canonicalHistoryCompleteness, 'partial');
    assert.deepEqual(result.dataCompleteness.warnings, [warning]);
    assert.equal(result.periods['1W'].priceChangePct !== null, true);
  });

  test('canonical history capability metadata is mandatory and provider-neutral', () => {
    const history = canonicalHistory({ bars: dailyBars('2026-08-20', 3) });
    delete history.historyCapabilities;
    assert.throws(
      () => analyzeCanonicalHistory(history, { requestedRange: '1W' }),
      (error) => error.status === 500 && error.code === 'INVALID_HISTORY_CAPABILITIES'
    );
  });

  test('canonical asset and completeness metadata are mandatory for successful analysis', () => {
    const missingAssetType = canonicalHistory({ bars: dailyBars('2026-08-20', 3) });
    delete missingAssetType.assetType;
    assert.throws(
      () => analyzeCanonicalHistory(missingAssetType, { requestedRange: '1W' }),
      (error) => error.status === 500 && error.code === 'INVALID_HISTORY_METADATA'
    );

    const missingCompleteness = canonicalHistory({ bars: dailyBars('2026-08-20', 3) });
    delete missingCompleteness.dataCompleteness;
    assert.throws(
      () => analyzeCanonicalHistory(missingCompleteness, { requestedRange: '1W' }),
      (error) => error.status === 500 && error.code === 'INVALID_HISTORY_METADATA'
    );
  });
});
