import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateComparisonSelection,
  normalizeHistoricalPrices,
  translateDataCompleteness
} from '../src/comparison.js';

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
});

