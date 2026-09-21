import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';

import { createApp } from '../index.js';
import {
  buildBoundaryExternalFlowEvidence,
  buildPortfolioDailyValuationObservation,
  capturePortfolioDailyValuationForProfile,
  createDailyValuationEvidenceHash,
  getDailyValuationSchedule,
  persistPortfolioDailyValuation,
  runScheduledPortfolioDailyValuationCapture
} from '../src/portfolioDailyValuations.js';
import {
  calculatePortfolioPerformanceFromDailyValuations,
  solveXirr
} from '../src/performance.js';
import {
  APP_API_BASE_URL,
  getPortfolioDailyValuationSchedule,
  runScheduledPortfolioDailyValuation
} from '../../client/server/index.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const SCHEDULER_TOKEN = 'scheduler-token-with-at-least-thirty-two-characters';
const MIGRATION_URL = new URL(
  '../../supabase/migrations/20260920000000_create_portfolio_daily_valuations.sql',
  import.meta.url
);
const runningServers = [];

function availableSnapshot({
  profileId = PROFILE_ID,
  total = 3_315_370,
  cash = 1_000_000,
  nativePrice = 0.4098,
  fxRate = 25_000,
  status = 'AVAILABLE'
} = {}) {
  const nativeMarketValue = 226 * nativePrice;
  const reportingMarketValue = nativeMarketValue * fxRate;
  return {
    profileId,
    snapshotId: `snapshot-${total}`,
    ledgerRevision: 'ledger-ondo-226',
    status,
    completeness: {
      unrealizedPnl: status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE'
    },
    cash: { value: cash, status: 'AVAILABLE' },
    investedMarketValue: status === 'AVAILABLE' ? reportingMarketValue : null,
    totalPortfolioValue: status === 'AVAILABLE' ? total : null,
    unrealizedPnL: status === 'AVAILABLE' ? 250_000 : null,
    holdings: [{
      assetId: ASSET_ID,
      symbol: 'ONDO',
      quantity: 226,
      quantityUnit: 'coin',
      nativePrice: status === 'AVAILABLE' ? nativePrice : null,
      nativeCurrency: 'USDT',
      nativeMarketValue: status === 'AVAILABLE' ? nativeMarketValue : null,
      reportingCurrency: 'VND',
      reportingMarketValue: status === 'AVAILABLE' ? reportingMarketValue : null,
      valuationStatus: status === 'AVAILABLE' ? 'available' : 'unavailable',
      valuationReason: status === 'AVAILABLE' ? null : 'FX_PROVIDER_UNAVAILABLE',
      marketProvider: 'binance',
      marketUpdatedAt: '2026-09-20T16:44:30.000Z',
      marketFreshness: 'current',
      fxRateToReporting: status === 'AVAILABLE' ? fxRate : null,
      fxProvider: status === 'AVAILABLE' ? 'COINMARKETCAP' : null,
      fxRateTimestamp: status === 'AVAILABLE' ? '2026-09-20T16:44:00.000Z' : null,
      fxFreshness: status === 'AVAILABLE' ? 'current' : null,
      apiKey: 'must-never-persist'
    }],
    sources: {
      prices: [{
        assetId: ASSET_ID,
        symbol: 'ONDO',
        source: 'binance',
        priceAsOf: '2026-09-20T16:44:30.000Z',
        freshness: 'current',
        status: 'AVAILABLE',
        authorization: 'must-never-persist'
      }],
      fx: [{
        assetId: ASSET_ID,
        baseCurrency: 'USDT',
        quoteCurrency: 'VND',
        provider: status === 'AVAILABLE' ? 'COINMARKETCAP' : null,
        rate: status === 'AVAILABLE' ? fxRate : null,
        asOf: status === 'AVAILABLE' ? '2026-09-20T16:44:00.000Z' : null,
        freshness: status === 'AVAILABLE' ? 'current' : null,
        status,
        token: 'must-never-persist'
      }]
    },
    secret: 'must-never-persist'
  };
}

function observation({
  valuationDate,
  total,
  status = 'AVAILABLE',
  flow = 0,
  flowStatus = 'AVAILABLE',
  flowIntervalType = 'CONSECUTIVE_DAILY_BOUNDARY',
  flowEvents = [],
  holdings = 1,
  unrealizedPnlVnd = 5
}) {
  return {
    profileId: PROFILE_ID,
    valuationDate,
    status,
    totalPortfolioValueVnd: total,
    unrealizedPnlVnd,
    totalHoldingsCount: holdings,
    valuedHoldingsCount: status === 'AVAILABLE' ? holdings : 0,
    boundaryExternalFlowVnd: flow,
    flowStatus,
    flowIntervalType,
    observationEvidence: {
      valuation: {
        coverageReasons: status === 'AVAILABLE' ? [] : ['INCOMPLETE_DAILY_VALUATION'],
        unrealizedPnlStatus: status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE'
      },
      flowInterval: { events: flowEvents }
    }
  };
}

async function listen(app) {
  const server = http.createServer(app);
  runningServers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  await Promise.all(runningServers.map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Portfolio daily valuation history foundation', () => {
  test('A/D/M/V: first ONDO observation preserves native and direct CMC valuation evidence without cost backfill or secrets', () => {
    const observedAt = '2026-09-20T16:45:00.000Z';
    const snapshot = availableSnapshot();
    const result = buildPortfolioDailyValuationObservation({
      profileId: PROFILE_ID,
      valuationDate: '2026-09-20',
      observedAt,
      snapshot
    });

    assert.equal(result.status, 'AVAILABLE');
    assert.equal(result.flowIntervalType, 'FIRST_OBSERVATION');
    assert.equal(result.flowStatus, 'NOT_APPLICABLE');
    assert.equal(result.boundaryExternalFlowVnd, null);
    assert.equal(result.observationEvidence.holdings[0].quantity, 226);
    assert.equal(result.observationEvidence.holdings[0].nativeCurrency, 'USDT');
    assert.equal(result.observationEvidence.holdings[0].nativeMarketValue, 92.6148);
    assert.equal(result.observationEvidence.holdings[0].reportingMarketValueVnd, 2_315_370);
    assert.equal(result.observationEvidence.holdings[0].fxProvider, 'COINMARKETCAP');
    assert.equal(result.observationEvidence.holdings[0].fxRateToVnd, 25_000);
    assert.equal(result.observationEvidence.holdings[0].fxAsOf, '2026-09-20T16:44:00.000Z');
    assert.equal('averageCost' in result.observationEvidence.holdings[0], false);
    assert.equal('nativeAverageCost' in result.observationEvidence.holdings[0], false);
    assert.match(result.evidenceHash, /^[0-9a-f]{64}$/);
    assert.equal(
      result.evidenceHash,
      createDailyValuationEvidenceHash({ profileId: PROFILE_ID, evidence: result.observationEvidence })
    );
    assert.equal(
      createDailyValuationEvidenceHash({ second: 2, first: 1 }),
      createDailyValuationEvidenceHash({ first: 1, second: 2 })
    );
    const serialized = JSON.stringify(result.observationEvidence);
    assert.doesNotMatch(serialized, /must-never-persist|apiKey|authorization|bearer|secret|token/i);
  });

  test('B/C/R/S/N: same-day retry is immutable, next day appends, and financial inputs are never mutated', async () => {
    const stored = new Map();
    let snapshot = availableSnapshot();
    let snapshotCalls = 0;
    const cashEntries = Object.freeze([]);
    const transactions = Object.freeze([]);
    const getExistingFn = async ({ profileId, valuationDate }) => stored.get(`${profileId}:${valuationDate}`) || null;
    const getPreviousFn = async ({ profileId, valuationDate }) => Array.from(stored.values())
      .filter((item) => item.profileId === profileId && item.valuationDate < valuationDate)
      .sort((left, right) => right.valuationDate.localeCompare(left.valuationDate))[0] || null;
    const persistFn = async (value) => {
      stored.set(`${value.profileId}:${value.valuationDate}`, value);
      return { observation: value, replayed: false };
    };
    const shared = {
      profileId: PROFILE_ID,
      client: {},
      getExistingFn,
      getPreviousFn,
      getSnapshotFn: async () => {
        snapshotCalls += 1;
        return snapshot;
      },
      getCashLedgerFn: async () => cashEntries,
      getTransactionsFn: async () => transactions,
      persistFn
    };

    const first = await capturePortfolioDailyValuationForProfile({
      ...shared,
      now: new Date('2026-09-20T16:45:00.000Z')
    });
    snapshot = availableSnapshot({ status: 'PARTIAL' });
    const retry = await capturePortfolioDailyValuationForProfile({
      ...shared,
      now: new Date('2026-09-20T16:46:00.000Z')
    });
    const next = await capturePortfolioDailyValuationForProfile({
      ...shared,
      now: new Date('2026-09-21T16:45:00.000Z')
    });

    assert.equal(first.replayed, false);
    assert.equal(retry.replayed, true);
    assert.equal(retry.observation.evidenceHash, first.observation.evidenceHash);
    assert.equal(retry.observation.status, 'AVAILABLE');
    assert.equal(next.replayed, false);
    assert.equal(next.observation.valuationDate, '2026-09-21');
    assert.equal(next.observation.flowIntervalType, 'CONSECUTIVE_DAILY_BOUNDARY');
    assert.equal(stored.size, 2);
    assert.equal(snapshotCalls, 2, 'same-day replay must not reacquire providers');
    assert.deepEqual(cashEntries, []);
    assert.deepEqual(transactions, []);
  });

  test('E/F/G: unavailable and partial observations stay null while real zero remains numeric', () => {
    const unavailable = buildPortfolioDailyValuationObservation({
      profileId: PROFILE_ID,
      valuationDate: '2026-09-20',
      observedAt: '2026-09-20T16:45:00.000Z',
      snapshot: availableSnapshot({ status: 'UNAVAILABLE' })
    });
    assert.equal(unavailable.status, 'UNAVAILABLE');
    assert.equal(unavailable.totalPortfolioValueVnd, null);

    const partial = buildPortfolioDailyValuationObservation({
      profileId: PROFILE_ID,
      valuationDate: '2026-09-20',
      observedAt: '2026-09-20T16:45:00.000Z',
      snapshot: availableSnapshot({ status: 'PARTIAL' })
    });
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.totalPortfolioValueVnd, null);
    assert.equal(partial.observationEvidence.holdings[0].reportingMarketValueVnd, null);

    const zeroSnapshot = {
      ...availableSnapshot({ total: 0, cash: 0 }),
      holdings: [],
      investedMarketValue: 0,
      totalPortfolioValue: 0,
      unrealizedPnL: 0,
      completeness: { unrealizedPnl: 'NOT_APPLICABLE' },
      sources: { prices: [], fx: [] }
    };
    const zero = buildPortfolioDailyValuationObservation({
      profileId: PROFILE_ID,
      valuationDate: '2026-09-20',
      observedAt: '2026-09-20T16:45:00.000Z',
      snapshot: zeroSnapshot
    });
    assert.equal(zero.status, 'AVAILABLE');
    assert.equal(zero.cashVnd, 0);
    assert.equal(zero.investedMarketValueVnd, 0);
    assert.equal(zero.totalPortfolioValueVnd, 0);
  });

  test('H: boundary flow evidence uses exact timestamps and excludes internal trades', () => {
    const flow = buildBoundaryExternalFlowEvidence({
      startExclusive: '2026-09-19T16:45:00.000Z',
      endInclusive: '2026-09-20T16:45:00.000Z',
      cashEntries: [
        { id: 'deposit', entryType: 'DEPOSIT', amount: 100, effectiveAt: '2026-09-20T01:00:00.000Z' },
        { id: 'withdraw', entryType: 'WITHDRAWAL', amount: 20, effectiveAt: '2026-09-20T02:00:00.000Z' },
        { id: 'internal-buy', entryType: 'BUY', amount: 999, effectiveAt: '2026-09-20T03:00:00.000Z' },
        { id: 'after-boundary', entryType: 'DEPOSIT', amount: 500, effectiveAt: '2026-09-20T16:46:00.000Z' }
      ],
      transactions: [
        { id: 'buy', transactionType: 'BUY', settlementMode: 'EXTERNAL_SETTLEMENT', quantity: 2, price: 30, executedAt: '2026-09-20T04:00:00.000Z' },
        { id: 'sell', transactionType: 'SELL', settlementMode: 'EXTERNAL_SETTLEMENT', quantity: 1, price: 25, executedAt: '2026-09-20T05:00:00.000Z' },
        { id: 'buy-reversal', transactionType: 'BUY_REVERSAL', settlementMode: 'EXTERNAL_SETTLEMENT', quantity: 1, price: 10, executedAt: '2026-09-20T05:30:00.000Z' },
        { id: 'sell-reversal', transactionType: 'SELL_REVERSAL', settlementMode: 'EXTERNAL_SETTLEMENT', quantity: 1, price: 5, executedAt: '2026-09-20T05:45:00.000Z' },
        { id: 'tracked', transactionType: 'BUY', settlementMode: 'INTERNAL_VND_CASH', quantity: 1, price: 999, executedAt: '2026-09-20T06:00:00.000Z' }
      ]
    });
    assert.equal(flow.status, 'AVAILABLE');
    assert.equal(flow.netExternalFlowVnd, 110);
    assert.deepEqual(
      flow.events.map((event) => event.sourceId),
      ['deposit', 'withdraw', 'buy', 'sell', 'buy-reversal', 'sell-reversal']
    );
    assert.equal(flow.startExclusive, '2026-09-19T16:45:00.000Z');
    assert.equal(flow.endInclusive, '2026-09-20T16:45:00.000Z');
  });

  test('I/J: one boundary is insufficient and consecutive complete boundaries compute TWR', () => {
    const now = new Date('2026-09-22T02:00:00.000Z');
    const one = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now,
      observations: [observation({
        valuationDate: '2026-09-20',
        total: 100,
        flow: null,
        flowStatus: 'NOT_APPLICABLE',
        flowIntervalType: 'FIRST_OBSERVATION'
      })]
    });
    assert.equal(one.twr.status, 'insufficient_data');
    assert.equal(one.twr.returnPct, null);

    const two = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now,
      observations: [
        observation({ valuationDate: '2026-09-20', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' }),
        observation({ valuationDate: '2026-09-21', total: 120, flow: 20 })
      ]
    });
    assert.equal(two.twr.status, 'available');
    assert.equal(two.twr.returnPct, 0);
    assert.deepEqual(two.series.map((point) => point.twrIndex), [100, 100]);
  });

  test('K: drawdown consumes only the valid consecutive wealth-index series', () => {
    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-23T02:00:00.000Z'),
      observations: [
        observation({ valuationDate: '2026-09-20', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' }),
        observation({ valuationDate: '2026-09-21', total: 80 }),
        observation({ valuationDate: '2026-09-22', total: 90 })
      ]
    });
    assert.equal(result.drawdown.status, 'available');
    assert.equal(result.drawdown.maxDrawdownPct, -20);
    assert.equal(result.drawdown.currentDrawdownPct, -10);
  });

  test('L: XIRR uses legitimate endpoints and actual persisted interval flow while preserving the 365-day threshold', () => {
    const actualFlowDate = '2026-03-20';
    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1Y',
      now: new Date('2026-09-21T02:00:00.000Z'),
      observations: [
        observation({ valuationDate: '2025-09-20', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' }),
        observation({
          valuationDate: '2026-09-20',
          total: 165,
          flow: 50,
          flowIntervalType: 'MULTI_DAY_GAP',
          flowEvents: [{
            economicAt: `${actualFlowDate}T03:00:00.000Z`,
            amountVnd: 50
          }]
        })
      ]
    });
    const expected = solveXirr([
      { dateKey: '2025-09-20', amount: -100 },
      { dateKey: actualFlowDate, amount: -50 },
      { dateKey: '2026-09-20', amount: 165 }
    ]);
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.reason, 'MISSING_DAILY_OBSERVATION');
    assert.equal(result.mwr.status, 'available');
    assert.ok(Math.abs(result.mwr.annualizedReturnPct - expected.annualizedReturnPct) < 1e-9);
  });

  test('the current Asia/Ho_Chi_Minh date stays outside completed performance history', () => {
    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-22T02:00:00.000Z'),
      observations: [
        observation({ valuationDate: '2026-09-20', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' }),
        observation({ valuationDate: '2026-09-21', total: 101 }),
        observation({ valuationDate: '2026-09-22', total: 999 })
      ]
    });
    assert.equal(result.period.endDate, '2026-09-21');
    assert.deepEqual(result.series.map((point) => point.date), ['2026-09-20', '2026-09-21']);
  });

  test('O: profile identity mismatch fails closed', () => {
    assert.throws(
      () => buildPortfolioDailyValuationObservation({
        profileId: PROFILE_ID,
        valuationDate: '2026-09-20',
        observedAt: '2026-09-20T16:45:00.000Z',
        snapshot: availableSnapshot({ profileId: OTHER_PROFILE_ID })
      }),
      /snapshot profile is inconsistent/
    );
  });

  test('P/Q: 23:45 Asia/Ho_Chi_Minh is due and UTC rollover resolves the correct local date', () => {
    assert.deepEqual(getDailyValuationSchedule(new Date('2026-09-20T16:45:00.000Z')), {
      dateKey: '2026-09-20',
      hour: 23,
      minute: 45,
      timeZone: 'Asia/Ho_Chi_Minh',
      due: true
    });
    assert.equal(getDailyValuationSchedule(new Date('2026-09-20T16:30:00.000Z')).due, false);
    assert.deepEqual(getPortfolioDailyValuationSchedule(new Date('2026-09-20T17:00:00.000Z')), {
      valuationDate: '2026-09-21',
      due: false
    });
  });

  test('T: a missing valuation day remains an explicit gap and cannot produce TWR or drawdown', () => {
    const result = calculatePortfolioPerformanceFromDailyValuations({
      range: '1W',
      now: new Date('2026-09-23T02:00:00.000Z'),
      observations: [
        observation({ valuationDate: '2026-09-20', total: 100, flow: null, flowStatus: 'NOT_APPLICABLE', flowIntervalType: 'FIRST_OBSERVATION' }),
        observation({ valuationDate: '2026-09-22', total: 110, flow: 0, flowIntervalType: 'MULTI_DAY_GAP' })
      ]
    });
    assert.equal(result.valuationCoverage.status, 'partial');
    assert.deepEqual(result.valuationCoverage.missingDates, ['2026-09-21']);
    assert.equal(result.twr.status, 'unavailable');
    assert.equal(result.twr.returnPct, null);
    assert.equal(result.drawdown.status, 'unavailable');
    assert.equal(result.drawdown.maxDrawdownPct, null);
  });

  test('U: repeated due scheduler invocation remains one captured row plus one replay', async () => {
    const stored = new Set();
    const captureProfileFn = async ({ profileId, now }) => {
      const date = getDailyValuationSchedule(now).dateKey;
      const key = `${profileId}:${date}`;
      const replayed = stored.has(key);
      stored.add(key);
      return { replayed };
    };
    const options = {
      now: new Date('2026-09-20T16:45:00.000Z'),
      client: {},
      listProfileIdsFn: async () => [PROFILE_ID],
      captureProfileFn
    };
    const first = await runScheduledPortfolioDailyValuationCapture(options);
    const second = await runScheduledPortfolioDailyValuationCapture(options);
    assert.equal(first.capturedCount, 1);
    assert.equal(second.replayedCount, 1);
    assert.equal(stored.size, 1);
  });

  test('multi-profile isolation ensures one profile failure does not halt or contaminate others', async () => {
    const executed = [];
    const options = {
      now: new Date('2026-09-20T16:45:00.000Z'),
      client: {},
      listProfileIdsFn: async () => [PROFILE_ID, OTHER_PROFILE_ID],
      captureProfileFn: async ({ profileId }) => {
        executed.push(profileId);
        if (profileId === PROFILE_ID) {
          throw new Error('Database connection failed for profile 1');
        }
        return { replayed: false };
      }
    };
    const summary = await runScheduledPortfolioDailyValuationCapture(options);
    assert.deepEqual(executed, [PROFILE_ID, OTHER_PROFILE_ID]);
    assert.equal(summary.capturedCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.profileCount, 2);
  });

  test('persistPortfolioDailyValuation propagates non-23505 database errors', async () => {
    const mockClient = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '42P01', message: 'relation does not exist' }
            })
          })
        })
      })
    };
    await assert.rejects(
      () => persistPortfolioDailyValuation({
        profileId: PROFILE_ID,
        valuationDate: '2026-09-20'
      }, mockClient),
      /Failed to persist portfolio daily valuation: relation does not exist/
    );
  });

  test('scheduler Worker calls the protected existing-infrastructure endpoint only when due', async () => {
    let calls = 0;
    const result = await runScheduledPortfolioDailyValuation(
      { ALERT_SCHEDULER_TOKEN: SCHEDULER_TOKEN },
      {
        now: new Date('2026-09-20T16:45:00.000Z'),
        fetchFn: async (url, options) => {
          calls += 1;
          assert.equal(url, `${APP_API_BASE_URL}/api/internal/portfolio/daily-valuations/capture`);
          assert.equal(options.headers.Authorization, `Bearer ${SCHEDULER_TOKEN}`);
          assert.equal(options.body, '{}');
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', data: { due: true, capturedCount: 1 } })
          };
        }
      }
    );
    assert.equal(calls, 1);
    assert.deepEqual(result, { due: true, capturedCount: 1 });

    const notDue = await runScheduledPortfolioDailyValuation({}, {
      now: new Date('2026-09-20T16:30:00.000Z'),
      fetchFn: async () => { throw new Error('must not fetch'); }
    });
    assert.deepEqual(notDue, { due: false, valuationDate: '2026-09-20' });
  });

  test('internal capture route requires the existing scheduler credential', async () => {
    let calls = 0;
    const baseUrl = await listen(createApp({
      alertSchedulerToken: SCHEDULER_TOKEN,
      runScheduledPortfolioDailyValuationCaptureFn: async () => {
        calls += 1;
        return { due: true, valuationDate: '2026-09-20', capturedCount: 1, replayedCount: 0, failedCount: 0 };
      }
    }));
    const path = `${baseUrl}/api/internal/portfolio/daily-valuations/capture`;
    const missing = await fetch(path, { method: 'POST' });
    assert.equal(missing.status, 401);
    const invalid = await fetch(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token-with-at-least-thirty-two-characters' }
    });
    assert.equal(invalid.status, 403);
    const valid = await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
    });
    assert.equal(valid.status, 200);
    assert.equal(calls, 1);
  });

  test('W: forward migration enforces uniqueness, RLS, service SELECT/INSERT, and immutable UPDATE/DELETE denial', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE TABLE public.investor_profile (id UUID PRIMARY KEY);
        INSERT INTO public.investor_profile (id) VALUES ('${PROFILE_ID}');
      `);
      await db.exec(await readFile(MIGRATION_URL, 'utf8'));
      const privileges = await db.query(`
        SELECT
          has_table_privilege('service_role', 'public.portfolio_daily_valuations', 'SELECT') AS can_select,
          has_table_privilege('service_role', 'public.portfolio_daily_valuations', 'INSERT') AS can_insert,
          has_table_privilege('service_role', 'public.portfolio_daily_valuations', 'UPDATE') AS can_update,
          has_table_privilege('service_role', 'public.portfolio_daily_valuations', 'DELETE') AS can_delete,
          has_table_privilege('anon', 'public.portfolio_daily_valuations', 'SELECT') AS anon_can_select,
          has_table_privilege('authenticated', 'public.portfolio_daily_valuations', 'SELECT') AS authenticated_can_select,
          c.relrowsecurity AS rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'portfolio_daily_valuations'
      `);
      assert.deepEqual(privileges.rows[0], {
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
        anon_can_select: false,
        authenticated_can_select: false,
        rls_enabled: true
      });

      await db.exec('SET ROLE anon');
      await assert.rejects(
        () => db.query('SELECT valuation_date FROM public.portfolio_daily_valuations'),
        /permission denied/i
      );
      await db.exec('RESET ROLE');
      await db.exec('SET ROLE authenticated');
      await assert.rejects(
        () => db.query('SELECT valuation_date FROM public.portfolio_daily_valuations'),
        /permission denied/i
      );
      await db.exec('RESET ROLE');

      const insertSql = `
        INSERT INTO public.portfolio_daily_valuations (
          profile_id, valuation_date, observed_at, snapshot_id, ledger_revision,
          status, cash_vnd, invested_market_value_vnd, total_portfolio_value_vnd,
          unrealized_pnl_vnd, total_holdings_count, valued_holdings_count,
          boundary_external_flow_vnd, flow_status, flow_interval_start,
          flow_interval_end, flow_interval_type, evidence_hash, observation_evidence
        ) VALUES (
          '${PROFILE_ID}', '2026-09-20', '2026-09-20T16:45:00Z', 'snapshot-1', 'ledger-1',
          'AVAILABLE', 0, 0, 0, 0, 0, 0,
          NULL, 'NOT_APPLICABLE', NULL, '2026-09-20T16:45:00Z',
          'FIRST_OBSERVATION', '${'a'.repeat(64)}', '{}'::jsonb
        )
      `;
      await db.exec(insertSql);
      await assert.rejects(() => db.exec(insertSql), /unique|duplicate/i);
      await db.exec('SET ROLE service_role');
      const serviceRows = await db.query('SELECT valuation_date FROM public.portfolio_daily_valuations');
      assert.equal(serviceRows.rows.length, 1);
      await db.exec(insertSql
        .replaceAll("'2026-09-20'", "'2026-09-21'")
        .replaceAll("'2026-09-20T16:45:00Z'", "'2026-09-21T16:45:00Z'")
        .replace("'snapshot-1'", "'snapshot-2'")
        .replace(`'${'a'.repeat(64)}'`, `'${'b'.repeat(64)}'`));
      await assert.rejects(
        () => db.exec("UPDATE public.portfolio_daily_valuations SET snapshot_id = 'changed'"),
        /permission denied/i
      );
      await assert.rejects(
        () => db.exec('DELETE FROM public.portfolio_daily_valuations'),
        /permission denied/i
      );
      await db.exec('RESET ROLE');
      await assert.rejects(
        () => db.exec("UPDATE public.portfolio_daily_valuations SET snapshot_id = 'changed'"),
        /immutable/i
      );
      await assert.rejects(
        () => db.exec('DELETE FROM public.portfolio_daily_valuations'),
        /immutable/i
      );
      const count = await db.query('SELECT COUNT(*)::INT AS count FROM public.portfolio_daily_valuations');
      assert.equal(count.rows[0].count, 2);
    } finally {
      await db.close();
    }
  });

  test('bounded retry recovers from transient provider failure before persistence', async () => {
    let attempts = 0;
    let persisted = null;
    const result = await capturePortfolioDailyValuationForProfile({
      profileId: PROFILE_ID,
      now: new Date('2026-09-20T16:45:00.000Z'),
      getExistingFn: async () => null,
      getPreviousFn: async () => null,
      getSnapshotFn: async () => {
        attempts += 1;
        return attempts === 1
          ? availableSnapshot({ status: 'PARTIAL' })
          : availableSnapshot({ status: 'AVAILABLE' });
      },
      getCashLedgerFn: async () => [],
      getTransactionsFn: async () => [],
      persistFn: async (obs) => {
        persisted = obs;
        return { observation: obs, replayed: false };
      },
      maxRetries: 2,
      retryDelayMs: 0
    });

    assert.equal(attempts, 2, 'Must retry once after initial PARTIAL');
    assert.equal(result.observation.status, 'AVAILABLE');
    assert.equal(persisted.status, 'AVAILABLE');
  });

  test('bounded retry exhausts attempts and persists truthful PARTIAL when failure persists', async () => {
    let attempts = 0;
    let persisted = null;
    const result = await capturePortfolioDailyValuationForProfile({
      profileId: PROFILE_ID,
      now: new Date('2026-09-20T16:45:00.000Z'),
      getExistingFn: async () => null,
      getPreviousFn: async () => null,
      getSnapshotFn: async () => {
        attempts += 1;
        return availableSnapshot({ status: 'PARTIAL' });
      },
      getCashLedgerFn: async () => [],
      getTransactionsFn: async () => [],
      persistFn: async (obs) => {
        persisted = obs;
        return { observation: obs, replayed: false };
      },
      maxRetries: 2,
      retryDelayMs: 0
    });

    assert.equal(attempts, 3, 'Must attempt 1 initial + 2 retries = 3 attempts total');
    assert.equal(result.observation.status, 'PARTIAL');
    assert.equal(persisted.status, 'PARTIAL');
  });

  test('bounded retry skips retries for cash-only profile or empty holdings', async () => {
    let attempts = 0;
    const result = await capturePortfolioDailyValuationForProfile({
      profileId: OTHER_PROFILE_ID,
      now: new Date('2026-09-20T16:45:00.000Z'),
      getExistingFn: async () => null,
      getPreviousFn: async () => null,
      getSnapshotFn: async () => {
        attempts += 1;
        return {
          profileId: OTHER_PROFILE_ID,
          snapshotId: 'snapshot-cash-only',
          ledgerRevision: 'rev-1',
          status: 'AVAILABLE',
          completeness: { unrealizedPnl: 'NOT_APPLICABLE' },
          cash: { value: 0, status: 'AVAILABLE' },
          investedMarketValue: 0,
          totalPortfolioValue: 0,
          unrealizedPnL: 0,
          holdings: [],
          sources: { prices: [], fx: [] }
        };
      },
      getCashLedgerFn: async () => [],
      getTransactionsFn: async () => [],
      persistFn: async (obs) => ({ observation: obs, replayed: false }),
      maxRetries: 2,
      retryDelayMs: 0
    });

    assert.equal(attempts, 1, 'Must not retry when holdings are empty');
    assert.equal(result.observation.status, 'AVAILABLE');
  });

  test('end-to-end scheduler recovery: attempt 0 transient CMC FX failure -> attempt 1 succeeds with bypassTransientFailureBackoff', async () => {
    let attempts = 0;
    const bypassFlags = [];
    const persistedRows = [];
    const observedAt = '2026-09-20T16:45:00.000Z';

    const result = await capturePortfolioDailyValuationForProfile({
      profileId: PROFILE_ID,
      now: new Date(observedAt),
      getExistingFn: async () => null,
      getPreviousFn: async () => null,
      getSnapshotFn: async ({ bypassTransientFailureBackoff }) => {
        attempts += 1;
        bypassFlags.push(bypassTransientFailureBackoff);
        if (attempts === 1) {
          return availableSnapshot({
            status: 'PARTIAL',
            sources: {
              prices: [{ assetId: 'crypto-1', symbol: 'ONDO', status: 'AVAILABLE' }],
              fx: [{ assetId: 'crypto-1', baseCurrency: 'USDT', quoteCurrency: 'VND', rate: null, status: 'UNAVAILABLE' }]
            }
          });
        }
        return availableSnapshot({
          status: 'AVAILABLE',
          sources: {
            prices: [{ assetId: 'crypto-1', symbol: 'ONDO', status: 'AVAILABLE' }],
            fx: [{ assetId: 'crypto-1', baseCurrency: 'USDT', quoteCurrency: 'VND', rate: 26_000, status: 'AVAILABLE' }]
          }
        });
      },
      getCashLedgerFn: async () => [],
      getTransactionsFn: async () => [],
      persistFn: async (obs) => {
        persistedRows.push(obs);
        return { observation: obs, replayed: false };
      },
      maxRetries: 2,
      retryDelayMs: 0
    });

    assert.equal(attempts, 2, 'Must recover on attempt 1');
    assert.equal(bypassFlags[0], undefined, 'Attempt 0 must not bypass transient failure backoff');
    assert.equal(bypassFlags[1], true, 'Attempt 1 must pass bypassTransientFailureBackoff: true');
    assert.equal(persistedRows.length, 1, 'Exactly one row persisted');
    assert.equal(persistedRows[0].status, 'AVAILABLE');
    assert.equal(result.observation.status, 'AVAILABLE');
    assert.equal(result.observation.observedAt, observedAt);
    assert.equal(result.observation.valuationDate, '2026-09-20');
  });

  test('end-to-end scheduler: CMC 429 rate limit across all bounded attempts persists PARTIAL without hammering', async () => {
    let attempts = 0;
    const bypassFlags = [];
    const persistedRows = [];
    const observedAt = '2026-09-20T16:45:00.000Z';

    const result = await capturePortfolioDailyValuationForProfile({
      profileId: PROFILE_ID,
      now: new Date(observedAt),
      getExistingFn: async () => null,
      getPreviousFn: async () => null,
      getSnapshotFn: async ({ bypassTransientFailureBackoff }) => {
        attempts += 1;
        bypassFlags.push(bypassTransientFailureBackoff);
        return availableSnapshot({
          status: 'PARTIAL',
          sources: {
            prices: [{ assetId: 'crypto-1', symbol: 'ONDO', status: 'AVAILABLE' }],
            fx: [{ assetId: 'crypto-1', baseCurrency: 'USDT', quoteCurrency: 'VND', rate: null, status: 'UNAVAILABLE' }]
          }
        });
      },
      getCashLedgerFn: async () => [],
      getTransactionsFn: async () => [],
      persistFn: async (obs) => {
        persistedRows.push(obs);
        return { observation: obs, replayed: false };
      },
      maxRetries: 2,
      retryDelayMs: 0
    });

    assert.equal(attempts, 3, 'Must exhaust all 3 attempts (1 initial + 2 retries)');
    assert.equal(bypassFlags[0], undefined);
    assert.equal(bypassFlags[1], true);
    assert.equal(bypassFlags[2], true);
    assert.equal(persistedRows.length, 1, 'Exactly one row persisted');
    assert.equal(persistedRows[0].status, 'PARTIAL');
    assert.equal(result.observation.status, 'PARTIAL');
    assert.equal(result.observation.observedAt, observedAt);
    assert.equal(result.observation.valuationDate, '2026-09-20');
  });
});
