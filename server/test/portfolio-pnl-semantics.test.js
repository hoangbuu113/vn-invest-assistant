import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { calculatePortfolioValuation } from '../src/portfolio.js';
import { buildPortfolioSnapshot, PORTFOLIO_DATA_STATES } from '../src/portfolioSnapshot.js';
import { buildPortfolioSummaryDisplay, PORTFOLIO_DISPLAY_STATES } from '../../client/src/utils/portfolioSnapshotDisplay.js';

const PROFILE_ID = '00000000-0000-4000-8000-000000000111';
const CALCULATED_AT = '2026-09-21T04:00:00.000Z';

function createFptHolding(overrides = {}) {
  return {
    id: 'holding-fpt',
    asset_id: 'asset-fpt',
    opening_position_id: 'opening-fpt',
    quantity: 14,
    average_cost: 68603,
    asset: {
      symbol: 'FPT',
      name: 'FPT Corporation',
      asset_type: 'stock',
      exchange: 'HOSE',
      quote_currency: 'VND',
      quantity_unit: 'share'
    },
    opening_position: {
      id: 'opening-fpt',
      execution_unit_price: 68603,
      price_currency: 'VND'
    },
    ...overrides
  };
}

function createOndoHolding(overrides = {}) {
  return {
    id: 'holding-ondo',
    asset_id: 'asset-ondo',
    opening_position_id: 'opening-ondo',
    quantity: 226,
    average_cost: null,
    native_average_cost: 0.36402,
    native_cost_currency: 'USDT',
    asset: {
      symbol: 'ONDO',
      name: 'Ondo',
      asset_type: 'crypto',
      exchange: null,
      quote_currency: 'USD',
      quantity_unit: 'coin'
    },
    opening_position: {
      id: 'opening-ondo',
      execution_unit_price: 0.36402,
      price_currency: 'USDT'
    },
    ...overrides
  };
}

function createEnaHolding(overrides = {}) {
  return {
    id: 'holding-ena',
    asset_id: 'asset-ena',
    opening_position_id: 'opening-ena',
    quantity: 184.50502,
    average_cost: null,
    native_average_cost: 0.1641,
    native_cost_currency: 'USDT',
    asset: {
      symbol: 'ENA',
      name: 'Ethena',
      asset_type: 'crypto',
      exchange: null,
      quote_currency: 'USD',
      quantity_unit: 'coin'
    },
    opening_position: {
      id: 'opening-ena',
      execution_unit_price: 0.1641,
      price_currency: 'USDT'
    },
    ...overrides
  };
}

describe('Portfolio Unrealized P/L Semantics & Summary Truthfulness', () => {
  // CASE A: all holdings have VND P/L => aggregate VND P/L available => Summary shows numeric total
  test('CASE A: all holdings have VND P/L => complete aggregate VND P/L and numeric total', () => {
    const holdings = [
      createFptHolding({
        quantity: 10,
        average_cost: 80000
      })
    ];
    const snapshots = {
      FPT: { price: 100000, currency: 'VND', freshness: 'live' }
    };
    const overview = calculatePortfolioValuation({ cash_available: 500000 }, holdings, snapshots);
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    assert.equal(overview.summary.pnlCoverageStatus, 'complete');
    assert.equal(overview.summary.totalUnrealizedPnL, 200000); // 10 * 100000 - 10 * 80000
    assert.equal(overview.summary.totalUnrealizedPnLPercent, 25);
    assert.equal(overview.summary.knownUnrealizedPnL, 200000);

    assert.equal(snapshot.unrealizedPnL, 200000);
    assert.equal(snapshot.unrealizedPnLPercent, 25);
    assert.equal(snapshot.knownUnrealizedPnL, 200000);

    assert.equal(view.unrealizedPnl, 200000);
    assert.equal(view.unrealizedPnlPercent, 25);
    assert.equal(view.isPnlPartial, false);
  });

  // CASE B: FPT VND P/L available, ONDO/ENA VND P/L unavailable => aggregate status incomplete => Summary does NOT display FPT loss as total
  test('CASE B: FPT VND P/L available, ONDO/ENA unavailable => aggregate status partial, no fake total', () => {
    const holdings = [
      createFptHolding({ quantity: 14, average_cost: 68603 }),
      createOndoHolding(),
      createEnaHolding()
    ];
    const snapshots = {
      FPT: { price: 66200, currency: 'VND', freshness: 'delayed' },
      ONDO: { price: 0.4302, currency: 'USD', freshness: 'live' },
      ENA: { price: 0.2141, currency: 'USD', freshness: 'live' }
    };
    const nativeReferences = {
      ONDO: { price: 0.4302, currency: 'USDT', freshness: 'live' },
      ENA: { price: 0.2141, currency: 'USDT', freshness: 'live' }
    };
    const fxRates = {
      USDT: { rate: 26000, availability: 'available', provider: 'COINMARKETCAP', freshness: 'current' },
      USD: { rate: 25400, availability: 'available', provider: 'TWELVEDATA', freshness: 'current' }
    };

    const overview = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshots,
      fxRates,
      nativeReferences
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    const expectedFptPnl = (14 * 66200) - (14 * 68603); // 926800 - 960442 = -33642

    // Server overview invariants
    assert.equal(overview.summary.pnlCoverageStatus, 'partial');
    assert.equal(overview.summary.totalUnrealizedPnL, null); // INVARIANT: MUST NOT present partial sum as total!
    assert.equal(overview.summary.totalUnrealizedPnLPercent, null); // INVARIANT: percentage belongs to FPT only!
    assert.equal(overview.summary.knownUnrealizedPnL, expectedFptPnl);
    assert.ok(Math.abs(overview.summary.knownUnrealizedPnLPercent - ((expectedFptPnl / 960442) * 100)) < 1e-5);

    // Snapshot invariants
    assert.equal(snapshot.unrealizedPnL, null);
    assert.equal(snapshot.unrealizedPnLPercent, null);
    assert.equal(snapshot.knownUnrealizedPnL, expectedFptPnl);

    // Client display view invariants
    assert.equal(view.unrealizedPnl, null); // Total is null
    assert.equal(view.unrealizedPnlPercent, null);
    assert.equal(view.knownUnrealizedPnl, expectedFptPnl);
    assert.equal(view.isPnlPartial, true);
    assert.ok(view.pnlExplanation.includes('Một số tài sản'));
  });

  // CASE C: all holdings unavailable => Summary shows unavailable
  test('CASE C: all holdings unavailable => Summary shows unavailable', () => {
    const holdings = [
      createOndoHolding(),
      createEnaHolding()
    ];
    const snapshots = {};
    const overview = calculatePortfolioValuation({ cash_available: 1000000 }, holdings, snapshots);
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    assert.equal(overview.summary.pnlCoverageStatus, 'unavailable');
    assert.equal(overview.summary.totalUnrealizedPnL, null);
    assert.equal(overview.summary.totalUnrealizedPnLPercent, null);
    assert.equal(overview.summary.knownUnrealizedPnL, null);

    assert.equal(snapshot.unrealizedPnL, null);
    assert.equal(snapshot.unrealizedPnLPercent, null);
    assert.equal(snapshot.knownUnrealizedPnL, null);

    assert.equal(view.unrealizedPnl, null);
    assert.equal(view.isPnlPartial, false);
  });

  // CASE D: genuine all-zero P/L => Summary shows 0 VND
  test('CASE D: genuine all-zero P/L => Summary shows 0 VND', () => {
    const holdings = [
      createFptHolding({ quantity: 10, average_cost: 100000 })
    ];
    const snapshots = {
      FPT: { price: 100000, currency: 'VND', freshness: 'live' }
    };
    const overview = calculatePortfolioValuation({ cash_available: 0 }, holdings, snapshots);
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    assert.equal(overview.summary.pnlCoverageStatus, 'complete');
    assert.equal(overview.summary.totalUnrealizedPnL, 0);
    assert.equal(overview.summary.totalUnrealizedPnLPercent, 0);
    assert.equal(overview.summary.knownUnrealizedPnL, 0);

    assert.equal(snapshot.unrealizedPnL, 0);
    assert.equal(snapshot.unrealizedPnLPercent, 0);
    assert.equal(view.unrealizedPnl, 0);
    assert.equal(view.isPnlPartial, false);
  });

  // CASE E: mixed positive native crypto + negative VND stock => no fake combined portfolio result
  test('CASE E: mixed positive native crypto + negative VND stock => no fake combined portfolio result', () => {
    const holdings = [
      createFptHolding({ quantity: 14, average_cost: 68603 }),
      createOndoHolding({ quantity: 226, native_average_cost: 0.36402, native_cost_currency: 'USDT' })
    ];
    const snapshots = {
      FPT: { price: 66200, currency: 'VND', freshness: 'live' }
    };
    const nativeReferences = {
      ONDO: { price: 0.4302, currency: 'USDT', freshness: 'live' }
    };
    const fxRates = {
      USDT: { rate: 26000, availability: 'available', provider: 'COINMARKETCAP', freshness: 'current' }
    };

    const overview = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshots,
      fxRates,
      nativeReferences
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    // ONDO has positive native PnL: (0.4302 - 0.36402) * 226 = +14.95668 USDT
    const ondoHolding = overview.holdings.find(h => h.symbol === 'ONDO');
    assert.ok(ondoHolding.nativeUnrealizedPnL > 0);
    assert.equal(ondoHolding.unrealizedPnL, null); // No historical VND PnL

    // FPT has negative VND PnL: -33642 VND
    const fptHolding = overview.holdings.find(h => h.symbol === 'FPT');
    assert.equal(fptHolding.unrealizedPnL, -33642);

    // Portfolio total must NOT combine them into a fake number
    assert.equal(overview.summary.totalUnrealizedPnL, null);
    assert.equal(overview.summary.knownUnrealizedPnL, -33642);
    assert.equal(view.unrealizedPnl, null);
    assert.equal(view.knownUnrealizedPnl, -33642);
    assert.equal(view.isPnlPartial, true);
  });

  // CASE F: USDT holdings share same native currency => native subtotal aggregates correctly
  test('CASE F: USDT holdings share same native currency => native subtotal aggregates correctly', () => {
    const holdings = [
      createFptHolding(),
      createOndoHolding({ quantity: 226, native_average_cost: 0.36402, native_cost_currency: 'USDT' }),
      createEnaHolding({ quantity: 184.50502, native_average_cost: 0.1641, native_cost_currency: 'USDT' })
    ];
    const snapshots = {
      FPT: { price: 66200, currency: 'VND', freshness: 'live' }
    };
    const nativeReferences = {
      ONDO: { price: 0.4302, currency: 'USDT', freshness: 'live' },
      ENA: { price: 0.2141, currency: 'USDT', freshness: 'live' }
    };
    const fxRates = {
      USDT: { rate: 26000, availability: 'available', provider: 'COINMARKETCAP', freshness: 'current' }
    };

    const overview = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshots,
      fxRates,
      nativeReferences
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const view = buildPortfolioSummaryDisplay(snapshot);

    assert.ok(overview.summary.nativePnlSummaries?.USDT);
    const usdtSummary = overview.summary.nativePnlSummaries.USDT;
    assert.equal(usdtSummary.currency, 'USDT');
    assert.equal(usdtSummary.count, 2);

    const expectedOndoPnl = (0.4302 - 0.36402) * 226;
    const expectedEnaPnl = (0.2141 - 0.1641) * 184.50502;
    const expectedTotalUsdt = expectedOndoPnl + expectedEnaPnl;

    assert.ok(Math.abs(usdtSummary.value - expectedTotalUsdt) < 1e-6);
    assert.ok(Math.abs(view.nativePnlSummaries?.USDT?.value - expectedTotalUsdt) < 1e-6);
  });
});

