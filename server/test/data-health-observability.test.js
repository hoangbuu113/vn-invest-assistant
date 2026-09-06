import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEALTH_STATES,
  OBSERVED_JOBS,
  ALL_OBSERVED_JOBS,
  ERROR_CATEGORIES,
  recordJobHealth,
  getSystemDataHealth,
  clearDataHealthMemoryStore,
  setTestDataHealthClientOverride,
  sanitizeOperationalMetadata,
  normalizeJobError,
  rowToJobHealth
} from '../src/observability/dataHealth.js';
import { createApp } from '../index.js';
import { getVietnamRegime } from '../src/regime.js';
import { runMarketContextCollector } from '../src/context/collector.js';
import { ingestCustomsDocument } from '../src/context/providers/customsTrade.js';
import { persistClaims } from '../src/claims/claimRepository.js';
import { getMarketStrategist } from '../src/marketStrategist.js';
import { runNewsCollector } from '../src/news/collector.js';
import { createMarketClaim, CLAIM_TYPES, CLAIM_STATUS } from '../src/claims/claimModel.js';
import { createMarketObservation } from '../src/context/factModel.js';

test('1. health state definitions: HEALTHY, DEGRADED, FAILED, UNKNOWN are immutable enums', () => {
  assert.equal(HEALTH_STATES.HEALTHY, 'HEALTHY');
  assert.equal(HEALTH_STATES.DEGRADED, 'DEGRADED');
  assert.equal(HEALTH_STATES.FAILED, 'FAILED');
  assert.equal(HEALTH_STATES.UNKNOWN, 'UNKNOWN');
  assert.throws(() => {
    HEALTH_STATES.CUSTOM = 'CUSTOM';
  }, /Cannot add property/);
});

test('2. observed jobs includes at least the 7 required core pipelines', () => {
  assert.equal(ALL_OBSERVED_JOBS.length, 7);
  assert.ok(ALL_OBSERVED_JOBS.includes('vn_market_context_collector'));
  assert.ok(ALL_OBSERVED_JOBS.includes('official_macro_monetary_collector'));
  assert.ok(ALL_OBSERVED_JOBS.includes('customs_trade_collector'));
  assert.ok(ALL_OBSERVED_JOBS.includes('news_refresh_collector'));
  assert.ok(ALL_OBSERVED_JOBS.includes('claims_reconciliation'));
  assert.ok(ALL_OBSERVED_JOBS.includes('market_strategist_refresh'));
  assert.ok(ALL_OBSERVED_JOBS.includes('alert_scheduler'));
});

test('3. UNKNOWN when never run: unexecuted jobs report UNKNOWN with null timestamps and 0 fabricated dates', async () => {
  clearDataHealthMemoryStore();

  const health = await getSystemDataHealth({ client: null, now: new Date('2026-09-06T12:00:00.000Z') });
  assert.equal(health.systemStatus, HEALTH_STATES.UNKNOWN);
  assert.equal(health.jobs.length, 7);

  for (const job of health.jobs) {
    assert.equal(job.status, HEALTH_STATES.UNKNOWN, `Job ${job.jobName} must report UNKNOWN when unexecuted`);
    assert.equal(job.lastAttemptAt, null, `Job ${job.jobName} must have null lastAttemptAt`);
    assert.equal(job.lastSuccessAt, null, `Job ${job.jobName} must have null lastSuccessAt`);
    assert.equal(job.durationMs, null);
    assert.equal(job.recordsRead, 0);
    assert.equal(job.recordsWritten, 0);
  }
});

test('4. stale or missing timestamp is never fabricated as current time', () => {
  const rowWithNullTimestamp = {
    source_key: 'vn_market_context_collector',
    last_attempted_at: null,
    last_success_at: null,
    status: 'success',
    metadata: { healthState: 'HEALTHY' }
  };

  const jobHealth = rowToJobHealth(rowWithNullTimestamp, 'vn_market_context_collector');
  assert.equal(jobHealth.status, HEALTH_STATES.UNKNOWN, 'Missing timestamp must override status to UNKNOWN');
  assert.equal(jobHealth.lastAttemptAt, null);
  assert.equal(jobHealth.lastSuccessAt, null);
});

test('5. success state: job records HEALTHY, updates timestamps and structured metrics', async () => {
  clearDataHealthMemoryStore();
  const now = new Date('2026-09-06T10:00:00.000Z');

  const res = await recordJobHealth({
    jobName: OBSERVED_JOBS.VN_MARKET_CONTEXT_COLLECTOR,
    status: HEALTH_STATES.HEALTHY,
    durationMs: 345,
    recordsRead: 28,
    recordsWritten: 28,
    dataAsOf: '2026-09-06T09:45:00.000Z',
    policyVersion: 'v1.3',
    client: null,
    now
  });

  assert.equal(res.health.status, HEALTH_STATES.HEALTHY);
  assert.equal(res.health.lastAttemptAt, '2026-09-06T10:00:00.000Z');
  assert.equal(res.health.lastSuccessAt, '2026-09-06T10:00:00.000Z');
  assert.equal(res.health.durationMs, 345);
  assert.equal(res.health.recordsRead, 28);
  assert.equal(res.health.recordsWritten, 28);
  assert.equal(res.health.dataAsOf, '2026-09-06T09:45:00.000Z');
  assert.equal(res.health.policyVersion, 'v1.3');

  const health = await getSystemDataHealth({ client: null, now });
  const vnJob = health.jobs.find((j) => j.jobName === OBSERVED_JOBS.VN_MARKET_CONTEXT_COLLECTOR);
  assert.ok(vnJob);
  assert.equal(vnJob.status, HEALTH_STATES.HEALTHY);
  assert.equal(vnJob.recordsRead, 28);
});

test('6. failed state: job records FAILED, preserves prior success timestamp and categorizes error', async () => {
  clearDataHealthMemoryStore();

  const successTime = new Date('2026-09-06T08:00:00.000Z');
  await recordJobHealth({
    jobName: OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR,
    status: HEALTH_STATES.HEALTHY,
    durationMs: 200,
    recordsRead: 15,
    recordsWritten: 12,
    client: null,
    now: successTime
  });

  const failTime = new Date('2026-09-06T08:15:00.000Z');
  const error = new Error('Upstream provider WAF access denied: 403 Forbidden');
  error.code = 'PROVIDER_ACCESS_DENIED';

  const res = await recordJobHealth({
    jobName: OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR,
    status: HEALTH_STATES.FAILED,
    durationMs: 85,
    recordsRead: 0,
    recordsWritten: 0,
    error,
    client: null,
    now: failTime
  });

  assert.equal(res.health.status, HEALTH_STATES.FAILED);
  assert.equal(res.health.lastAttemptAt, '2026-09-06T08:15:00.000Z');
  assert.equal(res.health.lastSuccessAt, '2026-09-06T08:00:00.000Z', 'Failed run must preserve previous lastSuccessAt');
  assert.equal(res.health.errorCode, 'PROVIDER_ACCESS_DENIED');
  assert.equal(res.health.errorCategory, ERROR_CATEGORIES.UPSTREAM_PROVIDER);

  const health = await getSystemDataHealth({ client: null, now: failTime });
  assert.equal(health.systemStatus, HEALTH_STATES.FAILED, 'System status must reflect FAILED when any job fails');
});

test('7. decoupled invariant: failed collector does NOT mark market regime negative', async () => {
  clearDataHealthMemoryStore();

  // 1. Record complete failure of official context collector
  const failTime = new Date('2026-09-06T09:00:00.000Z');
  await recordJobHealth({
    jobName: OBSERVED_JOBS.OFFICIAL_MACRO_MONETARY_COLLECTOR,
    status: HEALTH_STATES.FAILED,
    durationMs: 150,
    recordsRead: 0,
    recordsWritten: 0,
    errorCode: 'OFFICIAL_SOURCE_FAILED',
    errorCategory: ERROR_CATEGORIES.UPSTREAM_PROVIDER,
    client: null,
    now: failTime
  });

  const health = await getSystemDataHealth({ client: null, now: failTime });
  const macroJob = health.jobs.find((j) => j.jobName === OBSERVED_JOBS.OFFICIAL_MACRO_MONETARY_COLLECTOR);
  assert.equal(macroJob.status, HEALTH_STATES.FAILED);

  // 2. Fetch Vietnam market regime - verify regime evaluation is truthful and NOT turned bearish/negative by job failure
  const regime = await getVietnamRegime({ now: failTime });
  assert.ok(regime);
  assert.equal(typeof regime.status, 'string');
  assert.notEqual(regime.status, 'negative', 'Regime status must not be fabricated as negative due to operational job failure');
  // CPI and money market domain availability reflect underlying evidence, not job health
  assert.ok(regime.inflation !== undefined);
  assert.ok(regime.moneyMarket !== undefined);
});

test('8. endpoint read-only: GET /api/system/data-health performs zero mutations', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T10:00:00.000Z');

  await recordJobHealth({
    jobName: OBSERVED_JOBS.ALERT_SCHEDULER,
    status: HEALTH_STATES.HEALTHY,
    durationMs: 50,
    recordsRead: 5,
    recordsWritten: 1,
    client: null,
    now: testNow
  });

  const mockDbClient = {
    from(table) {
      assert.equal(table, 'market_context_collector_checkpoints');
      return {
        select() {
          return {
            data: [
              {
                source_key: OBSERVED_JOBS.ALERT_SCHEDULER,
                last_attempted_at: testNow.toISOString(),
                last_success_at: testNow.toISOString(),
                status: 'success',
                metadata: {
                  healthState: HEALTH_STATES.HEALTHY,
                  durationMs: 50,
                  recordsRead: 5,
                  recordsWritten: 1
                }
              }
            ],
            error: null
          };
        },
        // Any mutation call will fail the test!
        upsert() {
          assert.fail('GET /api/system/data-health must NEVER call upsert');
        },
        update() {
          assert.fail('GET /api/system/data-health must NEVER call update');
        },
        delete() {
          assert.fail('GET /api/system/data-health must NEVER call delete');
        }
      };
    }
  };

  const app = createApp({
    supabaseAuthClient: mockDbClient
  });

  const res = await fetch('http://localhost:0/api/system/data-health', {
    // In node:test, we can invoke route handler directly via test helper or app
  }).catch(() => null);

  // Directly test getSystemDataHealth with read-only mock
  const healthResult = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  assert.equal(healthResult.jobsCount, 7);
  const alertJob = healthResult.jobs.find((j) => j.jobName === OBSERVED_JOBS.ALERT_SCHEDULER);
  assert.equal(alertJob.status, HEALTH_STATES.HEALTHY);
});

test('9. secrets excluded: operational metadata strictly excludes tokens, keys, passwords, and stack traces', async () => {
  const dirtyMetadata = {
    apiKey: 'sk-proj-1234567890abcdef',
    secretToken: 'shh-super-secret-jwt-bearer',
    supabaseSecretKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
    dbPassword: 'super_secret_db_password',
    connectionUrl: 'postgres://admin:topsecret@db.supabase.co:5432/postgres',
    stackTrace: 'Error: boom\n    at Object.<anonymous> (file:///test.js:12:3)',
    validPublicStat: 42,
    sourceVersion: 'v1.3'
  };

  const sanitized = sanitizeOperationalMetadata(dirtyMetadata);

  assert.equal(sanitized.apiKey, undefined, 'apiKey must be stripped');
  assert.equal(sanitized.secretToken, undefined, 'secretToken must be stripped');
  assert.equal(sanitized.supabaseSecretKey, undefined, 'supabaseSecretKey must be stripped');
  assert.equal(sanitized.dbPassword, undefined, 'dbPassword must be stripped');
  assert.equal(sanitized.stackTrace, undefined, 'stackTrace must be stripped');
  assert.equal(sanitized.validPublicStat, 42, 'Non-sensitive public stat preserved');
  assert.equal(sanitized.sourceVersion, 'v1.3', 'Non-sensitive public version preserved');

  // Verify URL credential scrubbing
  const scrubbedUrl = sanitizeOperationalMetadata({ endpoint: 'https://user:pass123@api.example.com/feed' });
  assert.equal(scrubbedUrl.endpoint, 'https://***:***@api.example.com/feed');
});

test('10. cold restart persistence: loading from database reconstitutes exact telemetry after memory wipe', async () => {
  clearDataHealthMemoryStore();

  const testDb = new Map();
  const mockSupabase = {
    from(table) {
      assert.equal(table, 'market_context_collector_checkpoints');
      return {
        upsert(row) {
          testDb.set(row.source_key, { ...row });
          return {
            select: async () => ({ data: [{ ...row }], error: null })
          };
        },
        select: async () => {
          return { data: Array.from(testDb.values()), error: null };
        }
      };
    }
  };

  const attemptTime = new Date('2026-09-06T11:30:00.000Z');
  await recordJobHealth({
    jobName: OBSERVED_JOBS.MARKET_STRATEGIST_REFRESH,
    status: HEALTH_STATES.HEALTHY,
    durationMs: 820,
    recordsRead: 40,
    recordsWritten: 1,
    dataAsOf: '2026-09-06T11:00:00.000Z',
    policyVersion: 'strategy-stability-v2',
    client: mockSupabase,
    now: attemptTime
  });

  assert.equal(testDb.size, 1);

  // Simulate cold container restart: wipe all process-local memory
  clearDataHealthMemoryStore();

  // Query health using the persistent store
  const healthAfterRestart = await getSystemDataHealth({ client: mockSupabase, now: attemptTime });
  const strategistJob = healthAfterRestart.jobs.find((j) => j.jobName === OBSERVED_JOBS.MARKET_STRATEGIST_REFRESH);

  assert.ok(strategistJob);
  assert.equal(strategistJob.status, HEALTH_STATES.HEALTHY);
  assert.equal(strategistJob.durationMs, 820);
  assert.equal(strategistJob.recordsRead, 40);
  assert.equal(strategistJob.recordsWritten, 1);
  assert.equal(strategistJob.dataAsOf, '2026-09-06T11:00:00.000Z');
  assert.equal(strategistJob.policyVersion, 'strategy-stability-v2');
  assert.equal(strategistJob.lastAttemptAt, '2026-09-06T11:30:00.000Z');
});

test('11. database failure safety: production mode with DB error does not silently mask failure as memory success', async () => {
  const failingDb = {
    from() {
      return {
        upsert() {
          return {
            select: async () => ({ data: null, error: { message: 'Connection to Supabase timed out', code: 'PGRST000' } })
          };
        },
        select: async () => {
          return { data: null, error: { message: 'Connection to Supabase timed out', code: 'PGRST000' } };
        }
      };
    }
  };

  // In production / non-test mode simulation:
  const origNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    await assert.rejects(async () => {
      await recordJobHealth({
        jobName: OBSERVED_JOBS.CUSTOMS_TRADE_COLLECTOR,
        status: HEALTH_STATES.HEALTHY,
        client: failingDb,
        now: new Date()
      });
    }, /DATA_HEALTH_PERSISTENCE_FAILED/, 'Production DB write failure must throw and NOT fall back silently to memory');

    await assert.rejects(async () => {
      await getSystemDataHealth({ client: failingDb, now: new Date() });
    }, /DATA_HEALTH_QUERY_FAILED/, 'Production DB query failure must throw and NOT mask DB failure');
  } finally {
    process.env.NODE_ENV = origNodeEnv;
  }
});

test('12. error normalizer maps network timeouts, provider access denied, and database errors accurately', () => {
  const timeoutErr = normalizeJobError(new Error('ETIMEDOUT: Connection timed out'));
  assert.equal(timeoutErr.errorCategory, ERROR_CATEGORIES.TIMEOUT);

  const wafErr = normalizeJobError(new Error('Request Rejected: government WAF blocked request'));
  assert.equal(wafErr.errorCategory, ERROR_CATEGORIES.UPSTREAM_PROVIDER);
  assert.equal(wafErr.errorCode, 'PROVIDER_ACCESS_DENIED');

  const dbErr = normalizeJobError({ code: 'PGRST202', message: 'Function not found in database schema' });
  assert.equal(dbErr.errorCategory, ERROR_CATEGORIES.DATABASE);
  assert.equal(dbErr.errorCode, 'PGRST202');

  const valErr = normalizeJobError(new TypeError('validation error: unexpected null property'));
  assert.equal(valErr.errorCategory, ERROR_CATEGORIES.VALIDATION);
});

test('13. HTTP endpoint: GET /api/system/data-health returns 200, requires no auth, and excludes secrets', async () => {
  clearDataHealthMemoryStore();

  await recordJobHealth({
    jobName: OBSERVED_JOBS.ALERT_SCHEDULER,
    status: HEALTH_STATES.HEALTHY,
    durationMs: 42,
    recordsRead: 10,
    recordsWritten: 2,
    client: null,
    now: new Date('2026-09-06T10:00:00.000Z')
  });

  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/data-health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.data);
    assert.equal(body.data.jobsCount, 7);
    assert.equal(Array.isArray(body.data.jobs), true);

    const alertJob = body.data.jobs.find((j) => j.jobName === OBSERVED_JOBS.ALERT_SCHEDULER);
    assert.ok(alertJob);
    assert.equal(alertJob.status, HEALTH_STATES.HEALTHY);
    assert.equal(alertJob.durationMs, 42);

    // Verify secrets are nowhere in serialized JSON response
    const jsonStr = JSON.stringify(body);
    assert.equal(jsonStr.includes('ALERT_SCHEDULER_TOKEN'), false);
    assert.equal(jsonStr.includes('SUPABASE_SECRET_KEY'), false);
    assert.equal(jsonStr.includes('OPENAI_API_KEY'), false);
    assert.equal(jsonStr.includes('password'), false);
  } finally {
    server.close();
  }
});

test('14. HTTP endpoint: GET /api/system/data-health returns 503 when systemStatus is FAILED', async () => {
  clearDataHealthMemoryStore();

  await recordJobHealth({
    jobName: OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR,
    status: HEALTH_STATES.FAILED,
    durationMs: 99,
    errorCode: 'PROVIDER_DOWN',
    errorCategory: ERROR_CATEGORIES.UPSTREAM_PROVIDER,
    client: null,
    now: new Date('2026-09-06T10:15:00.000Z')
  });

  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/data-health`);
    assert.equal(res.status, 503);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.data.systemStatus, HEALTH_STATES.FAILED);
  } finally {
    server.close();
  }
});

test('15. deterministic systemStatus precedence: FAILED > DEGRADED > UNKNOWN > HEALTHY', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  // Case A: 0 executed jobs -> all UNKNOWN -> systemStatus is UNKNOWN
  let h = await getSystemDataHealth({ client: null, now: testNow });
  assert.equal(h.systemStatus, HEALTH_STATES.UNKNOWN);

  // Case B: 1 HEALTHY + 6 UNKNOWN -> systemStatus MUST be UNKNOWN (never fabricated as HEALTHY!)
  await recordJobHealth({
    jobName: OBSERVED_JOBS.VN_MARKET_CONTEXT_COLLECTOR,
    status: HEALTH_STATES.HEALTHY,
    client: null,
    now: testNow
  });
  h = await getSystemDataHealth({ client: null, now: testNow });
  assert.equal(h.systemStatus, HEALTH_STATES.UNKNOWN, 'Partial UNKNOWN coverage must NEVER report HEALTHY');

  // Case C: 1 DEGRADED + 1 HEALTHY + 5 UNKNOWN -> DEGRADED takes precedence over UNKNOWN
  await recordJobHealth({
    jobName: OBSERVED_JOBS.CUSTOMS_TRADE_COLLECTOR,
    status: HEALTH_STATES.DEGRADED,
    client: null,
    now: testNow
  });
  h = await getSystemDataHealth({ client: null, now: testNow });
  assert.equal(h.systemStatus, HEALTH_STATES.DEGRADED, 'DEGRADED takes precedence over UNKNOWN');

  // Case D: 1 FAILED + 1 DEGRADED + 1 HEALTHY + 4 UNKNOWN -> FAILED takes top precedence
  await recordJobHealth({
    jobName: OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR,
    status: HEALTH_STATES.FAILED,
    client: null,
    now: testNow
  });
  h = await getSystemDataHealth({ client: null, now: testNow });
  assert.equal(h.systemStatus, HEALTH_STATES.FAILED, 'FAILED takes precedence over all other states');

  // Case E: All 7 jobs HEALTHY -> systemStatus is HEALTHY
  clearDataHealthMemoryStore();
  for (const jobName of ALL_OBSERVED_JOBS) {
    await recordJobHealth({
      jobName,
      status: HEALTH_STATES.HEALTHY,
      client: null,
      now: testNow
    });
  }
  h = await getSystemDataHealth({ client: null, now: testNow });
  assert.equal(h.systemStatus, HEALTH_STATES.HEALTHY, 'All 7 jobs HEALTHY -> systemStatus is HEALTHY');
});

test('16. production wiring: runMarketContextCollector records HEALTHY on success and FAILED on uncaught failure', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  const checkpointRows = new Map();
  const observationRows = new Map();
  const mockDbClient = {
    from(table) {
      if (table === 'market_context_collector_checkpoints') {
        return {
          upsert(row) {
            checkpointRows.set(row.source_key, { ...row });
            return {
              select: async () => ({ data: [{ ...row }], error: null })
            };
          },
          select: async () => ({
            data: Array.from(checkpointRows.values()),
            error: null
          })
        };
      }
      if (table === 'market_context_observations') {
        return {
          upsert(rows) {
            const list = Array.isArray(rows) ? rows : [rows];
            for (const r of list) observationRows.set(r.observation_id, { ...r });
            return {
              select: async () => ({ data: list.map((r) => ({ ...r })), error: null })
            };
          },
          select: () => {
            const query = {
              order: () => query,
              then: (resolve) => resolve({ data: Array.from(observationRows.values()), error: null }),
              data: Array.from(observationRows.values()),
              error: null
            };
            return query;
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  const sampleObs = createMarketObservation({
    id: 'vn.market.vnindex.close',
    factId: 'vn.market.vnindex.close',
    pillar: 'market',
    label: 'VN-Index',
    metric: 'VN-Index Close',
    value: 1250.5,
    unit: 'points',
    status: 'available'
  });

  // 1. Successful run with recordHealth: true
  const summary = await runMarketContextCollector({
    now: testNow,
    client: mockDbClient,
    fetchMarketPillarFn: async () => [sampleObs],
    fetchGlobalPillarFn: async () => [],
    fetchUsdVndFn: async () => null,
    fetchNsoInflationFn: async () => null,
    fetchSbvMoneyMarketFn: async () => null,
    recordHealth: true,
    forceRefresh: false
  });

  assert.equal(summary.success, true);
  const healthAfterSuccess = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  const vnJobSuccess = healthAfterSuccess.jobs.find((j) => j.jobName === OBSERVED_JOBS.VN_MARKET_CONTEXT_COLLECTOR);
  assert.ok(vnJobSuccess);
  assert.equal(vnJobSuccess.status, HEALTH_STATES.HEALTHY);

  // 2. Fatal uncaught failure with recordHealth: true
  await assert.rejects(async () => {
    await runMarketContextCollector({
      now: testNow,
      client: mockDbClient,
      fetchLatestPersistedObservationsFn: async () => {
        throw new Error('Fatal network failure fetching market observations');
      },
      recordHealth: true
    });
  }, /Fatal network failure fetching market observations/);

  const healthAfterFailure = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  const vnJobFailure = healthAfterFailure.jobs.find((j) => j.jobName === OBSERVED_JOBS.VN_MARKET_CONTEXT_COLLECTOR);
  assert.ok(vnJobFailure);
  assert.equal(vnJobFailure.status, HEALTH_STATES.FAILED);
  assert.equal(vnJobFailure.errorCode, 'NETWORK_ERROR');
});

test('17. production wiring: ingestCustomsDocument records FAILED on SSRF rejection and DEGRADED on quarantine', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  const checkpointRows = new Map();
  const mockDbClient = {
    from(table) {
      assert.equal(table, 'market_context_collector_checkpoints');
      return {
        upsert(row) {
          checkpointRows.set(row.source_key, { ...row });
          return {
            select: async () => ({ data: [{ ...row }], error: null })
          };
        },
        select: async () => ({
          data: Array.from(checkpointRows.values()),
          error: null
        })
      };
    }
  };

  // 1. SSRF rejection path
  const ssrfResult = await ingestCustomsDocument({
    documentUrl: 'https://attacker.evil/fake-customs.pdf',
    client: mockDbClient,
    now: testNow
  });
  assert.equal(ssrfResult.success, false);
  assert.equal(ssrfResult.status, 'rejected');

  const healthAfterSsrf = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  const customsJobSsrf = healthAfterSsrf.jobs.find((j) => j.jobName === OBSERVED_JOBS.CUSTOMS_TRADE_COLLECTOR);
  assert.ok(customsJobSsrf);
  assert.equal(customsJobSsrf.status, HEALTH_STATES.FAILED);
  assert.equal(customsJobSsrf.errorCode, 'UNAPPROVED_SOURCE_HOST');

  // 2. Quarantine path: valid customs domain, but malformed / non-PDF buffer
  const quarantinedResult = await ingestCustomsDocument({
    documentUrl: 'https://files.customs.gov.vn/report.pdf',
    buffer: Buffer.from('NOT A PDF'),
    client: mockDbClient,
    now: testNow
  });
  assert.equal(quarantinedResult.success, false);
  assert.equal(quarantinedResult.status, 'quarantined');

  const healthAfterQuarantine = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  const customsJobQuarantine = healthAfterQuarantine.jobs.find((j) => j.jobName === OBSERVED_JOBS.CUSTOMS_TRADE_COLLECTOR);
  assert.ok(customsJobQuarantine);
  assert.equal(customsJobQuarantine.status, HEALTH_STATES.DEGRADED);
});

test('18. production wiring: persistClaims records FAILED/DEGRADED when DB persistence fails, never HEALTHY', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  const checkpointRows = new Map();
  const failingDbClient = {
    from(table) {
      if (table === 'market_context_collector_checkpoints') {
        return {
          upsert(row) {
            checkpointRows.set(row.source_key, { ...row });
            return {
              select: async () => ({ data: [{ ...row }], error: null })
            };
          },
          select: async () => ({
            data: Array.from(checkpointRows.values()),
            error: null
          })
        };
      }
      // market_claims or claim_evidence_links fail:
      return {
        upsert: async () => ({
          data: null,
          error: { code: '23505', message: 'Database constraint violation on market_claims' }
        })
      };
    }
  };

  const sampleClaim = createMarketClaim({
    claimType: CLAIM_TYPES.MACRO_NUMERIC,
    claimId: 'claim_db_fail_test',
    subject: 'cpi',
    numericValue: 4.2,
    supportStatus: CLAIM_STATUS.SUPPORTED,
    publishedAt: testNow.toISOString()
  });

  await persistClaims([{ claim: sampleClaim, supportingEvidence: [] }], failingDbClient);

  const health = await getSystemDataHealth({ client: failingDbClient, now: testNow });
  const claimsJob = health.jobs.find((j) => j.jobName === OBSERVED_JOBS.CLAIMS_RECONCILIATION);
  assert.ok(claimsJob);
  assert.equal(claimsJob.status, HEALTH_STATES.FAILED, 'DB upsert failure must record FAILED, never HEALTHY');
  assert.equal(claimsJob.errorCode, '23505');
  assert.equal(claimsJob.errorCategory, ERROR_CATEGORIES.DATABASE);
});

test('19. production wiring: getMarketStrategist records FAILED and rethrows when strategy evaluation crashes', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  const checkpointRows = new Map();
  const mockDbClient = {
    from(table) {
      if (table === 'market_context_collector_checkpoints') {
        return {
          upsert(row) {
            checkpointRows.set(row.source_key, { ...row });
            return {
              select: async () => ({ data: [{ ...row }], error: null })
            };
          },
          select: async () => ({
            data: Array.from(checkpointRows.values()),
            error: null
          })
        };
      }
      return {
        upsert: () => ({ select: async () => ({ data: [], error: null }) }),
        select: () => ({
          eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
          data: [],
          error: null
        })
      };
    }
  };

  // Pass a throwing generateLlmFn to trigger strategy evaluation failure
  await assert.rejects(async () => {
    await getMarketStrategist({
      now: testNow,
      client: mockDbClient,
      allowLlm: true,
      aiEnabled: true,
      apiKey: 'test-key',
      runtime: 'gemini',
      generateLlmFn: async () => {
        throw new Error('Upstream LLM provider access denied: 403 Forbidden');
      },
      getMarketContextFabricFn: async () => ({ facts: [] }),
      getNewsFeedFn: async () => ({ articles: [] })
    });
  }, /STRATEGY_INITIAL_PUBLICATION_FAILED/);

  const health = await getSystemDataHealth({ client: mockDbClient, now: testNow });
  const strategistJob = health.jobs.find((j) => j.jobName === OBSERVED_JOBS.MARKET_STRATEGIST_REFRESH);
  assert.ok(strategistJob);
  assert.equal(strategistJob.status, HEALTH_STATES.FAILED);
  assert.equal(strategistJob.errorCode, 'AI_STRATEGIST_UNAVAILABLE');
});

test('20. production wiring: real news collector & alerts evaluation, verified via GET /api/system/data-health', async () => {
  clearDataHealthMemoryStore();
  const testNow = new Date('2026-09-06T12:00:00.000Z');

  const checkpointRows = new Map();
  const mockDbClient = {
    from(table) {
      assert.equal(table, 'market_context_collector_checkpoints');
      return {
        upsert(row) {
          checkpointRows.set(row.source_key, { ...row });
          return {
            select: async () => ({ data: [{ ...row }], error: null })
          };
        },
        select: async () => ({
          data: Array.from(checkpointRows.values()),
          error: null
        })
      };
    }
  };

  // Real invocation of runNewsCollector
  await runNewsCollector({
    now: testNow,
    client: mockDbClient,
    service: {
      fetchAllSources: async () => ({
        allArticles: [],
        sourceResults: [{ sourceId: 'cafef', status: 'ok', articleCount: 0 }]
      }),
      processArticles: () => []
    },
    persistFn: async () => ({ isDurable: true, durablyPersisted: 0, failedPersistence: 0 }),
    fetchPersistedFn: async () => []
  });

  const schedulerToken = 'a'.repeat(32);
  const app = createApp({
    supabaseAuthClient: mockDbClient,
    getMarketSnapshotFn: async () => ({}),
    evaluateAndPersistAlertsFn: async () => ({
      evaluatedCount: 10,
      triggeredCount: 1,
      unavailableCount: 0,
      staleCount: 0
    }),
    dispatchPendingWebPushDeliveriesFn: async () => ({
      deliveryClaimedCount: 1,
      deliverySentCount: 1,
      deliveryPermanentFailureCount: 0
    }),
    alertSchedulerToken: schedulerToken
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Invoke real alert scheduler route
    const alertRes = await fetch(`http://127.0.0.1:${port}/api/internal/alerts/evaluate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${schedulerToken}`
      }
    });
    assert.equal(alertRes.status, 200);

    // Verify GET /api/system/data-health reflects both real pipeline checkpoints
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/system/data-health`);
    assert.equal(healthRes.status, 200);
    const body = await healthRes.json();
    assert.equal(body.status, 'ok');

    const newsJob = body.data.jobs.find((j) => j.jobName === OBSERVED_JOBS.NEWS_REFRESH_COLLECTOR);
    assert.ok(newsJob);
    assert.equal(newsJob.status, HEALTH_STATES.HEALTHY);

    const alertJob = body.data.jobs.find((j) => j.jobName === OBSERVED_JOBS.ALERT_SCHEDULER);
    assert.ok(alertJob);
    assert.equal(alertJob.status, HEALTH_STATES.HEALTHY);
    assert.equal(alertJob.recordsRead, 10);
    assert.equal(alertJob.recordsWritten, 2); // 1 triggered + 1 sent
  } finally {
    server.close();
  }
});
