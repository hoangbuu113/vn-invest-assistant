import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../index.js';
import {
  runMarketContextCollector,
  VN_MARKET_REFRESH_STATUS
} from '../src/context/collector.js';
import { createMarketObservation, PILLARS } from '../src/context/factModel.js';
import {
  clearPersistenceStore,
  fetchLatestPersistedObservations,
  persistMarketObservations
} from '../src/context/repository.js';
import { VIETNAM_INDICES } from '../src/context/providers/vndirectMarket.js';
import { assessConfidence } from '../src/ai/confidenceEngine.js';
import {
  CONFIDENCE_TARGET_TYPES
} from '../src/ai/confidenceModel.js';
import { PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1 } from '../src/ai/confidenceProfiles.js';

const MONDAY_AFTER_GRACE = new Date('2026-09-07T13:00:00.000Z');
const SCHEDULER_TOKEN = 'context-refresh-reliability-token-32chars';

function marketCloses(referenceTime, fetchedAt = MONDAY_AFTER_GRACE.toISOString()) {
  return VIETNAM_INDICES.map((definition, index) => createMarketObservation({
    id: definition.id,
    factId: definition.factId,
    pillar: PILLARS.MARKET,
    label: definition.label,
    metric: definition.metric,
    value: 1800 + index,
    unit: 'points',
    referenceTime,
    observedAt: `${referenceTime}T08:00:00.000Z`,
    fetchedAt,
    source: 'VNDIRECT',
    authorityLevel: 'MARKET_DIRECT',
    status: 'available'
  }));
}

function createDb({ failObservationWrites = false } = {}) {
  const observations = new Map();
  const checkpoints = new Map();
  const client = {
    from(table) {
      if (table === 'market_context_observations') {
        return {
          upsert(rows) {
            const list = Array.isArray(rows) ? rows : [rows];
            if (!failObservationWrites) {
              for (const row of list) observations.set(row.observation_id, { ...row });
            }
            return {
              select: async () => failObservationWrites
                ? ({ data: null, error: { code: 'DB_WRITE_FAILED', message: 'simulated observation write failure' } })
                : ({ data: list.map((row) => ({ ...row })), error: null })
            };
          },
          select() {
            const query = {
              order: () => query,
              then: (resolve) => resolve({ data: [...observations.values()], error: null })
            };
            return query;
          }
        };
      }
      if (table === 'market_context_collector_checkpoints') {
        return {
          upsert(row) {
            checkpoints.set(row.source_key, { ...row });
            return {
              select: async () => ({ data: [{ ...row }], error: null })
            };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
  return { client, observations, checkpoints };
}

async function runCollector({ db, market, global = [], recordHealth = true }) {
  return runMarketContextCollector({
    now: MONDAY_AFTER_GRACE,
    client: db.client,
    forceRefresh: true,
    recordHealth,
    fetchLatestPersistedObservationsFn: async () => [],
    fetchNsoInflationFn: async () => null,
    fetchSbvMoneyMarketFn: async () => null,
    fetchUsdVndFn: async () => null,
    fetchMarketPillarFn: async () => {
      if (market instanceof Error) throw market;
      return market;
    },
    fetchGlobalPillarFn: async () => {
      if (global instanceof Error) throw global;
      return global;
    }
  });
}

test('A/F: Monday completed closes durably supersede Friday and satisfy REQ_VN_MARKET_STATE', async () => {
  const db = createDb();
  await persistMarketObservations(marketCloses('2026-09-04'), db.client);

  const monday = marketCloses('2026-09-07');
  const summary = await runCollector({ db, market: monday, global: new Error('optional global provider failed') });

  assert.equal(summary.success, true);
  assert.equal(summary.marketRefresh.status, VN_MARKET_REFRESH_STATUS.SUCCESS);
  assert.equal(summary.marketRefresh.referenceTime, '2026-09-07');
  assert.deepEqual(new Set(summary.marketRefresh.persistedFactIds), new Set(VIETNAM_INDICES.map((item) => item.factId)));
  assert.equal([...db.observations.values()].filter((row) => row.reference_time === '2026-09-07').length, 3);

  const cpi = createMarketObservation({
    factId: 'vn.macro.cpi.yoy',
    pillar: PILLARS.MACRO,
    label: 'CPI YoY',
    value: 4.89,
    unit: '%',
    referenceTime: '2026-08',
    observedAt: '2026-09-03T02:00:00.000Z',
    fetchedAt: '2026-09-03T02:05:00.000Z',
    authorityLevel: 'PRIMARY_OFFICIAL'
  });
  const persistedCurrent = await fetchLatestPersistedObservations(db.client, MONDAY_AFTER_GRACE);
  const persistedMarket = persistedCurrent.filter((item) => item.pillar === PILLARS.MARKET);
  assert.equal(persistedMarket.length, 3);
  assert.ok(persistedMarket.every((item) => item.referenceTime === '2026-09-07'));

  const evidence = [...persistedMarket, cpi].map((item) => ({
    ...item,
    sourceAvailableAt: item.observedAt,
    firstSeenAt: item.fetchedAt
  }));
  const assessment = assessConfidence({
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    targetId: 'strategy:market-refresh-test',
    scope: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.scope,
    horizon: 'medium',
    cutoff: MONDAY_AFTER_GRACE.toISOString(),
    asOf: MONDAY_AFTER_GRACE.toISOString(),
    evidence,
    profile: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
    calibrationManifests: [],
    analyticReview: null
  });
  assert.equal(assessment.gateResults.find((gate) => gate.requirementId === 'REQ_VN_MARKET_STATE').passed, true);
});

test('C: rejected VN provider records a failed market refresh even when another fact persists', async () => {
  const db = createDb();
  const optionalFact = createMarketObservation({
    factId: 'global.intermarket.dxy.quote',
    pillar: PILLARS.INTERMARKET,
    label: 'DXY',
    value: 98.5,
    referenceTime: '2026-09-07',
    observedAt: '2026-09-07T12:00:00.000Z'
  });
  const summary = await runCollector({ db, market: new Error('VNDirect unavailable'), global: [optionalFact] });

  assert.equal(summary.isDurable, true, 'the unrelated fact was durably persisted');
  assert.equal(summary.success, false, 'unrelated persistence cannot mask the required market failure');
  assert.equal(summary.marketRefresh.status, VN_MARKET_REFRESH_STATUS.FAILED);
  assert.equal(summary.marketRefresh.errorCode, 'VN_MARKET_PROVIDER_INCOMPLETE');
  assert.equal(db.checkpoints.get('vn_market_context_collector').metadata.healthState, 'FAILED');
});

test('D: optional global provider failure cannot discard valid VN market observations', async () => {
  const db = createDb();
  const summary = await runCollector({
    db,
    market: marketCloses('2026-09-07'),
    global: new Error('DXY provider unavailable')
  });

  assert.equal(summary.success, true);
  assert.equal(summary.marketRefresh.status, VN_MARKET_REFRESH_STATUS.SUCCESS);
  assert.equal([...db.observations.values()].filter((row) => row.pillar === PILLARS.MARKET).length, 3);
});

test('E: failed VN market persistence cannot produce a successful checkpoint', async () => {
  clearPersistenceStore();
  const db = createDb({ failObservationWrites: true });
  const summary = await runCollector({ db, market: marketCloses('2026-09-07') });

  assert.equal(summary.success, false);
  assert.equal(summary.marketRefresh.errorCode, 'VN_MARKET_PERSISTENCE_FAILED');
  assert.deepEqual(new Set(summary.marketRefresh.persistenceMissingFactIds), new Set(VIETNAM_INDICES.map((item) => item.factId)));
  assert.notEqual(db.checkpoints.get('vn_market_context_collector').metadata.healthState, 'HEALTHY');
  assert.deepEqual(await fetchLatestPersistedObservations(null, MONDAY_AFTER_GRACE), [], 'failed production writes must not seed offline memory');
});

test('G: Friday closes remain stale after governed Monday expiry when no new session arrives', async () => {
  const db = createDb();
  const summary = await runCollector({ db, market: marketCloses('2026-09-04') });

  assert.equal(summary.success, false);
  assert.equal(summary.marketRefresh.status, VN_MARKET_REFRESH_STATUS.FAILED);
  assert.equal(summary.marketRefresh.errorCode, 'VN_MARKET_SESSION_INCOMPLETE');
  assert.deepEqual(new Set(summary.marketRefresh.staleFactIds), new Set(VIETNAM_INDICES.map((item) => item.factId)));
});

test('route returns 503 when unrelated rows persisted but required market refresh did not complete', async () => {
  const app = createApp({
    alertSchedulerToken: SCHEDULER_TOKEN,
    runMarketContextCollectorFn: async () => ({
      success: false,
      isDurable: true,
      failedPersistence: 0,
      durablyPersisted: 1,
      marketRefresh: { status: VN_MARKET_REFRESH_STATUS.FAILED, errorCode: 'VN_MARKET_PROVIDER_INCOMPLETE' }
    })
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/context/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
    });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
