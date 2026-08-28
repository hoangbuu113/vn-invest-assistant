import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAssetHistory,
  getAssetAnalysis,
  getVietnamDateKey,
  computeLookbackDate,
  PERIOD_THRESHOLDS,
  ANALYSIS_PERIODS
} from '../src/analysis.js';
import { getAnalysisHistory, getMarketHistory } from '../src/market.js';
import { createApp } from '../index.js';

// Helper to generate deterministic historical bars
function createBars({
  endDate = '2026-08-27',
  count = 200,
  priceFn = (i) => 70000 + i * 100,
  highFn = (i, close) => close + 1000,
  lowFn = (i, close) => close - 1000,
  openFn = (i, close) => close - 500,
  volumeFn = (i) => 1000000 + i * 1000
} = {}) {
  const bars = [];
  const endParts = endDate.split('-').map(Number);
  const endUtc = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endUtc - i * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const isoString = `${y}-${m}-${day}T02:00:00.000Z`;

    const idx = count - 1 - i;
    const close = priceFn(idx);
    const high = highFn ? highFn(idx, close) : null;
    const low = lowFn ? lowFn(idx, close) : null;
    const open = openFn ? openFn(idx, close) : null;
    const volume = volumeFn ? volumeFn(idx) : null;

    bars.push({
      timestamp: isoString,
      open,
      high,
      low,
      close,
      volume
    });
  }

  return bars;
}

const DETERMINISTIC_NOW = new Date('2026-08-28T07:00:00.000Z'); // Vietnam date: 2026-08-28

async function resolveYahooVietnamFixture(symbol) {
  return {
    asset: {
      id: `asset-${symbol.toLowerCase()}`,
      symbol,
      assetType: symbol === 'E1VFVN30' ? 'etf' : 'stock',
      quoteCurrency: 'VND',
      marketPolicy: 'VN_EXCHANGE',
      marketTimezone: 'Asia/Ho_Chi_Minh',
      isActive: true
    },
    mapping: {
      provider: 'yahoo',
      providerSymbol: `${symbol}.VN`
    }
  };
}

describe('Feature 07 — Deterministic Asset Analysis Engine (Core + API + Tests)', () => {

  // =========================================================================
  // A. COMPLETED BAR / CUTOFF RULES & TIMEZONE BOUNDARIES
  // =========================================================================
  describe('A. Completed Bar / Cutoff Rules & Timezone Boundaries', () => {
    test('1. Current Vietnam-date bar is excluded as potentially incomplete', () => {
      const bars = createBars({ endDate: '2026-08-28', count: 10 }); // Last bar is 2026-08-28
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });

      // analysisAsOf must be 2026-08-27, not 2026-08-28
      assert.equal(result.analysisAsOf, '2026-08-27T02:00:00.000Z');
      assert.equal(result.analysisPrice, bars[bars.length - 2].close);
      assert.ok(result.dataCompleteness.warnings.some(w => w.includes('Current-day Vietnam session excluded')));
    });

    test('2. Prior trading-day bar becomes authoritative analysisPrice and analysisAsOf', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });
      const result = analyzeAssetHistory(bars, { symbol: 'VCB', now: DETERMINISTIC_NOW });

      const lastBar = bars[bars.length - 1];
      assert.equal(result.analysisPrice, lastBar.close);
      assert.equal(result.analysisAsOf, lastBar.timestamp);
      assert.equal(result.analysisPriceSource, 'last_completed_daily_close');
    });

    test('3. All periods use identical analysisPrice and analysisAsOf', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 200 });
      const result = analyzeAssetHistory(bars, { symbol: 'HPG', now: DETERMINISTIC_NOW });

      for (const pKey of ANALYSIS_PERIODS) {
        const period = result.periods[pKey];
        if (period.status === 'available') {
          assert.equal(period.periodEndPrice, result.analysisPrice);
          assert.equal(period.observedEndAt, result.analysisAsOf);
        }
      }
    });

    test('4. Unsorted input bars are normalized and sorted chronologically', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });
      const shuffled = [...bars].reverse();
      const result = analyzeAssetHistory(shuffled, { symbol: 'FPT', now: DETERMINISTIC_NOW });

      assert.equal(result.analysisAsOf, '2026-08-27T02:00:00.000Z');
      assert.equal(result.analysisPrice, bars[bars.length - 1].close);
    });

    test('4b. Explicit UTC/Vietnam date-boundary straddling exclusion test', () => {
      // Bar 1: 2026-08-27 16:59:59 UTC = 2026-08-27 23:59:59 UTC+7 (completed date: 2026-08-27)
      // Bar 2: 2026-08-27 17:00:00 UTC = 2026-08-28 00:00:00 UTC+7 (current date: 2026-08-28)
      // Bar 3: 2026-08-28 02:00:00 UTC = 2026-08-28 09:00:00 UTC+7 (current date: 2026-08-28)
      const bars = [
        {
          timestamp: '2026-08-27T16:59:59.000Z',
          open: 70000, high: 71000, low: 69000, close: 70500, volume: 1000
        },
        {
          timestamp: '2026-08-27T17:00:00.000Z',
          open: 70500, high: 72000, low: 70000, close: 71500, volume: 1000
        },
        {
          timestamp: '2026-08-28T02:00:00.000Z',
          open: 71500, high: 73000, low: 71000, close: 72500, volume: 1000
        }
      ];

      // Current injected time: 2026-08-28 07:00:00 UTC (Vietnam date: 2026-08-28)
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: new Date('2026-08-28T07:00:00.000Z') });

      // Bar 2 and Bar 3 MUST be excluded; Bar 1 is the last completed bar
      assert.equal(result.analysisAsOf, '2026-08-27T16:59:59.000Z');
      assert.equal(result.analysisPrice, 70500);
      assert.ok(result.dataCompleteness.warnings.some(w => w.includes('last completed close used: 2026-08-27')));
    });

    test('4c. Lagging analysisAsOf regression test: 1Y window preserves boundary session from superset', () => {
      // Scenario:
      // Current date is 2026-08-28.
      // Asset last completed session is 2026-08-25 (lagging 3 calendar days).
      // Lookback 1Y from 2026-08-25 is 2025-08-25.
      // A request-date-anchored 1Y dataset starting 2025-08-28 would have missed the 2025-08-25 bar.
      // The 2Y superset retains 2025-08-25.
      const bars = [];
      const startUtc = Date.UTC(2025, 7, 25); // 2025-08-25
      const endUtc = Date.UTC(2026, 7, 25);   // 2026-08-25 (1 year later)
      const dayMs = 86400000;

      for (let t = startUtc; t <= endUtc; t += dayMs) {
        const d = new Date(t);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const isStart = (y === 2025 && m === '08' && day === '25');

        bars.push({
          timestamp: `${y}-${m}-${day}T02:00:00.000Z`,
          open: 50000,
          high: 60000,
          low: 40000,
          close: isStart ? 50000 : 55000,
          volume: 1000
        });
      }

      const result = analyzeAssetHistory(bars, {
        symbol: 'E1VFVN30',
        now: new Date('2026-08-28T07:00:00.000Z')
      });

      assert.equal(result.analysisAsOf, '2026-08-25T02:00:00.000Z');
      assert.equal(result.analysisPrice, 55000);
      assert.equal(result.periods['1Y'].status, 'available');
      assert.equal(result.periods['1Y'].observedStartAt, '2025-08-25T02:00:00.000Z');
      assert.equal(result.periods['1Y'].periodStartPrice, 50000);
      assert.equal(result.periods['1Y'].priceChangePct, ((55000 / 50000) - 1) * 100);
    });
  });

  // =========================================================================
  // B. PRICE CHANGE & FULL PRECISION
  // =========================================================================
  describe('B. Price Change & Full Precision', () => {
    test('5. Positive price change calculates accurately', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 10,
        priceFn: (i) => 100000 + i * 1000 // 100000 -> 109000
      });
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });
      const p1w = result.periods['1W'];

      assert.equal(p1w.status, 'available');
      assert.ok(p1w.priceChangePct > 0);
      assert.equal(p1w.absoluteChange, p1w.periodEndPrice - p1w.periodStartPrice);
      assert.equal(p1w.priceChangePct, ((p1w.periodEndPrice / p1w.periodStartPrice) - 1) * 100);
    });

    test('6. Negative price change calculates accurately', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 10,
        priceFn: (i) => 100000 - i * 1000 // 100000 -> 91000
      });
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });
      const p1w = result.periods['1W'];

      assert.equal(p1w.status, 'available');
      assert.ok(p1w.priceChangePct < 0);
      assert.equal(p1w.absoluteChange, p1w.periodEndPrice - p1w.periodStartPrice);
      assert.equal(p1w.priceChangePct, ((p1w.periodEndPrice / p1w.periodStartPrice) - 1) * 100);
    });

    test('7. Zero price change calculates as exact 0', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 10,
        priceFn: () => 80000 // Constant price
      });
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });
      const p1w = result.periods['1W'];

      assert.equal(p1w.status, 'available');
      assert.equal(p1w.priceChangePct, 0);
      assert.equal(p1w.absoluteChange, 0);
    });

    test('8. Full precision: percentage is NOT calculated from rounded intermediate change', () => {
      const startPrice = 33781.234567;
      const endPrice = 35294.876543;
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 0 ? startPrice : endPrice)
      });
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });
      const p1w = result.periods['1W'];

      const expectedDirect = ((endPrice / startPrice) - 1) * 100;
      assert.equal(p1w.priceChangePct, expectedDirect);

      // Verify that calculating from a rounded intermediate change (e.g. 2 decimals) would yield a different number
      const roundedChange = Math.round((endPrice - startPrice) * 100) / 100;
      const roundedDerivedPct = (roundedChange / startPrice) * 100;
      assert.notEqual(p1w.priceChangePct, roundedDerivedPct);
    });

    test('9. Invalid/nonpositive start price protection', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 5 });
      bars[0].close = 0; // Malformed close on first bar

      // First bar with close=0 is excluded during validation, next bar becomes start
      const result = analyzeAssetHistory(bars, { symbol: 'FPT', now: DETERMINISTIC_NOW });
      assert.equal(result.periods['1W'].validSessionCount, 4);
      assert.ok(result.periods['1W'].periodStartPrice > 0);
    });
  });

  // =========================================================================
  // C. SESSION THRESHOLDS & ONE-BELOW THRESHOLD TESTS
  // =========================================================================
  describe('C. Session Thresholds & One-Below Boundary Tests', () => {
    test('10. 1W requires minimum 3 valid completed sessions (2 -> unavailable, 3 -> available)', () => {
      const bars2 = createBars({ endDate: '2026-08-27', count: 2 });
      const res2 = analyzeAssetHistory(bars2, { now: DETERMINISTIC_NOW });
      assert.equal(res2.periods['1W'].status, 'unavailable');
      assert.deepEqual(res2.periods['1W'].unavailableReasons, ['insufficient_sessions']);

      const bars3 = createBars({ endDate: '2026-08-27', count: 3 });
      const res3 = analyzeAssetHistory(bars3, { now: DETERMINISTIC_NOW });
      assert.equal(res3.periods['1W'].status, 'available');
      assert.equal(res3.periods['1W'].validSessionCount, 3);
    });

    test('11. 1M requires minimum 15 valid completed sessions (14 -> unavailable, 15 -> available)', () => {
      const bars14 = createBars({ endDate: '2026-08-27', count: 14 });
      const res14 = analyzeAssetHistory(bars14, { now: DETERMINISTIC_NOW });
      assert.equal(res14.periods['1M'].status, 'unavailable');
      assert.deepEqual(res14.periods['1M'].unavailableReasons, ['insufficient_sessions']);

      const bars15 = createBars({ endDate: '2026-08-27', count: 15 });
      const res15 = analyzeAssetHistory(bars15, { now: DETERMINISTIC_NOW });
      assert.equal(res15.periods['1M'].status, 'available');
      assert.equal(res15.periods['1M'].validSessionCount, 15);
    });

    test('12. 3M requires minimum 45 valid completed sessions (44 -> unavailable, 45 -> available)', () => {
      const bars44 = createBars({ endDate: '2026-08-27', count: 44 });
      const res44 = analyzeAssetHistory(bars44, { now: DETERMINISTIC_NOW });
      assert.equal(res44.periods['3M'].status, 'unavailable');
      assert.deepEqual(res44.periods['3M'].unavailableReasons, ['insufficient_sessions']);

      const bars45 = createBars({ endDate: '2026-08-27', count: 45 });
      const res45 = analyzeAssetHistory(bars45, { now: DETERMINISTIC_NOW });
      assert.equal(res45.periods['3M'].status, 'available');
      assert.equal(res45.periods['3M'].validSessionCount, 45);
    });

    test('13. 6M requires minimum 90 valid completed sessions (89 -> unavailable, 90 -> available)', () => {
      const bars89 = createBars({ endDate: '2026-08-27', count: 89 });
      const res89 = analyzeAssetHistory(bars89, { now: DETERMINISTIC_NOW });
      assert.equal(res89.periods['6M'].status, 'unavailable');
      assert.deepEqual(res89.periods['6M'].unavailableReasons, ['insufficient_sessions']);

      const bars90 = createBars({ endDate: '2026-08-27', count: 90 });
      const res90 = analyzeAssetHistory(bars90, { now: DETERMINISTIC_NOW });
      assert.equal(res90.periods['6M'].status, 'available');
      assert.equal(res90.periods['6M'].validSessionCount, 90);
    });

    test('14. 1Y requires minimum 180 valid completed sessions (179 -> unavailable, 180 -> available)', () => {
      const bars179 = createBars({ endDate: '2026-08-27', count: 179 });
      const res179 = analyzeAssetHistory(bars179, { now: DETERMINISTIC_NOW });
      assert.equal(res179.periods['1Y'].status, 'unavailable');
      assert.deepEqual(res179.periods['1Y'].unavailableReasons, ['insufficient_sessions']);

      const bars180 = createBars({ endDate: '2026-08-27', count: 180 });
      const res180 = analyzeAssetHistory(bars180, { now: DETERMINISTIC_NOW });
      assert.equal(res180.periods['1Y'].status, 'available');
      assert.equal(res180.periods['1Y'].validSessionCount, 180);
    });
  });

  // =========================================================================
  // D. RANGE POSITION
  // =========================================================================
  describe('D. Range Position', () => {
    test('16. At low -> rangePositionPct is 0', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 60000 : 70000),
        lowFn: (i, close) => (i === 4 ? 60000 : 65000),
        highFn: () => 80000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.periodLowPrice, 60000);
      assert.equal(p1w.periodHighPrice, 80000);
      assert.equal(res.analysisPrice, 60000);
      assert.equal(p1w.rangePositionPct, 0);
    });

    test('17. At high -> rangePositionPct is 100', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 80000 : 70000),
        lowFn: () => 60000,
        highFn: (i, close) => (i === 4 ? 80000 : 75000)
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.periodLowPrice, 60000);
      assert.equal(p1w.periodHighPrice, 80000);
      assert.equal(res.analysisPrice, 80000);
      assert.equal(p1w.rangePositionPct, 100);
    });

    test('18. Inside range -> rangePositionPct is exact percentage', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 75000 : 70000),
        lowFn: () => 60000,
        highFn: () => 80000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      // (75000 - 60000) / (80000 - 60000) * 100 = 15000 / 20000 * 100 = 75
      assert.equal(p1w.rangePositionPct, 75);
    });

    test('19. High == Low -> rangePositionPct is null with reason flat_range', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: () => 70000,
        lowFn: () => 70000,
        highFn: () => 70000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.rangePositionPct, null);
      assert.ok(p1w.unavailableReasons.includes('flat_range'));
    });

    test('20. Missing high -> rangePositionPct is null with reason missing_high', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        highFn: (i) => (i === 2 ? null : 80000)
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.periodHighPrice, null);
      assert.equal(p1w.rangePositionPct, null);
      assert.ok(p1w.unavailableReasons.includes('missing_high'));
    });

    test('21. Missing low -> rangePositionPct is null with reason missing_low', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        lowFn: (i) => (i === 2 ? null : 60000)
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.periodLowPrice, null);
      assert.equal(p1w.rangePositionPct, null);
      assert.ok(p1w.unavailableReasons.includes('missing_low'));
    });

    test('22. analysisPrice > periodHighPrice -> rangePositionPct is null with inconsistency reason', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 85000 : 70000),
        highFn: () => 80000,
        lowFn: () => 60000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.rangePositionPct, null);
      assert.ok(p1w.unavailableReasons.includes('analysis_price_outside_range'));
    });

    test('23. analysisPrice < periodLowPrice -> rangePositionPct is null with inconsistency reason', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 55000 : 70000),
        highFn: () => 80000,
        lowFn: () => 60000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      const p1w = res.periods['1W'];

      assert.equal(p1w.rangePositionPct, null);
      assert.ok(p1w.unavailableReasons.includes('analysis_price_outside_range'));
    });
  });

  // =========================================================================
  // E. DISTANCE BELOW HIGH
  // =========================================================================
  describe('E. Distance Below Period High', () => {
    test('24. At high -> distanceBelowHighPct is 0', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 80000 : 70000),
        highFn: () => 80000,
        lowFn: () => 60000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      assert.equal(res.periods['1W'].distanceBelowHighPct, 0);
    });

    test('25. Below high -> distanceBelowHighPct is positive percentage', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 76000 : 70000),
        highFn: () => 80000,
        lowFn: () => 60000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      // 100 * (80000 - 76000) / 80000 = 4000 / 80000 * 100 = 5.0
      assert.equal(res.periods['1W'].distanceBelowHighPct, 5);
    });

    test('26. Special case: high == low == analysisPrice -> distanceBelowHighPct is 0', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: () => 70000,
        highFn: () => 70000,
        lowFn: () => 70000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      assert.equal(res.periods['1W'].distanceBelowHighPct, 0);
      assert.equal(res.periods['1W'].rangePositionPct, null);
    });

    test('27. analysisPrice > periodHighPrice -> distanceBelowHighPct is null', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 5,
        priceFn: (i) => (i === 4 ? 85000 : 70000),
        highFn: () => 80000,
        lowFn: () => 60000
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });
      assert.equal(res.periods['1W'].distanceBelowHighPct, null);
    });
  });

  // =========================================================================
  // F. CROSS-PERIOD POSITIVE BREADTH
  // =========================================================================
  describe('F. Cross-Period Positive Breadth', () => {
    test('28. Positive / negative / zero counts calculated correctly across periods', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 200,
        priceFn: (i) => 70000 + i * 50
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.crossPeriod.positivePeriodCount, 5);
      assert.equal(res.crossPeriod.negativePeriodCount, 0);
      assert.equal(res.crossPeriod.zeroChangePeriodCount, 0);
      assert.equal(res.crossPeriod.validPeriodCount, 5);
      assert.equal(res.crossPeriod.positivePeriodRatio, 1);
    });

    test('29. positivePeriodRatio denominator includes zero-change periods', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 200,
        priceFn: (i) => {
          if (i === 199) return 70000;
          if (i >= 190) return 68000;
          if (i >= 165) return 65000;
          if (i >= 105) return 70000;
          if (i >= 50) return 75000;
          return 80000;
        }
      });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.crossPeriod.positivePeriodCount, 2);
      assert.equal(res.crossPeriod.negativePeriodCount, 2);
      assert.equal(res.crossPeriod.zeroChangePeriodCount, 1);
      assert.equal(res.crossPeriod.validPeriodCount, 5);
      assert.equal(res.crossPeriod.positivePeriodRatio, 2 / 5);
    });

    test('30. Fewer than 3 valid periods -> positivePeriodRatio is null', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 20 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.crossPeriod.validPeriodCount, 2);
      assert.equal(res.crossPeriod.positivePeriodRatio, null);
    });
  });

  // =========================================================================
  // G. DATA COMPLETENESS
  // =========================================================================
  describe('G. Data Completeness', () => {
    test('31. 5 available periods -> completeness is complete (ratio 1.0)', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 200 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.dataCompleteness.availabilityLevel, 'complete');
      assert.equal(res.dataCompleteness.periodCompletenessRatio, 1);
      assert.equal(res.dataCompleteness.availableRanges.length, 5);
      assert.equal(res.dataCompleteness.unavailableRanges.length, 0);
    });

    test('32. 3–4 available periods -> completeness is partial', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 50 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.dataCompleteness.availabilityLevel, 'partial');
      assert.equal(res.dataCompleteness.periodCompletenessRatio, 3 / 5);
      assert.deepEqual(res.dataCompleteness.availableRanges, ['1W', '1M', '3M']);
      assert.deepEqual(res.dataCompleteness.unavailableRanges, ['6M', '1Y']);
    });

    test('33. 1–2 available periods -> completeness is limited', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.dataCompleteness.availabilityLevel, 'limited');
      assert.equal(res.dataCompleteness.periodCompletenessRatio, 1 / 5);
      assert.deepEqual(res.dataCompleteness.availableRanges, ['1W']);
    });

    test('34. 0 available periods -> completeness is unavailable', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 2 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.dataCompleteness.availabilityLevel, 'unavailable');
      assert.equal(res.dataCompleteness.periodCompletenessRatio, 0);
      assert.equal(res.dataCompleteness.availableRanges.length, 0);
      assert.equal(res.dataCompleteness.unavailableRanges.length, 5);
    });

    test('35. Missing range is NOT treated as zero price change in breadth or metrics', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 50 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.periods['6M'].priceChangePct, null);
      assert.equal(res.periods['1Y'].priceChangePct, null);
      assert.equal(res.crossPeriod.validPeriodCount, 3);
      assert.equal(res.crossPeriod.zeroChangePeriodCount, 0);
    });
  });

  // =========================================================================
  // H. SNAPSHOT SEPARATION, FAILURE HANDLING & BASELINE COMPARISON
  // =========================================================================
  describe('H. Snapshot Separation, Failure Handling & Baseline Comparison', () => {
    test('36. Snapshot price differs from analysisPrice -> calculations still use analysisPrice', () => {
      const bars = createBars({
        endDate: '2026-08-27',
        count: 10,
        priceFn: () => 70000
      });
      const snapshot = {
        price: 999999,
        priceAsOf: '2026-08-28T03:00:00.000Z',
        freshness: 'delayed',
        priceSource: 'yahoo_delayed_snapshot'
      };
      const res = analyzeAssetHistory(bars, { symbol: 'FPT', snapshot, now: DETERMINISTIC_NOW });

      assert.equal(res.analysisPrice, 70000);
      assert.equal(res.periods['1W'].periodEndPrice, 70000);
      assert.equal(res.periods['1W'].priceChangePct, 0);
      assert.equal(res.snapshot.price, 999999);
    });

    test('37. Snapshot unavailable in pure engine -> valid historical analysis succeeds completely', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 200 });
      const res = analyzeAssetHistory(bars, { symbol: 'VCB', snapshot: null, now: DETERMINISTIC_NOW });

      assert.equal(res.snapshot, null);
      assert.equal(res.dataCompleteness.availabilityLevel, 'complete');
      assert.equal(res.analysisPriceSource, 'last_completed_daily_close');
    });

    test('37b. Integration snapshot provider exception/failure -> snapshot becomes null and analysis succeeds', async () => {
      const mockBars = createBars({ endDate: '2026-08-27', count: 200 });
      const mockGetAnalysisHistory = async (symbol) => ({
        symbol,
        range: '1Y',
        bars: mockBars
      });
      const mockFailingSnapshot = async () => {
        const err = new Error('Yahoo Finance quote endpoint 502 Bad Gateway');
        err.status = 502;
        throw err;
      };

      const result = await getAssetAnalysis('FPT', {
        getAnalysisHistoryFn: mockGetAnalysisHistory,
        getMarketSnapshotFn: mockFailingSnapshot,
        now: DETERMINISTIC_NOW
      });

      assert.equal(result.symbol, 'FPT');
      assert.equal(result.snapshot, null);
      assert.equal(result.analysisPriceSource, 'last_completed_daily_close');
      assert.equal(result.dataCompleteness.availabilityLevel, 'complete');
      assert.equal(result.periods['1W'].status, 'available');
      assert.equal(result.periods['1Y'].status, 'available');
    });

    test('37c. Snapshot failure baseline comparison: calculations are identical whether snapshot succeeds or throws', async () => {
      const mockBars = createBars({ endDate: '2026-08-27', count: 200 });
      const mockGetAnalysisHistory = async (symbol) => ({
        symbol,
        range: '1Y',
        bars: mockBars
      });

      const mockSuccessfulSnapshot = async () => ({
        price: 75000,
        priceAsOf: '2026-08-28T02:30:00.000Z',
        freshness: 'delayed',
        priceSource: 'yahoo_delayed_snapshot'
      });

      const mockFailingSnapshot = async () => {
        const err = new Error('Yahoo Finance quote 500 error');
        err.status = 500;
        throw err;
      };

      // RUN A: Snapshot succeeds
      const resA = await getAssetAnalysis('FPT', {
        getAnalysisHistoryFn: mockGetAnalysisHistory,
        getMarketSnapshotFn: mockSuccessfulSnapshot,
        now: DETERMINISTIC_NOW
      });

      // RUN B: Snapshot throws
      const resB = await getAssetAnalysis('FPT', {
        getAnalysisHistoryFn: mockGetAnalysisHistory,
        getMarketSnapshotFn: mockFailingSnapshot,
        now: DETERMINISTIC_NOW
      });

      // RUN B snapshot is null
      assert.notEqual(resA.snapshot, null);
      assert.equal(resB.snapshot, null);

      // Historical analysis metrics MUST be strictly identical
      assert.equal(resB.analysisPrice, resA.analysisPrice);
      assert.equal(resB.analysisAsOf, resA.analysisAsOf);
      assert.equal(resB.analysisPriceSource, resA.analysisPriceSource);

      for (const pKey of ANALYSIS_PERIODS) {
        assert.equal(resB.periods[pKey].status, resA.periods[pKey].status);
        assert.equal(resB.periods[pKey].priceChangePct, resA.periods[pKey].priceChangePct);
        assert.equal(resB.periods[pKey].rangePositionPct, resA.periods[pKey].rangePositionPct);
        assert.equal(resB.periods[pKey].distanceBelowHighPct, resA.periods[pKey].distanceBelowHighPct);
        assert.equal(resB.periods[pKey].periodStartPrice, resA.periods[pKey].periodStartPrice);
        assert.equal(resB.periods[pKey].periodEndPrice, resA.periods[pKey].periodEndPrice);
        assert.equal(resB.periods[pKey].validSessionCount, resA.periods[pKey].validSessionCount);
      }

      assert.deepEqual(resB.crossPeriod, resA.crossPeriod);
      assert.deepEqual(resB.dataCompleteness, resA.dataCompleteness);
    });
  });

  // =========================================================================
  // I. METHODOLOGY & SCORE FORBIDDENNESS
  // =========================================================================
  describe('I. Methodology & Score Forbiddenness', () => {
    test('38. Methodology flags explicitly exposed: dividendsIncluded === false', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.methodology.dividendsIncluded, false);
      assert.equal(res.methodology.priceChangeMetric, 'unadjusted_close_change');
      assert.equal(res.methodology.analysisPriceSource, 'last_completed_daily_close');
    });

    test('39. Methodology flags explicitly exposed: corporateActionsModeled === false', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      assert.equal(res.methodology.corporateActionsModeled, false);
    });

    test('40. Absolutely NO overall/asset/momentum/confidence score fields exist anywhere', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 200 });
      const res = analyzeAssetHistory(bars, { now: DETERMINISTIC_NOW });

      const forbiddenKeys = [
        'overallScore',
        'assetScore',
        'strengthScore',
        'momentumScore',
        'consistencyScore',
        'confidenceScore',
        'rangePositionScore',
        'recommendation',
        'rating',
        'targetPrice'
      ];

      for (const key of forbiddenKeys) {
        assert.equal(res[key], undefined, `Root object must not have forbidden property '${key}'`);
        assert.equal(res.dataCompleteness[key], undefined, `dataCompleteness must not have forbidden property '${key}'`);
        assert.equal(res.crossPeriod[key], undefined, `crossPeriod must not have forbidden property '${key}'`);
      }
    });
  });

  // =========================================================================
  // J. DATE HELPERS & STRICT TIME INPUT CONTRACT (ZERO CLOCK)
  // =========================================================================
  describe('J. Date Helpers & Strict Time Input Contract', () => {
    test('41. getVietnamDateKey formats UTC and ms timestamps to UTC+7 calendar date', () => {
      assert.equal(getVietnamDateKey('2026-08-20T16:59:59.000Z'), '2026-08-20');
      assert.equal(getVietnamDateKey('2026-08-20T17:00:00.000Z'), '2026-08-21');
    });

    test('41b. getVietnamDateKey strictly rejects missing or invalid inputs (no clock fallback)', () => {
      assert.throws(() => getVietnamDateKey(), /Timestamp or Date is required/);
      assert.throws(() => getVietnamDateKey(null), /Timestamp or Date is required/);
      assert.throws(() => getVietnamDateKey('invalid_date_str'), /Invalid Date/);
      assert.throws(() => getVietnamDateKey(-100), /Invalid numeric timestamp/);
    });

    test('41c. analyzeAssetHistory strictly requires options.now to be a valid Date instance', () => {
      const bars = createBars({ endDate: '2026-08-27', count: 10 });

      // VALID: Date instance with finite timestamp -> accepted
      assert.doesNotThrow(() => {
        analyzeAssetHistory(bars, { now: new Date('2026-08-27T03:00:00Z') });
      });

      // INVALID: timezone-less date string -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars, { now: '2026-08-27T10:00:00' });
      }, /options\.now is required and must be a valid Date object/);

      // INVALID: date-only string -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars, { now: '2026-08-27' });
      }, /options\.now is required and must be a valid Date object/);

      // INVALID: numeric timestamp -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars, { now: 1787191200 });
      }, /options\.now is required and must be a valid Date object/);

      // INVALID: undefined -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars);
      }, /options\.now is required and must be a valid Date object/);

      // INVALID: null -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars, { now: null });
      }, /options\.now is required and must be a valid Date object/);

      // INVALID: Invalid Date object -> rejected
      assert.throws(() => {
        analyzeAssetHistory(bars, { now: new Date('invalid_date') });
      }, /options\.now is required and must be a valid Date object/);
    });

    test('42. computeLookbackDate computes exact calendar lookbacks with leap year clamping', () => {
      assert.equal(computeLookbackDate('2026-08-27', '1W'), '2026-08-20');
      assert.equal(computeLookbackDate('2026-08-27', '1M'), '2026-07-27');
      assert.equal(computeLookbackDate('2026-08-27', '3M'), '2026-05-27');
      assert.equal(computeLookbackDate('2026-08-27', '6M'), '2026-02-27');
      assert.equal(computeLookbackDate('2026-08-27', '1Y'), '2025-08-27');

      assert.equal(computeLookbackDate('2024-03-31', '1M'), '2024-02-29'); // Leap year
      assert.equal(computeLookbackDate('2025-03-31', '1M'), '2025-02-28'); // Non-leap year
      assert.equal(computeLookbackDate('2024-02-29', '1Y'), '2023-02-28'); // Leap day 1Y back
    });
  });

  // =========================================================================
  // K. EXPRESS ROUTE INTEGRATION & PRODUCTION WIRING
  // =========================================================================
  describe('K. Express Route Integration & Production Wiring', () => {
    test('43. GET /api/analysis/:symbol returns 200 with structured analysis data', async () => {
      const mockBars = createBars({ endDate: '2026-08-27', count: 200 });
      const mockSnapshot = {
        price: 75000,
        priceAsOf: '2026-08-28T02:30:00.000Z',
        freshness: 'delayed',
        priceSource: 'yahoo_delayed_snapshot'
      };

      const mockGetAnalysisHistory = async (symbol) => ({
        symbol,
        range: '1Y',
        bars: mockBars
      });
      const mockGetMarketSnapshot = async () => mockSnapshot;

      const app = createApp({
        getAnalysisHistoryFn: mockGetAnalysisHistory,
        getMarketSnapshotFn: mockGetMarketSnapshot
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/analysis/FPT`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(body.data.symbol, 'FPT');
        assert.equal(body.data.analysisPriceSource, 'last_completed_daily_close');
        assert.equal(body.data.snapshot.price, 75000);
        assert.equal(body.data.dataCompleteness.availabilityLevel, 'complete');
      } finally {
        server.close();
      }
    });

    test('44. GET /api/analysis/:symbol handles history failure with error status', async () => {
      const mockGetAnalysisHistory = async () => {
        const err = new Error("Historical market data for 'INVALID' not found");
        err.status = 404;
        throw err;
      };

      const app = createApp({
        getAnalysisHistoryFn: mockGetAnalysisHistory
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/analysis/INVALID`);
        assert.equal(res.status, 404);

        const body = await res.json();
        assert.equal(body.status, 'error');
        assert.match(body.message, /not found/i);
      } finally {
        server.close();
      }
    });

    test('45. Real 2Y provider contract: getAnalysisHistory strictly requests interval=1d and range=2y', async () => {
      let interceptedUrl = null;
      const fakeFetch = async (url) => {
        interceptedUrl = url;
        const parsed = new URL(url);
        const interval = parsed.searchParams.get('interval');
        const range = parsed.searchParams.get('range');

        // Provider MUST request range=2y and interval=1d
        if (range !== '2y' || interval !== '1d') {
          throw new Error(`Unexpected query parameters: interval=${interval}, range=${range}`);
        }

        // Return minimal valid chart payload
        return {
          ok: true,
          json: async () => ({
            chart: {
              result: [{
                meta: { symbol: 'FPT.VN' },
                timestamp: [1787191200, 1787277600, 1787536800],
                indicators: {
                  quote: [{
                    open: [70000, 71000, 72000],
                    high: [72000, 73000, 74000],
                    low: [69000, 70000, 71000],
                    close: [71000, 72000, 73000],
                    volume: [1000, 1000, 1000]
                  }]
                }
              }]
            }
          })
        };
      };

      const result = await getAnalysisHistory('FPT', {
        fetchFn: fakeFetch,
        resolveProviderMappingFn: resolveYahooVietnamFixture
      });

      assert.ok(interceptedUrl.includes('interval=1d'));
      assert.ok(interceptedUrl.includes('range=2y'));
      assert.ok(!interceptedUrl.includes('range=1y'));
      assert.equal(result.bars.length, 3);
      assert.equal(result.symbol, 'FPT');
    });

    test('46. Production route wiring regression: GET /api/analysis/:symbol does not call Feature 06 public getMarketHistory range validator', async () => {
      // Create app with default services (real getAnalysisHistory and real getMarketHistory)
      // Public getMarketHistory only accepts 1W/1M/3M/6M/1Y and throws on '2Y'.
      // If the analysis route accidentally called getMarketHistory(symbol, '2Y'), it would throw a 400 error.
      const mockBars = createBars({ endDate: '2026-08-27', count: 200 });

      // Injected analysis history provider
      const mockAnalysisHistory = async (symbol) => ({
        symbol,
        range: '1Y',
        bars: mockBars
      });

      // Strict public history provider that throws if range is '2Y'
      const strictPublicHistory = async (symbol, range = '1M') => {
        if (!['1W', '1M', '3M', '6M', '1Y'].includes(range)) {
          const err = new Error(`Invalid range '${range}'. Supported ranges: 1W, 1M, 3M, 6M, 1Y`);
          err.status = 400;
          throw err;
        }
        return { symbol, range, bars: mockBars.slice(0, 10) };
      };

      const app = createApp({
        getMarketHistoryFn: strictPublicHistory,
        getAnalysisHistoryFn: mockAnalysisHistory,
        getMarketSnapshotFn: async () => null
      });

      const server = app.listen(0);
      const port = server.address().port;

      try {
        // Analysis route MUST succeed (uses getAnalysisHistory, does NOT call public getMarketHistory with 2Y)
        const resAnalysis = await fetch(`http://127.0.0.1:${port}/api/analysis/FPT`);
        assert.equal(resAnalysis.status, 200);
        const analysisBody = await resAnalysis.json();
        assert.equal(analysisBody.status, 'ok');
        assert.equal(analysisBody.data.dataCompleteness.availabilityLevel, 'complete');

        // Public history route continues to reject 2Y (Feature 06 contract intact)
        const resPublicHistory = await fetch(`http://127.0.0.1:${port}/api/market/FPT/history?range=2Y`);
        assert.equal(resPublicHistory.status, 400);
      } finally {
        server.close();
      }
    });

    test('47. End-to-end 1Y boundary: raw 2Y Yahoo response survives normalization and current-day exclusion', async () => {
      // Controlled raw Yahoo response with:
      // - boundary session: 2025-08-26 (price 31750)
      // - more than one year of daily source records
      // - analysisAsOf session: 2026-08-26 (price 35290)
      // - current Vietnam-date session (excluded): 2026-08-28 (price 36000)
      const timestamps = [];
      const opens = [];
      const highs = [];
      const lows = [];
      const closes = [];
      const volumes = [];
      const startUtc = Date.UTC(2025, 7, 26); // 2025-08-26
      const completedUtc = Date.UTC(2026, 7, 26); // 2026-08-26
      const dayMs = 86400000;

      for (let t = startUtc; t <= completedUtc; t += dayMs) {
        const d = new Date(t);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const isStart = (y === 2025 && m === '08' && day === '26');

        timestamps.push(Math.floor((t + 2 * 3600000) / 1000));
        opens.push(31000);
        highs.push(36000);
        lows.push(30000);
        closes.push(isStart ? 31750 : 35290);
        volumes.push(1000);
      }

      // Add a raw current-day bar at 2026-08-28 09:00 Vietnam time.
      timestamps.push(Math.floor((Date.UTC(2026, 7, 28) + 2 * 3600000) / 1000));
      opens.push(35500);
      highs.push(36500);
      lows.push(35000);
      closes.push(36000);
      volumes.push(2000);

      let interceptedUrl = null;
      const fakeFetch = async (url) => {
        interceptedUrl = url;
        return {
          ok: true,
          json: async () => ({
            chart: {
              result: [{
                meta: { symbol: 'E1VFVN30.VN' },
                timestamp: timestamps,
                indicators: {
                  quote: [{
                    open: opens,
                    high: highs,
                    low: lows,
                    close: closes,
                    volume: volumes
                  }]
                }
              }]
            }
          })
        };
      };

      let normalizedHistory = null;
      const productionAnalysisHistory = async (symbol) => {
        normalizedHistory = await getAnalysisHistory(symbol, {
          fetchFn: fakeFetch,
          resolveProviderMappingFn: resolveYahooVietnamFixture
        });
        return normalizedHistory;
      };

      const result = await getAssetAnalysis('E1VFVN30', {
        getAnalysisHistoryFn: productionAnalysisHistory,
        getMarketSnapshotFn: async () => null,
        now: new Date('2026-08-28T07:00:00.000Z')
      });

      const providerUrl = new URL(interceptedUrl);
      assert.equal(providerUrl.searchParams.get('range'), '2y');
      assert.equal(providerUrl.searchParams.get('interval'), '1d');
      assert.ok(timestamps.length > 365);

      const normalizedBoundary = normalizedHistory.bars.find(
        (bar) => bar.timestamp === '2025-08-26T02:00:00.000Z'
      );
      assert.ok(normalizedBoundary);
      assert.equal(normalizedBoundary.close, 31750);

      assert.equal(result.analysisAsOf, '2026-08-26T02:00:00.000Z');
      assert.equal(result.analysisPrice, 35290);
      assert.equal(result.periods['1Y'].status, 'available');
      assert.equal(result.periods['1Y'].observedStartAt, '2025-08-26T02:00:00.000Z');
      assert.equal(result.periods['1Y'].periodStartPrice, 31750);
      assert.equal(result.periods['1Y'].priceChangePct, ((35290 / 31750) - 1) * 100);
    });
  });
});
