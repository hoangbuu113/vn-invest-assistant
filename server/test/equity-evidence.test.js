import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../index.js';
import { resolveEvidenceAvailabilityTime } from '../src/replay/availability.js';
import { buildHistoricalEvidencePacket } from '../src/replay/historicalReplay.js';
import {
  buildEquityEvidenceResponse,
  createEquityEvidence,
  createUnavailableEquityEvidence,
  EQUITY_EVIDENCE_STATUS,
  EQUITY_EVIDENCE_TYPES,
  getVietnamEquityEvidence,
  selectLatestEquityEvidence,
  toReplayCompatibleEquityObservation
} from '../src/equities/index.js';
import {
  clearEquityEvidenceMemory,
  equityEvidenceToRow,
  fetchEquityEvidenceVintages,
  persistEquityEvidence
} from '../src/equities/repository.js';
import {
  buildMarketEvidenceFromHistory,
  runVietnamEquityEvidenceCollector
} from '../src/equities/collector.js';
import {
  clearDataHealthMemoryStore,
  getSystemDataHealth,
  HEALTH_STATES,
  OBSERVED_JOBS
} from '../src/observability/dataHealth.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  testDir,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260906020000_create_vn_equity_evidence.sql'
);
const schemaPath = path.resolve(testDir, '..', 'db', 'schema.sql');

const fpt = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  symbol: 'FPT',
  name: 'Công ty Cổ phần FPT',
  assetType: 'stock',
  asset_type: 'stock',
  exchange: 'HOSE',
  marketCode: 'HOSE',
  quoteCurrency: 'VND',
  marketPolicy: 'VN_EXCHANGE',
  marketTimezone: 'Asia/Ho_Chi_Minh',
  isActive: true
});

function evidence(overrides = {}) {
  return createEquityEvidence({
    assetId: fpt.id,
    symbol: fpt.symbol,
    exchange: fpt.exchange,
    companyName: fpt.name,
    evidenceType: EQUITY_EVIDENCE_TYPES.MARKET_PRICE,
    metric: 'close',
    numericValue: 123456.75,
    unit: 'VND',
    currency: 'VND',
    referencePeriod: '2026-09-04',
    observedAt: '2026-09-04T08:00:00.000Z',
    sourceAvailableAt: '2026-09-04T08:00:00.000Z',
    fetchedAt: '2026-09-04T08:05:00.000Z',
    firstSeenAt: '2026-09-04T08:05:00.000Z',
    sourceId: 'yahoo',
    sourceName: 'Yahoo Finance',
    sourceFamily: 'MARKET_DATA',
    dependencyGroup: 'MARKET_DATA',
    authorityLevel: 'MARKET_REFERENCE',
    provenance: {
      provider: 'yahoo',
      marketTimezone: 'Asia/Ho_Chi_Minh',
      completionSemantics: 'completed_daily_bar'
    },
    freshness: 'delayed',
    ...overrides
  });
}

function createEvidenceDb(initialRows = []) {
  const equityRows = new Map(initialRows.map((row) => [row.observation_id, { ...row }]));
  const checkpointRows = new Map();
  const calls = [];

  return {
    equityRows,
    checkpointRows,
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      if (table === 'vn_equity_evidence_observations') {
        return {
          upsert(rows, options) {
            calls.push({ operation: 'upsert', table, options });
            const list = Array.isArray(rows) ? rows : [rows];
            for (const row of list) {
              if (!equityRows.has(row.observation_id)) equityRows.set(row.observation_id, { ...row });
            }
            return {
              select: async () => ({ data: list.map((row) => equityRows.get(row.observation_id)), error: null })
            };
          },
          select() {
            calls.push({ operation: 'select', table });
            const query = {
              symbol: null,
              eq(field, value) {
                if (field === 'symbol') this.symbol = value;
                return this;
              },
              order() { return this; },
              then(resolve) {
                const rows = Array.from(equityRows.values())
                  .filter((row) => !this.symbol || row.symbol === this.symbol);
                return Promise.resolve({ data: rows, error: null }).then(resolve);
              }
            };
            return query;
          }
        };
      }
      if (table === 'market_context_collector_checkpoints') {
        return {
          upsert(row) {
            checkpointRows.set(row.source_key, { ...row });
            return { select: async () => ({ data: [{ ...row }], error: null }) };
          },
          select: async () => ({ data: Array.from(checkpointRows.values()), error: null })
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
}

test('1. canonical equity fact preserves identity, source provenance, and replay-safe timestamps', () => {
  const item = evidence();
  assert.equal(item.symbol, 'FPT');
  assert.equal(item.exchange, 'HOSE');
  assert.equal(item.companyName, fpt.name);
  assert.equal(item.numericValue, 123456.75);
  assert.equal(item.sourceId, 'yahoo');
  assert.equal(item.sourceFamily, 'MARKET_DATA');
  assert.equal(item.dependencyGroup, 'MARKET_DATA');
  assert.equal(item.provenance.completionSemantics, 'completed_daily_bar');
  assert.equal(item.systemKnowableAt, '2026-09-04T08:05:00.000Z');

  const replay = resolveEvidenceAvailabilityTime(item);
  assert.equal(replay.replaySafe, true);
  assert.equal(replay.availabilityTime, item.systemKnowableAt);
});

test('2. unavailable source field remains null and is never normalized to zero', () => {
  const item = createUnavailableEquityEvidence({
    ...evidence(),
    factId: undefined,
    observationId: undefined,
    sourceContentHash: undefined,
    metric: 'volume',
    statusReason: 'SOURCE_FIELD_MISSING'
  });
  assert.equal(item.status, EQUITY_EVIDENCE_STATUS.UNAVAILABLE);
  assert.equal(item.numericValue, null);
  assert.equal(item.textValue, null);
  assert.equal(item.statusReason, 'SOURCE_FIELD_MISSING');
});

test('3. deterministic duplicate identity preserves one vintage despite later ingestion time', async () => {
  clearEquityEvidenceMemory();
  const first = evidence();
  const repeated = evidence({
    fetchedAt: '2026-09-04T09:00:00.000Z',
    firstSeenAt: '2026-09-04T09:00:00.000Z'
  });
  assert.equal(first.observationId, repeated.observationId);
  await persistEquityEvidence([first, repeated], null);
  const rows = await fetchEquityEvidenceVintages('FPT', null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstSeenAt, first.firstSeenAt);
});

test('3A. failed durable persistence does not seed process memory with uncommitted evidence', async () => {
  clearEquityEvidenceMemory();
  const failingDb = {
    from() {
      return {
        upsert() {
          return {
            select: async () => ({
              data: null,
              error: { code: 'PGRST000', message: 'Persistence unavailable' }
            })
          };
        }
      };
    }
  };
  const result = await persistEquityEvidence([evidence()], failingDb);
  assert.equal(result.isDurable, false);
  assert.equal(result.failedPersistence, 1);
  assert.deepEqual(await fetchEquityEvidenceVintages('FPT', null), []);
});

test('4. same-period correction creates a new vintage while a new period remains chronologically authoritative', () => {
  const original = evidence();
  const correction = evidence({
    numericValue: 123500.25,
    fetchedAt: '2026-09-05T10:00:00.000Z',
    firstSeenAt: '2026-09-05T10:00:00.000Z',
    revisionMarker: 'provider_correction_1'
  });
  const nextPeriod = evidence({
    numericValue: 124000,
    referencePeriod: '2026-09-07',
    observedAt: '2026-09-07T08:00:00.000Z',
    sourceAvailableAt: '2026-09-07T08:00:00.000Z',
    fetchedAt: '2026-09-07T08:05:00.000Z',
    firstSeenAt: '2026-09-07T08:05:00.000Z'
  });
  assert.notEqual(original.observationId, correction.observationId);
  assert.notEqual(correction.observationId, nextPeriod.observationId);
  const latest = selectLatestEquityEvidence([correction, original, nextPeriod]);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].referencePeriod, '2026-09-07');
  assert.equal(latest[0].numericValue, 124000);
});

test('5. completed history produces genuine OHLCV facts and omits missing volume instead of zero', () => {
  const facts = buildMarketEvidenceFromHistory(fpt, {
    provider: 'yahoo',
    marketPolicy: 'VN_EXCHANGE',
    marketTimezone: 'Asia/Ho_Chi_Minh',
    bars: [{
      date: '2026-09-04',
      timestamp: '2026-09-04T08:00:00.000Z',
      open: 120000,
      high: 125000,
      low: 119000,
      close: 123456.75,
      volume: null,
      isComplete: true
    }]
  }, { now: new Date('2026-09-04T09:00:00.000Z') });
  assert.deepEqual(facts.map((item) => item.metric), ['open', 'high', 'low', 'close']);
  assert.equal(facts.some((item) => item.metric === 'volume'), false);
  assert.equal(facts.some((item) => item.numericValue === 0), false);
});

test('5A. 01D replay excludes an equity vintage before firstSeenAt and includes it afterward', () => {
  const replayObservation = toReplayCompatibleEquityObservation(evidence());
  const before = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T08:04:59.999Z',
    observations: [replayObservation],
    includeDerived: false
  });
  const after = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T08:06:00.000Z',
    observations: [replayObservation],
    includeDerived: false
  });
  assert.equal(before.observations.length, 0);
  assert.equal(after.observations.length, 1);
  assert.equal(after.observations[0].observationId, replayObservation.observationId);
  assert.equal(after.observations[0].value, 123456.75);
});

test('5B. 01D replay uses later sourceAvailableAt when it follows firstSeenAt', () => {
  const item = evidence({
    sourceAvailableAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-04T09:00:00.000Z',
    firstSeenAt: '2026-09-04T09:00:00.000Z'
  });
  const replayObservation = toReplayCompatibleEquityObservation(item);
  const availability = resolveEvidenceAvailabilityTime(replayObservation);
  assert.equal(item.systemKnowableAt, '2026-09-04T10:00:00.000Z');
  assert.equal(availability.sourceField, 'sourceAvailableAt');
  assert.equal(availability.systemField, 'firstSeenAt');
  assert.equal(availability.availabilityTime, '2026-09-04T10:00:00.000Z');

  const beforeSourceAvailability = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T09:59:59.999Z',
    observations: [replayObservation],
    includeDerived: false
  });
  const atSourceAvailability = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T10:00:00.000Z',
    observations: [replayObservation],
    includeDerived: false
  });
  assert.equal(beforeSourceAvailability.observations.length, 0);
  assert.equal(atSourceAvailability.observations.length, 1);
});

test('5C. 01D replay uses later firstSeenAt when it follows sourceAvailableAt', () => {
  const replayObservation = toReplayCompatibleEquityObservation(evidence({
    sourceAvailableAt: '2026-09-04T09:00:00.000Z',
    fetchedAt: '2026-09-04T10:00:00.000Z',
    firstSeenAt: '2026-09-04T10:00:00.000Z'
  }));
  const availability = resolveEvidenceAvailabilityTime(replayObservation);
  assert.equal(availability.availabilityTime, '2026-09-04T10:00:00.000Z');
});

test('5D. stored or caller-supplied systemKnowableAt is never replay authority', () => {
  const canonical = toReplayCompatibleEquityObservation(evidence({
    sourceAvailableAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-04T09:00:00.000Z',
    firstSeenAt: '2026-09-04T09:00:00.000Z'
  }));
  const tampered = {
    ...canonical,
    systemKnowableAt: '2026-09-04T07:00:00.000Z',
    assumeInstantIngestion: true
  };
  const availability = resolveEvidenceAvailabilityTime(tampered);
  assert.equal(availability.availabilityTime, '2026-09-04T10:00:00.000Z');

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T09:30:00.000Z',
    observations: [tampered],
    includeDerived: false
  });
  assert.equal(packet.observations.length, 0);
});

test('5E. earlier publication timestamp cannot bypass trusted equity availability', () => {
  const replayObservation = toReplayCompatibleEquityObservation(evidence({
    publishedAt: '2026-09-04T08:00:00.000Z',
    sourceAvailableAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-04T09:00:00.000Z',
    firstSeenAt: '2026-09-04T09:00:00.000Z'
  }));
  const availability = resolveEvidenceAvailabilityTime(replayObservation);
  assert.equal(availability.articlePublishedAt, '2026-09-04T08:00:00.000Z');
  assert.equal(availability.availabilityTime, '2026-09-04T10:00:00.000Z');

  const packet = buildHistoricalEvidencePacket({
    asOf: '2026-09-04T09:30:00.000Z',
    observations: [replayObservation],
    includeDerived: false
  });
  assert.equal(packet.observations.length, 0);
});

test('6. provider failure retains last-known-good evidence and records a failed refresh', async () => {
  clearEquityEvidenceMemory();
  clearDataHealthMemoryStore();
  const prior = evidence();
  await persistEquityEvidence([prior], null);

  const summary = await runVietnamEquityEvidenceCollector({
    now: new Date('2026-09-05T09:00:00.000Z'),
    client: null,
    getAssetsFn: async () => [fpt],
    getMarketHistoryFn: async () => {
      const error = new Error('Yahoo unavailable');
      error.code = 'PROVIDER_ERROR';
      throw error;
    }
  });
  assert.equal(summary.success, false);
  assert.equal(summary.evidenceCount, 0);
  const retained = await fetchEquityEvidenceVintages('FPT', null);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].observationId, prior.observationId);

  const health = await getSystemDataHealth({ client: null, now: new Date('2026-09-05T09:01:00.000Z') });
  const job = health.jobs.find((item) => item.jobName === OBSERVED_JOBS.VN_EQUITY_EVIDENCE_REFRESH);
  assert.equal(job.status, HEALTH_STATES.FAILED);
});

test('7. successful collector excludes ETFs, persists completed stock facts, and records durable health', async () => {
  clearDataHealthMemoryStore();
  const db = createEvidenceDb();
  const etf = { ...fpt, id: '22222222-2222-4222-8222-222222222222', symbol: 'E1VFVN30', assetType: 'etf', asset_type: 'etf' };
  let historyCalls = 0;
  const summary = await runVietnamEquityEvidenceCollector({
    now: new Date('2026-09-05T09:00:00.000Z'),
    client: db,
    getAssetsFn: async () => [fpt, etf],
    getMarketHistoryFn: async (symbol, range) => {
      historyCalls++;
      assert.equal(symbol, 'FPT');
      assert.equal(range, '1M');
      return {
        provider: 'yahoo',
        marketPolicy: 'VN_EXCHANGE',
        marketTimezone: 'Asia/Ho_Chi_Minh',
        bars: [
          { date: '2026-09-03', timestamp: '2026-09-03T08:00:00.000Z', open: 1, high: 2, low: 1, close: 2, volume: 10, isComplete: true },
          { date: '2026-09-04', timestamp: '2026-09-04T08:00:00.000Z', open: 2, high: 3, low: 2, close: 3, volume: null, isComplete: true }
        ]
      };
    }
  });
  assert.equal(historyCalls, 1);
  assert.equal(summary.success, true);
  assert.equal(summary.status, HEALTH_STATES.HEALTHY);
  assert.equal(summary.stockCount, 1);
  assert.equal(summary.evidenceCount, 9);
  assert.equal(summary.isDurable, true);
  assert.equal(db.equityRows.size, 9);
  assert.equal(db.checkpointRows.get(OBSERVED_JOBS.VN_EQUITY_EVIDENCE_REFRESH).status, 'success');
});

test('8. public evidence API reads persistence only and returns honest partial capabilities', async () => {
  const close = evidence();
  const db = createEvidenceDb([equityEvidenceToRow(close)]);
  let marketProviderCalls = 0;
  const app = createApp({
    supabaseAuthClient: db,
    getAssetBySymbolFn: async () => fpt,
    getMarketHistoryFn: async () => {
      marketProviderCalls++;
      throw new Error('Public evidence endpoint must not call a provider');
    }
  });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/equities/FPT/evidence`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.data.asset.symbol, 'FPT');
    assert.equal(body.data.domains.marketPrice.facts[0].numericValue, 123456.75);
    assert.equal(body.data.domains.fundamentals.reason, 'SOURCE_NOT_PROVISIONED');
    assert.equal(body.data.domains.disclosures.reason, 'SOURCE_NOT_PROVISIONED');
    assert.equal(marketProviderCalls, 0);
    assert.equal(db.calls.some((call) => call.operation === 'upsert'), false);
  } finally {
    server.close();
  }
});

test('9. no persisted evidence returns explicit unavailable domains without fabricated values', () => {
  const response = buildEquityEvidenceResponse(fpt, [], {
    now: new Date('2026-09-05T09:00:00.000Z')
  });
  assert.equal(response.status, 'unavailable');
  assert.equal(response.dataAsOf, null);
  assert.equal(response.fetchedAt, null);
  assert.equal(response.domains.marketPrice.status, 'unavailable');
  assert.deepEqual(response.domains.marketPrice.facts, []);
});

test('10. response exposes no score, recommendation, or private user/portfolio data', async () => {
  const result = await getVietnamEquityEvidence('FPT', {
    client: null,
    now: new Date('2026-09-05T09:00:00.000Z'),
    getAssetBySymbolFn: async () => fpt,
    fetchLatestEvidenceFn: async () => [evidence({
      provenance: {
        provider: 'yahoo',
        userId: 'must-not-leak',
        portfolio: { cash: 100 }
      }
    })]
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of ['score', 'recommendation', 'BUY', 'SELL', 'userId', 'portfolio', 'holdings', 'transactions', 'email']) {
    assert.equal(serialized.includes(forbidden), false, `Unexpected private/opaque field: ${forbidden}`);
  }
});

test('11. a DB read error is explicit and never falls back to process memory', async () => {
  clearEquityEvidenceMemory();
  await persistEquityEvidence([evidence()], null);
  const failingDb = {
    from() {
      return {
        select() {
          return {
            eq() { return this; },
            order() { return this; },
            then(resolve) {
              return Promise.resolve({ data: null, error: { code: 'PGRST000', message: 'DB unavailable' } }).then(resolve);
            }
          };
        }
      };
    }
  };
  await assert.rejects(
    fetchEquityEvidenceVintages('FPT', failingDb),
    (error) => error.code === 'EQUITY_EVIDENCE_QUERY_FAILED'
  );
});

test('12. migration and schema enforce public read-only, immutable service writes, and replay timestamps', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.vn_equity_evidence_observations/);
    assert.match(sql, /observation_id TEXT PRIMARY KEY/);
    assert.match(sql, /first_seen_at TIMESTAMPTZ NOT NULL/);
    assert.match(sql, /system_knowable_at TIMESTAMPTZ NOT NULL/);
    assert.match(sql, /GRANT SELECT ON public\.vn_equity_evidence_observations TO anon, authenticated/);
    assert.match(sql, /GRANT SELECT, INSERT ON public\.vn_equity_evidence_observations TO service_role/);
    assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.vn_equity_evidence_observations FROM service_role/);
  }
});
