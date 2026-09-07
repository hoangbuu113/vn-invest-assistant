import test from 'node:test';
import assert from 'node:assert/strict';

import { assessConfidence } from '../src/ai/confidenceEngine.js';
import { CONFIDENCE_TARGET_TYPES } from '../src/ai/confidenceModel.js';
import { PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1 } from '../src/ai/confidenceProfiles.js';
import { ContextCache } from '../src/context/cache.js';
import { getMarketContextFabric, groupObservationsByPillar } from '../src/context/fabric.js';
import { createMarketObservation, PILLARS } from '../src/context/factModel.js';
import { observationToRow } from '../src/context/repository.js';

const CACHE_CONFIG = Object.freeze(Object.fromEntries(
  ['macro', 'monetary', 'market', 'intermarket'].map((pillar) => [
    pillar,
    { freshTtlMs: 15 * 60 * 1000, staleTtlMs: 7 * 24 * 60 * 60 * 1000 }
  ])
));

const FRIDAY_FETCHED_AT = '2026-09-04T08:05:00.000Z';
const MONDAY_FETCHED_AT = '2026-09-07T08:05:00.000Z';
const MONDAY_READ_AT = new Date('2026-09-07T13:00:00.000Z');

function contextFacts({ marketDate, fetchedAt, vnIndex }) {
  const observedAt = `${marketDate}T08:00:00.000Z`;
  return [
    createMarketObservation({
      factId: 'vn.macro.cpi.yoy',
      pillar: PILLARS.MACRO,
      label: 'CPI YoY',
      value: 4.89,
      unit: '%',
      referenceTime: '2026-08',
      observedAt: '2026-09-03T02:00:00.000Z',
      publishedAt: '2026-09-03T02:00:00.000Z',
      fetchedAt,
      source: 'NSO_VIETNAM',
      authorityLevel: 'PRIMARY_OFFICIAL'
    }),
    createMarketObservation({
      factId: 'vn.monetary.fx.usd_vnd',
      pillar: PILLARS.MONETARY,
      label: 'USD/VND',
      value: 26350,
      unit: 'VND per USD',
      referenceTime: marketDate,
      observedAt,
      publishedAt: observedAt,
      fetchedAt,
      source: 'MARKET_REFERENCE',
      authorityLevel: 'MARKET_REFERENCE'
    }),
    ...[
      ['vn.market.vnindex.close', 'VN-Index', vnIndex],
      ['vn.market.vn30.close', 'VN30', 1963.01],
      ['vn.market.hnx.close', 'HNX-Index', 280.60]
    ].map(([factId, label, value]) => createMarketObservation({
      factId,
      pillar: PILLARS.MARKET,
      label,
      value,
      unit: 'points',
      referenceTime: marketDate,
      observedAt,
      publishedAt: observedAt,
      fetchedAt,
      source: 'VNDIRECT',
      authorityLevel: 'MARKET_DIRECT'
    })),
    createMarketObservation({
      factId: 'global.intermarket.dxy.quote',
      pillar: PILLARS.INTERMARKET,
      label: 'DXY',
      value: 98.25,
      unit: 'index points',
      referenceTime: marketDate,
      observedAt,
      publishedAt: observedAt,
      fetchedAt,
      source: 'YAHOO',
      authorityLevel: 'MARKET_REFERENCE'
    })
  ];
}

function seedCache(cache, facts, cachedAt) {
  const pillars = groupObservationsByPillar(facts);
  for (const pillar of ['macro', 'monetary', 'market', 'intermarket']) {
    cache.set(pillar, pillars[pillar], cachedAt);
  }
}

function createReadClient({ observations = [], error = null } = {}) {
  let readCount = 0;
  const rows = observations.map(observationToRow);
  const client = {
    from(table) {
      assert.equal(table, 'market_context_observations');
      readCount += 1;
      return {
        select() {
          const query = {
            order() {
              return query;
            },
            then(resolve) {
              return resolve({ data: error ? null : rows, error });
            }
          };
          return query;
        }
      };
    }
  };
  return { client, get readCount() { return readCount; } };
}

test('stale L1 re-reads persistence, exposes an external durable update, and refreshes memory', async () => {
  const cache = new ContextCache(CACHE_CONFIG);
  seedCache(cache, contextFacts({
    marketDate: '2026-09-04',
    fetchedAt: FRIDAY_FETCHED_AT,
    vnIndex: 1853.08
  }), new Date(FRIDAY_FETCHED_AT));

  const durableFacts = contextFacts({
    marketDate: '2026-09-07',
    fetchedAt: MONDAY_FETCHED_AT,
    vnIndex: 1821.64
  });
  const db = createReadClient({ observations: durableFacts });
  const fabric = await getMarketContextFabric({ client: db.client, now: MONDAY_READ_AT, cache });

  assert.equal(db.readCount, 1);
  assert.equal(fabric.source, 'durable_persistence');
  assert.equal(fabric.pillars.market.find((fact) => fact.factId === 'vn.market.vnindex.close')?.value, 1821.64);
  assert.ok(fabric.pillars.market.every((fact) => fact.referenceTime === '2026-09-07'));

  const refreshedMarket = cache.get('market', MONDAY_READ_AT);
  assert.equal(refreshedMarket.cacheStatus, 'fresh');
  assert.equal(refreshedMarket.data.find((fact) => fact.factId === 'vn.market.vnindex.close')?.value, 1821.64);

  const evidence = fabric.facts.map((fact) => ({
    ...fact,
    sourceAvailableAt: fact.publishedAt || fact.observedAt,
    firstSeenAt: fact.fetchedAt
  }));
  const assessment = assessConfidence({
    targetType: CONFIDENCE_TARGET_TYPES.MARKET_STRATEGY,
    targetId: 'strategy:context-read-authority',
    scope: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1.scope,
    horizon: 'medium',
    cutoff: MONDAY_READ_AT.toISOString(),
    asOf: MONDAY_READ_AT.toISOString(),
    evidence,
    profile: PROFILE_MARKET_STRATEGY_VN_MEDIUM_HORIZON_V1,
    calibrationManifests: [],
    analyticReview: null
  });
  assert.equal(
    assessment.gateResults.find((gate) => gate.requirementId === 'REQ_VN_MARKET_STATE')?.passed,
    true,
    'confidence reconstruction must use the refreshed durable market evidence'
  );
});

test('stale L1 is retained only as explicit LKG when the durable read fails', async () => {
  const cache = new ContextCache(CACHE_CONFIG);
  seedCache(cache, contextFacts({
    marketDate: '2026-09-04',
    fetchedAt: FRIDAY_FETCHED_AT,
    vnIndex: 1853.08
  }), new Date(FRIDAY_FETCHED_AT));
  const db = createReadClient({ error: { code: 'DB_UNAVAILABLE', message: 'simulated read failure' } });

  const fabric = await getMarketContextFabric({ client: db.client, now: MONDAY_READ_AT, cache });

  assert.equal(db.readCount, 1);
  assert.equal(fabric.source, 'memory_cache_stale_fallback');
  assert.equal(fabric.cacheStatus, 'stale');
  assert.equal(fabric.persistenceStatus, 'failed');
  assert.equal(fabric.pillars.market[0].referenceTime, '2026-09-04');
  assert.equal(fabric.pillars.market[0].freshness, 'stale');
  assert.equal(fabric.pillars.market[0].status, 'stale');
});

test('complete fresh L1 remains the fast path with no persistence read', async () => {
  const cache = new ContextCache(CACHE_CONFIG);
  const freshAt = new Date('2026-09-07T08:06:00.000Z');
  seedCache(cache, contextFacts({
    marketDate: '2026-09-07',
    fetchedAt: MONDAY_FETCHED_AT,
    vnIndex: 1821.64
  }), freshAt);
  const db = createReadClient({ error: { code: 'MUST_NOT_READ', message: 'fresh cache should win' } });

  const fabric = await getMarketContextFabric({
    client: db.client,
    now: new Date('2026-09-07T08:10:00.000Z'),
    cache
  });

  assert.equal(db.readCount, 0);
  assert.equal(fabric.source, 'memory_cache');
  assert.equal(fabric.cacheStatus, 'fresh');
  assert.equal(fabric.pillars.market[0].referenceTime, '2026-09-07');
});
