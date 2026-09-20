import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  buildBenchmarkDisplay,
  buildPortfolioPerformanceDisplay,
  PERFORMANCE_DATA_STATES
} from '../../client/src/utils/portfolioPerformanceDisplay.js';

function makeSeries(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    portfolioValueVnd: 100_000_000 + index * 1_000_000,
    netExternalFlowVnd: 0,
    twrIndex: 100 + index
  }));
}

function makePerformance(overrides = {}) {
  return {
    status: 'available',
    period: {
      range: '1M',
      actualStartDate: '2026-09-01',
      endDate: '2026-09-05',
      clippedToInception: false
    },
    valuationCoverage: {
      status: 'complete',
      observationCount: 5,
      valuationMarks: 5,
      carriedForwardMarks: 0,
      missingValuationMarks: 0,
      reasons: []
    },
    twr: { status: 'available', returnPct: 4, reason: null },
    mwr: { status: 'available', annualizedReturnPct: 8, reason: null },
    pnl: {
      status: 'available',
      asOfDate: '2026-09-05',
      realizedPnlDuringPeriod: 1_000_000,
      cumulativeRealizedPnlToEnd: 1_500_000,
      unrealizedPnlAtEnd: 2_000_000,
      totalAccountingPnlAtEnd: 3_500_000,
      reason: null
    },
    drawdown: {
      status: 'available',
      maxDrawdownPct: -3,
      currentDrawdownPct: -1,
      peakDate: '2026-09-02',
      troughDate: '2026-09-03',
      reason: null
    },
    series: makeSeries(),
    ...overrides
  };
}

function makeBenchmark(overrides = {}) {
  return {
    status: 'available',
    reason: null,
    benchmark: {
      id: 'VN_INDEX',
      name: 'VN-Index',
      quoteCurrency: 'VND',
      comparability: 'VND_COMPARABLE'
    },
    portfolio: { returnType: 'TWR', returnPctOnCommonPeriod: 4 },
    benchmarkReturnPct: 2.5,
    returnDifferencePctPoints: 1.5,
    series: [
      { date: '2026-09-01', portfolioBase100: 100, benchmarkBase100: 100 },
      { date: '2026-09-05', portfolioBase100: 104, benchmarkBase100: 102.5 }
    ],
    ...overrides
  };
}

describe('Portfolio V1 P0.5 performance display model', () => {
  test('initial unavailable read model has a safe non-fabricated display shape', () => {
    const view = buildPortfolioPerformanceDisplay(null, { holdingsCount: 1 });
    assert.equal(view.state, PERFORMANCE_DATA_STATES.UNAVAILABLE);
    assert.equal(view.canRenderChart, false);
    assert.deepEqual(view.coverageReasons, []);
    assert.equal(view.coverage, null);
  });

  test('sufficient TWR history exposes the measured period and one chart-eligible series', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance(), { holdingsCount: 2 });
    assert.equal(view.twr.value, 4);
    assert.equal(view.observationCount, 5);
    assert.equal(view.historyMode, 'SUFFICIENT');
    assert.equal(view.canRenderChart, true);
    assert.deepEqual(view.period, {
      requestedRange: '1M',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
      clippedToInception: false
    });
  });

  test('two or three observations remain a compact sparse period instead of a large chart', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      valuationCoverage: {
        status: 'complete',
        observationCount: 3,
        valuationMarks: 3,
        carriedForwardMarks: 0,
        missingValuationMarks: 0,
        reasons: []
      },
      series: makeSeries(3)
    }), { holdingsCount: 1 });
    assert.equal(view.historyMode, 'SPARSE');
    assert.equal(view.observationCount, 3);
    assert.equal(view.twr.value, 4);
    assert.equal(view.canRenderChart, false);
  });

  test('a single valuation is insufficient history and never becomes zero return', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      status: 'insufficient_data',
      valuationCoverage: {
        status: 'complete',
        observationCount: 1,
        valuationMarks: 1,
        carriedForwardMarks: 0,
        missingValuationMarks: 0,
        reasons: []
      },
      twr: { status: 'insufficient_data', returnPct: null, reason: 'INSUFFICIENT_DATE_SPAN' },
      series: makeSeries(1)
    }), { holdingsCount: 1 });
    assert.equal(view.historyMode, 'INSUFFICIENT_HISTORY');
    assert.equal(view.twr.value, null);
    assert.equal(view.twr.state, PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY);
  });

  test('one persisted partial daily valuation is counted even when no TWR point can be formed', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      status: 'partial',
      valuationCoverage: {
        status: 'partial',
        observationCount: 1,
        valuationMarks: 0,
        carriedForwardMarks: 0,
        missingValuationMarks: 1,
        reasons: ['INCOMPLETE_DAILY_VALUATION']
      },
      twr: {
        status: 'unavailable',
        returnPct: null,
        reason: 'INCOMPLETE_DAILY_VALUATION'
      },
      series: [{
        date: '2026-09-01',
        portfolioValueVnd: null,
        netExternalFlowVnd: null,
        twrIndex: null
      }]
    }), { holdingsCount: 1 });

    assert.equal(view.observationCount, 1);
    assert.equal(view.state, PERFORMANCE_DATA_STATES.PARTIAL);
    assert.equal(view.historyMode, 'INSUFFICIENT_HISTORY');
    assert.equal(view.twr.value, null);
    assert.equal(view.canRenderChart, false);
  });

  test('MWR below one year stays unavailable with insufficient-history state', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      mwr: { status: 'insufficient_data', annualizedReturnPct: null, reason: 'INSUFFICIENT_HISTORY' }
    }), { holdingsCount: 1 });
    assert.equal(view.mwr.value, null);
    assert.equal(view.mwr.state, PERFORMANCE_DATA_STATES.INSUFFICIENT_HISTORY);
    assert.equal(view.mwr.reason, 'INSUFFICIENT_HISTORY');
  });

  test('failed or ambiguous XIRR remains null rather than zero', () => {
    for (const reason of ['NO_SIGN_CHANGE', 'NO_SOLUTION']) {
      const view = buildPortfolioPerformanceDisplay(makePerformance({
        mwr: { status: 'unavailable', annualizedReturnPct: null, reason }
      }), { holdingsCount: 1 });
      assert.equal(view.mwr.value, null);
      assert.equal(view.mwr.state, PERFORMANCE_DATA_STATES.UNAVAILABLE);
    }
  });

  test('zero drawdown is valid and suppresses meaningless peak/trough dates', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      drawdown: {
        status: 'available',
        maxDrawdownPct: 0,
        currentDrawdownPct: 0,
        peakDate: '2026-09-01',
        troughDate: '2026-09-01',
        reason: null
      }
    }), { holdingsCount: 1 });
    assert.equal(view.drawdown.value, 0);
    assert.equal(view.drawdown.isZero, true);
    assert.equal(view.drawdown.peakDate, null);
    assert.equal(view.drawdown.troughDate, null);
  });

  test('missing historical VND cost keeps dependent P/L null but preserves confirmed realized VND P/L', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      pnl: {
        status: 'partial',
        asOfDate: '2026-09-05',
        realizedPnlDuringPeriod: 0,
        cumulativeRealizedPnlToEnd: 0,
        unrealizedPnlAtEnd: null,
        totalAccountingPnlAtEnd: null,
        reason: 'NON_VND_OR_MISSING_END_PRICE'
      }
    }), { holdingsCount: 1 });
    assert.equal(view.pnl.totalAtEnd, null);
    assert.equal(view.pnl.realizedDuringPeriod, 0);
    assert.equal(view.pnl.unrealizedAtEnd, null);
    assert.equal(view.pnl.state, PERFORMANCE_DATA_STATES.PARTIAL);
  });

  test('eligible VND benchmark exposes common-period values and chart overlay', () => {
    const view = buildBenchmarkDisplay({
      benchmarkId: 'VN_INDEX',
      benchmark: makeBenchmark(),
      holdingsCount: 1
    });
    assert.equal(view.state, PERFORMANCE_DATA_STATES.AVAILABLE);
    assert.equal(view.canOverlay, true);
    assert.equal(view.differencePctPoints, 1.5);
  });

  test('USD reference benchmark remains non-comparable and never exposes a difference', () => {
    const view = buildBenchmarkDisplay({
      benchmarkId: 'SP500',
      benchmark: makeBenchmark({
        benchmark: {
          id: 'SP500',
          name: 'S&P 500',
          quoteCurrency: 'USD',
          comparability: 'REFERENCE_ONLY_CURRENCY_MISMATCH'
        },
        returnDifferencePctPoints: null
      }),
      holdingsCount: 1
    });
    assert.equal(view.isReferenceOnly, true);
    assert.equal(view.canOverlay, false);
    assert.equal(view.differencePctPoints, null);
  });

  test('no benchmark is an explicit not-applicable selection', () => {
    const view = buildBenchmarkDisplay({ benchmarkId: 'NONE', holdingsCount: 1 });
    assert.equal(view.state, PERFORMANCE_DATA_STATES.NOT_APPLICABLE);
    assert.equal(view.reason, 'BENCHMARK_NOT_SELECTED');
    assert.equal(view.canOverlay, false);
  });

  test('cash-only performance stays compact and benchmark is not applicable', () => {
    const performance = buildPortfolioPerformanceDisplay(makePerformance({
      twr: { status: 'available', returnPct: 0, reason: null },
      drawdown: { status: 'available', maxDrawdownPct: 0, currentDrawdownPct: 0, peakDate: null, troughDate: null },
      series: makeSeries(5).map((point) => ({ ...point, twrIndex: 100 }))
    }), { holdingsCount: 0 });
    const benchmark = buildBenchmarkDisplay({ benchmarkId: 'VN_INDEX', holdingsCount: 0 });
    assert.equal(performance.twr.value, 0);
    assert.equal(performance.canRenderChart, false);
    assert.equal(benchmark.state, PERFORMANCE_DATA_STATES.NOT_APPLICABLE);
    assert.equal(benchmark.reason, 'CASH_ONLY_PORTFOLIO');
  });

  test('stale historical segment is explicit and never presented as available', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      status: 'partial',
      valuationCoverage: {
        status: 'partial',
        valuationMarks: 3,
        carriedForwardMarks: 0,
        missingValuationMarks: 2,
        reasons: ['STALE_VALUATION_MARK']
      },
      twr: { status: 'unavailable', returnPct: null, reason: 'STALE_VALUATION_MARK' }
    }), { holdingsCount: 1 });
    assert.equal(view.state, PERFORMANCE_DATA_STATES.STALE);
    assert.equal(view.twr.value, null);
  });

  test('null metrics never become numerical zero', () => {
    const view = buildPortfolioPerformanceDisplay(makePerformance({
      twr: { status: 'unavailable', returnPct: null, reason: 'TWR_UNAVAILABLE' },
      mwr: { status: 'unavailable', annualizedReturnPct: null, reason: 'NO_SOLUTION' },
      drawdown: { status: 'unavailable', maxDrawdownPct: null, currentDrawdownPct: null, reason: 'TWR_UNAVAILABLE' }
    }), { holdingsCount: 1 });
    assert.equal(view.twr.value, null);
    assert.equal(view.mwr.value, null);
    assert.equal(view.drawdown.value, null);
  });

  test('component keeps one chart, defaults to no benchmark, distinguishes API errors, and is responsive', async () => {
    const [component, css] = await Promise.all([
      readFile(new URL('../../client/src/components/PortfolioPerformanceSection.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/index.css', import.meta.url), 'utf8')
    ]);
    assert.equal((component.match(/<UnifiedPerformanceChart/g) || []).length, 1);
    assert.doesNotMatch(component, /function BenchmarkChart/);
    assert.match(component, /useState\('NONE'\)/);
    assert.match(component, /holdingsCount === 0 \|\| benchmarkId === 'NONE'/);
    assert.match(component, /Danh mục hiện chỉ có tiền mặt/);
    assert.match(component, /Lỗi API không được xem là danh mục 0%/);
    assert.match(component, /Chênh lệch/);
    assert.doesNotMatch(component, /alpha/i);
    assert.match(component, /<details className="performance-secondary-details" open>/);
    assert.match(css, /\.performance-v1-section \.performance-line-chart\s*\{[^}]*width: 100%/);
    assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.performance-v1-section \.performance-line-chart\s*\{[^}]*width: 100%;[^}]*height: 200px/);
    assert.match(css, /\.performance-v1-section \.performance-svg-scroll\s*\{[^}]*overflow: hidden/);
  });
});
