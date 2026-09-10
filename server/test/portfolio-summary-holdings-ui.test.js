import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPortfolioHoldingDisplay,
  buildPortfolioHoldingsDisplay,
  buildPortfolioSummaryDisplay
} from '../../client/src/utils/portfolioSnapshotDisplay.js';

function snapshot(overrides = {}) {
  return {
    snapshotId: 'portfolio-test',
    status: 'AVAILABLE',
    valuationAsOf: '2026-09-10T03:00:00.000Z',
    cash: { value: 20_000_000, status: 'AVAILABLE' },
    investedMarketValue: 10_000_000,
    totalPortfolioValue: 30_000_000,
    unrealizedPnL: 1_000_000,
    unrealizedPnLPercent: 11.11,
    summary: {
      metricStates: {
        totalPortfolioValue: 'AVAILABLE',
        investedMarketValue: 'AVAILABLE',
        unrealizedPnl: 'AVAILABLE'
      }
    },
    holdings: [],
    allocation: { holdingAllocations: [] },
    ...overrides
  };
}

function vndHolding(overrides = {}) {
  return {
    id: 'holding-fpt',
    assetId: 'asset-fpt',
    symbol: 'FPT',
    name: 'FPT Corporation',
    assetType: 'stock',
    exchange: 'HOSE',
    quantity: 100,
    quantityUnit: 'share',
    nativePrice: 120_000,
    nativeCurrency: 'VND',
    averageCost: 100_000,
    reportingMarketValue: 12_000_000,
    unrealizedPnL: 2_000_000,
    unrealizedPnLPercent: 20,
    pnlStatus: 'available',
    valuationStatus: 'available',
    dataStatus: 'AVAILABLE',
    priceAsOf: '2026-09-10T02:30:00.000Z',
    marketProvider: 'Yahoo Finance',
    marketFreshness: 'current',
    ...overrides
  };
}

describe('Portfolio V1 P0.4 Summary and Holdings display', () => {
  test('cash-only summary preserves authoritative total, cash, and confirmed zero invested value', () => {
    const view = buildPortfolioSummaryDisplay(snapshot({
      cash: { value: 200_000_000, status: 'AVAILABLE' },
      investedMarketValue: 0,
      totalPortfolioValue: 200_000_000,
      unrealizedPnL: null,
      unrealizedPnLPercent: null,
      summary: {
        metricStates: {
          totalPortfolioValue: 'AVAILABLE',
          investedMarketValue: 'AVAILABLE',
          unrealizedPnl: 'NOT_APPLICABLE'
        }
      }
    }));

    assert.equal(view.total, 200_000_000);
    assert.equal(view.cash, 200_000_000);
    assert.equal(view.invested, 0);
    assert.equal(view.unrealizedPnl, null);
    assert.equal(view.isCashOnly, true);
  });

  test('normal holding uses snapshot allocation rather than calculating a second weight', () => {
    const holding = vndHolding();
    const view = buildPortfolioHoldingDisplay(holding, {
      holdingAllocations: [{ id: holding.id, assetId: holding.assetId, weightPct: 40 }]
    });

    assert.equal(view.quantity, 100);
    assert.deepEqual(view.currentPrice, {
      value: 120_000,
      currency: 'VND',
      asOf: holding.priceAsOf,
      source: 'Yahoo Finance',
      freshness: 'current'
    });
    assert.deepEqual(view.averageCost, { value: 100_000, currency: 'VND' });
    assert.equal(view.marketValueVnd, 12_000_000);
    assert.equal(view.weightPct, 40);
    assert.equal(view.isApproximateVnd, false);
  });

  test('native USDT-cost crypto keeps USD accounting valuation and USDT cost/P&L distinct', () => {
    const holding = {
      id: 'holding-ondo',
      assetId: 'asset-ondo',
      symbol: 'ONDO',
      name: 'Ondo',
      assetType: 'crypto',
      quantity: 1_234,
      quantityUnit: 'coin',
      nativePrice: 0.90,
      nativeCurrency: 'USD',
      nativeAverageCost: 0.82,
      nativeCostCurrency: 'USDT',
      nativeCurrentPrice: 0.91,
      nativeCurrentPriceAsOf: '2026-09-10T02:40:00.000Z',
      nativeCurrentPriceSource: 'Binance',
      nativeCurrentPriceFreshness: 'realtime',
      nativeUnrealizedPnL: 111.06,
      nativeUnrealizedPnLPercent: 10.97,
      nativePnlStatus: 'available',
      averageCost: null,
      costBasis: null,
      unrealizedPnL: null,
      pnlStatus: 'unavailable',
      reportingMarketValue: 27_750_000,
      valuationStatus: 'available',
      dataStatus: 'AVAILABLE'
    };

    const view = buildPortfolioHoldingDisplay(holding, {
      holdingAllocations: [{ assetId: holding.assetId, weightPct: 25 }]
    });

    assert.deepEqual(view.averageCost, { value: 0.82, currency: 'USDT' });
    assert.equal(view.currentPrice.value, 0.91);
    assert.equal(view.currentPrice.currency, 'USDT');
    assert.equal(view.unrealizedPnl.value, 111.06);
    assert.equal(view.unrealizedPnl.currency, 'USDT');
    assert.equal(view.marketValueVnd, 27_750_000);
    assert.equal(view.isApproximateVnd, true);
  });

  test('unknown VND cost remains unavailable while a valid market value stays visible', () => {
    const view = buildPortfolioHoldingDisplay(vndHolding({
      averageCost: null,
      unrealizedPnL: null,
      unrealizedPnLPercent: null,
      pnlStatus: 'unavailable',
      pnlReason: 'VND_COST_BASIS_UNKNOWN'
    }), { holdingAllocations: [{ assetId: 'asset-fpt', weightPct: 60 }] });

    assert.equal(view.averageCost, null);
    assert.equal(view.unrealizedPnl, null);
    assert.equal(view.marketValueVnd, 12_000_000);
  });

  test('missing price leaves the holding visible without zero valuation or weight', () => {
    const view = buildPortfolioHoldingDisplay(vndHolding({
      nativePrice: null,
      reportingMarketValue: null,
      valuationStatus: 'unavailable',
      valuationReason: 'MISSING_NATIVE_PRICE',
      dataStatus: 'UNAVAILABLE',
      priceAsOf: null,
      unrealizedPnL: null,
      pnlStatus: 'unavailable'
    }), { holdingAllocations: [{ assetId: 'asset-fpt', weightPct: null }] });

    assert.equal(view.symbol, 'FPT');
    assert.equal(view.currentPrice, null);
    assert.equal(view.marketValueVnd, null);
    assert.equal(view.weightPct, null);
    assert.equal(view.stateLabel, 'Chưa có dữ liệu giá');
  });

  test('stale holding remains displayable with an explicit stale state and timestamp', () => {
    const holding = vndHolding({
      valuationStatus: 'stale',
      dataStatus: 'STALE',
      marketFreshness: 'stale',
      priceAsOf: '2026-09-05T08:00:00.000Z'
    });
    const view = buildPortfolioHoldingDisplay(holding, {
      holdingAllocations: [{ assetId: holding.assetId, weightPct: 40 }]
    });

    assert.equal(view.state, 'STALE');
    assert.equal(view.stateLabel, 'Dữ liệu cũ');
    assert.equal(view.priceAsOf, '2026-09-05T08:00:00.000Z');
    assert.equal(view.marketValueVnd, 12_000_000);
  });

  test('unavailable snapshot never turns missing summary values into zero', () => {
    const view = buildPortfolioSummaryDisplay(snapshot({
      status: 'UNAVAILABLE',
      cash: { value: null, status: 'UNAVAILABLE' },
      investedMarketValue: null,
      totalPortfolioValue: null,
      unrealizedPnL: null,
      summary: {
        metricStates: {
          totalPortfolioValue: 'UNAVAILABLE',
          investedMarketValue: 'UNAVAILABLE',
          unrealizedPnl: 'UNAVAILABLE'
        }
      }
    }));

    assert.equal(view.total, null);
    assert.equal(view.cash, null);
    assert.equal(view.invested, null);
    assert.equal(view.unrealizedPnl, null);
    assert.equal(view.stateLabel, 'Chưa khả dụng');
  });

  test('all holding cards are projected from the snapshot collection', () => {
    const first = vndHolding();
    const second = vndHolding({ id: 'holding-vcb', assetId: 'asset-vcb', symbol: 'VCB' });
    const views = buildPortfolioHoldingsDisplay(snapshot({
      holdings: [first, second],
      allocation: {
        holdingAllocations: [
          { assetId: first.assetId, weightPct: 30 },
          { assetId: second.assetId, weightPct: 20 }
        ]
      }
    }));

    assert.deepEqual(views.map((item) => item.symbol), ['FPT', 'VCB']);
    assert.deepEqual(views.map((item) => item.weightPct), [30, 20]);
  });

  test('component contract has one compact summary, one empty state, and mobile expandable cards', async () => {
    const [componentSource, appSource, cssSource] = await Promise.all([
      readFile(new URL('../../client/src/components/PortfolioSummaryHoldings.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/App.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/index.css', import.meta.url), 'utf8')
    ]);

    assert.equal((componentSource.match(/Tổng giá trị danh mục/g) || []).length, 1);
    assert.equal((componentSource.match(/Hiện danh mục đang giữ tiền mặt\./g) || []).length, 1);
    assert.match(componentSource, /<details className="portfolio-holding-card"/);
    assert.match(componentSource, /Ghi giao dịch/);
    assert.match(componentSource, /Khai báo tài sản đang có/);
    assert.match(componentSource, /Quản lý tiền mặt/);
    assert.equal((appSource.match(/<PortfolioSummaryHoldings/g) || []).length, 1);
    assert.doesNotMatch(appSource, /Tiền sẵn sàng đầu tư/);
    const portfolioSection = appSource.slice(
      appSource.indexOf("{activeTab === 'portfolio'"),
      appSource.indexOf('{/* TAB: WATCHLIST')
    );
    assert.doesNotMatch(portfolioSection, /className="metrics-grid"/);
    assert.match(appSource, /activityOnly/);
    assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.portfolio-holdings-desktop[\s\S]*display: none/);
    assert.match(cssSource, /\.portfolio-holdings-mobile \{[\s\S]*display: none/);
    assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.portfolio-holdings-mobile[\s\S]*display: grid/);
  });
});
