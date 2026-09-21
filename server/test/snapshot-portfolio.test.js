import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarketSnapshot } from '../src/market.js';
import { calculatePortfolioValuation, getPortfolioOverview } from '../src/portfolio.js';

describe('Market Snapshot Integrity (Patch A & A2)', () => {

  test('1. Valid snapshot normalizes and calculates change & changePercent with full precision', () => {
    const meta = {
      regularMarketPrice: 72200,
      previousClose: 71000,
      regularMarketDayHigh: 73000,
      regularMarketDayLow: 70500,
      regularMarketVolume: 1500000,
      regularMarketTime: 1787191200,
      currency: 'VND',
      exchangeName: 'HOSE'
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.symbol, 'FPT');
    assert.equal(snapshot.currency, 'VND');
    assert.equal(snapshot.exchange, 'HOSE');
    assert.equal(snapshot.price, 72200);
    assert.equal(snapshot.previousClose, 71000);
    assert.equal(snapshot.change, 1200);
    assert.equal(snapshot.changePercent, ((72200 / 71000) - 1) * 100);
    assert.equal(snapshot.dayHigh, 73000);
    assert.equal(snapshot.dayLow, 70500);
    assert.equal(snapshot.volume, 1500000);
    assert.equal(snapshot.updatedAt, new Date(1787191200 * 1000).toISOString());
    assert.equal(snapshot.priceAsOf, new Date(1787191200 * 1000).toISOString());
    assert.equal(snapshot.priceSource, 'yahoo_delayed_snapshot');
    assert.equal(snapshot.freshness, 'delayed');
  });

  test('2. Missing currency and exchange are preserved as null and not fabricated', () => {
    const meta = {
      regularMarketPrice: 72200,
      previousClose: 71000,
      currency: null,
      exchangeName: undefined
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.currency, null);
    assert.equal(snapshot.exchange, null);
  });

  test('3. Invalid fullExchangeName does not mask valid exchangeName', () => {
    const metaInvalidFull = {
      regularMarketPrice: 72200,
      previousClose: 71000,
      fullExchangeName: '   ', // whitespace only / invalid
      exchangeName: 'HOSE'
    };

    const snapshot = normalizeMarketSnapshot(metaInvalidFull, 'FPT');
    assert.equal(snapshot.exchange, 'HOSE');

    const metaNonStringFull = {
      regularMarketPrice: 72200,
      previousClose: 71000,
      fullExchangeName: 12345, // non-string
      exchangeName: 'HOSE'
    };

    const snapshotNonString = normalizeMarketSnapshot(metaNonStringFull, 'FPT');
    assert.equal(snapshotNonString.exchange, 'HOSE');
  });

  test('4. price = 0 is rejected and marked unavailable (null)', () => {
    const meta = {
      regularMarketPrice: 0,
      previousClose: 71000
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.price, null);
    assert.equal(snapshot.change, null);
    assert.equal(snapshot.changePercent, null);
  });

  test('4. Negative price is rejected and marked unavailable (null)', () => {
    const meta = {
      regularMarketPrice: -50000,
      previousClose: 71000
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.price, null);
    assert.equal(snapshot.change, null);
    assert.equal(snapshot.changePercent, null);
  });

  test('5. Malformed price (NaN, string, Infinity) is rejected and marked unavailable (null)', () => {
    const metaNaN = { regularMarketPrice: NaN, previousClose: 71000 };
    const metaStr = { regularMarketPrice: 'invalid', previousClose: 71000 };
    const metaInf = { regularMarketPrice: Infinity, previousClose: 71000 };

    assert.equal(normalizeMarketSnapshot(metaNaN, 'FPT').price, null);
    assert.equal(normalizeMarketSnapshot(metaStr, 'FPT').price, null);
    assert.equal(normalizeMarketSnapshot(metaInf, 'FPT').price, null);
  });

  test('6. Invalid previousClose (0, negative, null) leaves change and changePercent null', () => {
    const metaZero = { regularMarketPrice: 72200, previousClose: 0 };
    const metaNeg = { regularMarketPrice: 72200, previousClose: -70000 };
    const metaNull = { regularMarketPrice: 72200, previousClose: null };

    const snapZero = normalizeMarketSnapshot(metaZero, 'FPT');
    assert.equal(snapZero.previousClose, null);
    assert.equal(snapZero.change, null);
    assert.equal(snapZero.changePercent, null);

    const snapNeg = normalizeMarketSnapshot(metaNeg, 'FPT');
    assert.equal(snapNeg.previousClose, null);
    assert.equal(snapNeg.change, null);
    assert.equal(snapNeg.changePercent, null);

    const snapNull = normalizeMarketSnapshot(metaNull, 'FPT');
    assert.equal(snapNull.previousClose, null);
    assert.equal(snapNull.change, null);
    assert.equal(snapNull.changePercent, null);
  });

  test('7. Missing high / low are preserved as null', () => {
    const meta = {
      regularMarketPrice: 72200,
      previousClose: 71000,
      regularMarketDayHigh: null,
      regularMarketDayLow: 0 // non-positive low becomes null
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.dayHigh, null);
    assert.equal(snapshot.dayLow, null);
  });

  test('8. Invalid/negative volume becomes null', () => {
    const metaNeg = { regularMarketPrice: 72200, regularMarketVolume: -100 };
    const metaNan = { regularMarketPrice: 72200, regularMarketVolume: NaN };

    assert.equal(normalizeMarketSnapshot(metaNeg, 'FPT').volume, null);
    assert.equal(normalizeMarketSnapshot(metaNan, 'FPT').volume, null);
  });

  test('9. Fractional valid volume is preserved exactly without flooring', () => {
    const meta = {
      regularMarketPrice: 72200,
      regularMarketVolume: 12345.67
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.volume, 12345.67);
  });

  test('10. Missing market timestamp does NOT become current time and remains null', () => {
    const meta = {
      regularMarketPrice: 72200,
      regularMarketTime: null
    };

    const snapshot = normalizeMarketSnapshot(meta, 'FPT');
    assert.equal(snapshot.updatedAt, null);
    assert.equal(snapshot.priceAsOf, null);
  });

  test('11. Snapshot changePercent uses full precision, not rounded change', () => {
    const meta = {
      regularMarketPrice: 62.25,
      previousClose: 54.10
    };

    const snapshot = normalizeMarketSnapshot(meta, 'TEST');
    const expectedExactPct = ((62.25 / 54.10) - 1) * 100;
    assert.equal(snapshot.changePercent, expectedExactPct);
    assert.equal(snapshot.change, 62.25 - 54.10);
  });

});

describe('Portfolio Valuation Integrity (Patch A & A2)', () => {

  test('P0.2 missing or malformed cash is unavailable and never fabricated as zero', () => {
    for (const profile of [null, {}, { cash_available: null }, { cash_available: 'bad' }]) {
      const result = calculatePortfolioValuation(profile, [], {});
      assert.equal(result.summary.cashAvailable, null);
      assert.equal(result.summary.cashStatus, 'unavailable');
      assert.equal(result.summary.cashReason, 'AUTHORITATIVE_CASH_UNAVAILABLE');
      assert.equal(result.summary.totalPortfolioValue, null);
      assert.equal(result.summary.valuationStatus, 'partial');
    }

    const confirmedZero = calculatePortfolioValuation({ cash_available: 0 }, [], {});
    assert.equal(confirmedZero.summary.cashAvailable, 0);
    assert.equal(confirmedZero.summary.cashStatus, 'available');
    assert.equal(confirmedZero.summary.totalPortfolioValue, 0);
    assert.equal(confirmedZero.summary.valuationStatus, 'complete');
  });

  test('P0.2 portfolio overview remains truthful and partial when cash authority fails', async () => {
    const result = await getPortfolioOverview({
      getCashOverviewFn: async () => {
        throw new Error('cash authority unavailable');
      },
      getHoldingsFn: async () => [],
      getMarketSnapshotFn: async () => {
        throw new Error('cash-only overview must not fetch prices');
      }
    });

    assert.equal(result.summary.cashAvailable, null);
    assert.equal(result.summary.cashStatus, 'unavailable');
    assert.equal(result.summary.totalPortfolioValue, null);
    assert.equal(result.summary.valuationStatus, 'partial');
  });

  test('P0.2 stale provider price remains displayable but is never labelled current', () => {
    const result = calculatePortfolioValuation(
      { cash_available: 1_000 },
      [{
        id: 'h-stale',
        quantity: 2,
        average_cost: 80,
        asset: { symbol: 'FPT', quote_currency: 'VND' }
      }],
      {
        FPT: {
          price: 100,
          priceAsOf: '2026-08-20T08:00:00.000Z',
          freshness: 'stale',
          cacheStatus: 'stale'
        }
      }
    );

    assert.equal(result.holdings[0].marketValue, 200);
    assert.equal(result.holdings[0].valuationStatus, 'stale');
    assert.equal(result.holdings[0].valuationReason, 'STALE_MARKET_PRICE');
    assert.equal(result.holdings[0].marketFreshness, 'stale');
    assert.equal(result.summary.totalMarketValue, 200);
    assert.equal(result.summary.totalPortfolioValue, 1_200);
    assert.equal(result.summary.valuationStatus, 'stale');
    assert.equal(result.summary.pnlCoverageStatus, 'stale');
  });

  test('1. Valid priced holding math calculates full precision marketValue, PnL, PnL%', () => {
    const profile = { cash_available: 50000000 };
    const holdings = [{
      id: 'h1',
      asset_id: 'a1',
      quantity: 100,
      average_cost: 60000,
      asset: { symbol: 'FPT', name: 'FPT Corp', quote_currency: 'VND' }
    }];
    const snapshots = {
      FPT: { price: 72000, priceAsOf: '2026-08-20T02:00:00.000Z' }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];

    assert.equal(h.costBasis, 6000000);
    assert.equal(h.latestPrice, 72000);
    assert.equal(h.marketValue, 7200000);
    assert.equal(h.unrealizedPnL, 1200000);
    assert.equal(h.unrealizedPnLPercent, 20); // ((7200000 - 6000000) / 6000000) * 100 = 20%
    assert.equal(h.pricingStatus, 'available');
    assert.equal(h.marketUpdatedAt, '2026-08-20T02:00:00.000Z');

    assert.equal(result.summary.cashAvailable, 50000000);
    assert.equal(result.summary.totalCostBasis, 6000000);
    assert.equal(result.summary.pricedCostBasis, 6000000);
    assert.equal(result.summary.totalMarketValue, 7200000);
    assert.equal(result.summary.totalUnrealizedPnL, 1200000);
    assert.equal(result.summary.totalUnrealizedPnLPercent, 20);
    assert.equal(result.summary.totalPortfolioValue, 57200000);
    assert.equal(result.summary.valuationStatus, 'complete');
  });

  test('2. Zero price is treated as unavailable', () => {
    const profile = { cash_available: 1000000 };
    const holdings = [{
      id: 'h1',
      quantity: 100,
      average_cost: 50000,
      asset: { symbol: 'FPT', quote_currency: 'VND' }
    }];
    const snapshots = {
      FPT: { price: 0, priceAsOf: '2026-08-20T02:00:00.000Z' }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.equal(h.pricingStatus, 'unavailable');
    assert.equal(h.latestPrice, null);
    assert.equal(h.marketValue, null);
    assert.equal(h.unrealizedPnL, null);
    assert.equal(h.unrealizedPnLPercent, null);
    assert.equal(h.marketUpdatedAt, null);
    assert.equal(result.summary.valuationStatus, 'partial');
  });

  test('3. Negative price is treated as unavailable', () => {
    const profile = { cash_available: 1000000 };
    const holdings = [{
      id: 'h1',
      quantity: 100,
      average_cost: 50000,
      asset: { symbol: 'FPT', quote_currency: 'VND' }
    }];
    const snapshots = {
      FPT: { price: -50000 }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.equal(h.pricingStatus, 'unavailable');
    assert.equal(h.latestPrice, null);
    assert.equal(result.summary.valuationStatus, 'partial');
  });

  test('4. Missing snapshot / price is treated as unavailable', () => {
    const profile = { cash_available: 1000000 };
    const holdings = [{
      id: 'h1',
      quantity: 100,
      average_cost: 50000,
      asset: { symbol: 'UNKNOWN', quote_currency: 'VND' }
    }];
    const snapshots = {};

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.equal(h.pricingStatus, 'unavailable');
    assert.equal(h.latestPrice, null);
    assert.equal(result.summary.valuationStatus, 'partial');
  });

  test('5. Partial valuation when one holding is priced and another cannot be priced', () => {
    const profile = { cash_available: 10000000 };
    const holdings = [
      { id: 'h1', quantity: 100, average_cost: 50000, asset: { symbol: 'FPT', quote_currency: 'VND' } },
      { id: 'h2', quantity: 200, average_cost: 30000, asset: { symbol: 'VCB', quote_currency: 'VND' } }
    ];
    const snapshots = {
      FPT: { price: 60000, priceAsOf: '2026-08-20T02:00:00.000Z' },
      VCB: { price: null } // unpriced
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    assert.equal(result.summary.valuationStatus, 'partial');
    assert.equal(result.summary.totalCostBasis, 100 * 50000 + 200 * 30000); // 11,000,000
    assert.equal(result.summary.pricedCostBasis, 100 * 50000);              // 5,000,000
    assert.equal(result.summary.totalMarketValue, 100 * 60000);            // 6,000,000
    assert.equal(result.summary.totalUnrealizedPnL, 1000000);
    assert.equal(result.summary.totalUnrealizedPnLPercent, 20);
    assert.equal(result.summary.totalUnrealizedPnL, null);
    assert.equal(result.summary.totalUnrealizedPnLPercent, null);
    assert.equal(result.summary.knownUnrealizedPnL, 1000000);
    assert.equal(result.summary.knownUnrealizedPnLPercent, 20);
    assert.equal(result.summary.totalPortfolioValue, 10000000 + 6000000);
  });

  test('6. Fractional quantity precision is preserved without premature rounding', () => {
    const profile = { cash_available: 0 };
    const holdings = [{
      id: 'h1',
      quantity: 12.3456,
      average_cost: 65432.1,
      asset: { symbol: 'FPT', quote_currency: 'VND' }
    }];
    const snapshots = {
      FPT: { price: 70000.5 }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.equal(h.costBasis, 12.3456 * 65432.1);
    assert.equal(h.marketValue, 12.3456 * 70000.5);
    assert.equal(h.unrealizedPnL, (12.3456 * 70000.5) - (12.3456 * 65432.1));
  });

  test('7. Cost basis > 0 cannot become zero due to intermediate rounding', () => {
    const profile = { cash_available: 0 };
    const holdings = [{
      id: 'h1',
      quantity: 0.0001,
      average_cost: 0.0001,
      asset: { symbol: 'MICRO', quote_currency: 'VND' }
    }];
    const snapshots = {
      MICRO: { price: 0.0002 }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.ok(h.costBasis > 0);
    assert.equal(h.unrealizedPnLPercent, 100);
  });

  test('8. costBasis = 0 yields unrealizedPnLPercent = null', () => {
    const profile = { cash_available: 0 };
    const holdings = [{
      id: 'h1',
      quantity: 0,
      average_cost: 0,
      asset: { symbol: 'ZERO', quote_currency: 'VND' }
    }];
    const snapshots = {
      ZERO: { price: 10000 }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const h = result.holdings[0];
    assert.equal(h.costBasis, 0);
    assert.equal(h.unrealizedPnLPercent, null);
    assert.equal(result.summary.pricedCostBasis, 0);
    assert.equal(result.summary.totalUnrealizedPnLPercent, null);
  });

  test('9. Aggregate calculations use full precision', () => {
    const profile = { cash_available: 12345.678 };
    const holdings = [
      { id: 'h1', quantity: 1.111, average_cost: 10.111, asset: { symbol: 'A', quote_currency: 'VND' } },
      { id: 'h2', quantity: 2.222, average_cost: 20.222, asset: { symbol: 'B', quote_currency: 'VND' } }
    ];
    const snapshots = {
      A: { price: 15.333 },
      B: { price: 25.444 }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    const expectedPricedCostBasis = (1.111 * 10.111) + (2.222 * 20.222);
    const expectedTotalMarketValue = (1.111 * 15.333) + (2.222 * 25.444);
    const expectedPnL = expectedTotalMarketValue - expectedPricedCostBasis;
    const expectedPnLPct = (expectedPnL / expectedPricedCostBasis) * 100;

    assert.equal(result.summary.pricedCostBasis, expectedPricedCostBasis);
    assert.equal(result.summary.totalMarketValue, expectedTotalMarketValue);
    assert.equal(result.summary.totalUnrealizedPnL, expectedPnL);
    assert.equal(result.summary.totalUnrealizedPnLPercent, expectedPnLPct);
  });

  test('10. Missing timestamp in snapshot remains null in holding marketUpdatedAt', () => {
    const profile = { cash_available: 1000 };
    const holdings = [{
      id: 'h1',
      quantity: 10,
      average_cost: 100,
      asset: { symbol: 'FPT', quote_currency: 'VND' }
    }];
    const snapshots = {
      FPT: { price: 120, priceAsOf: null, updatedAt: null }
    };

    const result = calculatePortfolioValuation(profile, holdings, snapshots);
    assert.equal(result.holdings[0].marketUpdatedAt, null);
  });

});
