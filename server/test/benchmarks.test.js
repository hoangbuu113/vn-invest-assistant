/**
 * Feature 25C — Portfolio Benchmark Integration Tests
 *
 * 15 deterministic oracles. NO live providers — all benchmarks are mocked.
 *
 * Oracles:
 *  1  — Identical portfolio + benchmark returns
 *  2  — Later first common date (portfolio starts before benchmark)
 *  3  — Missing benchmark date (sparse benchmark)
 *  4  — Only one common date → insufficient_data
 *  5  — Portfolio partial/unavailable (NON_VND_HISTORICAL_FX_UNAVAILABLE)
 *  6  — Zero capital break → benchmark comparison unavailable
 *  7  — VN_INDEX authority metadata verification
 *  8  — SP500 reference-only currency safety
 *  9  — Current VN day excluded from VNDIRECT bars
 * 10  — Current US day excluded per NY timezone (SP500)
 * 11  — 1Y leap-year calendar range
 * 12  — VNDIRECT provider failure → controlled error, base performance unaffected
 * 13  — Malformed VNDIRECT parallel arrays → controlled error
 * 14  — Invalid close (null/NaN/≤0) → row excluded
 * 15  — Asset universe: 49 canonical assets, VNINDEX and ^GSPC absent
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCHMARK_REGISTRY,
  BENCHMARK_IDS,
  resolveBenchmark,
  calculateBenchmarkComparison,
  portfolioTwrIsValid,
  getPortfolioBenchmark
} from '../src/benchmarks.js';
import { parseVndirectResponse } from '../src/providers/vndirect.js';
import { getPerformanceRangeStart } from '../src/performance.js';
import { createApp } from '../index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Fixed reference: 2026-08-29 in Asia/Ho_Chi_Minh
const FIXED_NOW = new Date('2026-08-29T03:00:00.000Z'); // 10:00 ICT

const VN_INDEX_DEF = BENCHMARK_REGISTRY[BENCHMARK_IDS.VN_INDEX];
const SP500_DEF = BENCHMARK_REGISTRY[BENCHMARK_IDS.SP500];

function jsonTextResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

async function requestApp(app, requestPath) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Builds a minimal valid portfolio performance result with available TWR and a wealth-index series.
 */
function makePortfolioPerf({
  twrStatus = 'available',
  twrReason = null,
  twrReturnPct = 10.0,
  series = [],
  actualStartDate = '2026-07-29',
  actualEndDate = '2026-08-28',
  range = '1M'
} = {}) {
  return {
    status: twrStatus === 'available' ? 'available' : 'partial',
    valuationCoverage: {
      status: twrStatus === 'available' ? 'complete' : 'partial',
      reasons: twrReason ? [twrReason] : []
    },
    twr: {
      status: twrStatus,
      returnPct: twrStatus === 'available' ? twrReturnPct : null,
      reason: twrReason
    },
    period: {
      range,
      actualStartDate,
      endDate: actualEndDate
    },
    series
  };
}

/**
 * Creates a portfolio series with given {date, twrIndex} pairs.
 */
function makeSeries(entries) {
  return entries.map(([date, twrIndex]) => ({ date, twrIndex }));
}

/**
 * Creates benchmark bars with given {date, close} pairs.
 */
function makeBars(entries) {
  return entries.map(([date, close]) => ({ date, close }));
}

// ---------------------------------------------------------------------------
// ORACLE 1 — Identical portfolio + benchmark returns
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 1: Identical returns', () => {
  it('portfolioBase100 and benchmarkBase100 move identically; returns are both 10%', () => {
    // Portfolio wealth index: 100 → 105 → 110
    const series = makeSeries([
      ['2026-08-01', 100.0],
      ['2026-08-15', 105.0],
      ['2026-08-28', 110.0]
    ]);
    // Benchmark close: 200 → 210 → 220
    const bars = makeBars([
      ['2026-08-01', 200.0],
      ['2026-08-15', 210.0],
      ['2026-08-28', 220.0]
    ]);

    const perf = makePortfolioPerf({ series });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'available');
    assert.equal(result.period.commonDatesCount, 3);
    assert.equal(result.period.commonStartDate, '2026-08-01');
    assert.equal(result.period.commonEndDate, '2026-08-28');

    // Both rebased to exactly 100 at first common date
    assert.equal(result.series[0].portfolioBase100, 100.0);
    assert.equal(result.series[0].benchmarkBase100, 100.0);

    // Mid point: 105/100*100 = 105, 210/200*100 = 105
    assert.ok(Math.abs(result.series[1].portfolioBase100 - 105.0) < 1e-9);
    assert.ok(Math.abs(result.series[1].benchmarkBase100 - 105.0) < 1e-9);

    // End point: 110/100*100 = 110, 220/200*100 = 110
    assert.ok(Math.abs(result.series[2].portfolioBase100 - 110.0) < 1e-9);
    assert.ok(Math.abs(result.series[2].benchmarkBase100 - 110.0) < 1e-9);

    // Portfolio return: (110-100)/100 * 100 = 10%
    assert.ok(Math.abs(result.portfolio.returnPctOnCommonPeriod - 10.0) < 1e-9);
    // Benchmark return: (220-200)/200 * 100 = 10%
    assert.ok(Math.abs(result.benchmarkReturnPct - 10.0) < 1e-9);
    // Difference: 0
    assert.ok(Math.abs(result.returnDifferencePctPoints - 0.0) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 2 — Later first common date
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 2: Later first common date', () => {
  it('common dates start at first date present in BOTH portfolio and benchmark', () => {
    // Portfolio: Jan01, Jan02, Jan03
    const series = makeSeries([
      ['2026-01-01', 100.0],
      ['2026-01-02', 102.0],
      ['2026-01-03', 104.0]
    ]);
    // Benchmark: only Jan02, Jan03
    const bars = makeBars([
      ['2026-01-02', 200.0],
      ['2026-01-03', 220.0]
    ]);

    const perf = makePortfolioPerf({ series, actualStartDate: '2026-01-01', actualEndDate: '2026-01-03' });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'available');
    assert.equal(result.period.commonDatesCount, 2);
    assert.equal(result.period.commonStartDate, '2026-01-02');
    assert.equal(result.period.commonEndDate, '2026-01-03');

    // First common date rebased to 100 each
    assert.equal(result.series[0].date, '2026-01-02');
    assert.equal(result.series[0].portfolioBase100, 100.0);
    assert.equal(result.series[0].benchmarkBase100, 100.0);

    // Second point: portfolio 104/102*100, benchmark 220/200*100
    assert.ok(Math.abs(result.series[1].portfolioBase100 - (104.0 / 102.0 * 100.0)) < 1e-9);
    assert.ok(Math.abs(result.series[1].benchmarkBase100 - (220.0 / 200.0 * 100.0)) < 1e-9);

    // Returns use Jan02→Jan03 endpoints
    assert.ok(Math.abs(result.portfolio.returnPctOnCommonPeriod - ((104.0 / 102.0 - 1) * 100)) < 1e-9);
    assert.ok(Math.abs(result.benchmarkReturnPct - ((220.0 / 200.0 - 1) * 100)) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 3 — Missing benchmark date (sparse benchmark)
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 3: Sparse benchmark (missing date)', () => {
  it('only dates present in BOTH series appear in result — no Jan02 when benchmark lacks it', () => {
    // Portfolio: Jan01, Jan02, Jan03
    const series = makeSeries([
      ['2026-01-01', 100.0],
      ['2026-01-02', 103.0],
      ['2026-01-03', 108.0]
    ]);
    // Benchmark: Jan01 and Jan03 only — no Jan02
    const bars = makeBars([
      ['2026-01-01', 500.0],
      ['2026-01-03', 550.0]
    ]);

    const perf = makePortfolioPerf({ series, actualStartDate: '2026-01-01', actualEndDate: '2026-01-03' });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'available');
    assert.equal(result.period.commonDatesCount, 2);
    assert.deepEqual(result.series.map((s) => s.date), ['2026-01-01', '2026-01-03']);

    // No Jan02 in series
    assert.equal(result.series.length, 2);

    // Returns from Jan01 to Jan03
    assert.ok(Math.abs(result.portfolio.returnPctOnCommonPeriod - ((108 / 100 - 1) * 100)) < 1e-9);
    assert.ok(Math.abs(result.benchmarkReturnPct - ((550 / 500 - 1) * 100)) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 4 — Only one common date → insufficient_data
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 4: One common date', () => {
  it('returns insufficient_data with INSUFFICIENT_COMMON_DATES when only 1 common date', () => {
    const series = makeSeries([
      ['2026-08-01', 100.0],
      ['2026-08-28', 105.0]
    ]);
    // Benchmark only has Aug01 — not Aug28
    const bars = makeBars([
      ['2026-08-01', 200.0]
    ]);

    const perf = makePortfolioPerf({ series });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.reason, 'INSUFFICIENT_COMMON_DATES');
    assert.equal(result.portfolio.returnPctOnCommonPeriod, null);
    assert.equal(result.benchmarkReturnPct, null);
    assert.equal(result.returnDifferencePctPoints, null);
    assert.deepEqual(result.series, []);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 5 — Portfolio partial/unavailable due to non-VND asset
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 5: Portfolio partial due to NON_VND_HISTORICAL_FX_UNAVAILABLE', () => {
  it('benchmark comparison is unavailable when portfolio TWR is unavailable', () => {
    const perf = makePortfolioPerf({
      twrStatus: 'unavailable',
      twrReason: 'NON_VND_HISTORICAL_FX_UNAVAILABLE',
      series: []
    });
    const bars = makeBars([['2026-08-01', 200.0], ['2026-08-28', 210.0]]);

    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'NON_VND_HISTORICAL_FX_UNAVAILABLE');
    assert.equal(result.portfolio.returnPctOnCommonPeriod, null);
    assert.equal(result.benchmarkReturnPct, null);
    assert.deepEqual(result.series, []);
  });

  it('does not trust an available-looking TWR when valuation coverage is incomplete', () => {
    const perf = makePortfolioPerf({
      series: makeSeries([['2026-08-01', 100], ['2026-08-28', 110]])
    });
    perf.status = 'partial';
    perf.valuationCoverage = {
      status: 'partial',
      reasons: ['INCOMPLETE_VALUATION_COVERAGE']
    };

    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: makeBars([['2026-08-01', 200], ['2026-08-28', 220]])
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'INCOMPLETE_VALUATION_COVERAGE');
    assert.equal(result.benchmarkReturnPct, null);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 6 — Zero capital break → benchmark comparison unavailable
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 6: Zero capital break', () => {
  it('benchmark comparison unavailable when TWR status is ZERO_CAPITAL_BREAK', () => {
    const perf = makePortfolioPerf({
      twrStatus: 'unavailable',
      twrReason: 'ZERO_CAPITAL_BREAK',
      series: []
    });
    const bars = makeBars([['2026-08-01', 200.0], ['2026-08-28', 210.0]]);

    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'ZERO_CAPITAL_BREAK');
    assert.equal(result.portfolio.returnPctOnCommonPeriod, null);
    assert.equal(result.benchmarkReturnPct, null);
    assert.equal(result.period, null);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 7 — VN_INDEX authority metadata
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 7: VN_INDEX authority definition', () => {
  it('BENCHMARK_REGISTRY has correct VN_INDEX metadata', () => {
    const def = BENCHMARK_REGISTRY[BENCHMARK_IDS.VN_INDEX];
    assert.equal(def.id, 'VN_INDEX');
    assert.equal(def.name, 'VN-Index');
    assert.equal(def.provider, 'VNDIRECT');
    assert.equal(def.providerIdentifier, 'VNINDEX');
    assert.equal(def.quoteCurrency, 'VND');
    assert.equal(def.returnType, 'PRICE_RETURN');
    assert.equal(def.marketPolicy, 'VN_EXCHANGE');
    assert.equal(def.marketTimezone, 'Asia/Ho_Chi_Minh');
    assert.equal(def.comparability, 'VND_COMPARABLE');
  });

  it('resolveBenchmark returns VN_INDEX definition', () => {
    const def = resolveBenchmark('VN_INDEX');
    assert.equal(def.id, 'VN_INDEX');
    assert.equal(def.quoteCurrency, 'VND');
  });

  it('resolveBenchmark throws 400 for unknown benchmark ID', () => {
    try {
      resolveBenchmark('UNKNOWN_BENCH');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'UNKNOWN_BENCHMARK');
    }
  });

  it('resolveBenchmark throws 400 for missing benchmark ID', () => {
    try {
      resolveBenchmark(null);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'INVALID_BENCHMARK_ID');
    }
  });

  it('VN_INDEX response includes returnDifferencePctPoints (VND_COMPARABLE)', () => {
    const series = makeSeries([['2026-08-01', 100.0], ['2026-08-28', 110.0]]);
    const bars = makeBars([['2026-08-01', 200.0], ['2026-08-28', 220.0]]);
    const perf = makePortfolioPerf({ series });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: VN_INDEX_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });
    assert.equal(result.status, 'available');
    assert.ok(result.returnDifferencePctPoints !== undefined);
    // Both 10% so difference is 0
    assert.ok(Math.abs(result.returnDifferencePctPoints) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 8 — SP500 reference-only currency safety
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 8: SP500 reference-only currency safety', () => {
  it('BENCHMARK_REGISTRY has correct SP500 reference-only metadata', () => {
    const def = BENCHMARK_REGISTRY[BENCHMARK_IDS.SP500];
    assert.equal(def.id, 'SP500');
    assert.equal(def.provider, 'YAHOO');
    assert.equal(def.providerIdentifier, '^GSPC');
    assert.equal(def.quoteCurrency, 'USD');
    assert.equal(def.returnType, 'PRICE_RETURN');
    assert.equal(def.comparability, 'REFERENCE_ONLY_CURRENCY_MISMATCH');
    assert.equal(def.currencyAdjusted, false);
    assert.equal(def.currencyMismatchReason, 'HISTORICAL_FX_UNAVAILABLE');
  });

  it('SP500 comparison has no returnDifferencePctPoints (REFERENCE_ONLY)', () => {
    const series = makeSeries([['2026-08-01', 100.0], ['2026-08-28', 112.0]]);
    const bars = makeBars([['2026-08-01', 5000.0], ['2026-08-28', 5300.0]]);
    const perf = makePortfolioPerf({ series });
    const result = calculateBenchmarkComparison({
      portfolioPerformance: perf,
      benchmarkDef: SP500_DEF,
      benchmarkBars: bars,
      now: FIXED_NOW
    });
    assert.equal(result.status, 'available');
    // returnDifferencePctPoints must be null for REFERENCE_ONLY
    assert.equal(result.returnDifferencePctPoints, null);
    // But benchmark and portfolio returns are present
    assert.ok(typeof result.benchmarkReturnPct === 'number');
    assert.ok(typeof result.portfolio.returnPctOnCommonPeriod === 'number');
    // benchmark metadata must expose currency mismatch
    assert.equal(result.benchmark.comparability, 'REFERENCE_ONLY_CURRENCY_MISMATCH');
    assert.equal(result.benchmark.currencyAdjusted, false);
    assert.equal(result.benchmark.portfolioReportingCurrency, 'VND');
    assert.equal(result.benchmark.benchmarkQuoteCurrency, 'USD');
  });
});

// ---------------------------------------------------------------------------
// ORACLE 9 — Current VN day excluded from VNDIRECT bars
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 9: VNDIRECT current VN day exclusion', () => {
  it('production service excludes a provider-supplied bar on the current Vietnam date', async () => {
    const dates = ['2026-08-27', '2026-08-28', '2026-08-29'];
    const portfolio = makePortfolioPerf({
      series: makeSeries(dates.map((date, index) => [date, 100 + index])),
      actualStartDate: dates[0],
      actualEndDate: dates.at(-1)
    });
    let requestUrl;
    let requestHeaders;
    const result = await getPortfolioBenchmark({
      benchmarkId: 'VN_INDEX',
      range: '1M',
      now: FIXED_NOW,
      getPortfolioPerformanceFn: async () => portfolio,
      fetchFn: async (url, options) => {
        requestUrl = new URL(url);
        requestHeaders = options.headers;
        return jsonTextResponse({
          s: 'ok',
          t: dates.map((date) => Date.parse(`${date}T00:00:00.000Z`) / 1000),
          o: [1820, 1833.27, 1832],
          h: [1830, 1838.2, 1840],
          l: [1810, 1819.16, 1825],
          c: [1825, 1832.12, 1835.5],
          v: [500000000, 562184482, 100000]
        });
      }
    });

    assert.deepEqual(result.series.map((point) => point.date), ['2026-08-27', '2026-08-28']);
    assert.equal(result.provenance.latestCompletedDate, '2026-08-28');
    assert.equal(requestUrl.searchParams.get('resolution'), 'D');
    assert.equal(requestUrl.searchParams.get('symbol'), 'VNINDEX');
    assert.equal(requestHeaders.Accept, '*/*');
    assert.equal('Cookie' in requestHeaders, false);
    assert.equal('Authorization' in requestHeaders, false);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 10 — Current US day excluded for SP500
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 10: SP500 current US day exclusion', () => {
  it('production service reuses Yahoo normalization and excludes the current New York date', async () => {
    const nowInTest = new Date('2026-08-29T03:00:00.000Z'); // 23:00 NY Aug28
    const dates = ['2026-08-26', '2026-08-27', '2026-08-28'];
    const portfolio = makePortfolioPerf({
      series: makeSeries(dates.map((date, index) => [date, 100 + index])),
      actualStartDate: dates[0],
      actualEndDate: dates.at(-1)
    });
    let requestedUrl;
    const result = await getPortfolioBenchmark({
      benchmarkId: 'SP500',
      range: '1M',
      now: nowInTest,
      getPortfolioPerformanceFn: async () => portfolio,
      fetchFn: async (url) => {
        requestedUrl = new URL(url);
        return jsonTextResponse({
          chart: {
            result: [{
              meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' },
              timestamp: dates.map((date) => Date.parse(`${date}T13:30:00.000Z`) / 1000),
              indicators: {
                quote: [{
                  open: [6400, 6410, 6420],
                  high: [6420, 6430, 6440],
                  low: [6390, 6400, 6410],
                  close: [6410, 6420, 6430],
                  volume: [100, 110, 120]
                }]
              }
            }]
          }
        });
      }
    });

    assert.equal(requestedUrl.pathname.endsWith('/%5EGSPC'), true);
    assert.equal(requestedUrl.searchParams.get('interval'), '1d');
    assert.deepEqual(result.series.map((point) => point.date), ['2026-08-26', '2026-08-27']);
    assert.equal(result.provenance.latestCompletedDate, '2026-08-27');
    assert.equal(result.returnDifferencePctPoints, null);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 11 — 1Y leap-year calendar range
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 11: 1Y leap-year calendar range', () => {
  it('service requests the Feature 25B calendar-year endpoints without reducing them to 365 days', async () => {
    assert.equal(getPerformanceRangeStart('2025-02-28', '1Y'), '2024-02-28');
    const portfolio = makePortfolioPerf({
      range: '1Y',
      actualStartDate: '2024-02-28',
      actualEndDate: '2025-02-28',
      series: makeSeries([
        ['2024-02-28', 100],
        ['2025-02-28', 110]
      ])
    });
    let requestedUrl;
    const result = await getPortfolioBenchmark({
      benchmarkId: 'VN_INDEX',
      range: '1Y',
      now: new Date('2025-03-01T03:00:00.000Z'),
      getPortfolioPerformanceFn: async ({ range }) => {
        assert.equal(range, '1Y');
        return portfolio;
      },
      fetchFn: async (url) => {
        requestedUrl = new URL(url);
        return jsonTextResponse({
          s: 'ok',
          t: [
            Date.parse('2024-02-28T00:00:00.000Z') / 1000,
            Date.parse('2025-02-28T00:00:00.000Z') / 1000
          ],
          o: [1200, 1400], h: [1210, 1410], l: [1190, 1390],
          c: [1205, 1405], v: [1000, 2000]
        });
      }
    });

    assert.equal(new Date(Number(requestedUrl.searchParams.get('from')) * 1000).toISOString(), '2024-02-28T00:00:00.000Z');
    assert.equal(new Date(Number(requestedUrl.searchParams.get('to')) * 1000).toISOString(), '2025-03-01T00:00:00.000Z');
    assert.equal(result.period.commonStartDate, '2024-02-28');
    assert.equal(result.period.commonEndDate, '2025-02-28');
  });
});

// ---------------------------------------------------------------------------
// ORACLE 12 — VNDIRECT provider failure → controlled error
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 12: VNDIRECT provider failure isolation', () => {
  it('getPortfolioBenchmark throws a controlled provider error when VNDIRECT fails', async () => {
    // Mock portfolio performance (valid TWR)
    const series = makeSeries([['2026-08-01', 100.0], ['2026-08-28', 108.0]]);
    const mockPerfFn = async () => makePortfolioPerf({ series, actualStartDate: '2026-08-01', actualEndDate: '2026-08-28' });

    // Mock fetch that throws a network error
    const failingFetch = async () => {
      throw new Error('network unreachable https://secret-upstream.example/internal?token=do-not-leak');
    };

    let caughtError;
    try {
      await getPortfolioBenchmark({
        benchmarkId: 'VN_INDEX',
        range: '1M',
        now: FIXED_NOW,
        getPortfolioPerformanceFn: mockPerfFn,
        fetchFn: failingFetch
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Should have thrown a controlled error');
    assert.equal(caughtError.message, "Benchmark data for 'VN_INDEX' is temporarily unavailable");
    assert.equal(caughtError.code, 'PROVIDER_CONNECTION_ERROR');
    assert.equal(caughtError.status, 502);
  });

  it('base /api/portfolio/performance is unaffected by benchmark provider failure (route isolation)', async () => {
    // Mock performance function succeeds
    const series = makeSeries([['2026-08-01', 100.0], ['2026-08-28', 108.0]]);
    const mockPerfFn = async () => makePortfolioPerf({ series, actualStartDate: '2026-08-01', actualEndDate: '2026-08-28' });

    const app = createApp({
      getPortfolioPerformanceFn: mockPerfFn,
      // Other services not needed for this route test
      checkSupabaseConnectionFn: async () => ({ connected: false })
    });

    const response = await requestApp(app, '/api/portfolio/performance?range=1M');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.ok(response.body.data, 'Expected data field');
  });
});

// ---------------------------------------------------------------------------
// ORACLE 13 — Malformed VNDIRECT parallel arrays
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 13: Malformed VNDIRECT parallel arrays', () => {
  it('parseVndirectResponse throws PROVIDER_MALFORMED_RESPONSE when arrays have different lengths', () => {
    const malformed = {
      s: 'ok',
      t: [1787875200, 1787961600], // length 2
      o: [1833.27],                 // length 1 — mismatch!
      h: [1838.2, 1840.0],
      l: [1819.16, 1825.0],
      c: [1832.12, 1835.5],
      v: [562184482, 100000]
    };

    try {
      parseVndirectResponse(malformed, 'VNINDEX');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.code, 'PROVIDER_MALFORMED_RESPONSE');
    }
  });

  it('parseVndirectResponse throws PROVIDER_MALFORMED_RESPONSE when arrays are missing', () => {
    const malformed = { s: 'ok', t: [1787875200] }; // no o/h/l/c/v

    try {
      parseVndirectResponse(malformed, 'VNINDEX');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.code, 'PROVIDER_MALFORMED_RESPONSE');
    }
  });

  it('parseVndirectResponse returns no_data bars when s=no_data', () => {
    const noData = { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
    const { bars } = parseVndirectResponse(noData, 'VNINDEX');
    assert.deepEqual(bars, []);
  });

  it('unexpected provider status cannot leak raw upstream text', () => {
    assert.throws(
      () => parseVndirectResponse({ s: '<html>subscribe at https://upstream.example</html>' }, 'VNINDEX'),
      (error) => (
        error.code === 'PROVIDER_ERROR' &&
        !error.message.includes('<html>') &&
        !error.message.includes('https://')
      )
    );
  });
});

// ---------------------------------------------------------------------------
// ORACLE 14 — Invalid close excluded
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 14: Invalid close rows excluded', () => {
  it('parseVndirectResponse excludes rows with null, NaN, zero, or negative close', () => {
    const raw = {
      s: 'ok',
      t: [1787875200, 1787961600, 1788048000, 1788134400, 1788220800],
      o: [1833.0,  1830.0,  1835.0,  1840.0,  1845.0],
      h: [1840.0,  1838.0,  1842.0,  1848.0,  1850.0],
      l: [1820.0,  1825.0,  1828.0,  1832.0,  1838.0],
      c: [1832.12, null,    0,       -100,     NaN    ], // 4 invalid closes
      v: [562000,  100000,  200000,  300000,  400000 ]
    };

    const { bars } = parseVndirectResponse(raw, 'VNINDEX');
    // Only the first row has a valid close
    assert.equal(bars.length, 1);
    assert.equal(bars[0].close, 1832.12);
    assert.equal(bars[0].date, '2026-08-28');
  });

  it('parseVndirectResponse excludes rows with invalid timestamps', () => {
    const raw = {
      s: 'ok',
      t: [null, 0, -1, 1787875200],      // first 3 invalid
      o: [1830.0, 1831.0, 1832.0, 1833.0],
      h: [1840.0, 1841.0, 1842.0, 1843.0],
      l: [1820.0, 1821.0, 1822.0, 1823.0],
      c: [1835.0, 1836.0, 1837.0, 1832.12],
      v: [100,    200,    300,    400    ]
    };

    const { bars } = parseVndirectResponse(raw, 'VNINDEX');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].date, '2026-08-28');
  });

  it('does not emit contradictory OHLC and preserves missing optional fields as null', () => {
    const raw = {
      s: 'ok',
      t: [
        Date.parse('2026-08-27T00:00:00.000Z') / 1000,
        Date.parse('2026-08-28T00:00:00.000Z') / 1000
      ],
      o: [110, null],
      h: [105, null],
      l: [90, null],
      c: [100, 101.123456789],
      v: [1000.5, null]
    };

    const { bars } = parseVndirectResponse(raw, 'VNINDEX');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].date, '2026-08-28');
    assert.equal(bars[0].open, null);
    assert.equal(bars[0].high, null);
    assert.equal(bars[0].low, null);
    assert.equal(bars[0].close, 101.123456789);
    assert.equal(bars[0].volume, null);
  });
});

// ---------------------------------------------------------------------------
// ORACLE 15 — Asset universe: 49 canonical, VNINDEX and ^GSPC absent
// ---------------------------------------------------------------------------
describe('Feature 25C — ORACLE 15: Asset universe invariant', () => {
  it('canonical seed contains exactly 49 investable assets and no benchmark identities', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const seedSql = fs.readFileSync(path.resolve(testDir, '../db/seed.sql'), 'utf8');
    const assetBlock = seedSql.match(/INSERT INTO public\.assets[\s\S]*?VALUES([\s\S]*?)ON CONFLICT \(symbol\) DO NOTHING;/)?.[1];
    assert.ok(assetBlock, 'Canonical asset seed block must exist');

    const seededSymbols = [...assetBlock.matchAll(/\(\s*'[0-9a-f-]{36}',\s*'([^']+)'/g)]
      .map((match) => match[1]);
    assert.equal(seededSymbols.length, 49);
    assert.equal(new Set(seededSymbols).size, 49);
    assert.equal(seededSymbols.includes('VNINDEX'), false);
    assert.equal(seededSymbols.includes('^GSPC'), false);
    assert.equal(Object.keys(BENCHMARK_IDS).length, 2);
  });

  it('benchmark API route returns 400 for unknown benchmark ID', async () => {
    const mockPerfFn = async () => makePortfolioPerf({ series: [] });
    const app = createApp({
      getPortfolioPerformanceFn: mockPerfFn,
      checkSupabaseConnectionFn: async () => ({ connected: false })
    });

    const response = await requestApp(
      app,
      '/api/portfolio/performance/benchmark?range=1M&benchmark=FAKE_INDEX'
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'error');
    assert.equal(response.body.code, 'UNKNOWN_BENCHMARK');
  });

  it('benchmark API route returns 400 for missing benchmark parameter', async () => {
    const mockPerfFn = async () => makePortfolioPerf({ series: [] });
    const app = createApp({
      getPortfolioPerformanceFn: mockPerfFn,
      checkSupabaseConnectionFn: async () => ({ connected: false })
    });

    const response = await requestApp(app, '/api/portfolio/performance/benchmark?range=1M');

    assert.equal(response.status, 400);
    assert.equal(response.body.status, 'error');
    assert.ok(response.body.code);
  });

  it('benchmark API route rejects an unknown range before invoking Feature 25B', async () => {
    let performanceCalled = false;
    const app = createApp({
      getPortfolioPerformanceFn: async () => {
        performanceCalled = true;
        return makePortfolioPerf();
      },
      checkSupabaseConnectionFn: async () => ({ connected: false })
    });

    const response = await requestApp(
      app,
      '/api/portfolio/performance/benchmark?range=ALL&benchmark=VN_INDEX'
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_PERFORMANCE_RANGE');
    assert.equal(performanceCalled, false);
  });
});
