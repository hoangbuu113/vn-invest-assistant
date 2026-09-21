import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import cloudflareWorker, {
  runScheduledAcquisitionFxEnrichment
} from '../../client/server/index.js';
import { createApp } from '../index.js';
import {
  ACQUISITION_FX_SOURCE_KEY,
  ACQUISITION_FX_STATUS,
  BACKOFF_STEPS_MS,
  clearAcquisitionFxMemoryStore,
  enrichMissingAcquisitionFx,
  getAcquisitionFxRateLimitCooldown,
  getAcquisitionFxStatus,
  getBackoffDurationMs,
  setAcquisitionFxRateLimitCooldown
} from '../src/acquisitionFx.js';

const CANONICAL_ONDO_BASELINE = Object.freeze({
  id: '5dde5a18-9fc1-41fc-b9f8-f494cf2172a8',
  profile_id: 'test-profile-id',
  asset_id: 'ondo-asset-id',
  opening_quantity: 226,
  execution_unit_price: 0.36402,
  price_currency: 'USDT',
  opening_average_cost: 9470.258760528734,
  fx_rate_to_vnd: 26015.764959421827,
  fx_provenance: 'COINGECKO_USDT_VND',
  fx_observed_at: '2026-09-19T14:00:00+00:00',
  accounting_cutoff_at: '2026-09-19T14:00:00.000Z',
  created_at: '2026-09-19T14:00:00.000Z'
});

const CANONICAL_ENA_BASELINE = Object.freeze({
  id: 'b265e3d5-8904-4aff-8c09-81cce09de400',
  profile_id: 'test-profile-id',
  asset_id: 'ena-asset-id',
  opening_quantity: 184.50502,
  execution_unit_price: 0.1641,
  price_currency: 'USDT',
  opening_average_cost: null,
  fx_rate_to_vnd: null,
  fx_provenance: null,
  fx_observed_at: null,
  cancelled_at: null,
  locked_at: null,
  accounting_cutoff_at: '2026-09-19T14:00:00.000Z',
  created_at: '2026-09-19T14:00:00.000Z'
});

function createMockDb({ baselines = [], transactions = [], checkpoints = new Map() } = {}) {
  const currentCheckpoints = checkpoints instanceof Map ? checkpoints : new Map();
  const currentBaselines = baselines.map((b) => ({ ...b }));
  const currentTransactions = transactions.map((t) => ({ ...t }));

  return {
    checkpoints: currentCheckpoints,
    baselines: currentBaselines,
    transactions: currentTransactions,
    from(table) {
      if (table === 'market_context_collector_checkpoints') {
        return {
          select(fields) {
            return {
              eq(col, val) {
                return {
                  maybeSingle: async () => {
                    const row = currentCheckpoints.get(val) || null;
                    return { data: row ? { ...row } : null, error: null };
                  },
                  then: (resolve) => {
                    const row = currentCheckpoints.get(val) || null;
                    return resolve({ data: row ? [{ ...row }] : [], error: null });
                  }
                };
              },
              then: (resolve) => resolve({ data: Array.from(currentCheckpoints.values()), error: null })
            };
          },
          upsert(row) {
            currentCheckpoints.set(row.source_key, { ...row });
            return {
              select: async () => ({ data: [{ ...row }], error: null }),
              then: (resolve) => resolve({ data: [{ ...row }], error: null })
            };
          }
        };
      }

      if (table === 'position_opening_baselines') {
        let filtered = [...currentBaselines];
        const builder = {
          select: () => builder,
          is(col, val) {
            filtered = filtered.filter((r) => (r[col] === undefined ? null : r[col]) === val);
            return builder;
          },
          gt(col, val) {
            filtered = filtered.filter((r) => r[col] > val);
            return builder;
          },
          eq(col, val) {
            filtered = filtered.filter((r) => r[col] === val);
            return builder;
          },
          order() {
            return builder;
          },
          limit(n) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          update(updates) {
            return {
              eq(col, val) {
                return {
                  is(isCol, isVal) {
                    for (const r of currentBaselines) {
                      if (r[col] === val && r[isCol] === isVal) {
                        Object.assign(r, updates);
                      }
                    }
                    return { error: null };
                  }
                };
              }
            };
          },
          then: (resolve) => resolve({ data: filtered, error: null })
        };
        return builder;
      }

      if (table === 'portfolio_transactions') {
        let filtered = [...currentTransactions];
        const builder = {
          select: () => builder,
          is(col, val) {
            filtered = filtered.filter((r) => (r[col] === undefined ? null : r[col]) === val);
            return builder;
          },
          gt(col, val) {
            filtered = filtered.filter((r) => r[col] > val);
            return builder;
          },
          eq(col, val) {
            filtered = filtered.filter((r) => r[col] === val);
            return builder;
          },
          order() {
            return builder;
          },
          limit(n) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          update(updates) {
            return {
              eq(col, val) {
                return {
                  is(isCol, isVal) {
                    for (const r of currentTransactions) {
                      if (r[col] === val && r[isCol] === isVal) {
                        Object.assign(r, updates);
                      }
                    }
                    return { error: null };
                  }
                };
              }
            };
          },
          then: (resolve) => resolve({ data: filtered, error: null })
        };
        return builder;
      }

      if (table === 'holdings') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({ error: null })
                }),
                is: () => ({ error: null })
              })
            })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };
}

test('Acquisition FX Observability & Governed Backoff', async (t) => {
  t.beforeEach(() => {
    clearAcquisitionFxMemoryStore();
  });

  t.afterEach(() => {
    clearAcquisitionFxMemoryStore();
  });

  await t.test('A. First 429 sets 5m backoff and records durable state', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    let resolverCalls = 0;
    const mock429Resolver = async () => {
      resolverCalls++;
      return { availability: 'unavailable', rate: null, reason: 'PROVIDER_RATE_LIMITED' };
    };

    const baseTimeMs = Date.parse('2026-09-21T10:00:00.000Z');
    const summary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mock429Resolver
    }, {
      nowMs: baseTimeMs,
      triggerSource: 'scheduler'
    });

    assert.equal(resolverCalls, 1);
    assert.equal(summary.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED);
    assert.equal(summary.reason, 'COINGECKO_429');
    assert.equal(summary.backoffStep, 1);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 5 * 60 * 1000);
    assert.equal(summary.cooldownUntil, new Date(baseTimeMs + 5 * 60 * 1000).toISOString());

    // Verify durable checkpoint was recorded
    const checkpoint = db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY);
    assert.ok(checkpoint);
    assert.equal(checkpoint.status, 'quarantined');
    assert.equal(checkpoint.metadata.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED);
    assert.equal(checkpoint.metadata.backoffStep, 1);
    assert.equal(checkpoint.metadata.cooldownUntilMs, baseTimeMs + 5 * 60 * 1000);
    assert.equal(checkpoint.metadata.triggerSource, 'scheduler');
  });

  await t.test('B. Subsequent invocation within backoff is skipped as PROVIDER_RATE_LIMITED_COOLDOWN without network call', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    let resolverCalls = 0;
    const mockResolver = async () => {
      resolverCalls++;
      return { availability: 'unavailable', rate: null, reason: 'PROVIDER_RATE_LIMITED' };
    };

    const t0 = Date.parse('2026-09-21T10:00:00.000Z');
    await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t0, triggerSource: 'scheduler' });

    assert.equal(resolverCalls, 1);

    // Call 2 minutes later (well within 5m cooldown)
    const t1 = t0 + 2 * 60 * 1000;
    const skippedSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t1, triggerSource: 'scheduler' });

    // Zero additional network/resolver calls made
    assert.equal(resolverCalls, 1);
    assert.equal(skippedSummary.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN);
    assert.equal(skippedSummary.reason, 'PROVIDER_RATE_LIMITED_COOLDOWN');
    assert.equal(skippedSummary.processedCount, 0);
    assert.equal(skippedSummary.enrichedCount, 0);
    assert.equal(skippedSummary.skippedCount, 0);
    assert.equal(skippedSummary.backoffStep, 1); // backoff step did NOT advance
    assert.equal(skippedSummary.cooldownRemainingMs, 3 * 60 * 1000);
  });

  await t.test('C. Second 429 after step 1 advances backoff to 15m', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    let resolverCalls = 0;
    const mockResolver = async () => {
      resolverCalls++;
      return { availability: 'unavailable', rate: null, reason: 'PROVIDER_RATE_LIMITED' };
    };

    const t0 = Date.parse('2026-09-21T10:00:00.000Z');
    await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t0 });

    // Step 1: 5m cooldown
    assert.equal(resolverCalls, 1);

    // Advance past step 1 cooldown: 5m + 1ms
    const t2 = t0 + 5 * 60 * 1000 + 1;
    const secondSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t2 });

    assert.equal(resolverCalls, 2);
    assert.equal(secondSummary.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED);
    assert.equal(secondSummary.backoffStep, 2);
    assert.ok(secondSummary.cooldownRemainingMs > 0 && secondSummary.cooldownRemainingMs <= 15 * 60 * 1000);
    assert.equal(secondSummary.cooldownUntil, new Date(t2 + 15 * 60 * 1000).toISOString());

    const checkpoint = db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY);
    assert.equal(checkpoint.metadata.backoffStep, 2);
    assert.equal(checkpoint.metadata.cooldownUntilMs, t2 + 15 * 60 * 1000);
  });

  await t.test('D. Backoff caps at 60m', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    const mockResolver = async () => ({
      availability: 'unavailable',
      rate: null,
      reason: 'PROVIDER_RATE_LIMITED'
    });

    let currentTime = Date.parse('2026-09-21T10:00:00.000Z');

    // 1st 429 -> Step 1: 5m
    let summary = await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    assert.equal(summary.backoffStep, 1);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 5 * 60 * 1000);

    // 2nd 429 -> Step 2: 15m
    currentTime += 5 * 60 * 1000 + 1;
    summary = await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    assert.equal(summary.backoffStep, 2);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 15 * 60 * 1000);

    // 3rd 429 -> Step 3: 30m
    currentTime += 15 * 60 * 1000 + 1;
    summary = await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    assert.equal(summary.backoffStep, 3);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 30 * 60 * 1000);

    // 4th 429 -> Step 4: 60m
    currentTime += 30 * 60 * 1000 + 1;
    summary = await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    assert.equal(summary.backoffStep, 4);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 60 * 60 * 1000);

    // 5th 429 -> Still Step 4 (capped at 60m)
    currentTime += 60 * 60 * 1000 + 1;
    summary = await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    assert.equal(summary.backoffStep, 4);
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 60 * 60 * 1000);
  });

  await t.test('E. Successful call resets backoff to 0 and clears cooldown', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    let return429 = true;
    const mockResolver = async () => {
      if (return429) {
        return { availability: 'unavailable', rate: null, reason: 'PROVIDER_RATE_LIMITED' };
      }
      return {
        availability: 'available',
        rate: 26000,
        sourceObservedAt: '2026-09-19T14:00:00.000Z'
      };
    };

    let currentTime = Date.parse('2026-09-21T10:00:00.000Z');
    await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });

    // Step 1 backoff is active
    assert.equal(db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY).metadata.backoffStep, 1);

    // Move past cooldown and succeed
    currentTime += 5 * 60 * 1000 + 1;
    return429 = false;

    const successSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: currentTime });

    assert.equal(successSummary.status, ACQUISITION_FX_STATUS.SUCCESS);
    assert.equal(successSummary.enrichedCount, 1);
    assert.equal(successSummary.backoffStep, 0);
    assert.equal(successSummary.cooldownRemainingMs, 0);
    assert.equal(successSummary.cooldownUntil, null);

    const checkpoint = db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY);
    assert.equal(checkpoint.status, 'success');
    assert.equal(checkpoint.metadata.status, ACQUISITION_FX_STATUS.SUCCESS);
    assert.equal(checkpoint.metadata.backoffStep, 0);
    assert.equal(checkpoint.metadata.cooldownUntilMs, 0);
  });

  await t.test('F. Restart simulation: persisted cooldown survives process reload / memory wipe', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    let resolverCalls = 0;
    const mockResolver = async () => {
      resolverCalls++;
      return { availability: 'unavailable', rate: null, reason: 'PROVIDER_RATE_LIMITED' };
    };

    const t0 = Date.parse('2026-09-21T10:00:00.000Z');
    await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: t0 });
    assert.equal(resolverCalls, 1);

    // Simulate process crash / container restart by wiping all in-memory state
    clearAcquisitionFxMemoryStore();
    assert.equal(getAcquisitionFxRateLimitCooldown(), 0);

    // Invocation after restart at t0 + 1 minute (still within 5m cooldown)
    const t1 = t0 + 1 * 60 * 1000;
    const postRestartSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t1 });

    // Resolver was NOT called because DB checkpoint restored cooldown!
    assert.equal(resolverCalls, 1);
    assert.equal(postRestartSummary.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN);
    assert.equal(postRestartSummary.backoffStep, 1);
    assert.equal(postRestartSummary.cooldownRemainingMs, 4 * 60 * 1000);

    // Status inspection also reflects the restored state
    const status = await getAcquisitionFxStatus({ client: db, now: new Date(t1) });
    assert.equal(status.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN);
    assert.equal(status.backoffStep, 1);
    assert.equal(status.cooldownRemainingMs, 4 * 60 * 1000);
  });

  await t.test('G. Retry-After header larger than current backoff is respected', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    // Step 1 default backoff is 5m (300,000 ms). Upstream returns Retry-After: 12 minutes (720,000 ms).
    const mockResolver = async () => ({
      availability: 'unavailable',
      rate: null,
      reason: 'PROVIDER_RATE_LIMITED',
      retryAfterMs: 12 * 60 * 1000
    });

    const t0 = Date.parse('2026-09-21T10:00:00.000Z');
    const summary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t0 });

    assert.equal(summary.status, ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED);
    assert.equal(summary.backoffStep, 1);
    // 12 minutes respected instead of 5 minutes!
    assert.ok(summary.cooldownRemainingMs > 0 && summary.cooldownRemainingMs <= 12 * 60 * 1000);
    assert.equal(summary.cooldownUntil, new Date(t0 + 12 * 60 * 1000).toISOString());

    // If Retry-After is smaller than current step (e.g. 60 seconds on step 1), step default (5m) is used
    clearAcquisitionFxMemoryStore();
    db.checkpoints.clear();
    const mockSmallerRetryAfter = async () => ({
      availability: 'unavailable',
      rate: null,
      reason: 'PROVIDER_RATE_LIMITED',
      retryAfterMs: 60 * 1000
    });

    const summary2 = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockSmallerRetryAfter
    }, { nowMs: t0 });

    assert.ok(summary2.cooldownRemainingMs > 0 && summary2.cooldownRemainingMs <= 5 * 60 * 1000);
    assert.equal(summary2.cooldownUntil, new Date(t0 + 5 * 60 * 1000).toISOString());
  });

  await t.test('H. Trigger source correctly recorded for scheduler vs manual', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    const mockResolver = async () => ({
      availability: 'unavailable',
      rate: null,
      reason: 'PROVIDER_RATE_LIMITED'
    });

    const t0 = Date.parse('2026-09-21T10:00:00.000Z');
    const schedulerSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t0, triggerSource: 'scheduler' });

    assert.equal(schedulerSummary.triggerSource, 'scheduler');
    let checkpoint = db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY);
    assert.equal(checkpoint.metadata.triggerSource, 'scheduler');

    // Clear cooldown to allow immediate manual trigger
    clearAcquisitionFxMemoryStore();
    const manualSummary = await enrichMissingAcquisitionFx({
      client: db,
      resolveAcquisitionFxFn: mockResolver
    }, { nowMs: t0, triggerSource: 'manual' });

    assert.equal(manualSummary.triggerSource, 'manual');
    checkpoint = db.checkpoints.get(ACQUISITION_FX_SOURCE_KEY);
    assert.equal(checkpoint.metadata.triggerSource, 'manual');
  });

  await t.test('I. Cloudflare scheduler isolation: acquisition-fx failure does not crash overall scheduled() run', async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    console.error = () => {};

    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, authorization: options?.headers?.Authorization });
      if (url.includes('/api/internal/portfolio/acquisition-fx/enrich')) {
        // Simulate acquisition FX enrichment 500 error / rejection
        return {
          ok: false,
          status: 500,
          json: async () => ({ status: 'error', message: 'Downstream DB timeout' })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', data: { success: true } })
      };
    };

    let waitUntilPromise = null;
    try {
      await cloudflareWorker.scheduled(
        { scheduledTime: Date.parse('2026-09-21T10:15:00.000Z') },
        { ALERT_SCHEDULER_TOKEN: 'test-scheduler-token-32-chars-long!!' },
        {
          waitUntil(promise) {
            waitUntilPromise = promise;
          }
        }
      );

      assert.ok(waitUntilPromise);
      const results = await waitUntilPromise;
      assert.equal(results.length, 5);

      // Other jobs succeeded
      assert.equal(results[0].status, 'fulfilled'); // alerts
      assert.equal(results[1].status, 'fulfilled'); // context
      assert.equal(results[2].status, 'fulfilled'); // news
      assert.equal(results[3].status, 'fulfilled'); // portfolio daily valuation

      // Acquisition FX rejected, but Promise.allSettled kept worker from crashing!
      assert.equal(results[4].status, 'rejected');
      assert.equal(results[4].reason.code, 'ACQUISITION_FX_SCHEDULER_HTTP_ERROR');
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });

  await t.test('J. ONDO persisted evidence remains intact throughout all backoff and retry tests', async () => {
    const db = createMockDb({
      baselines: [CANONICAL_ONDO_BASELINE, CANONICAL_ENA_BASELINE]
    });

    const mockResolver = async () => ({
      availability: 'unavailable',
      rate: null,
      reason: 'PROVIDER_RATE_LIMITED'
    });

    // Run multiple cycles of 429 and cooldown
    let currentTime = Date.parse('2026-09-21T10:00:00.000Z');
    await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });
    currentTime += 5 * 60 * 1000 + 1;
    await enrichMissingAcquisitionFx({ client: db, resolveAcquisitionFxFn: mockResolver }, { nowMs: currentTime });

    // Verify ONDO baseline was NEVER touched
    const ondoBaseline = db.baselines.find((b) => b.id === CANONICAL_ONDO_BASELINE.id);
    assert.ok(ondoBaseline);
    assert.equal(ondoBaseline.opening_quantity, 226);
    assert.equal(ondoBaseline.execution_unit_price, 0.36402);
    assert.equal(ondoBaseline.opening_average_cost, 9470.258760528734);
    assert.equal(ondoBaseline.fx_rate_to_vnd, 26015.764959421827);
    assert.equal(ondoBaseline.fx_provenance, 'COINGECKO_USDT_VND');
    assert.equal(ondoBaseline.fx_observed_at, '2026-09-19T14:00:00+00:00');

    // Verify ENA native facts were NEVER mutated
    const enaBaseline = db.baselines.find((b) => b.id === CANONICAL_ENA_BASELINE.id);
    assert.ok(enaBaseline);
    assert.equal(enaBaseline.opening_quantity, 184.50502);
    assert.equal(enaBaseline.execution_unit_price, 0.1641);
    assert.equal(enaBaseline.opening_average_cost, null);
    assert.equal(enaBaseline.fx_rate_to_vnd, null);
  });

  await t.test('K. Cloudflare scheduled path persists trigger_source = "scheduler", manual invocation persists "manual"', async () => {
    let capturedSummary = null;
    const SCHEDULER_TOKEN = 'test-scheduler-token-32-chars-long!!';
    const app = createApp({
      alertSchedulerToken: SCHEDULER_TOKEN,
      enrichMissingAcquisitionFxFn: async (params, options) => {
        capturedSummary = {
          params,
          options,
          status: 'SUCCESS',
          errors: []
        };
        return {
          status: 'SUCCESS',
          triggerSource: options?.triggerSource || 'manual',
          errors: []
        };
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Cloudflare scheduled invocation via runScheduledAcquisitionFxEnrichment
      const scheduledResult = await runScheduledAcquisitionFxEnrichment(
        { ALERT_SCHEDULER_TOKEN: SCHEDULER_TOKEN },
        {
          fetchFn: (url, opts) => fetch(url.replace('https://vn-invest-assistant-api.onrender.com', baseUrl), opts),
          limit: 5
        }
      );
      assert.ok(scheduledResult);
      assert.equal(capturedSummary.options.triggerSource, 'scheduler');

      // 2. Manual invocation (no triggerSource in payload)
      const manualRes = await fetch(`${baseUrl}/api/internal/portfolio/acquisition-fx/enrich`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SCHEDULER_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ limit: 5 })
      });
      assert.equal(manualRes.status, 200);
      assert.equal(capturedSummary.options.triggerSource, 'manual');
    } finally {
      server.close();
    }
  });

  await t.test('L. Status endpoint GET /api/internal/portfolio/acquisition-fx/status is protected by alert scheduler auth', async () => {
    const SCHEDULER_TOKEN = 'test-scheduler-token-32-chars-long!!';
    const app = createApp({
      alertSchedulerToken: SCHEDULER_TOKEN,
      getAcquisitionFxStatusFn: async () => ({
        sourceKey: 'acquisition_fx_enrichment',
        status: 'SUCCESS',
        reason: 'SUCCESS',
        triggerSource: 'scheduler',
        backoffStep: 0,
        cooldownRemainingMs: 0
      })
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. No auth -> 401
      const noAuthRes = await fetch(`${baseUrl}/api/internal/portfolio/acquisition-fx/status`);
      assert.equal(noAuthRes.status, 401);
      const noAuthJson = await noAuthRes.json();
      assert.equal(noAuthJson.code, 'ALERT_SCHEDULER_AUTH_REQUIRED');

      // 2. Wrong token -> 403
      const wrongAuthRes = await fetch(`${baseUrl}/api/internal/portfolio/acquisition-fx/status`, {
        headers: { Authorization: 'Bearer wrong-token-with-at-least-thirty-two-characters' }
      });
      assert.equal(wrongAuthRes.status, 403);
      const wrongAuthJson = await wrongAuthRes.json();
      assert.equal(wrongAuthJson.code, 'ALERT_SCHEDULER_AUTH_INVALID');

      // 3. Correct scheduler token -> 200
      const okRes = await fetch(`${baseUrl}/api/internal/portfolio/acquisition-fx/status`, {
        headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
      });
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.status, 'ok');
      assert.equal(okJson.data.status, 'SUCCESS');

      // 4. Response contains no secrets/tokens
      const rawText = JSON.stringify(okJson);
      assert.equal(rawText.includes(SCHEDULER_TOKEN), false);
      assert.equal(rawText.toLowerCase().includes('secret'), false);
      assert.equal(rawText.toLowerCase().includes('token'), false);
      assert.equal(rawText.toLowerCase().includes('key='), false);
    } finally {
      server.close();
    }
  });
});
