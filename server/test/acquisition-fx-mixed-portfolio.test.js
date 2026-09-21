import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { calculatePortfolioValuation } from '../src/portfolio.js';

const NOW = '2026-09-21T10:00:00.000Z';

describe('Mixed Portfolio P/L Aggregation with Acquisition FX', () => {
  test('CASE A: All holdings (FPT VND + ONDO USDT + ENA USDT) have resolved VND basis => complete numeric total and %', () => {
    // Current market prices:
    // FPT: 66,200 VND
    // ONDO: 0.4313 USD, current USD/VND: 26,050 => 11,235.365 VND
    // ENA: 0.2145 USD, current USD/VND: 26,050 => 5,587.725 VND
    const holdings = [
      {
        id: 'h-fpt',
        asset_id: 'asset-fpt',
        quantity: 14,
        average_cost: 68603, // VND basis: 960,442 VND
        asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', quote_currency: 'VND', asset_type: 'stock' }
      },
      {
        id: 'h-ondo',
        asset_id: 'asset-ondo',
        quantity: 226,
        average_cost: 9470.26, // Derived VND basis from 0.36402 USDT * 26015.76 => 2,140,278.76 VND
        asset: { id: 'asset-ondo', symbol: 'ONDO', name: 'Ondo', quote_currency: 'USD', asset_type: 'crypto' }
      },
      {
        id: 'h-ena',
        asset_id: 'asset-ena',
        quantity: 184.50502,
        average_cost: 4268.95, // Derived VND basis from 0.1641 USDT * 26014.32 => 787,642.82 VND
        asset: { id: 'asset-ena', symbol: 'ENA', name: 'Ethena', quote_currency: 'USD', asset_type: 'crypto' }
      }
    ];

    const snapshotsMap = {
      FPT: { price: 66200, currency: 'VND', freshness: 'current' },
      ONDO: { price: 0.4313, currency: 'USD', freshness: 'current' },
      ENA: { price: 0.2145, currency: 'USD', freshness: 'current' }
    };

    const fxRatesMap = {
      USD: {
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        rate: 26050,
        availability: 'available',
        freshness: 'current',
        provider: 'twelvedata',
        sourceTimestamp: NOW
      },
      USDT: {
        baseCurrency: 'USDT',
        quoteCurrency: 'VND',
        rate: 26050,
        availability: 'available',
        freshness: 'current',
        provider: 'coingecko',
        sourceTimestamp: NOW
      }
    };

    const valuation = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshotsMap,
      fxRatesMap
    );

    assert.equal(valuation.summary.pnlCoverageStatus, 'complete');
    assert.equal(typeof valuation.summary.totalUnrealizedPnL, 'number');
    assert.equal(Number.isFinite(valuation.summary.totalUnrealizedPnL), true);
    assert.equal(typeof valuation.summary.totalUnrealizedPnLPercent, 'number');
    assert.equal(Number.isFinite(valuation.summary.totalUnrealizedPnLPercent), true);
    assert.equal(valuation.summary.knownUnrealizedPnL, valuation.summary.totalUnrealizedPnL);
    assert.equal(valuation.summary.knownUnrealizedPnLPercent, valuation.summary.totalUnrealizedPnLPercent);
  });

  test('CASE B: One crypto acquisition FX unresolved (average_cost null) => partial coverage, totalUnrealizedPnL is null', () => {
    const holdings = [
      {
        id: 'h-fpt',
        asset_id: 'asset-fpt',
        quantity: 14,
        average_cost: 68603,
        asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', quote_currency: 'VND', asset_type: 'stock' }
      },
      {
        id: 'h-ondo',
        asset_id: 'asset-ondo',
        quantity: 226,
        average_cost: null, // UNRESOLVED
        asset: { id: 'asset-ondo', symbol: 'ONDO', name: 'Ondo', quote_currency: 'USD', asset_type: 'crypto' }
      }
    ];

    const snapshotsMap = {
      FPT: { price: 66200, currency: 'VND', freshness: 'current' },
      ONDO: { price: 0.4313, currency: 'USD', freshness: 'current' }
    };

    const fxRatesMap = {
      USD: {
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        rate: 26050,
        availability: 'available',
        freshness: 'current',
        provider: 'twelvedata',
        sourceTimestamp: NOW
      },
      USDT: {
        baseCurrency: 'USDT',
        quoteCurrency: 'VND',
        rate: 26050,
        availability: 'available',
        freshness: 'current',
        provider: 'coingecko',
        sourceTimestamp: NOW
      }
    };

    const valuation = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshotsMap,
      fxRatesMap
    );

    assert.equal(valuation.summary.pnlCoverageStatus, 'partial');
    assert.equal(valuation.summary.totalUnrealizedPnL, null);
    assert.equal(valuation.summary.totalUnrealizedPnLPercent, null);
    // Known component is solely FPT's: (66200 - 68603) * 14 = -33,642 VND
    assert.equal(valuation.summary.knownUnrealizedPnL, (66200 - 68603) * 14);
    assert.ok(typeof valuation.summary.knownUnrealizedPnLPercent === 'number');
  });

  test('CASE C: Genuine zero P/L with complete basis => totalUnrealizedPnL is 0, not unavailable', () => {
    const holdings = [
      {
        id: 'h-fpt',
        asset_id: 'asset-fpt',
        quantity: 10,
        average_cost: 50000,
        asset: { id: 'asset-fpt', symbol: 'FPT', name: 'FPT Corp', quote_currency: 'VND', asset_type: 'stock' }
      }
    ];

    const snapshotsMap = {
      FPT: { price: 50000, currency: 'VND', freshness: 'current' } // Exactly matches cost basis
    };

    const valuation = calculatePortfolioValuation(
      { cash_available: 0 },
      holdings,
      snapshotsMap,
      {}
    );

    assert.equal(valuation.summary.pnlCoverageStatus, 'complete');
    assert.equal(valuation.summary.totalUnrealizedPnL, 0);
    assert.equal(valuation.summary.totalUnrealizedPnLPercent, 0);
  });
});

