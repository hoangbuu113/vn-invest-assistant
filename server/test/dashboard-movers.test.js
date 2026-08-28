import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeWatchlistMovers } from '../src/dashboard.js';

describe('Feature 09 — Dashboard Watchlist Movers (computeWatchlistMovers)', () => {
  const sampleWatchlist = [
    { id: '1', asset: { symbol: 'FPT', name: 'FPT Corp', asset_type: 'stock' } },
    { id: '2', asset: { symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock' } },
    { id: '3', asset: { symbol: 'HPG', name: 'Hoa Phat', asset_type: 'stock' } },
    { id: '4', asset: { symbol: 'VNM', name: 'Vinamilk', asset_type: 'stock' } }
  ];

  test('1. Normal case: correctly identifies top gainer and top decliner with full precision', () => {
    const marketDataMap = {
      FPT: { price: 135000, change: 3500, changePercent: 2.661596958 },
      VCB: { price: 92000, change: -1200, changePercent: -1.287553648 },
      HPG: { price: 29500, change: 100, changePercent: 0.340136054 },
      VNM: { price: 74000, change: -500, changePercent: -0.671140939 }
    };

    const result = computeWatchlistMovers(sampleWatchlist, marketDataMap);

    assert.equal(result.validCount, 4);
    assert.ok(result.topGainer);
    assert.equal(result.topGainer.symbol, 'FPT');
    assert.equal(result.topGainer.changePercent, 2.661596958);

    assert.ok(result.topDecliner);
    assert.equal(result.topDecliner.symbol, 'VCB');
    assert.equal(result.topDecliner.changePercent, -1.287553648);
  });

  test('2. Missing/malformed snapshots: items with null price or changePercent are filtered out', () => {
    const marketDataMap = {
      FPT: { price: 135000, change: 3500, changePercent: 2.66 },
      VCB: { price: null, change: null, changePercent: null }, // unavailable price
      HPG: { price: 29500, change: -200, changePercent: -0.67 },
      VNM: null // missing entirely
    };

    const result = computeWatchlistMovers(sampleWatchlist, marketDataMap);

    assert.equal(result.validCount, 2);
    assert.equal(result.topGainer?.symbol, 'FPT');
    assert.equal(result.topDecliner?.symbol, 'HPG');
  });

  test('3. Insufficient data: returns null when valid count is less than 2', () => {
    const marketDataMap = {
      FPT: { price: 135000, change: 3500, changePercent: 2.66 },
      VCB: { price: null, change: null, changePercent: null }
    };

    const result = computeWatchlistMovers(sampleWatchlist, marketDataMap);

    assert.equal(result.validCount, 1);
    assert.equal(result.topGainer, null);
    assert.equal(result.topDecliner, null);
  });

  test('4. Empty watchlist: returns null and validCount 0', () => {
    const result = computeWatchlistMovers([], {});
    assert.equal(result.validCount, 0);
    assert.equal(result.topGainer, null);
    assert.equal(result.topDecliner, null);
  });

  test('5. All positive changes: topGainer is set, topDecliner is null (never fabricate negative)', () => {
    const marketDataMap = {
      FPT: { price: 135000, change: 3500, changePercent: 2.66 },
      VCB: { price: 92000, change: 1000, changePercent: 1.10 }
    };

    const result = computeWatchlistMovers(sampleWatchlist, marketDataMap);

    assert.equal(result.validCount, 2);
    assert.equal(result.topGainer?.symbol, 'FPT');
    assert.equal(result.topDecliner, null, 'Must be null when no decliners exist');
  });

  test('6. All negative changes: topDecliner is set, topGainer is null (never fabricate positive)', () => {
    const marketDataMap = {
      FPT: { price: 135000, change: -3500, changePercent: -2.66 },
      VCB: { price: 92000, change: -1000, changePercent: -1.10 }
    };

    const result = computeWatchlistMovers(sampleWatchlist, marketDataMap);

    assert.equal(result.validCount, 2);
    assert.equal(result.topGainer, null, 'Must be null when no gainers exist');
    assert.equal(result.topDecliner?.symbol, 'FPT');
  });
});

