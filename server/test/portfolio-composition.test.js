import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePortfolioComposition,
  getPortfolioComposition
} from '../src/composition.js';
import { createApp } from '../index.js';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';

process.env.OWNER_ACCESS_TOKEN = TEST_OWNER_ACCESS_TOKEN;

function makeOverview(cashAvailable, holdings = []) {
  return {
    summary: {
      cashAvailable
    },
    holdings
  };
}

function makeHolding({
  id,
  assetId,
  symbol,
  name = symbol,
  assetType = 'stock',
  marketValue = null,
  isPriced = marketValue !== null
}) {
  return {
    id,
    assetId,
    symbol,
    name,
    assetType,
    marketValue: isPriced ? marketValue : null,
    pricingStatus: isPriced ? 'available' : 'unavailable'
  };
}

describe('Feature 10 — Portfolio Composition & Concentration', () => {
  test('A. Empty portfolio has explicit empty semantics and no fabricated percentages', () => {
    const result = calculatePortfolioComposition(makeOverview(0, []));

    assert.equal(result.hasHoldings, false);
    assert.equal(result.totalHoldingsCount, 0);
    assert.equal(result.valuationCoverageLevel, 'not_applicable');
    assert.equal(result.allocationBasis, 'no_known_value');
    assert.equal(result.allocationStatus, 'unavailable');
    assert.equal(result.knownAllocationValue, 0);
    assert.equal(result.cashWeightPct, null);
    assert.equal(result.pricedAssetsWeightPct, null);
    assert.deepEqual(result.holdingAllocations, []);
    assert.deepEqual(result.assetTypeGroups, []);
    assert.equal(result.largestHolding, null);
    assert.equal(result.top3HoldingsWeightPct, null);
    assert.equal(result.pricedHoldingCountUsed, 0);
  });

  test('B. Cash-only portfolio reports 100% cash without fabricating concentration', () => {
    const result = calculatePortfolioComposition(makeOverview(12_500_000, []));

    assert.equal(result.valuationCoverageLevel, 'not_applicable');
    assert.equal(result.allocationBasis, 'cash_only');
    assert.equal(result.allocationStatus, 'available');
    assert.equal(result.cashWeightPct, 100);
    assert.equal(result.pricedAssetsWeightPct, 0);
    assert.equal(result.largestHolding, null);
    assert.equal(result.top3HoldingsWeightPct, null);
  });

  test('P0.2 unavailable cash cannot become a zero-valued allocation denominator', () => {
    const result = calculatePortfolioComposition(makeOverview(null, []));

    assert.equal(result.cashValue, null);
    assert.equal(result.cashStatus, 'unavailable');
    assert.equal(result.knownAllocationValue, null);
    assert.equal(result.allocationBasis, 'cash_unavailable');
    assert.equal(result.allocationStatus, 'unavailable');
    assert.equal(result.cashWeightPct, null);
    assert.equal(result.pricedAssetsWeightPct, null);
    assert.equal(result.largestHolding, null);
    assert.equal(result.top3HoldingsWeightPct, null);
  });

  test('P0.2 stale priced holdings stay displayable with stale allocation state', () => {
    const overview = makeOverview(20, [{
      ...makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue: 80 }),
      pricingStatus: 'stale',
      valuationStatus: 'stale'
    }]);
    const result = calculatePortfolioComposition(overview);

    assert.equal(result.knownAllocationValue, 100);
    assert.equal(result.holdingAllocations[0].marketValue, 80);
    assert.equal(result.holdingAllocations[0].pricingStatus, 'stale');
    assert.equal(result.holdingAllocations[0].weightPct, 80);
    assert.equal(result.valuationCoverageLevel, 'stale');
    assert.equal(result.allocationStatus, 'stale');
  });

  test('C. One priced holding produces exact allocation and concentration values', () => {
    const overview = makeOverview(25, [
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue: 75 })
    ]);
    const result = calculatePortfolioComposition(overview);

    assert.equal(result.valuationCoverageLevel, 'complete');
    assert.equal(result.allocationBasis, 'full_portfolio_value');
    assert.equal(result.knownAllocationValue, 100);
    assert.equal(result.cashWeightPct, 25);
    assert.equal(result.pricedAssetsWeightPct, 75);
    assert.equal(result.holdingAllocations[0].weightPct, 75);
    assert.equal(result.largestHolding.symbol, 'FPT');
    assert.equal(result.largestHolding.weightPct, 75);
    assert.equal(result.top3HoldingsWeightPct, 75);
    assert.equal(result.pricedHoldingCountUsed, 1);
  });

  test('D. Multiple priced holdings use objective top-3 concentration and asset-type aggregation', () => {
    const overview = makeOverview(10, [
      makeHolding({ id: 'h4', assetId: 'a4', symbol: 'DDD', assetType: 'fund', marketValue: 10 }),
      makeHolding({ id: 'h2', assetId: 'a2', symbol: 'BBB', assetType: 'etf', marketValue: 30 }),
      makeHolding({ id: 'h3', assetId: 'a3', symbol: 'CCC', assetType: 'stock', marketValue: 20 }),
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'AAA', assetType: 'stock', marketValue: 40 })
    ]);
    const result = calculatePortfolioComposition(overview);

    assert.equal(result.knownAllocationValue, 110);
    assert.deepEqual(result.holdingAllocations.map((holding) => holding.symbol), ['AAA', 'BBB', 'CCC', 'DDD']);
    assert.equal(result.largestHolding.symbol, 'AAA');
    assert.equal(result.largestHolding.weightPct, (40 / 110) * 100);
    assert.equal(result.top3HoldingsWeightPct, (90 / 110) * 100);
    assert.equal(result.pricedHoldingCountUsed, 3);

    assert.deepEqual(
      result.assetTypeGroups.map((group) => [group.assetType, group.marketValue, group.holdingCount]),
      [
        ['stock', 60, 2],
        ['etf', 30, 1],
        ['fund', 10, 1]
      ]
    );
    assert.equal(result.assetTypeGroups[0].weightPct, (60 / 110) * 100);
  });

  test('E. Partial valuation keeps unpriced holdings visible and weights only known value', () => {
    const overview = makeOverview(20_000_000, [
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue: 30_000_000 }),
      makeHolding({ id: 'h2', assetId: 'a2', symbol: 'VCB', marketValue: null, isPriced: false })
    ]);
    const result = calculatePortfolioComposition(overview);

    assert.equal(result.valuationCoverageLevel, 'partial');
    assert.equal(result.allocationBasis, 'known_value_only');
    assert.equal(result.totalHoldingsCount, 2);
    assert.equal(result.pricedHoldingsCount, 1);
    assert.equal(result.unpricedHoldingsCount, 1);
    assert.equal(result.knownAllocationValue, 50_000_000);
    assert.equal(result.cashWeightPct, 40);
    assert.equal(result.pricedAssetsWeightPct, 60);

    const priced = result.holdingAllocations.find((holding) => holding.symbol === 'FPT');
    const unpriced = result.holdingAllocations.find((holding) => holding.symbol === 'VCB');
    assert.equal(priced.weightPct, 60);
    assert.equal(unpriced.marketValue, null);
    assert.equal(unpriced.weightPct, null);
    assert.equal(unpriced.isPriced, false);
  });

  test('F. Holdings with no usable prices remain visible without fake valuation or concentration', () => {
    const overview = makeOverview(5_000_000, [
      makeHolding({ id: 'h2', assetId: 'a2', symbol: 'VCB', marketValue: null, isPriced: false }),
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue: null, isPriced: false })
    ]);
    const result = calculatePortfolioComposition(overview);

    assert.equal(result.valuationCoverageLevel, 'unavailable');
    assert.equal(result.allocationBasis, 'known_value_only');
    assert.equal(result.pricedHoldingsCount, 0);
    assert.equal(result.unpricedHoldingsCount, 2);
    assert.equal(result.pricedHoldingsMarketValue, 0);
    assert.equal(result.cashWeightPct, 100);
    assert.equal(result.pricedAssetsWeightPct, 0);
    assert.ok(result.holdingAllocations.every((holding) => holding.weightPct === null));
    assert.deepEqual(result.assetTypeGroups, []);
    assert.equal(result.largestHolding, null);
    assert.equal(result.top3HoldingsWeightPct, null);
  });

  test('G. Fractional inputs retain full precision without rounded intermediates', () => {
    const cashValue = 10.123456789;
    const marketValue = 33.987654321;
    const overview = makeOverview(cashValue, [
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue })
    ]);
    const result = calculatePortfolioComposition(overview);

    const expectedKnownValue = cashValue + marketValue;
    const expectedHoldingWeight = (marketValue / expectedKnownValue) * 100;
    const roundedMarketValue = Math.round(marketValue * 100) / 100;
    const roundedIntermediateWeight = (roundedMarketValue / (cashValue + roundedMarketValue)) * 100;

    assert.equal(result.knownAllocationValue, expectedKnownValue);
    assert.equal(result.holdingAllocations[0].weightPct, expectedHoldingWeight);
    assert.equal(result.top3HoldingsWeightPct, expectedHoldingWeight);
    assert.notEqual(result.holdingAllocations[0].weightPct, roundedIntermediateWeight);
    assert.equal(result.cashWeightPct + result.pricedAssetsWeightPct, 100);
  });

  test('H. Equal market values sort by symbol, then stable asset key', () => {
    const overview = makeOverview(0, [
      makeHolding({ id: 'h3', assetId: 'a3', symbol: 'BBB', marketValue: 50 }),
      makeHolding({ id: 'h2', assetId: 'a2', symbol: 'AAA', marketValue: 50 }),
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'AAA', marketValue: 50 })
    ]);
    const result = calculatePortfolioComposition(overview);

    assert.deepEqual(
      result.holdingAllocations.map((holding) => holding.assetId),
      ['a1', 'a2', 'a3']
    );
    assert.equal(result.largestHolding.assetId, 'a1');
  });

  test('I. Multiple holdings of one asset type aggregate from valued holding market values', () => {
    const firstValue = 10.123;
    const secondValue = 20.456;
    const overview = makeOverview(5.789, [
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'AAA', assetType: 'etf', marketValue: firstValue }),
      makeHolding({ id: 'h2', assetId: 'a2', symbol: 'BBB', assetType: 'etf', marketValue: secondValue })
    ]);
    const result = calculatePortfolioComposition(overview);
    const group = result.assetTypeGroups[0];

    assert.equal(result.assetTypeGroups.length, 1);
    assert.equal(group.assetType, 'etf');
    assert.equal(group.holdingCount, 2);
    assert.equal(group.marketValue, firstValue + secondValue);
    assert.equal(group.weightPct, ((firstValue + secondValue) / result.knownAllocationValue) * 100);
  });

  test('J. Production composition integration and Express route reuse one injected portfolio overview', async () => {
    const overview = makeOverview(20, [
      makeHolding({ id: 'h1', assetId: 'a1', symbol: 'FPT', marketValue: 30 })
    ]);

    let directOverviewCalls = 0;
    const direct = await getPortfolioComposition({
      getPortfolioOverviewFn: async () => {
        directOverviewCalls += 1;
        return overview;
      }
    });
    assert.equal(directOverviewCalls, 1);
    assert.equal(direct.knownAllocationValue, 50);
    assert.equal(direct.holdingAllocations[0].weightPct, 60);

    let routeOverviewCalls = 0;
    const app = createApp({
      getPortfolioOverviewFn: async () => {
        routeOverviewCalls += 1;
        return overview;
      }
    });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const response = await ownerFetch(`http://127.0.0.1:${port}/api/portfolio/composition`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(routeOverviewCalls, 1);
      assert.equal(body.data.valuationCoverageLevel, 'complete');
      assert.equal(body.data.cashWeightPct, 40);
      assert.equal(body.data.holdingAllocations[0].weightPct, 60);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
