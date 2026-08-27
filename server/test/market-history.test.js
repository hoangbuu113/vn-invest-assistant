import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHistoricalData, getVietnamSessionKey } from '../src/market.js';

// Base timestamps for controlled fixtures (seconds, approx 1 day apart in Vietnam timezone)
// 2026-08-20, 2026-08-21, 2026-08-24, 2026-08-25
const TS_DAY1 = 1787191200; // 2026-08-20 02:00:00 UTC = 09:00:00 UTC+7
const TS_DAY2 = 1787277600; // 2026-08-21 02:00:00 UTC = 09:00:00 UTC+7
const TS_DAY3 = 1787536800; // 2026-08-24 02:00:00 UTC = 09:00:00 UTC+7
const TS_DAY4 = 1787623200; // 2026-08-25 02:00:00 UTC = 09:00:00 UTC+7

describe('Feature 06 - Historical Data Integrity Hardening (Patch 2)', () => {

  test('1. Valid normal bars normalize and calculate correctly', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2, TS_DAY3],
      indicators: {
        quote: [{
          open: [70000, 71000, 72000],
          high: [72500, 73000, 74000],
          low: [69500, 70500, 71500],
          close: [71000, 72000, 73500],
          volume: [1000000, 1500000, 2000000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars.length, 3);
    assert.equal(result.symbol, 'FPT');
    assert.equal(result.range, '1W');
    assert.equal(result.freshness, 'delayed');
    assert.equal(result.metrics.periodStartPrice, 71000);
    assert.equal(result.metrics.latestPrice, 73500);
    assert.equal(result.metrics.absoluteChange, 2500);
    assert.equal(result.metrics.periodHigh, 74000);
    assert.equal(result.metrics.periodLow, 69500);
    assert.equal(result.metrics.validSessions, 3);
  });

  test('2. Missing open is preserved as null and not fabricated from close', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [null, undefined],
          high: [72000, 73000],
          low: [70000, 71000],
          close: [71000, 72000],
          volume: [1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars[0].open, null);
    assert.equal(result.bars[1].open, null);
    assert.equal(result.bars[0].close, 71000);
    assert.notEqual(result.bars[0].open, result.bars[0].close);
  });

  test('3. Missing high is preserved as null and does not corrupt metrics', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 71000],
          high: [null, 74000],
          low: [69000, 70000],
          close: [71000, 73000],
          volume: [1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars[0].high, null);
    assert.equal(result.bars[1].high, 74000);
    assert.equal(result.metrics.periodHigh, 74000);

    const allMissingHigh = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 71000],
          high: [null, null],
          low: [69000, 70000],
          close: [71000, 73000],
          volume: [1000, 2000]
        }]
      }
    };
    const resAllMissing = normalizeHistoricalData(allMissingHigh, 'FPT', '1W');
    assert.equal(resAllMissing.metrics.periodHigh, null);
  });

  test('4. Missing low is preserved as null and does not corrupt metrics', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 71000],
          high: [72000, 74000],
          low: [null, 70000],
          close: [71000, 73000],
          volume: [1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars[0].low, null);
    assert.equal(result.bars[1].low, 70000);
    assert.equal(result.metrics.periodLow, 70000);

    const allMissingLow = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 71000],
          high: [72000, 74000],
          low: [null, null],
          close: [71000, 73000],
          volume: [1000, 2000]
        }]
      }
    };
    const resAllMissing = normalizeHistoricalData(allMissingLow, 'FPT', '1W');
    assert.equal(resAllMissing.metrics.periodLow, null);
  });

  test('5. Volume integrity: exact fractional values preserved, invalid/missing -> null', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2, TS_DAY3, TS_DAY4],
      indicators: {
        quote: [{
          open: [70000, 71000, 72000, 73000],
          high: [72000, 73000, 74000, 75000],
          low: [69000, 70000, 71000, 72000],
          close: [71000, 72000, 73000, 74000],
          volume: [12345.67, 0, -50, null]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars[0].volume, 12345.67); // Not floored to 12345
    assert.equal(result.bars[1].volume, 0);        // Exact 0 preserved
    assert.equal(result.bars[2].volume, null);     // Negative -> null
    assert.equal(result.bars[3].volume, null);     // Missing -> null
  });

  test('6. Malformed close coverage: null, NaN, non-numeric string, close <= 0 are dropped', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2, TS_DAY3, TS_DAY4, TS_DAY4 + 86400, TS_DAY4 + 172800],
      indicators: {
        quote: [{
          open: [70000, 71000, 72000, 73000, 74000, 75000],
          high: [72000, 73000, 74000, 75000, 76000, 77000],
          low: [69000, 70000, 71000, 72000, 73000, 74000],
          close: [71000, null, NaN, 'bad_string', 0, -50],
          volume: [1000, 2000, 3000, 4000, 5000, 6000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars.length, 1);
    assert.equal(result.bars[0].close, 71000);
  });

  test('7. Identical duplicate sessions with different timestamps: deterministic earliest timestamp', () => {
    // Two timestamps on the same Vietnam trading date (e.g. 02:00 UTC and 04:00 UTC)
    const tsEarly = TS_DAY1;
    const tsLate = TS_DAY1 + 7200; // 2 hours later, same Vietnam day

    // Test order 1: Early then Late
    const fixtureOrder1 = {
      timestamp: [tsEarly, tsLate, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 70000, 71000],
          high: [72000, 72000, 73000],
          low: [69000, 69000, 70000],
          close: [71000, 71000, 72000],
          volume: [1000, 1000, 2000]
        }]
      }
    };

    // Test order 2: Late then Early (reversed)
    const fixtureOrder2 = {
      timestamp: [tsLate, tsEarly, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 70000, 71000],
          high: [72000, 72000, 73000],
          low: [69000, 69000, 70000],
          close: [71000, 71000, 72000],
          volume: [1000, 1000, 2000]
        }]
      }
    };

    const result1 = normalizeHistoricalData(fixtureOrder1, 'FPT', '1W');
    const result2 = normalizeHistoricalData(fixtureOrder2, 'FPT', '1W');

    assert.equal(result1.bars.length, 2);
    assert.equal(result2.bars.length, 2);

    const expectedCanonicalTimestamp = new Date(tsEarly * 1000).toISOString();
    assert.equal(result1.bars[0].timestamp, expectedCanonicalTimestamp);
    assert.equal(result2.bars[0].timestamp, expectedCanonicalTimestamp);

    // Deep equal comparison across results
    assert.deepEqual(result1.bars, result2.bars);
  });

  test('8. Vietnam date boundary: timestamps around UTC boundary map to distinct local dates', () => {
    // 2026-08-20 16:59:59 UTC = 2026-08-20 23:59:59 UTC+7 (session 2026-08-20)
    const tsDayEnd = 1787245199;
    // 2026-08-20 17:00:00 UTC = 2026-08-21 00:00:00 UTC+7 (session 2026-08-21)
    const tsNextDayStart = 1787245200;

    assert.equal(getVietnamSessionKey(tsDayEnd), '2026-08-20');
    assert.equal(getVietnamSessionKey(tsNextDayStart), '2026-08-21');

    const fixture = {
      timestamp: [tsDayEnd, tsNextDayStart],
      indicators: {
        quote: [{
          open: [70000, 70000],
          high: [72000, 72000],
          low: [69000, 69000],
          close: [71000, 71000],
          volume: [1000, 1000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars.length, 2);
    assert.equal(result.bars[0].timestamp, new Date(tsDayEnd * 1000).toISOString());
    assert.equal(result.bars[1].timestamp, new Date(tsNextDayStart * 1000).toISOString());
  });

  test('9. All-conflicting sessions: error occurs and structured warning survives on error object', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY1],
      indicators: {
        quote: [{
          open: [70000, 70500], // Conflicting open
          high: [72000, 72000],
          low: [69000, 69000],
          close: [71000, 71500], // Conflicting close
          volume: [1000, 1200]
        }]
      }
    };

    assert.throws(
      () => normalizeHistoricalData(fixture, 'FPT', '1W'),
      (err) => {
        assert.equal(err.status, 404);
        assert.ok(err.warnings && err.warnings.length > 0);
        assert.equal(err.warnings[0].code, 'CONFLICTING_DUPLICATE_SESSION');
        assert.equal(err.warnings[0].sessionKey, getVietnamSessionKey(TS_DAY1));
        return true;
      }
    );
  });

  test('10. No valid bars: controlled 404 error with no fabricated output', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [70000, 71000],
          high: [72000, 73000],
          low: [69000, 70000],
          close: [null, -100],
          volume: [1000, 2000]
        }]
      }
    };

    assert.throws(
      () => normalizeHistoricalData(fixture, 'FPT', '1W'),
      (err) => {
        assert.equal(err.status, 404);
        assert.match(err.message, /No valid historical price records found/);
        return true;
      }
    );
  });

  test('11. Period start semantics: leading invalid bar is discarded and next valid becomes period start', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2, TS_DAY3],
      indicators: {
        quote: [{
          open: [70000, 50000, 60000],
          high: [72000, 55000, 65000],
          low: [69000, 48000, 58000],
          close: [0, 50000, 60000], // First bar has close=0 (discarded), second bar close=50000 becomes period start
          volume: [1000, 2000, 3000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars.length, 2);
    assert.equal(result.metrics.validSessions, 2);
    assert.equal(result.metrics.periodStartPrice, 50000);
    assert.equal(result.metrics.latestPrice, 60000);
    assert.equal(result.metrics.absoluteChange, 10000);
    assert.equal(result.metrics.percentageChange, ((60000 / 50000) - 1) * 100);
  });

  test('12. Percentage calculation uses full precision without intermediate rounding', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [62200, 71000],
          high: [63000, 73000],
          low: [62000, 70000],
          close: [62200, 72200],
          volume: [1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1M');
    const expectedPct = ((72200 / 62200) - 1) * 100;
    assert.equal(result.metrics.percentageChange, expectedPct);
    assert.equal(result.metrics.absoluteChange, 10000);
  });

  test('13. High == low condition calculates periodHigh == periodLow', () => {
    const fixture = {
      timestamp: [TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [50000, 50000],
          high: [50000, 50000],
          low: [50000, 50000],
          close: [50000, 50000],
          volume: [1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.metrics.periodHigh, 50000);
    assert.equal(result.metrics.periodLow, 50000);
    assert.equal(result.metrics.absoluteChange, 0);
    assert.equal(result.metrics.percentageChange, 0);
  });

  test('14. Chronological ordering sorts unsorted input bars oldest to newest', () => {
    const fixture = {
      timestamp: [TS_DAY3, TS_DAY1, TS_DAY2],
      indicators: {
        quote: [{
          open: [73000, 70000, 71000],
          high: [74000, 72000, 73000],
          low: [72000, 69000, 70000],
          close: [73500, 71000, 72000],
          volume: [3000, 1000, 2000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    assert.equal(result.bars.length, 3);
    assert.equal(result.bars[0].close, 71000);
    assert.equal(result.bars[1].close, 72000);
    assert.equal(result.bars[2].close, 73500);
  });

  test('15. Robust historical updatedAt equals the timestamp of the final normalized returned bar', () => {
    const fixture = {
      timestamp: [TS_DAY3, TS_DAY1, TS_DAY2], // Input is unordered
      meta: {
        regularMarketTime: 1234567890 // Unrelated quote metadata timestamp
      },
      indicators: {
        quote: [{
          open: [70000, 71000, 72000],
          high: [72000, 73000, 74000],
          low: [69000, 70000, 71000],
          close: [71000, 72000, 73500],
          volume: [1000, 2000, 3000]
        }]
      }
    };

    const result = normalizeHistoricalData(fixture, 'FPT', '1W');
    const expectedLatestTimestamp = new Date(TS_DAY3 * 1000).toISOString();
    assert.equal(result.updatedAt, expectedLatestTimestamp);
    assert.equal(result.updatedAt, result.bars[result.bars.length - 1].timestamp);
    assert.notEqual(result.updatedAt, new Date(1234567890 * 1000).toISOString());
  });

});
