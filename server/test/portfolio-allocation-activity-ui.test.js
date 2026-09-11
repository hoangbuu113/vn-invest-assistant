import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPortfolioAllocationDisplay,
  buildPortfolioRecentActivity,
  PORTFOLIO_DISPLAY_STATES
} from '../../client/src/utils/portfolioSnapshotDisplay.js';
import { calculatePortfolioComposition } from '../src/composition.js';

function makeHolding(symbol, marketValue, overrides = {}) {
  return {
    id: `holding-${symbol.toLowerCase()}`,
    assetId: `asset-${symbol.toLowerCase()}`,
    symbol,
    name: `${symbol} Corp`,
    assetType: 'stock',
    marketValue,
    isPriced: marketValue !== null,
    pricingStatus: marketValue !== null ? 'available' : 'unavailable',
    dataStatus: marketValue !== null ? 'AVAILABLE' : 'UNAVAILABLE',
    ...overrides
  };
}

describe('Portfolio V1 P0.6 — Allocation & Activity UI and Contracts', () => {
  // 1. Diversified holdings allocation renders correctly
  test('1. diversified holdings allocation renders correctly', () => {
    const holdings = [
      makeHolding('FPT', 25_000_000),
      makeHolding('VCB', 15_000_000),
      makeHolding('HPG', 10_000_000)
    ];
    const snapshot = {
      snapshotId: 'snap-1',
      status: 'AVAILABLE',
      cash: { value: 50_000_000, status: 'AVAILABLE' },
      investedMarketValue: 50_000_000,
      totalPortfolioValue: 100_000_000,
      holdings,
      allocation: {
        status: 'AVAILABLE',
        concentrationStatus: 'AVAILABLE',
        totalHoldingsCount: 3,
        pricedHoldingsCount: 3,
        unpricedHoldingsCount: 0,
        cashValue: 50_000_000,
        pricedHoldingsMarketValue: 50_000_000,
        knownAllocationValue: 100_000_000,
        cashWeightPct: 50,
        pricedAssetsWeightPct: 50,
        top3InvestedWeightPct: 100,
        largestHolding: {
          symbol: 'FPT',
          assetType: 'stock',
          marketValue: 25_000_000,
          weightPct: 25,
          investedWeightPct: 50
        },
        assetTypeGroups: [
          { assetType: 'stock', marketValue: 50_000_000, weightPct: 50, holdingCount: 3 }
        ]
      }
    };

    const view = buildPortfolioAllocationDisplay(snapshot);
    assert.equal(view.cashWeightPct, 50);
    assert.equal(view.investedWeightPct, 50);
    assert.equal(view.cashValue, 50_000_000);
    assert.equal(view.investedMarketValue, 50_000_000);
    assert.equal(view.largestHolding.symbol, 'FPT');
    assert.equal(view.largestHolding.investedWeightPct, 50);
    assert.equal(view.largestHolding.weightPct, 25);
    assert.equal(view.top3Concentration, 100);
    assert.equal(view.assetTypeGroups.length, 1);
    assert.equal(view.assetTypeGroups[0].assetType, 'stock');
  });

  // 2. Top-3 denominator excludes cash
  test('2. top3 denominator excludes cash', () => {
    // Example from prompt:
    // Cash: 50m, Invested: 50m, Top 3 holdings = 40m
    // Top3 concentration = 40 / 50 = 80%, NOT 40 / 100
    const composition = calculatePortfolioComposition({
      summary: { cashAvailable: 50_000_000 },
      holdings: [
        makeHolding('AAA', 20_000_000),
        makeHolding('BBB', 10_000_000),
        makeHolding('CCC', 10_000_000),
        makeHolding('DDD', 10_000_000)
      ]
    });

    // Backend composition provides top3InvestedWeightPct with cash excluded
    assert.equal(composition.top3InvestedWeightPct, 80);
    // Legacy field relative to total known allocation remains intact
    assert.equal(composition.top3HoldingsWeightPct, 40);

    // Frontend display helper uses top3InvestedWeightPct (80%)
    const view = buildPortfolioAllocationDisplay({
      cash: { value: 50_000_000 },
      investedMarketValue: 50_000_000,
      totalPortfolioValue: 100_000_000,
      allocation: composition
    });
    assert.equal(view.top3Concentration, 80);
  });

  // 3. Cash-only = 100% cash and no concentration UI
  test('3. cash-only = 100% cash and no concentration UI', () => {
    const snapshot = {
      snapshotId: 'snap-cash-only',
      status: 'AVAILABLE',
      cash: { value: 200_000_000, status: 'AVAILABLE' },
      investedMarketValue: 0,
      totalPortfolioValue: 200_000_000,
      holdings: [],
      allocation: {
        status: 'AVAILABLE',
        concentrationStatus: 'NOT_APPLICABLE',
        totalHoldingsCount: 0,
        pricedHoldingsCount: 0,
        unpricedHoldingsCount: 0,
        cashValue: 200_000_000,
        pricedHoldingsMarketValue: 0,
        knownAllocationValue: 200_000_000,
        cashWeightPct: 100,
        pricedAssetsWeightPct: 0,
        top3InvestedWeightPct: null,
        largestHolding: null,
        assetTypeGroups: []
      }
    };

    const view = buildPortfolioAllocationDisplay(snapshot);
    assert.equal(view.isCashOnly, true);
    assert.equal(view.cashWeightPct, 100);
    assert.equal(view.investedWeightPct, 0);
    assert.equal(view.concentrationState, PORTFOLIO_DISPLAY_STATES.NOT_APPLICABLE);
    assert.equal(view.largestHolding, null);
    assert.equal(view.top3Concentration, null);
    assert.deepEqual(view.assetTypeGroups, []);
  });

  // 4. Missing valuation produces PARTIAL, not fake 0
  test('4. missing valuation produces PARTIAL, not fake 0', () => {
    const snapshot = {
      snapshotId: 'snap-partial',
      status: 'PARTIAL',
      cash: { value: 50_000_000, status: 'AVAILABLE' },
      investedMarketValue: 25_000_000,
      totalPortfolioValue: 75_000_000,
      holdings: [
        makeHolding('FPT', 25_000_000),
        makeHolding('UNKNOWN', null, { dataStatus: 'UNAVAILABLE' })
      ],
      allocation: {
        status: 'PARTIAL',
        totalHoldingsCount: 2,
        pricedHoldingsCount: 1,
        unpricedHoldingsCount: 1,
        cashValue: 50_000_000,
        pricedHoldingsMarketValue: 25_000_000,
        knownAllocationValue: 75_000_000,
        cashWeightPct: (50 / 75) * 100,
        pricedAssetsWeightPct: (25 / 75) * 100,
        top3InvestedWeightPct: 100
      }
    };

    const view = buildPortfolioAllocationDisplay(snapshot);
    assert.equal(view.isPartial, true);
    assert.equal(view.state, PORTFOLIO_DISPLAY_STATES.PARTIAL);
    assert.equal(view.unpricedHoldingsCount, 1);
    assert.equal(view.pricedHoldingsCount, 1);
    assert.notEqual(view.investedMarketValue, 0);
  });

  // 5. Stale allocation displays stale state
  test('5. stale allocation displays stale state', () => {
    const snapshot = {
      snapshotId: 'snap-stale',
      status: 'STALE',
      cash: { value: 50_000_000, status: 'AVAILABLE' },
      investedMarketValue: 25_000_000,
      totalPortfolioValue: 75_000_000,
      holdings: [makeHolding('FPT', 25_000_000, { dataStatus: 'STALE' })],
      allocation: {
        status: 'STALE',
        totalHoldingsCount: 1,
        pricedHoldingsCount: 1,
        unpricedHoldingsCount: 0,
        cashWeightPct: (50 / 75) * 100,
        pricedAssetsWeightPct: (25 / 75) * 100
      }
    };

    const view = buildPortfolioAllocationDisplay(snapshot);
    assert.equal(view.isStale, true);
    assert.equal(view.state, PORTFOLIO_DISPLAY_STATES.STALE);
    assert.equal(view.stateLabel, 'Dữ liệu cũ');
  });

  // 6. Activity shows max 5 recent events
  test('6. Activity shows max 5 recent events with truthful currency formatting', () => {
    const transactions = [
      { id: '1', transactionType: 'BUY', symbol: 'BTC', quantity: 0.5, price: 750_000_000, executionUnitPrice: 60_000, priceCurrency: 'USDT', executedAt: '2026-09-08T10:00:00Z' },
      { id: '2', transactionType: 'SELL', symbol: 'FPT', quantity: 50, price: 100_000, priceCurrency: 'VND', executedAt: '2026-09-07T10:00:00Z' },
      { id: '3', transactionType: 'BUY', symbol: 'HPG', quantity: 200, price: 25_000, priceCurrency: 'VND', executedAt: '2026-09-06T10:00:00Z' },
      { id: '4', transactionType: 'BUY', symbol: 'ONDO', quantity: 1000, price: 20_000_000, executionUnitPrice: 0.82, priceCurrency: 'USDT', executedAt: '2026-09-09T10:00:00Z' }
    ];
    const holdings = [
      { id: 'h-fpt', symbol: 'FPT', openingPositionId: 'op-1', quantity: 100, averageCost: 90_000, openingPositionUpdatedAt: '2026-09-05T08:00:00Z' }
    ];
    const cashLedger = [
      { id: 'c-1', entryType: 'DEPOSIT', amount: 50_000_000, effectiveAt: '2026-09-04T00:00:00Z' },
      { id: 'c-2', entryType: 'WITHDRAWAL', amount: 10_000_000, effectiveAt: '2026-09-03T00:00:00Z' }
    ];

    const events = buildPortfolioRecentActivity({ transactions, holdings, cashLedger });
    // Total candidates: 4 transactions + 1 opening position + 2 cash entries = 7
    // Must be capped at MAX 5
    assert.equal(events.length, 5);

    // Most recent event is ONDO on 2026-09-09
    assert.equal(events[0].symbol, 'ONDO');
    assert.equal(events[0].action, 'Mua');
    assert.match(events[0].detail, /0,82 USDT/);
    assert.doesNotMatch(events[0].detail, /20\.000\.000/); // Do not fabricate VND value when native is USDT

    // Second is BTC on 2026-09-08
    assert.equal(events[1].symbol, 'BTC');
    assert.match(events[1].detail, /60\.000 USDT/);

    // Third is FPT SELL on 2026-09-07
    assert.equal(events[2].symbol, 'FPT');
    assert.equal(events[2].action, 'Bán');

    // Fourth is HPG BUY on 2026-09-06
    assert.equal(events[3].symbol, 'HPG');

    // Fifth is FPT opening position on 2026-09-05
    assert.equal(events[4].symbol, 'FPT');
    assert.equal(events[4].action, 'Khai báo vị thế');
  });

  // 7. Empty activity is compact
  test('7. empty activity is compact', () => {
    const events = buildPortfolioRecentActivity({ transactions: [], holdings: [], cashLedger: [] });
    assert.equal(events.length, 0);
  });

  // 8. Activity error != empty activity
  test('8. activity error != empty activity', async () => {
    const componentSource = await readFile(
      new URL('../../client/src/components/PortfolioActivitySection.jsx', import.meta.url),
      'utf8'
    );
    // Fatal error displays error banner separately
    assert.match(componentSource, /portfolio-activity-error/);
    assert.match(componentSource, /Không thể tải hoạt động gần đây/);
    assert.match(componentSource, /portfolio-activity-empty/);
    assert.match(componentSource, /Chưa có hoạt động trong danh mục\./);
  });

  // 9. Snapshot error != empty portfolio
  test('9. snapshot error != empty portfolio', async () => {
    const appSource = await readFile(
      new URL('../../client/src/App.jsx', import.meta.url),
      'utf8'
    );
    // Fatal error banner displays load failure rather than empty portfolio
    assert.match(appSource, /Không thể tải dữ liệu danh mục/);
    assert.match(appSource, /portfolioError && !portfolioLoading && !portfolioOverview/);
  });

  // 10. Cash management is secondary
  test('10. cash management is secondary', async () => {
    const [summarySource, appSource] = await Promise.all([
      readFile(new URL('../../client/src/components/PortfolioSummaryHoldings.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/App.jsx', import.meta.url), 'utf8')
    ]);

    // In PortfolioSummaryHoldings, cash actions are behind <details class="portfolio-cash-menu"><summary>Quản lý tiền mặt</summary>
    assert.match(summarySource, /<details className="portfolio-cash-menu">/);
    assert.match(summarySource, /<summary>Quản lý tiền mặt<\/summary>/);

    // In App.jsx, Deposit/Withdraw buttons are not top-level primary buttons
    const portfolioView = appSource.slice(
      appSource.indexOf("{activeTab === 'portfolio'"),
      appSource.indexOf('{/* TAB: WATCHLIST')
    );
    assert.doesNotMatch(portfolioView, /btn-primary[^>]*>Nạp tiền/);
  });

  // 11. Primary CTAs remain transaction + existing-position
  test('11. primary CTAs remain transaction + existing-position', async () => {
    const summarySource = await readFile(
      new URL('../../client/src/components/PortfolioSummaryHoldings.jsx', import.meta.url),
      'utf8'
    );
    assert.match(summarySource, /btn-primary btn-sm" onClick=\{onRecordTransaction\}>\s*Ghi giao dịch/);
    assert.match(summarySource, /btn-secondary btn-sm" onClick=\{onDeclarePosition\}>\s*Khai báo tài sản đang có/);
  });

  // 12. Mobile rendering has no horizontal overflow where existing test tooling permits
  test('12. mobile rendering has no horizontal overflow where existing test tooling permits', async () => {
    const cssSource = await readFile(
      new URL('../../client/src/index.css', import.meta.url),
      'utf8'
    );
    assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.portfolio-composition-card/);
    assert.match(cssSource, /@media \(max-width: 430px\)[\s\S]*\.portfolio-allocation-grid[\s\S]*grid-template-columns: 1fr/);
    assert.match(cssSource, /@media \(max-width: 430px\)[\s\S]*\.portfolio-activity-left[\s\S]*flex-direction: column/);
  });
});
