import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  calculatePortfolioPerformanceFromDailyValuations
} from '../src/performance.js';
import {
  buildBenchmarkDisplay,
  buildPortfolioPerformanceDisplay,
  PERFORMANCE_DATA_STATES
} from '../../client/src/utils/portfolioPerformanceDisplay.js';

function mockObservation({
  valuationDate,
  total = 100_000_000,
  status = 'AVAILABLE',
  flow = 0,
  flowStatus = 'AVAILABLE',
  flowIntervalType = 'CONSECUTIVE_DAILY_BOUNDARY',
  holdingsCount = 1,
  unrealizedPnlVnd = 0,
  unrealizedStatus = 'AVAILABLE'
} = {}) {
  return {
    valuationDate,
    status,
    totalPortfolioValueVnd: total,
    totalHoldingsCount: holdingsCount,
    boundaryExternalFlowVnd: flow,
    flowStatus,
    flowIntervalType,
    unrealizedPnlVnd,
    observationEvidence: {
      valuation: {
        unrealizedPnlStatus: unrealizedStatus,
        coverageReasons: status === 'AVAILABLE' ? [] : ['INCOMPLETE_DAILY_VALUATION']
      },
      flowInterval: {
        events: flowStatus === 'AVAILABLE' && flow !== 0 ? [{
          economicAt: `${valuationDate}T08:00:00.000Z`,
          amountVnd: flow,
          sourceId: 'event-1'
        }] : []
      }
    }
  };
}

describe('Portfolio Historical Performance Readiness — Deterministic Test Fixtures', () => {

  // ---------------------------------------------------------------------------
  // CASE A — 0 observations
  // ---------------------------------------------------------------------------
  test('CASE A: 0 observations produces truthful empty-history semantics', () => {
    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1M',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: []
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.valuationCoverage.observationCount, 0);
    assert.deepEqual(result.valuationCoverage.reasons, ['NO_DAILY_VALUATION_HISTORY']);
    assert.equal(result.period.actualStartDate, null);
    assert.equal(result.period.endDate, null, 'endDate must be null when 0 observations exist');
    assert.equal(result.pnl.asOfDate, null, 'pnl.asOfDate must be null when 0 observations exist');
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
    assert.equal(result.drawdown.status, 'unavailable');
    assert.equal(result.drawdown.maxDrawdownPct, null);
    assert.deepEqual(result.series, []);

    // Client display view
    const view = buildPortfolioPerformanceDisplay(result, { holdingsCount: 1 });
    assert.equal(view.observationCount, 0);
    assert.equal(view.period.startDate, null);
    assert.equal(view.period.endDate, null);
    assert.equal(view.historicalAsOf, null);
    assert.equal(view.pnl.asOfDate, null);
    assert.equal(view.canRenderChart, false);
    assert.equal(view.historyMode, 'INSUFFICIENT_HISTORY');
    assert.equal(view.state, PERFORMANCE_DATA_STATES.UNAVAILABLE);
    assert.equal(
      view.primaryReasonMessage,
      'Lịch sử định giá hằng ngày sẽ bắt đầu từ quan sát hợp lệ đầu tiên; không có dữ liệu hồi tố được tạo.'
    );

    // Benchmark view with 0 observations
    const benchmarkView = buildBenchmarkDisplay({
      benchmarkId: 'VN_INDEX',
      holdingsCount: 1,
      observationCount: view.observationCount
    });
    assert.equal(benchmarkView.state, PERFORMANCE_DATA_STATES.UNAVAILABLE);
    assert.equal(benchmarkView.reason, 'NO_DAILY_VALUATION_HISTORY');
    assert.equal(benchmarkView.canOverlay, false);
    assert.deepEqual(benchmarkView.series, []);
  });

  // ---------------------------------------------------------------------------
  // CASE B — 1 COMPLETE observation
  // ---------------------------------------------------------------------------
  test('CASE B: 1 COMPLETE observation starts history but marks TWR and drawdown insufficient', () => {
    const obs1 = mockObservation({
      valuationDate: '2026-09-20',
      total: 100_000_000,
      flow: null,
      flowStatus: 'NOT_APPLICABLE',
      flowIntervalType: 'FIRST_OBSERVATION'
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-22T02:00:00.000Z'),
      observations: [obs1]
    });

    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.valuationCoverage.observationCount, 1);
    assert.equal(result.period.actualStartDate, '2026-09-20');
    assert.equal(result.twr.status, 'insufficient_data');
    assert.equal(result.twr.returnPct, null, 'single point must never produce a fake return');
    assert.equal(result.twr.reason, 'INSUFFICIENT_VALUATION_OBSERVATIONS');
    assert.equal(result.drawdown.status, 'insufficient_data');
    assert.equal(result.drawdown.maxDrawdownPct, null);

    // Client display view
    const view = buildPortfolioPerformanceDisplay(result, { holdingsCount: 1 });
    assert.equal(view.observationCount, 1);
    assert.equal(view.period.startDate, '2026-09-20');
    assert.equal(view.historyMode, 'INSUFFICIENT_HISTORY');
    assert.equal(view.canRenderChart, false, 'single observation must not render a line chart');
    assert.equal(view.twr.value, null);
  });

  // ---------------------------------------------------------------------------
  // CASE C — 2 consecutive COMPLETE observations (no external flow)
  // ---------------------------------------------------------------------------
  test('CASE C: 2 consecutive COMPLETE observations without flow calculates TWR correctly', () => {
    // Day 1: Value = 100
    // Day 2: Value = 110, Flow = 0
    // Expected return: r = (110 - 0) / 100 - 1 = +10.00%
    // Formula: twrIndex_1 = 100, twrIndex_2 = 100 * (1 + 0.10) = 110. returnPct = 10%
    const obs1 = mockObservation({
      valuationDate: '2026-09-19',
      total: 100,
      flow: null,
      flowStatus: 'NOT_APPLICABLE',
      flowIntervalType: 'FIRST_OBSERVATION'
    });
    const obs2 = mockObservation({
      valuationDate: '2026-09-20',
      total: 110,
      flow: 0
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2]
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 10) < 1e-9, 'Expected TWR = +10%');
    assert.equal(result.series[0].twrIndex, 100);
    assert.ok(Math.abs(result.series[1].twrIndex - 110) < 1e-9);
    assert.equal(result.drawdown.status, 'available');
    assert.equal(result.drawdown.maxDrawdownPct, 0, 'no peak-to-trough decline');
  });

  // ---------------------------------------------------------------------------
  // CASE D — Cash flow between observations
  // ---------------------------------------------------------------------------
  test('CASE D: external cash flow between observations is isolated from investment return', () => {
    // Day 1: Value = 100
    // Day 2: Value = 120, Boundary Net External Flow = 10 (e.g. 10 deposit)
    // Subperiod return: r = (V_t - C_t) / V_{t-1} - 1 = (120 - 10) / 100 - 1 = 10%
    // The 10 deposit is not credited as investment performance.
    const obs1 = mockObservation({
      valuationDate: '2026-09-19',
      total: 100,
      flow: null,
      flowStatus: 'NOT_APPLICABLE',
      flowIntervalType: 'FIRST_OBSERVATION'
    });
    const obs2 = mockObservation({
      valuationDate: '2026-09-20',
      total: 120,
      flow: 10
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2]
    });

    assert.equal(result.status, 'available');
    assert.equal(result.twr.status, 'available');
    assert.ok(Math.abs(result.twr.returnPct - 10) < 1e-9, 'Expected TWR = +10% after removing 10 deposit');
    assert.equal(result.series[0].twrIndex, 100);
    assert.ok(Math.abs(result.series[1].twrIndex - 110) < 1e-9);
  });

  // ---------------------------------------------------------------------------
  // CASE E — Drawdown series
  // ---------------------------------------------------------------------------
  test('CASE E: drawdown series accurately tracks peak-to-trough decline', () => {
    // Series: 100 -> 120 -> 90 -> 105 (no external flow)
    // TWR indices:
    //   Pt 1: 100 (peak = 100, dd = 0%)
    //   Pt 2: 120 (peak = 120, dd = 0%)
    //   Pt 3: 90  (peak = 120, dd = (90 - 120) / 120 = -25%)
    //   Pt 4: 105 (peak = 120, dd = (105 - 120) / 120 = -12.5%)
    // Expected Max Drawdown: -25% (peakDate: Day 2, troughDate: Day 3)
    // Expected Current Drawdown: -12.5%
    const obs1 = mockObservation({ valuationDate: '2026-09-17', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' });
    const obs2 = mockObservation({ valuationDate: '2026-09-18', total: 120, flow: 0 });
    const obs3 = mockObservation({ valuationDate: '2026-09-19', total: 90, flow: 0 });
    const obs4 = mockObservation({ valuationDate: '2026-09-20', total: 105, flow: 0 });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2, obs3, obs4]
    });

    assert.equal(result.drawdown.status, 'available');
    assert.ok(Math.abs(result.drawdown.maxDrawdownPct - (-25)) < 1e-9, 'Expected Max Drawdown = -25%');
    assert.ok(Math.abs(result.drawdown.currentDrawdownPct - (-12.5)) < 1e-9, 'Expected Current Drawdown = -12.5%');
    assert.equal(result.drawdown.peakDate, '2026-09-18');
    assert.equal(result.drawdown.troughDate, '2026-09-19');
  });

  // ---------------------------------------------------------------------------
  // CASE F — PARTIAL / UNAVAILABLE observation
  // ---------------------------------------------------------------------------
  test('CASE F: partial observation is not coerced to zero and gates metrics truthfully', () => {
    const obs1 = mockObservation({ valuationDate: '2026-09-19', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' });
    const obs2 = mockObservation({
      valuationDate: '2026-09-20',
      total: null,
      status: 'PARTIAL',
      flow: 0
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2]
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
    assert.equal(result.drawdown.status, 'unavailable');
    assert.equal(result.drawdown.maxDrawdownPct, null);
    assert.ok(result.valuationCoverage.reasons.includes('INCOMPLETE_DAILY_VALUATION'));
  });

  // ---------------------------------------------------------------------------
  // CASE G — Missing historical VND accounting basis
  // ---------------------------------------------------------------------------
  test('CASE G: missing historical VND accounting basis leaves accounting P/L unavailable without zero fabrication', () => {
    const obs1 = mockObservation({ valuationDate: '2026-09-19', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' });
    const obs2 = mockObservation({
      valuationDate: '2026-09-20',
      total: 110,
      flow: 0,
      unrealizedPnlVnd: null,
      unrealizedStatus: 'UNAVAILABLE'
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2],
      transactions: []
    });

    // TWR is still available because daily portfolio valuation exists
    assert.equal(result.twr.status, 'available');
    // But accounting P/L is partial / unavailable because unrealized VND basis is unavailable
    assert.equal(result.pnl.status, 'partial');
    assert.equal(result.pnl.unrealizedPnlAtEnd, null);
    assert.equal(result.pnl.totalAccountingPnlAtEnd, null);
    assert.equal(result.pnl.reason, 'VND_UNREALIZED_PNL_UNAVAILABLE');
  });

  // ---------------------------------------------------------------------------
  // CASE H — History gap
  // ---------------------------------------------------------------------------
  test('CASE H: missing calendar day creates an explicit gap and stops TWR/drawdown chaining', () => {
    // Observations on Sep 18 and Sep 20; Sep 19 is missing
    const obs1 = mockObservation({ valuationDate: '2026-09-18', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' });
    const obs2 = mockObservation({
      valuationDate: '2026-09-20',
      total: 110,
      flow: 0,
      flowIntervalType: 'MULTI_DAY_GAP'
    });

    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2]
    });

    assert.equal(result.status, 'partial');
    assert.deepEqual(result.valuationCoverage.missingDates, ['2026-09-19']);
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
    assert.equal(result.drawdown.status, 'unavailable');
    assert.equal(result.drawdown.maxDrawdownPct, null);
  });

  // ---------------------------------------------------------------------------
  // Numeric zero vs unavailable distinction
  // ---------------------------------------------------------------------------
  test('numeric zero vs unavailable distinction is strictly preserved', () => {
    // 0% return is a confirmed numeric 0
    const obs1 = mockObservation({ valuationDate: '2026-09-19', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' });
    const obs2 = mockObservation({ valuationDate: '2026-09-20', total: 100, flow: 0 });
    const flatResult = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [obs1, obs2]
    });
    assert.strictEqual(flatResult.twr.returnPct, 0, 'confirmed zero return must be strictly 0');
    assert.strictEqual(flatResult.drawdown.maxDrawdownPct, 0, 'confirmed zero drawdown must be strictly 0');

    // 0 observations produces null (unavailable), never 0
    const emptyResult = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: []
    });
    assert.strictEqual(emptyResult.twr.returnPct, null, 'unavailable return must be null');
    assert.strictEqual(emptyResult.drawdown.maxDrawdownPct, null, 'unavailable drawdown must be null');
  });
});
