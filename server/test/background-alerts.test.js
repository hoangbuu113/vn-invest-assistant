import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAlertsBatch, evaluateSingleAlert } from '../src/alerts.js';
import { evaluateAndPersistAlerts } from '../src/supabase.js';
import { createApp } from '../index.js';
import {
  ALERT_EVALUATION_API_BASE_URL,
  ALERT_EVALUATION_CADENCE_MINUTES,
  runScheduledAlertEvaluation
} from '../../client/server/index.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const PROFILE_ID = 'profile-owner';
const SCHEDULER_TOKEN = 'scheduler-token-with-at-least-thirty-two-characters';
const OWNER_TOKEN = 'owner-token-with-at-least-thirty-two-characters';
const NOW = new Date('2026-09-01T10:15:00.000Z');
const runningServers = [];

function asset(symbol = 'FPT') {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    name: symbol,
    asset_type: 'stock',
    exchange: 'HOSE',
    market_code: 'HOSE',
    quote_currency: 'VND',
    base_currency: null,
    market_policy: 'VN_EXCHANGE',
    market_timezone: 'Asia/Ho_Chi_Minh',
    quantity_unit: 'share'
  };
}

function alertRow({ id, direction, targetPrice, status = 'active', symbol = 'FPT' }) {
  const canonicalAsset = asset(symbol);
  return {
    id,
    profile_id: PROFILE_ID,
    asset_id: canonicalAsset.id,
    direction,
    target_price: targetPrice,
    status,
    last_evaluated_price: null,
    last_evaluated_at: null,
    triggered_at: status === 'triggered' ? '2026-08-31T09:00:00.000Z' : null,
    created_at: '2026-08-31T08:00:00.000Z',
    assets: canonicalAsset
  };
}

function createAlertDb(initialAlerts) {
  const alerts = initialAlerts.map((row) => structuredClone(row));
  const profile = {
    id: PROFILE_ID,
    cash_available: 0,
    risk_tolerance: 'moderate',
    investment_horizon: 'medium',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.values = null;
      this.filters = [];
    }

    select() {
      return this;
    }

    update(values) {
      this.operation = 'update';
      this.values = values;
      return this;
    }

    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }

    limit() {
      return this;
    }

    order() {
      return this;
    }

    matches(row) {
      return this.filters.every(([column, value]) => row[column] === value);
    }

    execute() {
      if (this.table === 'investor_profile') {
        return { data: structuredClone(profile), error: null };
      }
      if (this.table !== 'price_alerts') {
        return { data: null, error: { message: `Unexpected table ${this.table}` } };
      }

      if (this.operation === 'update') {
        const row = alerts.find((candidate) => this.matches(candidate));
        if (!row) return { data: null, error: null };
        Object.assign(row, structuredClone(this.values));
        return { data: { id: row.id }, error: null };
      }

      return {
        data: alerts.filter((row) => this.matches(row)).map((row) => structuredClone(row)),
        error: null
      };
    }

    maybeSingle() {
      const result = this.execute();
      if (this.operation === 'update' || this.table === 'investor_profile') {
        return Promise.resolve(result);
      }
      return Promise.resolve({
        data: Array.isArray(result.data) ? (result.data[0] || null) : result.data,
        error: result.error
      });
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  return {
    alerts,
    client: {
      from(table) {
        return new Query(table);
      }
    }
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  runningServers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  await Promise.all(runningServers.splice(0).map(
    (server) => new Promise((resolve) => server.close(resolve))
  ));
});

describe('V1.1 Improvement 04 — reliable background price alerts', () => {
  test('stale last-good observations are explicit and never trigger', () => {
    const outcome = evaluateSingleAlert(
      { id: 'alert-stale', status: 'active', direction: 'above', target_price: 100 },
      { price: 120, freshness: 'stale', cacheStatus: 'stale' },
      { now: NOW }
    );

    assert.equal(outcome.triggered, false);
    assert.equal(outcome.evaluated, false);
    assert.equal(outcome.status, 'stale');
    assert.equal(outcome.reason, 'market_price_stale');
    assert.equal(outcome.evaluatedPrice, 120);

    const batch = evaluateAlertsBatch(
      [{ id: 'alert-stale', symbol: 'FPT', status: 'active', direction: 'above', target_price: 100 }],
      { FPT: { price: 120, freshness: 'stale' } },
      { now: NOW }
    );
    assert.equal(batch.unavailableCount, 1);
    assert.equal(batch.staleCount, 1);
  });

  test('multiple alerts for one asset reuse exactly one canonical snapshot acquisition', async () => {
    const db = createAlertDb([
      alertRow({ id: 'above', direction: 'above', targetPrice: 110 }),
      alertRow({ id: 'below', direction: 'below', targetPrice: 90 })
    ]);
    let snapshotCalls = 0;

    const summary = await evaluateAndPersistAlerts({
      now: NOW,
      getMarketSnapshotFn: async (symbol) => {
        snapshotCalls++;
        assert.equal(symbol, 'FPT');
        return { price: 100, freshness: 'delayed' };
      }
    }, db.client);

    assert.equal(snapshotCalls, 1);
    assert.equal(summary.evaluatedCount, 2);
    assert.equal(summary.triggeredCount, 0);
    assert.equal(db.alerts.every((row) => row.last_evaluated_price === 100), true);
  });

  test('concurrent trigger claims are idempotent and survive a new evaluator invocation', async () => {
    const db = createAlertDb([
      alertRow({ id: 'one-shot', direction: 'above', targetPrice: 100 })
    ]);
    let arrivals = 0;
    let releaseBoth;
    const bothStarted = new Promise((resolve) => {
      releaseBoth = resolve;
    });
    const getMarketSnapshotFn = async () => {
      arrivals++;
      if (arrivals === 2) releaseBoth();
      await bothStarted;
      return { price: 101, freshness: 'delayed' };
    };

    const summaries = await Promise.all([
      evaluateAndPersistAlerts({ now: NOW, getMarketSnapshotFn }, db.client),
      evaluateAndPersistAlerts({
        now: new Date('2026-09-01T10:16:00.000Z'),
        getMarketSnapshotFn
      }, db.client)
    ]);

    assert.equal(arrivals, 2);
    assert.deepEqual(summaries.map((summary) => summary.triggeredCount).sort(), [0, 1]);
    assert.equal(db.alerts[0].status, 'triggered');
    const persistedTriggeredAt = db.alerts[0].triggered_at;
    assert.ok([
      NOW.toISOString(),
      '2026-09-01T10:16:00.000Z'
    ].includes(persistedTriggeredAt));

    let restartedProviderCalls = 0;
    const restarted = await evaluateAndPersistAlerts({
      now: new Date('2026-09-01T10:30:00.000Z'),
      getMarketSnapshotFn: async () => {
        restartedProviderCalls++;
        return { price: 150 };
      }
    }, db.client);
    assert.equal(restartedProviderCalls, 0);
    assert.equal(restarted.triggeredCount, 0);
    assert.equal(db.alerts[0].triggered_at, persistedTriggeredAt);
  });

  test('internal scheduler endpoint rejects absent and wrong credentials', async () => {
    let evaluationCalls = 0;
    const baseUrl = await listen(createApp({
      ownerAccessToken: OWNER_TOKEN,
      alertSchedulerToken: SCHEDULER_TOKEN,
      evaluateAndPersistAlertsFn: async () => {
        evaluationCalls++;
        return { evaluatedCount: 1, triggeredCount: 0, unavailableCount: 0, staleCount: 0, alerts: [] };
      }
    }));

    const missing = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, { method: 'POST' });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, 'ALERT_SCHEDULER_AUTH_REQUIRED');

    for (const token of ['wrong-token-with-at-least-thirty-two-characters', OWNER_TOKEN]) {
      const response = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'ALERT_SCHEDULER_AUTH_INVALID');
    }
    assert.equal(evaluationCalls, 0);
  });

  test('authorized scheduled evaluation returns counts without private alert rows', async () => {
    let evaluationCalls = 0;
    const baseUrl = await listen(createApp({
      ownerAccessToken: OWNER_TOKEN,
      alertSchedulerToken: SCHEDULER_TOKEN,
      evaluateAndPersistAlertsFn: async ({ now }) => {
        evaluationCalls++;
        assert.equal(now instanceof Date, true);
        return { evaluatedCount: 3, triggeredCount: 1, unavailableCount: 1, staleCount: 1, alerts: [{ id: 'private' }] };
      }
    }));

    const response = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(evaluationCalls, 1);
    assert.deepEqual(payload.data, {
      evaluatedCount: 3,
      triggeredCount: 1,
      unavailableCount: 1,
      staleCount: 1,
      deliveryClaimedCount: 0,
      deliverySentCount: 0,
      deliveryRetryableFailureCount: 0,
      deliveryPermanentFailureCount: 0,
      deliveryExpiredSubscriptionCount: 0
    });
    assert.equal(JSON.stringify(payload).includes('private'), false);
  });

  test('scheduler fails closed without its secret and sends one protected request when configured', async () => {
    let calls = 0;
    await assert.rejects(
      () => runScheduledAlertEvaluation({}, {
        fetchFn: async () => {
          calls++;
          throw new Error('must not run');
        }
      }),
      (error) => error.code === 'ALERT_SCHEDULER_NOT_CONFIGURED'
    );
    assert.equal(calls, 0);

    const data = await runScheduledAlertEvaluation(
      { ALERT_SCHEDULER_TOKEN: SCHEDULER_TOKEN },
      {
        fetchFn: async (url, options) => {
          calls++;
          assert.equal(url, `${ALERT_EVALUATION_API_BASE_URL}/api/internal/alerts/evaluate`);
          assert.equal(options.method, 'POST');
          assert.equal(options.headers.Authorization, `Bearer ${SCHEDULER_TOKEN}`);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              data: { evaluatedCount: 2, triggeredCount: 1, unavailableCount: 0, staleCount: 0 }
            })
          };
        }
      }
    );

    assert.equal(calls, 1);
    assert.deepEqual(data, { evaluatedCount: 2, triggeredCount: 1, unavailableCount: 0, staleCount: 0 });
  });

  test('Cloudflare deployment contract uses one 15-minute Cron Trigger and the existing Worker', () => {
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'wrangler.jsonc'), 'utf8'));
    assert.equal(ALERT_EVALUATION_CADENCE_MINUTES, 15);
    assert.equal(config.name, 'vn-invest-assistant');
    assert.equal(config.main, 'client/server/index.js');
    assert.equal(config.assets?.binding, 'ASSETS');
    assert.deepEqual(config.triggers?.crons, ['*/15 * * * *']);
  });

  test('Alert Center states the automatic cadence and absence of notification delivery', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'client', 'src', 'components', 'AlertCenterSection.jsx'),
      'utf8'
    );
    assert.match(source, /kiểm tra tự động khoảng 15 phút một lần/);
    assert.match(source, /không gửi push, email hoặc SMS/);
  });
});
