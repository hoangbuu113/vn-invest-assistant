import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../index.js';
import { calculatePortfolioValuation, getPortfolioOverview } from '../src/portfolio.js';
import {
  buildPortfolioSnapshot,
  getPortfolioSnapshot,
  PORTFOLIO_DATA_STATES
} from '../src/portfolioSnapshot.js';
import { ownerFetch } from './helpers/owner-auth.js';

const PROFILE_ID = '00000000-0000-4000-8000-000000000303';
const CALCULATED_AT = '2026-09-10T03:00:00.000Z';

function vndHolding(overrides = {}) {
  return {
    id: 'holding-fpt',
    asset_id: 'asset-fpt',
    opening_position_id: 'opening-fpt',
    quantity: 10,
    average_cost: 80,
    updated_at: '2026-09-09T02:00:00.000Z',
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
      updated_at: '2026-09-01T02:00:00.000Z',
      locked_at: null,
      cancelled_at: null
    },
    ...overrides
  };
}

function completeOverview() {
  return calculatePortfolioValuation(
    {
      cash_available: 200,
      cash_ledger_entry_count: 4,
      cash_ledger_start_at: '2026-01-01T00:00:00.000Z'
    },
    [vndHolding()],
    {
      FPT: {
        price: 100,
        currency: 'VND',
        source: 'Yahoo Finance',
        priceAsOf: '2026-09-09T08:00:00.000Z',
        freshness: 'delayed',
        cacheStatus: 'fresh'
      }
    }
  );
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

describe('Portfolio V1 P0.3 unified current-state snapshot', () => {
  test('one deterministic snapshot identity reconciles summary, holdings, and allocation', () => {
    const overview = completeOverview();
    const first = buildPortfolioSnapshot({
      profileId: PROFILE_ID,
      overview,
      calculatedAt: CALCULATED_AT
    });
    const laterCalculation = buildPortfolioSnapshot({
      profileId: PROFILE_ID,
      overview,
      calculatedAt: '2026-09-10T03:05:00.000Z'
    });

    assert.equal(first.snapshotId, first.summary.snapshotId);
    assert.equal(first.snapshotId, first.holdings[0].snapshotId);
    assert.equal(first.snapshotId, first.allocation.snapshotId);
    assert.equal(first.snapshotId, laterCalculation.snapshotId);
    assert.equal(first.ledgerRevision, laterCalculation.ledgerRevision);
    assert.equal(first.valuationAsOf, CALCULATED_AT);
    assert.equal(first.calculatedAt, CALCULATED_AT);
    assert.equal(first.investedMarketValue, 1_000);
    assert.equal(first.cash.value, 200);
    assert.equal(first.totalPortfolioValue, 1_200);
    assert.equal(first.allocation.knownAllocationValue, 1_200);
    assert.equal(first.allocation.cashWeightPct, (200 / 1_200) * 100);
    assert.equal(first.allocation.holdingAllocations[0].weightPct, (1_000 / 1_200) * 100);
    assert.equal(first.status, PORTFOLIO_DATA_STATES.AVAILABLE);
  });

  test('ledger and snapshot identities change when authoritative portfolio inputs change', () => {
    const firstOverview = completeOverview();
    const secondOverview = structuredClone(firstOverview);
    secondOverview.summary.cashAvailable = 250;
    secondOverview.summary.totalPortfolioValue = 1_250;
    secondOverview.summary.cashLedgerEntryCount = 5;

    const first = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview: firstOverview, calculatedAt: CALCULATED_AT });
    const second = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview: secondOverview, calculatedAt: CALCULATED_AT });

    assert.notEqual(first.ledgerRevision, second.ledgerRevision);
    assert.notEqual(first.snapshotId, second.snapshotId);
  });

  test('valuation provenance changes snapshot identity without fabricating a ledger change', () => {
    const firstOverview = completeOverview();
    const secondOverview = structuredClone(firstOverview);
    secondOverview.holdings[0].marketProvider = 'Alternate validated provider';

    const first = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview: firstOverview, calculatedAt: CALCULATED_AT });
    const second = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview: secondOverview, calculatedAt: CALCULATED_AT });

    assert.equal(first.ledgerRevision, second.ledgerRevision);
    assert.notEqual(first.snapshotId, second.snapshotId);
  });

  test('inconsistent independently-derived totals fail closed instead of becoming a snapshot', () => {
    const overview = completeOverview();
    overview.summary.totalPortfolioValue = 999;

    assert.throws(
      () => buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT }),
      /inconsistent with cash plus valued holdings/
    );
  });

  test('partial valuation preserves an unpriced holding and never converts missing values to zero', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: 500 },
      [vndHolding(), vndHolding({
        id: 'holding-vcb',
        asset_id: 'asset-vcb',
        opening_position_id: null,
        average_cost: null,
        asset: {
          symbol: 'VCB',
          name: 'Vietcombank',
          asset_type: 'stock',
          exchange: 'HOSE',
          quote_currency: 'VND',
          quantity_unit: 'share'
        }
      })],
      { FPT: { price: 100, currency: 'VND', priceAsOf: '2026-09-09T08:00:00.000Z' } }
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const missing = snapshot.holdings.find((holding) => holding.symbol === 'VCB');

    assert.equal(snapshot.status, PORTFOLIO_DATA_STATES.PARTIAL);
    assert.equal(snapshot.completeness.valuation, PORTFOLIO_DATA_STATES.PARTIAL);
    assert.equal(snapshot.valuationCoverage.unvaluedHoldingsCount, 1);
    assert.equal(missing.reportingMarketValue, null);
    assert.equal(missing.costBasis, null);
    assert.equal(missing.unrealizedPnL, null);
    assert.equal(missing.dataStatus, PORTFOLIO_DATA_STATES.UNAVAILABLE);
    assert.equal(snapshot.allocation.holdingAllocations.find((holding) => holding.symbol === 'VCB').weightPct, null);
  });

  test('unavailable authoritative cash keeps cash, total, and allocation weights unavailable', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: null },
      [vndHolding()],
      { FPT: { price: 100, currency: 'VND', priceAsOf: '2026-09-09T08:00:00.000Z' } }
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });

    assert.equal(snapshot.cash.value, null);
    assert.equal(snapshot.cash.status, PORTFOLIO_DATA_STATES.UNAVAILABLE);
    assert.equal(snapshot.totalPortfolioValue, null);
    assert.equal(snapshot.summary.metricStates.totalPortfolioValue, PORTFOLIO_DATA_STATES.UNAVAILABLE);
    assert.equal(snapshot.investedMarketValue, 1_000);
    assert.equal(snapshot.allocation.cashWeightPct, null);
    assert.equal(snapshot.allocation.pricedAssetsWeightPct, null);
    assert.equal(snapshot.status, PORTFOLIO_DATA_STATES.PARTIAL);
  });

  test('an unvalued position does not become a zero invested market value', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: 500 },
      [vndHolding({ average_cost: null })],
      {}
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });

    assert.equal(snapshot.investedMarketValue, null);
    assert.equal(snapshot.summary.totalMarketValue, null);
    assert.equal(snapshot.summary.metricStates.investedMarketValue, PORTFOLIO_DATA_STATES.UNAVAILABLE);
    assert.equal(snapshot.totalPortfolioValue, 500);
    assert.equal(snapshot.status, PORTFOLIO_DATA_STATES.PARTIAL);
    assert.equal(snapshot.holdings[0].reportingMarketValue, null);
  });

  test('stale source observations remain displayable only with explicit stale state', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: 200 },
      [vndHolding()],
      { FPT: {
        price: 100,
        currency: 'VND',
        source: 'Yahoo Finance',
        priceAsOf: '2026-09-05T08:00:00.000Z',
        freshness: 'stale',
        cacheStatus: 'stale'
      } }
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });

    assert.equal(snapshot.status, PORTFOLIO_DATA_STATES.STALE);
    assert.equal(snapshot.summary.metricStates.totalPortfolioValue, PORTFOLIO_DATA_STATES.STALE);
    assert.equal(snapshot.holdings[0].dataStatus, PORTFOLIO_DATA_STATES.STALE);
    assert.equal(snapshot.holdings[0].priceAsOf, '2026-09-05T08:00:00.000Z');
    assert.equal(snapshot.allocation.status, PORTFOLIO_DATA_STATES.STALE);
    assert.equal(snapshot.sources.prices[0].status, PORTFOLIO_DATA_STATES.STALE);
  });

  test('non-VND holdings preserve native P/L and distinct current VND valuation provenance', () => {
    const overview = calculatePortfolioValuation(
      { cash_available: 0 },
      [{
        id: 'holding-btc',
        asset_id: 'asset-btc',
        opening_position_id: 'opening-btc',
        quantity: 2,
        average_cost: null,
        asset: {
          symbol: 'BTC',
          name: 'Bitcoin',
          asset_type: 'crypto',
          exchange: 'CRYPTO',
          quote_currency: 'USD',
          quantity_unit: 'coin'
        },
        opening_position: {
          id: 'opening-btc',
          execution_unit_price: 50_000,
          price_currency: 'USDT',
          locked_at: null,
          cancelled_at: null
        }
      }],
      { BTC: { price: 60_000, currency: 'USD', source: 'CoinGecko', priceAsOf: '2026-09-10T02:00:00.000Z' } },
      { USD: { baseCurrency: 'USD', quoteCurrency: 'VND', rate: 25_000, availability: 'available', provider: 'Twelve Data', sourceTimestamp: '2026-09-10T01:00:00.000Z', freshness: 'current' } },
      { BTC: { price: 61_000, currency: 'USDT', source: 'Binance', observedAt: '2026-09-10T02:00:01.000Z' } }
    );
    const snapshot = buildPortfolioSnapshot({ profileId: PROFILE_ID, overview, calculatedAt: CALCULATED_AT });
    const holding = snapshot.holdings[0];

    assert.equal(holding.quantityUnit, 'coin');
    assert.equal(holding.nativeCurrency, 'USD');
    assert.equal(holding.reportingMarketValue, 3_000_000_000);
    assert.equal(holding.fxRateToReporting, 25_000);
    assert.equal(holding.fxAsOf, '2026-09-10T01:00:00.000Z');
    assert.equal(holding.averageCost, null);
    assert.equal(holding.costBasis, null);
    assert.equal(holding.unrealizedPnL, null);
    assert.equal(holding.nativeAverageCost, 50_000);
    assert.equal(holding.nativeCostCurrency, 'USDT');
    assert.equal(holding.nativeUnrealizedPnL, 22_000);
    assert.equal(snapshot.totalCostBasis, null);
    assert.equal(snapshot.unrealizedPnL, null);
    assert.equal(snapshot.sources.prices[0].source, 'CoinGecko');
    assert.equal(snapshot.sources.fx[0].provider, 'Twelve Data');
  });

  test('cash-only production path is provider-free and reports truthful applicability', async () => {
    let marketCalls = 0;
    let realtimeCalls = 0;
    let fxCalls = 0;
    const snapshot = await getPortfolioSnapshot({
      profileId: PROFILE_ID,
      now: new Date(CALCULATED_AT),
      getPortfolioOverviewFn: (options) => getPortfolioOverview({
        ...options,
        getCashOverviewFn: async () => ({
          currentCash: 200_000_000,
          entryCount: 1,
          ledgerStartAt: '2026-09-01T00:00:00.000Z'
        }),
        getHoldingsFn: async () => [],
        getMarketSnapshotFn: async () => { marketCalls += 1; throw new Error('must not run'); },
        getMarketRealtimeFn: async () => { realtimeCalls += 1; throw new Error('must not run'); },
        getFxRateFn: async () => { fxCalls += 1; throw new Error('must not run'); }
      })
    });

    assert.equal(marketCalls, 0);
    assert.equal(realtimeCalls, 0);
    assert.equal(fxCalls, 0);
    assert.equal(snapshot.cash.value, 200_000_000);
    assert.equal(snapshot.cash.source, 'cash_ledger');
    assert.equal(snapshot.cash.entryCount, 1);
    assert.equal(snapshot.investedMarketValue, 0);
    assert.equal(snapshot.totalPortfolioValue, 200_000_000);
    assert.equal(snapshot.totalCostBasis, null);
    assert.equal(snapshot.unrealizedPnL, null);
    assert.equal(snapshot.summary.totalCostBasis, null);
    assert.equal(snapshot.summary.totalUnrealizedPnL, null);
    assert.deepEqual(snapshot.holdings, []);
    assert.equal(snapshot.allocation.cashWeightPct, 100);
    assert.equal(snapshot.allocation.pricedAssetsWeightPct, 0);
    assert.equal(snapshot.allocation.concentrationStatus, PORTFOLIO_DATA_STATES.NOT_APPLICABLE);
    assert.equal(snapshot.completeness.concentration, PORTFOLIO_DATA_STATES.NOT_APPLICABLE);
  });

  test('snapshot requires an explicit valid clock', async () => {
    await assert.rejects(
      getPortfolioSnapshot({ profileId: PROFILE_ID, getPortfolioOverviewFn: async () => completeOverview() }),
      /explicit valid Date/
    );
    await assert.rejects(
      getPortfolioSnapshot({ profileId: PROFILE_ID, now: new Date('invalid'), getPortfolioOverviewFn: async () => completeOverview() }),
      /explicit valid Date/
    );
  });

  test('calculatedAt clock is read after the authoritative overview has resolved', async () => {
    let overviewResolved = false;
    const snapshot = await getPortfolioSnapshot({
      profileId: PROFILE_ID,
      now: () => {
        assert.equal(overviewResolved, true);
        return new Date(CALCULATED_AT);
      },
      getPortfolioOverviewFn: async () => {
        overviewResolved = true;
        return completeOverview();
      }
    });

    assert.equal(snapshot.calculatedAt, CALCULATED_AT);
    assert.equal(snapshot.valuationAsOf, CALCULATED_AT);
  });

  test('protected production route resolves the owner profile and calls the overview once', async () => {
    let overviewCalls = 0;
    let receivedProfileId = null;
    const app = createApp({
      supabaseAuthClient: null,
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getPortfolioOverviewFn: async ({ profileId }) => {
        overviewCalls += 1;
        receivedProfileId = profileId;
        return completeOverview();
      }
    });
    const { server, baseUrl } = await listen(app);

    try {
      const unauthenticated = await fetch(`${baseUrl}/api/portfolio/snapshot`);
      assert.equal(unauthenticated.status, 401);

      const response = await ownerFetch(`${baseUrl}/api/portfolio/snapshot`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.data.profileId, PROFILE_ID);
      assert.equal(receivedProfileId, PROFILE_ID);
      assert.equal(overviewCalls, 1);
      assert.equal(body.data.snapshotId, body.data.summary.snapshotId);
      assert.equal(body.data.snapshotId, body.data.allocation.snapshotId);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('legacy overview/composition remain compatible while frontend current blocks use snapshot', async () => {
    const overview = completeOverview();
    const app = createApp({
      supabaseAuthClient: null,
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getPortfolioOverviewFn: async () => overview
    });
    const { server, baseUrl } = await listen(app);

    try {
      const [overviewResponse, compositionResponse] = await Promise.all([
        ownerFetch(`${baseUrl}/api/portfolio/overview`),
        ownerFetch(`${baseUrl}/api/portfolio/composition`)
      ]);
      assert.equal(overviewResponse.status, 200);
      assert.equal(compositionResponse.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const appSource = await readFile(new URL('../../client/src/App.jsx', import.meta.url), 'utf8');
    assert.match(appSource, /apiFetch\('\/api\/portfolio\/snapshot'/);
    assert.doesNotMatch(appSource, /apiFetch\('\/api\/portfolio\/overview'/);
    assert.doesNotMatch(appSource, /apiFetch\('\/api\/portfolio\/composition'/);
    assert.match(appSource, /setPortfolioOverview\(json\.data\)/);
    assert.match(appSource, /setCompositionData\(json\.data\.allocation\)/);
    assert.match(appSource, /currentCashSnapshot=\{portfolioOverview\?\.cash\}/);
  });
});
