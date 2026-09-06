import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../index.js';
import { createEquityEvidence } from '../src/equities/evidenceModel.js';
import {
  buildEquityOpportunityShortlist,
  createEquityOpportunityCandidate,
  EQUITY_QUALIFICATION_STATUS,
  evaluateEquityOpportunityAsOf,
  evaluateOpportunityAsOf,
  explainEquityOpportunity,
  getPublishedEquityOpportunities,
  runVietnamEquityOpportunityRefresh,
  validateEquityOpportunityAiExplanation
} from '../src/equityOpportunities/index.js';
import {
  clearEquityOpportunityMemory,
  equityOpportunityRecordToRow,
  fetchEquityOpportunityEvaluations,
  persistEquityOpportunityEvaluations
} from '../src/equityOpportunities/repository.js';
import { HEALTH_STATES, OBSERVED_JOBS } from '../src/observability/dataHealth.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  testDir,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260906030000_create_vn_equity_opportunities.sql'
);
const schemaPath = path.resolve(testDir, '..', 'db', 'schema.sql');

const fpt = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  symbol: 'FPT',
  name: 'Công ty Cổ phần FPT',
  assetType: 'stock',
  exchange: 'HOSE',
  marketCode: 'HOSE',
  quoteCurrency: 'VND',
  marketPolicy: 'VN_EXCHANGE',
  marketTimezone: 'Asia/Ho_Chi_Minh',
  isActive: true
});

const vcb = Object.freeze({
  ...fpt,
  id: '22222222-2222-4222-8222-222222222222',
  symbol: 'VCB',
  name: 'Ngân hàng TMCP Ngoại thương Việt Nam'
});

function evidence(asset = fpt, metric = 'close', numericValue = 100, overrides = {}) {
  return createEquityEvidence({
    assetId: asset.id,
    symbol: asset.symbol,
    exchange: asset.exchange,
    companyName: asset.name,
    evidenceType: 'market_price',
    metric,
    numericValue,
    unit: metric === 'volume' ? 'share' : 'VND',
    currency: metric === 'volume' ? null : 'VND',
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
      completionSemantics: 'completed_daily_bar'
    },
    freshness: 'delayed',
    ...overrides
  });
}

function fullMarketEvidence(asset = fpt, overrides = {}) {
  return [
    evidence(asset, 'open', 98, overrides),
    evidence(asset, 'high', 103, overrides),
    evidence(asset, 'low', 97, overrides),
    evidence(asset, 'close', 101, overrides),
    evidence(asset, 'volume', 1_000_000, overrides)
  ];
}

function evaluate(asset = fpt, facts = fullMarketEvidence(asset), asOf = '2026-09-04T09:00:00.000Z') {
  return evaluateEquityOpportunityAsOf({ asset, evidence: facts, asOf: new Date(asOf) });
}

function createOpportunityDb(initialRows = []) {
  const opportunityRows = new Map(initialRows.map((row) => [row.evaluation_id, { ...row }]));
  const checkpointRows = new Map();
  const calls = [];

  return {
    opportunityRows,
    checkpointRows,
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      if (table === 'vn_equity_opportunity_evaluations') {
        return {
          upsert(rows, options) {
            calls.push({ operation: 'upsert', table, options });
            const list = Array.isArray(rows) ? rows : [rows];
            const inserted = [];
            for (const row of list) {
              if (!opportunityRows.has(row.evaluation_id)) {
                opportunityRows.set(row.evaluation_id, { ...row });
                inserted.push({ ...row });
              }
            }
            return { select: async () => ({ data: inserted, error: null }) };
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
                const rows = Array.from(opportunityRows.values())
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
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
}

test('1. same evidence and explicit clock produce the same deterministic candidate', () => {
  const first = evaluate();
  const second = evaluate();
  assert.deepEqual(first, second);
  assert.equal(first.qualificationStatus, EQUITY_QUALIFICATION_STATUS.WATCH);
  assert.equal(first.qualificationReasons[0].evidenceRefs.length, 1);
  assert.equal(first.qualificationReasons[0].evidenceRefs[0], first.evidenceRefs.find((ref) => ref.metric === 'close').observationId);
});

test('2. missing evidence is insufficient rather than negative and never becomes zero', () => {
  const candidate = evaluate(fpt, []);
  assert.equal(candidate.qualificationStatus, EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE);
  assert.deepEqual(candidate.qualificationReasons, []);
  assert.deepEqual(candidate.disqualificationReasons, []);
  assert.ok(candidate.missingRequirements.includes('REPLAY_SAFE_COMPLETED_CLOSE'));
  assert.equal(candidate.evidenceRefs.length, 0);
  assert.equal(JSON.stringify(candidate).includes('"numericValue":0'), false);
});

test('3. positive opportunity reasons cannot exist without exact evidence references', () => {
  const base = evaluate();
  assert.throws(() => createEquityOpportunityCandidate({
    ...base,
    candidateId: undefined,
    qualificationReasons: [{ code: 'UNSUPPORTED_POSITIVE_CLAIM', evidenceRefs: [] }]
  }), /requires evidenceRefs/);
});

test('4. a rejected candidate cannot be promoted or sent to AI explanation', async () => {
  const rejected = evaluate({ ...fpt, isActive: false });
  let aiCalls = 0;
  const explanation = await explainEquityOpportunity(rejected, {
    generateAiFn: async () => {
      aiCalls += 1;
      return { qualificationStatus: 'QUALIFIED' };
    }
  });
  assert.equal(rejected.qualificationStatus, EQUITY_QUALIFICATION_STATUS.REJECTED);
  assert.equal(aiCalls, 0);
  assert.equal(explanation.status, 'not_applicable');
});

test('5. AI failure preserves WATCH and returns deterministic cited fallback', async () => {
  const candidate = evaluate();
  const explanation = await explainEquityOpportunity(candidate, {
    generateAiFn: async () => { throw new Error('provider unavailable'); }
  });
  assert.equal(candidate.qualificationStatus, EQUITY_QUALIFICATION_STATUS.WATCH);
  assert.equal(explanation.generationMode, 'deterministic_fallback');
  assert.equal(explanation.reason, 'AI_EXPLANATION_UNAVAILABLE');
  assert.deepEqual(explanation.summary.evidenceRefs, candidate.qualificationReasons[0].evidenceRefs);
});

test('6. output contains no opaque score, action authority, target, probability, or private data', async () => {
  const candidate = evaluate();
  const explanation = await explainEquityOpportunity(candidate);
  const output = JSON.stringify({ candidate, explanation });
  for (const forbidden of [
    'opportunityScore', 'score', 'recommendation', 'BUY', 'SELL', 'HOLD',
    'targetPrice', 'probability', 'confidence', 'userId', 'profileId', 'portfolio', 'holdings'
  ]) {
    assert.equal(output.includes(forbidden), false, `Forbidden output: ${forbidden}`);
  }
});

test('7. shortlist ordering is qualification class, evidence completeness, then symbol', () => {
  const fptComplete = evaluate();
  const vcbCloseOnly = evaluate(vcb, [evidence(vcb)]);
  const aaa = evaluate({ ...vcb, id: '33333333-3333-4333-8333-333333333333', symbol: 'AAA', name: 'AAA Corp' }, [
    evidence(
      { ...vcb, id: '33333333-3333-4333-8333-333333333333', symbol: 'AAA', name: 'AAA Corp' },
      'close',
      20
    )
  ]);
  const report = buildEquityOpportunityShortlist([vcbCloseOnly, aaa, fptComplete]);
  assert.deepEqual(report.candidates.map((item) => item.symbol), ['FPT', 'AAA', 'VCB']);
  assert.deepEqual(report.shortlist.map((item) => item.symbol), ['FPT', 'AAA', 'VCB']);
  assert.equal(report.ordering.meaning, 'DETERMINISTIC_DISPLAY_ORDER_NOT_INVESTMENT_PREFERENCE');
});

test('8. exact duplicate evaluations deduplicate in repository memory and durable storage', async () => {
  clearEquityOpportunityMemory();
  const candidate = evaluate();
  const explanation = await explainEquityOpportunity(candidate);
  await persistEquityOpportunityEvaluations([{ candidate, explanation }, { candidate, explanation }], null);
  assert.equal((await fetchEquityOpportunityEvaluations(null, null)).length, 1);

  const db = createOpportunityDb();
  const first = await persistEquityOpportunityEvaluations([{ candidate, explanation }], db);
  const duplicate = await persistEquityOpportunityEvaluations([{ candidate, explanation }], db);
  assert.equal(first.durablyAccepted, 1);
  assert.equal(duplicate.durablyAccepted, 0);
  assert.equal(db.opportunityRows.size, 1);
});

test('9. only a materially participating evidence revision changes the fingerprint', () => {
  const original = evidence(fpt, 'close', 100);
  const correction = evidence(fpt, 'close', 101, {
    fetchedAt: '2026-09-04T10:00:00.000Z',
    firstSeenAt: '2026-09-04T10:00:00.000Z',
    revisionMarker: 'provider_correction'
  });
  const before = evaluate(fpt, [original, correction], '2026-09-04T09:00:00.000Z');
  const after = evaluate(fpt, [original, correction], '2026-09-04T10:01:00.000Z');
  assert.notEqual(before.evidenceFingerprint, after.evidenceFingerprint);

  const latest = evidence(fpt, 'close', 110, {
    referencePeriod: '2026-09-05',
    observedAt: '2026-09-05T08:00:00.000Z',
    sourceAvailableAt: '2026-09-05T08:00:00.000Z',
    fetchedAt: '2026-09-05T08:05:00.000Z',
    firstSeenAt: '2026-09-05T08:05:00.000Z'
  });
  const withoutOldRevision = evaluate(fpt, [original, latest], '2026-09-05T09:00:00.000Z');
  const withOldRevision = evaluate(fpt, [original, correction, latest], '2026-09-05T09:00:00.000Z');
  assert.equal(withoutOldRevision.evidenceFingerprint, withOldRevision.evidenceFingerprint);
  assert.equal(withoutOldRevision.qualificationStatus, withOldRevision.qualificationStatus);
});

test('10. as-of evaluation excludes evidence not yet knowable to the system', () => {
  const future = evidence(fpt, 'close', 150, {
    sourceAvailableAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-04T09:00:00.000Z',
    firstSeenAt: '2026-09-04T09:00:00.000Z'
  });
  const before = evaluate(fpt, [future], '2026-09-04T09:30:00.000Z');
  const after = evaluate(fpt, [future], '2026-09-04T10:00:00.000Z');
  assert.equal(before.qualificationStatus, EQUITY_QUALIFICATION_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(before.evidenceRefs.length, 0);
  assert.equal(after.qualificationStatus, EQUITY_QUALIFICATION_STATUS.WATCH);
  assert.equal(after.evidenceRefs[0].numericValue, 150);
});

test('10a. evaluateOpportunityAsOf resolves canonical persisted evidence without a provider call', async () => {
  const calls = [];
  const candidate = await evaluateOpportunityAsOf(' fpt ', new Date('2026-09-04T09:00:00.000Z'), {
    client: { kind: 'production-like-client' },
    getAssetBySymbolFn: async (symbol, client) => {
      calls.push({ operation: 'asset', symbol, client });
      return fpt;
    },
    fetchEvidenceFn: async (symbol, client) => {
      calls.push({ operation: 'evidence', symbol, client });
      return fullMarketEvidence();
    }
  });
  assert.equal(candidate.symbol, 'FPT');
  assert.equal(candidate.qualificationStatus, EQUITY_QUALIFICATION_STATUS.WATCH);
  assert.deepEqual(calls.map((call) => [call.operation, call.symbol]), [
    ['asset', 'FPT'],
    ['evidence', 'FPT']
  ]);
});

test('11. public GET routes use persisted reads only and expose no private context', async () => {
  const candidate = evaluate();
  const explanation = await explainEquityOpportunity(candidate);
  const db = createOpportunityDb([equityOpportunityRecordToRow({ candidate, explanation })]);
  let providerCalls = 0;
  const app = createApp({
    supabaseAuthClient: db,
    getMarketHistoryFn: async () => { providerCalls += 1; throw new Error('provider forbidden'); },
    getAssetAnalysisFn: async () => { providerCalls += 1; throw new Error('analysis forbidden'); },
    getOpportunitiesFn: async () => { providerCalls += 1; throw new Error('legacy service forbidden'); }
  });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/equity-opportunities`);
    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/equity-opportunities/FPT`);
    assert.equal(listResponse.status, 200);
    assert.equal(detailResponse.status, 200);
    const list = await listResponse.json();
    const detail = await detailResponse.json();
    assert.equal(list.data.shortlist[0].symbol, 'FPT');
    assert.equal(detail.data.symbol, 'FPT');
    assert.equal(providerCalls, 0);
    assert.equal(db.calls.some((call) => call.operation === 'upsert'), false);
    const serialized = JSON.stringify({ list, detail });
    for (const forbidden of ['profileId', 'userId', 'portfolio', 'holdings', 'transactions', 'cash']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  } finally {
    server.close();
  }
});

test('12. real refresh service persists candidates and records HEALTHY execution telemetry', async () => {
  const db = createOpportunityDb();
  const summary = await runVietnamEquityOpportunityRefresh({
    now: new Date('2026-09-04T09:00:00.000Z'),
    client: db,
    getAssetsFn: async () => [fpt],
    fetchEvidenceFn: async () => fullMarketEvidence(),
    persistEvaluationsFn: persistEquityOpportunityEvaluations
  });
  assert.equal(summary.success, true);
  assert.equal(summary.status, HEALTH_STATES.HEALTHY);
  assert.equal(summary.isDurable, true);
  assert.equal(db.opportunityRows.size, 1);
  const checkpoint = db.checkpointRows.get(OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH);
  assert.equal(checkpoint.status, 'success');
  assert.equal(checkpoint.metadata.healthState, HEALTH_STATES.HEALTHY);
});

test('13. normal insufficient evidence is DEGRADED rather than operational FAILED', async () => {
  const db = createOpportunityDb();
  const summary = await runVietnamEquityOpportunityRefresh({
    now: new Date('2026-09-04T09:00:00.000Z'),
    client: db,
    getAssetsFn: async () => [fpt],
    fetchEvidenceFn: async () => []
  });
  assert.equal(summary.success, true);
  assert.equal(summary.status, HEALTH_STATES.DEGRADED);
  assert.equal(summary.candidates.candidates[0].qualificationStatus, 'INSUFFICIENT_EVIDENCE');
  assert.equal(db.checkpointRows.get(OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH).status, 'quarantined');
});

test('14. DB persistence failure publishes nothing to memory and records FAILED', async () => {
  clearEquityOpportunityMemory();
  const healthEvents = [];
  const failingDb = {
    from(table) {
      assert.equal(table, 'vn_equity_opportunity_evaluations');
      return {
        upsert() {
          return { select: async () => ({ data: null, error: { code: 'PGRST000', message: 'DB unavailable' } }) };
        }
      };
    }
  };
  const summary = await runVietnamEquityOpportunityRefresh({
    now: new Date('2026-09-04T09:00:00.000Z'),
    client: failingDb,
    getAssetsFn: async () => [fpt],
    fetchEvidenceFn: async () => fullMarketEvidence(),
    recordHealthFn: async (event) => { healthEvents.push(event); return { isDurable: false }; }
  });
  assert.equal(summary.success, false);
  assert.equal(summary.status, HEALTH_STATES.FAILED);
  assert.equal(healthEvents.at(-1).status, HEALTH_STATES.FAILED);
  assert.deepEqual(await fetchEquityOpportunityEvaluations(null, null), []);
});

test('14a. deterministic evaluation failure records FAILED before rethrow', async () => {
  const healthEvents = [];
  await assert.rejects(
    runVietnamEquityOpportunityRefresh({
      now: new Date('2026-09-04T09:00:00.000Z'),
      client: { kind: 'production-like-client' },
      getAssetsFn: async () => [{ ...fpt, name: '' }],
      fetchEvidenceFn: async () => fullMarketEvidence(),
      persistEvaluationsFn: async () => {
        throw new Error('Persistence must not be reached');
      },
      recordHealthFn: async (event) => {
        healthEvents.push(event);
        return { isDurable: true };
      }
    }),
    /asset metadata is incomplete/
  );
  assert.equal(healthEvents.length, 1);
  assert.equal(healthEvents[0].jobName, OBSERVED_JOBS.VN_OPPORTUNITY_ENGINE_REFRESH);
  assert.equal(healthEvents[0].status, HEALTH_STATES.FAILED);
});

test('15. AI explanations require exact citations and reject numerical or action claims', async () => {
  const candidate = evaluate();
  const closeId = candidate.evidenceRefs.find((item) => item.metric === 'close').observationId;
  const valid = validateEquityOpportunityAiExplanation(candidate, {
    summary: { text: 'The candidate has validated completed market evidence.', evidenceRefs: [closeId] },
    supportingEvidence: [{ text: 'The cited close supports continued evidence monitoring.', evidenceRefs: [closeId] }]
  });
  assert.equal(valid.valid, true);

  const fabricatedNumber = validateEquityOpportunityAiExplanation(candidate, {
    summary: { text: 'The price can rise 20 percent.', evidenceRefs: [closeId] },
    supportingEvidence: [{ text: 'Evidence is cited.', evidenceRefs: [closeId] }]
  });
  const actionClaim = validateEquityOpportunityAiExplanation(candidate, {
    summary: { text: 'Buy this candidate.', evidenceRefs: [closeId] },
    supportingEvidence: [{ text: 'Evidence is cited.', evidenceRefs: [closeId] }]
  });
  const unknownCitation = validateEquityOpportunityAiExplanation(candidate, {
    summary: { text: 'The candidate has validated evidence.', evidenceRefs: ['unknown'] },
    supportingEvidence: [{ text: 'Evidence is cited.', evidenceRefs: [closeId] }]
  });
  assert.equal(fabricatedNumber.valid, false);
  assert.equal(actionClaim.valid, false);
  assert.equal(unknownCitation.valid, false);
});

test('16. migration and schema enforce append-only public-read/service-write persistence', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.vn_equity_opportunity_evaluations/);
    assert.match(sql, /evaluation_id TEXT PRIMARY KEY/);
    assert.match(sql, /UNIQUE \(asset_id, as_of, evidence_fingerprint, policy_version\)/);
    assert.match(sql, /GRANT SELECT ON public\.vn_equity_opportunity_evaluations TO anon, authenticated/);
    assert.match(sql, /GRANT SELECT, INSERT ON public\.vn_equity_opportunity_evaluations TO service_role/);
    assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.vn_equity_opportunity_evaluations FROM service_role/);
  }
});

test('17. provider-free read service returns a truthful empty shortlist', async () => {
  clearEquityOpportunityMemory();
  const result = await getPublishedEquityOpportunities({ client: null });
  assert.equal(result.status, 'empty');
  assert.deepEqual(result.shortlist, []);
  assert.deepEqual(result.candidates, []);
});
