import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { calculatePortfolioComposition, getPortfolioComposition } from '../src/composition.js';
import { createUnavailableFxRate, normalizeFxRate } from '../src/fx.js';
import { calculatePortfolioValuation, getPortfolioOverview } from '../src/portfolio.js';

const FX_TIMESTAMP = '2026-08-28T10:00:00.000Z';

function holding({
  id,
  symbol,
  currency,
  quantity = 2,
  averageCost = 80,
  assetType = 'crypto'
}) {
  return {
    id,
    asset_id: `asset-${id}`,
    quantity,
    average_cost: averageCost,
    asset: {
      id: `asset-${id}`,
      symbol,
      name: symbol,
      asset_type: assetType,
      quote_currency: currency
    }
  };
}

function availableFxRate(overrides = {}) {
  return {
    baseCurrency: 'USD',
    quoteCurrency: 'VND',
    rate: 26000,
    provider: 'fixture_fx',
    sourceTimestamp: FX_TIMESTAMP,
    availability: 'available',
    freshness: 'delayed',
    reason: null,
    ...overrides
  };
}

function portfolioDependencies({ holdings, snapshots, getFxRateFn }) {
  return {
    getCashOverviewFn: async () => ({ currentCash: 1_000_000 }),
    getHoldingsFn: async () => holdings,
    getMarketSnapshotFn: async (symbol) => snapshots[symbol],
    ...(getFxRateFn ? { getFxRateFn } : {})
  };
}

describe('Feature 19 — FX and VND portfolio valuation foundation', () => {
  test('A/L. VND holdings preserve legacy valuation and bypass FX resolution', async () => {
    let fxCalls = 0;
    const overview = await getPortfolioOverview(portfolioDependencies({
      holdings: [holding({
        id: 'fpt',
        symbol: 'FPT',
        currency: 'VND',
        quantity: 100,
        averageCost: 60000,
        assetType: 'stock'
      })],
      snapshots: {
        FPT: {
          price: 72000,
          currency: 'VND',
          priceAsOf: '2026-08-28T08:00:00.000Z'
        }
      },
      getFxRateFn: async () => {
        fxCalls += 1;
        throw new Error('VND must not resolve FX');
      }
    }));

    const valued = overview.holdings[0];
    assert.equal(fxCalls, 0);
    assert.equal(valued.latestPrice, 72000);
    assert.equal(valued.marketValue, 7_200_000);
    assert.equal(valued.costBasis, 6_000_000);
    assert.equal(valued.unrealizedPnL, 1_200_000);
    assert.equal(valued.unrealizedPnLPercent, 20);
    assert.equal(valued.nativePrice, 72000);
    assert.equal(valued.nativeCurrency, 'VND');
    assert.equal(valued.nativeMarketValue, 7_200_000);
    assert.equal(valued.reportingMarketValue, 7_200_000);
    assert.equal(valued.fxRateToReporting, null);
    assert.equal(valued.fxProvider, null);
    assert.equal(valued.fxRateTimestamp, null);
    assert.equal(valued.fxFreshness, null);
    assert.equal(valued.valuationStatus, 'available');
    assert.equal(valued.pnlStatus, 'available');
    assert.equal(overview.summary.totalPortfolioValue, 8_200_000);
    assert.equal(overview.summary.pnlCoverageStatus, 'complete');
  });

  test('B/C. two USD holdings use one direct USD-to-VND quote per request', async () => {
    const fxCalls = [];
    const overview = await getPortfolioOverview(portfolioDependencies({
      holdings: [
        holding({ id: 'btc', symbol: 'BTC/USD', currency: 'USD' }),
        holding({ id: 'eth', symbol: 'ETH/USD', currency: 'USD', quantity: 1, averageCost: 50 })
      ],
      snapshots: {
        'BTC/USD': { price: 100, currency: 'USD' },
        'ETH/USD': { price: 50, currency: 'USD' }
      },
      getFxRateFn: async (baseCurrency, quoteCurrency) => {
        fxCalls.push([baseCurrency, quoteCurrency]);
        return availableFxRate();
      }
    }));

    const btc = overview.holdings.find((item) => item.symbol === 'BTC/USD');
    assert.deepEqual(fxCalls, [['USD', 'VND']]);
    assert.equal(btc.nativeMarketValue, 200);
    assert.equal(btc.reportingMarketValue, 5_200_000);
    assert.equal(btc.marketValue, 5_200_000);
    assert.equal(btc.fxRateToReporting, 26000);
    assert.equal(btc.fxRateTimestamp, FX_TIMESTAMP);
    assert.equal(btc.fxProvider, 'fixture_fx');
    assert.equal(btc.fxFreshness, 'delayed');
    assert.equal(overview.summary.totalMarketValue, 6_500_000);
    assert.equal(overview.summary.totalPortfolioValue, 7_500_000);
  });

  test('D. missing FX keeps the holding visible and makes reporting valuation partial', async () => {
    const overview = await getPortfolioOverview(portfolioDependencies({
      holdings: [holding({ id: 'btc', symbol: 'BTC/USD', currency: 'USD' })],
      snapshots: { 'BTC/USD': { price: 100, currency: 'USD' } },
      getFxRateFn: async (base, quote) => createUnavailableFxRate(base, quote, 'FX_PROVIDER_UNCONFIGURED')
    }));

    const valued = overview.holdings[0];
    assert.equal(overview.holdings.length, 1);
    assert.equal(valued.nativeMarketValue, 200);
    assert.equal(valued.reportingMarketValue, null);
    assert.equal(valued.marketValue, null);
    assert.equal(valued.valuationStatus, 'unavailable');
    assert.equal(valued.valuationReason, 'FX_PROVIDER_UNCONFIGURED');
    assert.equal(overview.summary.totalMarketValue, null);
    assert.equal(overview.summary.totalPortfolioValue, null);
    assert.equal(overview.summary.valuationStatus, 'partial');
  });

  test('E/F. malformed, non-positive, missing-provider, and missing-timestamp rates are unavailable', () => {
    const invalidCases = [
      [availableFxRate({ rate: 0 }), 'FX_RATE_INVALID'],
      [availableFxRate({ rate: -1 }), 'FX_RATE_INVALID'],
      [availableFxRate({ rate: '26000' }), 'FX_RATE_INVALID'],
      [availableFxRate({ rate: Number.NaN }), 'FX_RATE_INVALID'],
      [availableFxRate({ provider: '' }), 'FX_PROVIDER_MISSING'],
      [availableFxRate({ sourceTimestamp: null }), 'FX_TIMESTAMP_INVALID'],
      [availableFxRate({ sourceTimestamp: '2026-08-28T10:00:00' }), 'FX_TIMESTAMP_INVALID'],
      [availableFxRate({ sourceTimestamp: '2026-02-30T10:00:00Z' }), 'FX_TIMESTAMP_INVALID']
    ];

    for (const [rawRate, expectedReason] of invalidCases) {
      const normalized = normalizeFxRate(rawRate, 'USD', 'VND');
      assert.equal(normalized.availability, 'unavailable');
      assert.equal(normalized.rate, null);
      assert.equal(normalized.reason, expectedReason);
    }
  });

  test('stale and unknown FX freshness remain explicit without an invented age threshold', () => {
    for (const freshness of ['stale', 'unknown']) {
      const normalized = normalizeFxRate(availableFxRate({ freshness }), 'USD', 'VND');
      assert.equal(normalized.availability, 'available');
      assert.equal(normalized.rate, 26000);
      assert.equal(normalized.freshness, freshness);
    }
  });

  test('G. provider currency conflict rejects valuation without resolving FX', async () => {
    let fxCalls = 0;
    const overview = await getPortfolioOverview(portfolioDependencies({
      holdings: [holding({ id: 'btc', symbol: 'BTC/USD', currency: 'USD' })],
      snapshots: { 'BTC/USD': { price: 100, currency: 'EUR' } },
      getFxRateFn: async () => {
        fxCalls += 1;
        return availableFxRate();
      }
    }));

    const valued = overview.holdings[0];
    assert.equal(fxCalls, 0);
    assert.equal(valued.nativePrice, null);
    assert.equal(valued.reportingMarketValue, null);
    assert.equal(valued.valuationReason, 'PROVIDER_CURRENCY_MISMATCH');
    assert.equal(overview.summary.valuationStatus, 'partial');
  });

  test('H. opposite FX direction is rejected and never inverted', () => {
    const result = calculatePortfolioValuation(
      { cash_available: 0 },
      [holding({ id: 'btc', symbol: 'BTC/USD', currency: 'USD' })],
      { 'BTC/USD': { price: 100, currency: 'USD' } },
      {
        USD: availableFxRate({
          baseCurrency: 'VND',
          quoteCurrency: 'USD',
          rate: 1 / 26000
        })
      }
    );

    const valued = result.holdings[0];
    assert.equal(valued.reportingMarketValue, null);
    assert.equal(valued.fxRateToReporting, null);
    assert.equal(valued.valuationReason, 'FX_PAIR_MISMATCH');
  });

  test('I/J. non-VND P&L uses authoritative VND cost basis and live FX; stays unavailable if FX missing', () => {
    // 1. Available FX case: exact VND unrealized P&L
    const result = calculatePortfolioValuation(
      { cash_available: 1_000_000 },
      [
        holding({
          id: 'fpt',
          symbol: 'FPT',
          currency: 'VND',
          quantity: 10,
          averageCost: 100,
          assetType: 'stock'
        }),
        holding({
          id: 'btc',
          symbol: 'BTC/USD',
          currency: 'USD',
          quantity: 2,
          averageCost: 80
        })
      ],
      {
        FPT: { price: 120, currency: 'VND' },
        'BTC/USD': { price: 100, currency: 'USD' }
      },
      { USD: availableFxRate() }
    );

    const usdHolding = result.holdings.find((item) => item.symbol === 'BTC/USD');
    assert.equal(usdHolding.costBasis, 160);
    assert.equal(usdHolding.reportingMarketValue, 5_200_000);
    assert.equal(usdHolding.unrealizedPnL, 5_200_000 - 160);
    assert.equal(usdHolding.unrealizedPnLPercent, ((5_200_000 - 160) / 160) * 100);
    assert.equal(usdHolding.pnlStatus, 'available');
    assert.equal(usdHolding.pnlReason, null);
    assert.equal(result.summary.totalCostBasis, 1000 + 160);
    assert.equal(result.summary.pricedCostBasis, 1000 + 160);
    assert.equal(result.summary.totalUnrealizedPnL, 200 + (5_200_000 - 160));
    assert.equal(result.summary.pnlCoverageStatus, 'complete');
    assert.equal(result.summary.totalMarketValue, 1_200 + 5_200_000);

    // 2. Unavailable FX case: P&L is unavailable, does not fabricate zero
    const resultNoFx = calculatePortfolioValuation(
      { cash_available: 1_000_000 },
      [
        holding({
          id: 'fpt',
          symbol: 'FPT',
          currency: 'VND',
          quantity: 10,
          averageCost: 100,
          assetType: 'stock'
        }),
        holding({
          id: 'btc',
          symbol: 'BTC/USD',
          currency: 'USD',
          quantity: 2,
          averageCost: 80
        })
      ],
      {
        FPT: { price: 120, currency: 'VND' },
        'BTC/USD': { price: 100, currency: 'USD' }
      },
      {
        USD: createUnavailableFxRate('USD', 'VND', 'FX_PROVIDER_RATE_LIMITED')
      }
    );

    const usdHoldingNoFx = resultNoFx.holdings.find((item) => item.symbol === 'BTC/USD');
    assert.equal(usdHoldingNoFx.costBasis, 160);
    assert.equal(usdHoldingNoFx.reportingMarketValue, null);
    assert.equal(usdHoldingNoFx.unrealizedPnL, null);
    assert.equal(usdHoldingNoFx.unrealizedPnLPercent, null);
    assert.equal(usdHoldingNoFx.pnlStatus, 'unavailable');
    assert.equal(usdHoldingNoFx.pnlReason, 'FX_PROVIDER_RATE_LIMITED');
    assert.equal(resultNoFx.summary.totalCostBasis, 1000 + 160);
    assert.equal(resultNoFx.summary.pricedCostBasis, 1000);
    assert.equal(resultNoFx.summary.totalUnrealizedPnL, 200);
    assert.equal(resultNoFx.summary.totalUnrealizedPnL, null);
    assert.equal(resultNoFx.summary.knownUnrealizedPnL, 200);
    assert.equal(resultNoFx.summary.pnlCoverageStatus, 'partial');
    assert.equal(resultNoFx.summary.valuationStatus, 'partial');
    assert.equal(resultNoFx.summary.totalMarketValue, 1_200);
  });

  test('K. composition consumes authoritative reporting values without FX calculation', async () => {
    let overviewCalls = 0;
    const overview = {
      summary: { cashAvailable: 800_000 },
      holdings: [{
        id: 'btc',
        assetId: 'asset-btc',
        symbol: 'BTC/USD',
        name: 'Bitcoin / US Dollar',
        assetType: 'crypto',
        marketValue: 1,
        reportingMarketValue: 5_200_000,
        pricingStatus: 'available',
        valuationStatus: 'available'
      }]
    };

    const composition = await getPortfolioComposition({
      getPortfolioOverviewFn: async () => {
        overviewCalls += 1;
        return overview;
      }
    });

    assert.equal(overviewCalls, 1);
    assert.equal(composition.pricedHoldingsMarketValue, 5_200_000);
    assert.equal(composition.knownAllocationValue, 6_000_000);
    assert.equal(composition.cashWeightPct, (800_000 / 6_000_000) * 100);
    assert.equal(composition.pricedAssetsWeightPct, (5_200_000 / 6_000_000) * 100);
    assert.equal(composition.holdingAllocations[0].marketValue, 5_200_000);

    const direct = calculatePortfolioComposition(overview);
    assert.deepEqual(direct, composition);
  });

  test('full-precision native and FX multiplication has no rounded intermediate', () => {
    const quantity = 2.3456;
    const nativePrice = 100.1234;
    const rate = 26000.5678;
    const result = calculatePortfolioValuation(
      { cash_available: 0 },
      [holding({
        id: 'fractional',
        symbol: 'FRACTIONAL/USD',
        currency: 'USD',
        quantity,
        averageCost: 1
      })],
      { 'FRACTIONAL/USD': { price: nativePrice, currency: 'USD' } },
      { USD: availableFxRate({ rate }) }
    );

    const expectedNative = quantity * nativePrice;
    const expectedReporting = expectedNative * rate;
    const roundedNative = Math.round(expectedNative * 100) / 100;
    assert.equal(result.holdings[0].nativeMarketValue, expectedNative);
    assert.equal(result.holdings[0].reportingMarketValue, expectedReporting);
    assert.notEqual(result.holdings[0].reportingMarketValue, roundedNative * rate);
  });

  test('missing canonical quote currency is explicit and never resolved as VND', async () => {
    let fxCalls = 0;
    const overview = await getPortfolioOverview(portfolioDependencies({
      holdings: [holding({ id: 'unknown', symbol: 'UNKNOWN', currency: null })],
      snapshots: { UNKNOWN: { price: 100, currency: 'USD' } },
      getFxRateFn: async () => {
        fxCalls += 1;
        return availableFxRate();
      }
    }));

    assert.equal(fxCalls, 0);
    assert.equal(overview.holdings[0].nativeCurrency, null);
    assert.equal(overview.holdings[0].reportingMarketValue, null);
    assert.equal(overview.holdings[0].valuationReason, 'MISSING_CANONICAL_CURRENCY');
    assert.equal(overview.summary.valuationStatus, 'partial');
  });
});
