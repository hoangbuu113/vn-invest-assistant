import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../index.js';
import {
  OPPORTUNITY_METHODOLOGY_VERSION,
  buildOpportunityReport,
  getAnalysisRangeProxy,
  getOpportunities,
  nearestRankPercentile
} from '../src/opportunities.js';
import {
  buildOpportunityViewModel,
  opportunityReasonLabel
} from '../../client/src/utils/opportunityDisplay.js';

const NOW = new Date('2026-08-31T05:00:00.000Z');

function asset(id, symbol, assetType, marketPolicy, extra = {}) {
  return {
    id,
    symbol,
    name: `${symbol} Asset`,
    assetType,
    marketPolicy,
    quoteCurrency: assetType === 'crypto' || assetType === 'gold' ? 'USD' : 'VND',
    isActive: true,
    ...extra
  };
}

function analysis(symbol, range = '3M', evidence = {}, extra = {}) {
  const values = {
    priceChangePct: 10,
    positiveCloseTransitionRatio: 0.6,
    dailyVolatilityPct: 2,
    maxDrawdownPct: 8,
    completedCloseRangePositionPct: 70,
    distanceBelowHighestCompletedClosePct: 5,
    ...evidence
  };
  const metricStatus = Object.fromEntries(Object.keys(values).map((key) => [
    key,
    { status: typeof values[key] === 'number' && Number.isFinite(values[key]) ? 'available' : 'insufficient_data', reason: null }
  ]));
  return {
    methodologyVersion: 'v2',
    symbol,
    quoteCurrency: symbol === 'BTC' || symbol.startsWith('C') ? 'USDT' : 'VND',
    analysisAsOf: '2026-08-30T00:00:00.000Z',
    analysisPriceDate: '2026-08-30',
    freshness: 'delayed',
    periods: {
      [range]: {
        status: 'available',
        usableCompletedBarCount: 60,
        metricStatus,
        ...values
      }
    },
    dataCompleteness: {
      canonicalHistoryCompleteness: 'complete'
    },
    ...extra
  };
}

function fulfilled(value) {
  return { status: 'fulfilled', value };
}

function reportFor({ assets, analyses, profile, holdings, watchlist, composition, contextStatus }) {
  return buildOpportunityReport({
    assets,
    profile: profile || { risk_tolerance: 'moderate', investment_horizon: 'medium' },
    analysisByAssetId: new Map(assets.map((item) => [
      item.id,
      analyses?.get(item.id) || fulfilled(analysis(item.symbol))
    ])),
    holdings,
    watchlist,
    composition,
    contextStatus,
    now: NOW
  });
}

test('Feature 28 opportunity methodology', async (t) => {
  await t.test('maps only the three real profile horizons to locked analysis proxies', () => {
    assert.equal(getAnalysisRangeProxy('short'), '1M');
    assert.equal(getAnalysisRangeProxy('medium'), '3M');
    assert.equal(getAnalysisRangeProxy('long'), '1Y');
    assert.equal(getAnalysisRangeProxy('unknown'), null);
  });

  await t.test('isolates cohorts and excludes USD/VND as non-investment context', () => {
    const assets = [
      asset('s1', 'FPT', 'stock', 'VN_EXCHANGE'),
      asset('e1', 'E1VFVN30', 'etf', 'VN_EXCHANGE'),
      asset('c1', 'BTC', 'crypto', 'CONTINUOUS_24_7'),
      asset('g1', 'XAU/USD', 'gold', 'GLOBAL_24_5'),
      asset('f1', 'USD/VND', 'fx', 'GLOBAL_24_5')
    ];
    const result = reportFor({ assets });
    assert.equal(result.methodologyVersion, OPPORTUNITY_METHODOLOGY_VERSION);
    assert.deepEqual(result.cohorts.map((cohort) => cohort.id), ['VN_STOCK', 'VN_ETF', 'CRYPTO', 'GOLD']);
    assert.deepEqual(result.cohorts.map((cohort) => cohort.candidates[0].symbol), ['FPT', 'E1VFVN30', 'BTC', 'XAU/USD']);
    assert.equal(result.excludedCandidates[0].symbol, 'USD/VND');
    assert.equal(result.excludedCandidates[0].candidateState, 'excluded');
    assert.deepEqual(result.excludedCandidates[0].reasons, ['NON_INVESTMENT_CONTEXT']);
  });

  await t.test('uses the locked deterministic rank order and canonical symbol tie-break', () => {
    const assets = [
      asset('a', 'AAA', 'crypto', 'CONTINUOUS_24_7'),
      asset('b', 'BBB', 'crypto', 'CONTINUOUS_24_7'),
      asset('c', 'CCC', 'crypto', 'CONTINUOUS_24_7'),
      asset('d', 'DDD', 'crypto', 'CONTINUOUS_24_7')
    ];
    const analyses = new Map([
      ['a', fulfilled(analysis('AAA', '3M', { priceChangePct: 50, positiveCloseTransitionRatio: 0.5 }))],
      ['b', fulfilled(analysis('BBB', '3M', { priceChangePct: 10, positiveCloseTransitionRatio: 0.6 }))],
      ['c', fulfilled(analysis('CCC', '3M', { priceChangePct: 10, positiveCloseTransitionRatio: 0.6, maxDrawdownPct: 5, dailyVolatilityPct: 1 }))],
      ['d', fulfilled(analysis('DDD', '3M', { priceChangePct: 10, positiveCloseTransitionRatio: 0.6, maxDrawdownPct: 5, dailyVolatilityPct: 1 }))]
    ]);
    const candidates = reportFor({ assets, analyses }).cohorts.find((cohort) => cohort.id === 'CRYPTO').candidates;
    assert.deepEqual(candidates.map((candidate) => candidate.symbol), ['CCC', 'DDD', 'BBB', 'AAA']);
    assert.deepEqual(candidates.map((candidate) => candidate.descriptiveRank), [1, 2, 3, 4]);
  });

  await t.test('screen boundaries are strict at exactly zero and exactly 0.5', () => {
    const assets = [
      asset('a', 'AAA', 'stock', 'VN_EXCHANGE'),
      asset('b', 'BBB', 'stock', 'VN_EXCHANGE'),
      asset('c', 'CCC', 'stock', 'VN_EXCHANGE')
    ];
    const analyses = new Map([
      ['a', fulfilled(analysis('AAA', '3M', { priceChangePct: 0, positiveCloseTransitionRatio: 0.9 }))],
      ['b', fulfilled(analysis('BBB', '3M', { priceChangePct: 1, positiveCloseTransitionRatio: 0.5 }))],
      ['c', fulfilled(analysis('CCC', '3M', { priceChangePct: Number.EPSILON, positiveCloseTransitionRatio: 0.5000001 }))]
    ]);
    const candidates = reportFor({ assets, analyses }).cohorts[0].candidates;
    assert.equal(candidates.find((candidate) => candidate.symbol === 'AAA').screenMatch, false);
    assert.equal(candidates.find((candidate) => candidate.symbol === 'BBB').screenMatch, false);
    assert.equal(candidates.find((candidate) => candidate.symbol === 'CCC').screenMatch, true);
  });

  await t.test('preserves legitimate zero metrics but rejects a missing required metric without fabrication', () => {
    const assets = [
      asset('a', 'AAA', 'etf', 'VN_EXCHANGE'),
      asset('b', 'BBB', 'etf', 'VN_EXCHANGE')
    ];
    const analyses = new Map([
      ['a', fulfilled(analysis('AAA', '3M', {
        priceChangePct: 0,
        positiveCloseTransitionRatio: 0,
        dailyVolatilityPct: 0,
        maxDrawdownPct: 0
      }))],
      ['b', fulfilled(analysis('BBB', '3M', { dailyVolatilityPct: null }))]
    ]);
    const candidates = reportFor({ assets, analyses }).cohorts.find((cohort) => cohort.id === 'VN_ETF').candidates;
    const zero = candidates.find((candidate) => candidate.symbol === 'AAA');
    const missing = candidates.find((candidate) => candidate.symbol === 'BBB');
    assert.equal(zero.candidateState, 'eligible');
    assert.equal(zero.evidence.dailyVolatilityPct, 0);
    assert.equal(zero.evidence.maxDrawdownPct, 0);
    assert.equal(zero.screenMatch, false);
    assert.equal(missing.candidateState, 'insufficient_data');
    assert.equal(missing.evidence.dailyVolatilityPct, null);
    assert.equal(missing.descriptiveRank, null);
  });

  await t.test('cohorts below ten eligible assets do not receive profile-fit judgments', () => {
    const assets = Array.from({ length: 9 }, (_, index) => asset(`c${index}`, `C${index}`, 'crypto', 'CONTINUOUS_24_7'));
    const cohort = reportFor({ assets }).cohorts.find((item) => item.id === 'CRYPTO');
    assert.equal(cohort.eligibleCohortSize, 9);
    assert.equal(cohort.profileFitCutoffs, null);
    assert.ok(cohort.candidates.every((candidate) => (
      candidate.profileFit.status === 'not_assessed'
      && candidate.profileFit.reason === 'INSUFFICIENT_COHORT_SIZE'
    )));
  });

  await t.test('calculates visible nearest-rank percentile cutoffs for cohorts of ten or more', () => {
    const assets = Array.from({ length: 10 }, (_, index) => asset(`c${index}`, `C${index}`, 'crypto', 'CONTINUOUS_24_7'));
    const analyses = new Map(assets.map((item, index) => [
      item.id,
      fulfilled(analysis(item.symbol, '3M', {
        priceChangePct: 100 - index,
        dailyVolatilityPct: index + 1,
        maxDrawdownPct: (index + 1) * 2
      }))
    ]));
    const cohort = reportFor({
      assets,
      analyses,
      profile: { risk_tolerance: 'low', investment_horizon: 'medium' }
    }).cohorts.find((item) => item.id === 'CRYPTO');
    assert.deepEqual(cohort.profileFitCutoffs, {
      p33: { dailyVolatilityPct: 4, maxDrawdownPct: 8 },
      p67: { dailyVolatilityPct: 7, maxDrawdownPct: 14 }
    });
    assert.equal(cohort.candidates.find((candidate) => candidate.symbol === 'C3').profileFit.status, 'within_preference');
    assert.equal(cohort.candidates.find((candidate) => candidate.symbol === 'C4').profileFit.status, 'outside_preference');
    assert.equal(nearestRankPercentile([10, 20, 30], 2 / 3), 20);
  });

  await t.test('profile fit never reorders descriptive market rank', () => {
    const assets = Array.from({ length: 10 }, (_, index) => asset(`c${index}`, `C${index}`, 'crypto', 'CONTINUOUS_24_7'));
    const analyses = new Map(assets.map((item, index) => [
      item.id,
      fulfilled(analysis(item.symbol, '3M', {
        priceChangePct: 100 - index,
        dailyVolatilityPct: 10 - index,
        maxDrawdownPct: 20 - index
      }))
    ]));
    const low = reportFor({ assets, analyses, profile: { risk_tolerance: 'low', investment_horizon: 'medium' } });
    const high = reportFor({ assets, analyses, profile: { risk_tolerance: 'high', investment_horizon: 'medium' } });
    const lowOrder = low.cohorts.find((item) => item.id === 'CRYPTO').candidates.map((candidate) => candidate.symbol);
    const highOrder = high.cohorts.find((item) => item.id === 'CRYPTO').candidates.map((candidate) => candidate.symbol);
    assert.deepEqual(lowOrder, highOrder);
    assert.equal(low.cohorts.find((item) => item.id === 'CRYPTO').candidates[0].profileFit.status, 'outside_preference');
  });

  await t.test('incomplete canonical history remains insufficient even when metric values exist', () => {
    const item = asset('a', 'AAA', 'stock', 'VN_EXCHANGE');
    const analyses = new Map([['a', fulfilled(analysis('AAA', '3M', {}, {
      dataCompleteness: { canonicalHistoryCompleteness: 'partial' }
    }))]]);
    const candidate = reportFor({ assets: [item], analyses }).cohorts[0].candidates[0];
    assert.equal(candidate.candidateState, 'insufficient_data');
    assert.ok(candidate.reasons.includes('INCOMPLETE_HISTORY'));
    assert.equal(candidate.descriptiveRank, null);
  });

  await t.test('Gold remains evidence-only without a singleton ordinal rank', () => {
    const item = asset('g', 'XAU/USD', 'gold', 'GLOBAL_24_5');
    const candidate = reportFor({ assets: [item] }).cohorts.find((cohort) => cohort.id === 'GOLD').candidates[0];
    assert.equal(candidate.candidateState, 'eligible');
    assert.equal(candidate.descriptiveRank, null);
    assert.equal(candidate.evidence.priceChangePct, 10);
  });

  await t.test('exposes held/watchlisted and partial-basis exposure without affecting rank', () => {
    const item = asset('a', 'AAA', 'stock', 'VN_EXCHANGE');
    const result = reportFor({
      assets: [item],
      holdings: [{ asset_id: 'a' }],
      watchlist: [{ asset_id: 'a' }],
      composition: {
        valuationCoverageLevel: 'partial',
        allocationBasis: 'known_value_only',
        holdingAllocations: [{ assetId: 'a', isPriced: true, weightPct: 12.5 }]
      }
    });
    const candidate = result.cohorts[0].candidates[0];
    assert.equal(candidate.held, true);
    assert.equal(candidate.watchlisted, true);
    assert.equal(candidate.currentExposurePct, 12.5);
    assert.equal(candidate.exposureStatus, 'partial_basis');
    assert.equal(candidate.descriptiveRank, 1);

    const unavailableContext = reportFor({
      assets: [item],
      contextStatus: { holdings: 'unavailable', watchlist: 'unavailable' }
    });
    const unknownCandidate = unavailableContext.cohorts[0].candidates[0];
    assert.equal(unknownCandidate.held, null);
    assert.equal(unknownCandidate.watchlisted, null);
    assert.equal(unavailableContext.holdingsContext.status, 'unavailable');
    assert.equal(unavailableContext.watchlistContext.status, 'unavailable');
  });

  await t.test('orchestration isolates one provider failure, bounds concurrency, and shares one request clock', async () => {
    const assets = [
      asset('a', 'AAA', 'crypto', 'CONTINUOUS_24_7'),
      asset('b', 'BBB', 'crypto', 'CONTINUOUS_24_7'),
      asset('c', 'CCC', 'crypto', 'CONTINUOUS_24_7')
    ];
    let active = 0;
    let maximumActive = 0;
    const seenNow = [];
    const result = await getOpportunities({
      now: NOW,
      concurrency: 2,
      getAssetsFn: async () => assets,
      getInvestorProfileFn: async () => ({ risk_tolerance: 'moderate', investment_horizon: 'medium' }),
      getHoldingsFn: async () => [],
      getWatchlistFn: async () => [],
      getPortfolioCompositionFn: async () => ({ valuationCoverageLevel: 'complete', allocationBasis: 'cash_only', holdingAllocations: [] }),
      getVietnamRegimeFn: async ({ now }) => ({ status: 'ok', fetchedAt: now.toISOString() }),
      getAssetAnalysisFn: async (symbol, options) => {
        seenNow.push(options.now);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (symbol === 'BBB') {
          const error = new Error('provider down');
          error.code = 'PROVIDER_UNAVAILABLE';
          error.status = 503;
          throw error;
        }
        return analysis(symbol);
      }
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.counts.eligible, 2);
    assert.equal(result.counts.insufficientData, 1);
    assert.ok(maximumActive <= 2);
    assert.ok(seenNow.every((value) => value === NOW));
  });

  await t.test('uses 503 status only when every analyzable candidate has an acquisition failure', () => {
    const assets = [
      asset('a', 'AAA', 'crypto', 'CONTINUOUS_24_7'),
      asset('b', 'BBB', 'crypto', 'CONTINUOUS_24_7')
    ];
    const providerError = Object.assign(new Error('down'), { code: 'PROVIDER_UNAVAILABLE', status: 503 });
    const unavailable = reportFor({
      assets,
      analyses: new Map(assets.map((item) => [item.id, { status: 'rejected', reason: providerError }]))
    });
    assert.equal(unavailable.status, 'unavailable');

    const incomplete = reportFor({
      assets,
      analyses: new Map(assets.map((item) => [item.id, fulfilled(analysis(item.symbol, '3M', {}, {
        dataCompleteness: { canonicalHistoryCompleteness: 'partial' }
      }))]))
    });
    assert.equal(incomplete.status, 'ok');
    assert.equal(incomplete.counts.eligible, 0);
  });

  await t.test('production Express route returns candidate states for both HTTP 200 and genuine HTTP 503', async () => {
    const baseResult = reportFor({ assets: [asset('a', 'AAA', 'stock', 'VN_EXCHANGE')] });
    async function exercise(result) {
      const app = createApp({ getOpportunitiesFn: async () => result });
      const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/opportunities`);
        return { response, body: await response.json() };
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }

    const ok = await exercise(baseResult);
    assert.equal(ok.response.status, 200);
    assert.equal(ok.body.status, 'ok');
    assert.equal(ok.body.data.cohorts[0].candidates[0].candidateState, 'eligible');

    const unavailable = await exercise({ ...baseResult, status: 'unavailable' });
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.body.code, 'OPPORTUNITY_SERVICE_UNAVAILABLE');
    assert.ok(Array.isArray(unavailable.body.data.cohorts));
  });

  await t.test('frontend view model preserves capability states, null metrics, and exact reason codes', () => {
    const payload = reportFor({
      assets: [asset('a', 'AAA', 'stock', 'VN_EXCHANGE')],
      analyses: new Map([['a', fulfilled(analysis('AAA', '3M', { maxDrawdownPct: null }))]])
    });
    const view = buildOpportunityViewModel(payload);
    const candidate = view.cohorts[0].candidates[0];
    assert.equal(candidate.candidateState, 'insufficient_data');
    assert.equal(candidate.evidence.maxDrawdownPct, null);
    assert.ok(candidate.reasons.some((reason) => reason.includes('MAX_DRAWDOWN_PCT')));
    assert.equal(opportunityReasonLabel('INCOMPLETE_HISTORY'), 'Khoảng lịch sử chưa đầy đủ');
    assert.equal(view.analysisRangeProxy, '3M');
  });
});
