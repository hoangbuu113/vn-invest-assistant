import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  evaluateSingleAlert,
  evaluateAlertsBatch,
  isValidAlertDirection,
  formatAlertCondition
} from '../src/alerts.js';
import { createApp, isValidFinancialNumber } from '../index.js';
import { getMarketSnapshot } from '../src/market.js';
import { normalizeAlert } from '../src/supabase.js';
import { twelvedataProvider } from '../src/providers/twelvedata.js';

describe('Feature 12 — Price Alerts V1 / Cảnh báo giá (Isolated Automated Tests)', () => {
  const SINGLETON_PROFILE_ID = 'singleton-profile-uuid-12345';
  const FIXED_NOW = new Date('2026-08-28T10:00:00.000Z');

  // =========================================================================
  // Section 1: Pure Evaluation Engine Unit Logic
  // =========================================================================
  describe('1. Pure Evaluation Engine Logic (evaluateSingleAlert)', () => {
    test('A1. Above alert: price < target remains active and does not trigger', () => {
      const alert = {
        id: 'alert-1',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-fpt',
        symbol: 'FPT',
        direction: 'above',
        target_price: 80000,
        status: 'active'
      };
      const snapshot = { price: 79500, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, false);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'active');
      assert.equal(outcome.evaluatedPrice, 79500);
      assert.equal(outcome.alert.status, 'active');
      assert.equal(outcome.alert.last_evaluated_price, 79500);
      assert.equal(outcome.alert.triggered_at, undefined);
    });

    test('A2. Above alert: price == target triggers successfully', () => {
      const alert = {
        id: 'alert-1',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-fpt',
        symbol: 'FPT',
        direction: 'above',
        target_price: 80000,
        status: 'active'
      };
      const snapshot = { price: 80000, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, true);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'triggered');
      assert.equal(outcome.evaluatedPrice, 80000);
      assert.equal(outcome.alert.status, 'triggered');
      assert.equal(outcome.alert.last_evaluated_price, 80000);
      assert.equal(outcome.alert.triggered_at, FIXED_NOW.toISOString());
    });

    test('A3. Above alert: price > target triggers successfully', () => {
      const alert = {
        id: 'alert-1',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-fpt',
        symbol: 'FPT',
        direction: 'above',
        target_price: 80000,
        status: 'active'
      };
      const snapshot = { price: 81200, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, true);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'triggered');
      assert.equal(outcome.evaluatedPrice, 81200);
      assert.equal(outcome.alert.status, 'triggered');
      assert.equal(outcome.alert.last_evaluated_price, 81200);
      assert.equal(outcome.alert.triggered_at, FIXED_NOW.toISOString());
    });

    test('B1. Below alert: price > target remains active and does not trigger', () => {
      const alert = {
        id: 'alert-2',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-vcb',
        symbol: 'VCB',
        direction: 'below',
        target_price: 55000,
        status: 'active'
      };
      const snapshot = { price: 56000, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, false);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'active');
      assert.equal(outcome.evaluatedPrice, 56000);
      assert.equal(outcome.alert.status, 'active');
      assert.equal(outcome.alert.last_evaluated_price, 56000);
      assert.equal(outcome.alert.triggered_at, undefined);
    });

    test('B2. Below alert: price == target triggers successfully', () => {
      const alert = {
        id: 'alert-2',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-vcb',
        symbol: 'VCB',
        direction: 'below',
        target_price: 55000,
        status: 'active'
      };
      const snapshot = { price: 55000, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, true);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'triggered');
      assert.equal(outcome.evaluatedPrice, 55000);
      assert.equal(outcome.alert.status, 'triggered');
      assert.equal(outcome.alert.last_evaluated_price, 55000);
      assert.equal(outcome.alert.triggered_at, FIXED_NOW.toISOString());
    });

    test('B3. Below alert: price < target triggers successfully', () => {
      const alert = {
        id: 'alert-2',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-vcb',
        symbol: 'VCB',
        direction: 'below',
        target_price: 55000,
        status: 'active'
      };
      const snapshot = { price: 54200, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, true);
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.status, 'triggered');
      assert.equal(outcome.evaluatedPrice, 54200);
      assert.equal(outcome.alert.status, 'triggered');
      assert.equal(outcome.alert.last_evaluated_price, 54200);
      assert.equal(outcome.alert.triggered_at, FIXED_NOW.toISOString());
    });

    test('C1. Unavailable market price leaves alert active with no fake trigger or 0-comparison', () => {
      const alert = {
        id: 'alert-3',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-hpg',
        symbol: 'HPG',
        direction: 'below',
        target_price: 25000,
        status: 'active'
      };

      // Test with null snapshot, missing price, zero price, negative price, NaN
      const invalidSnapshots = [
        null,
        undefined,
        {},
        { price: null },
        { price: 0 },
        { price: -1000 },
        { price: NaN },
        { price: Infinity }
      ];

      for (const snap of invalidSnapshots) {
        const outcome = evaluateSingleAlert(alert, snap, { now: FIXED_NOW });
        assert.equal(outcome.triggered, false, `Must not trigger for invalid price: ${JSON.stringify(snap)}`);
        assert.equal(outcome.evaluated, false);
        assert.equal(outcome.status, 'unavailable');
        assert.equal(outcome.alert.status, 'active');
        assert.equal(outcome.alert.triggered_at, undefined);
      }
    });

    test('D1. Already-triggered alert is preserved and not re-triggered', () => {
      const alert = {
        id: 'alert-4',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-fpt',
        symbol: 'FPT',
        direction: 'above',
        target_price: 80000,
        status: 'triggered',
        last_evaluated_price: 82000,
        triggered_at: '2026-08-28T09:00:00.000Z'
      };
      const snapshot = { price: 85000, updatedAt: '2026-08-28T09:45:00.000Z' };

      const outcome = evaluateSingleAlert(alert, snapshot, { now: FIXED_NOW });

      assert.equal(outcome.triggered, false);
      assert.equal(outcome.evaluated, false);
      assert.equal(outcome.status, 'triggered');
      assert.equal(outcome.reason, 'already_triggered');
      assert.equal(outcome.alert.triggered_at, '2026-08-28T09:00:00.000Z');
    });

    test('E1. Helpers format condition labels accurately', () => {
      assert.equal(isValidAlertDirection('above'), true);
      assert.equal(isValidAlertDirection('below'), true);
      assert.equal(isValidAlertDirection('ABOVE'), true);
      assert.equal(isValidAlertDirection('invalid'), false);

      assert.equal(formatAlertCondition('above'), 'Giá đạt hoặc vượt');
      assert.equal(formatAlertCondition('below'), 'Giá giảm xuống hoặc thấp hơn');
    });
  });

  // =========================================================================
  // Section 2: Batch Evaluation & Failure Isolation
  // =========================================================================
  describe('2. Batch Evaluation & Failure Isolation (evaluateAlertsBatch)', () => {
    test('H1. Batch evaluation handles multiple assets with failure isolation', () => {
      const alerts = [
        { id: '1', symbol: 'FPT', direction: 'above', target_price: 80000, status: 'active' },
        { id: '2', symbol: 'VCB', direction: 'below', target_price: 55000, status: 'active' },
        { id: '3', symbol: 'HPG', direction: 'above', target_price: 30000, status: 'active' }, // unavailable
        { id: '4', symbol: 'MWG', direction: 'above', target_price: 50000, status: 'triggered' } // already triggered
      ];

      const snapshots = {
        FPT: { price: 82000 }, // triggers
        VCB: { price: 58000 }, // active
        HPG: null // unavailable snapshot
      };

      const summary = evaluateAlertsBatch(alerts, snapshots, { now: FIXED_NOW });

      assert.equal(summary.evaluatedCount, 2); // FPT and VCB evaluated
      assert.equal(summary.triggeredCount, 1); // FPT triggered
      assert.equal(summary.unavailableCount, 1); // HPG unavailable
      assert.equal(summary.results.length, 4);

      // Verify FPT triggered
      assert.equal(summary.updatedAlerts[0].status, 'triggered');
      assert.equal(summary.updatedAlerts[0].last_evaluated_price, 82000);

      // Verify VCB remained active
      assert.equal(summary.updatedAlerts[1].status, 'active');
      assert.equal(summary.updatedAlerts[1].last_evaluated_price, 58000);

      // Verify HPG remained active without fake trigger
      assert.equal(summary.updatedAlerts[2].status, 'active');

      // Verify MWG remained triggered
      assert.equal(summary.updatedAlerts[3].status, 'triggered');
    });

    test('H2. alert projection preserves native quote currency and canonical market metadata', () => {
      const normalized = normalizeAlert({
        id: 'alert-btc',
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: 'asset-btc',
        direction: 'above',
        target_price: 70000,
        status: 'active',
        last_evaluated_price: null,
        last_evaluated_at: null,
        triggered_at: null,
        created_at: FIXED_NOW.toISOString(),
        assets: {
          id: 'asset-btc',
          symbol: 'BTC',
          name: 'Bitcoin',
          asset_type: 'crypto',
          exchange: null,
          market_code: null,
          quote_currency: 'USD',
          market_policy: 'CONTINUOUS_24_7',
          market_timezone: 'UTC',
          quantity_unit: 'coin'
        }
      });

      assert.equal(normalized.assetId, 'asset-btc');
      assert.equal(normalized.assetType, 'crypto');
      assert.equal(normalized.quoteCurrency, 'USD');
      assert.equal(normalized.marketPolicy, 'CONTINUOUS_24_7');
      assert.equal(normalized.marketTimezone, 'UTC');
      assert.equal(normalized.exchange, null);
      assert.equal(normalized.asset.quoteCurrency, 'USD');
    });

    test('H3. USD/VND native-price alert evaluates through repaired generic market snapshot path', async () => {
      const snapshot = await getMarketSnapshot('USD/VND', {
        resolveProviderMappingFn: async () => ({
          asset: {
            id: 'asset-usd-vnd',
            symbol: 'USD/VND',
            assetType: 'fx',
            baseCurrency: 'USD',
            quoteCurrency: 'VND',
            marketPolicy: 'GLOBAL_24_5',
            marketTimezone: 'Asia/Ho_Chi_Minh'
          },
          mapping: { provider: 'twelvedata', providerSymbol: 'USD/VND' }
        }),
        providerAdapter: twelvedataProvider,
        apiKey: 'test-key',
        fetchFn: async () => ({
          ok: true,
          json: async () => ({
            symbol: 'USD/VND',
            rate: '25450.5',
            timestamp: 1724835600
          })
        })
      });

      const outcome = evaluateSingleAlert({
        id: 'alert-usd-vnd',
        asset_id: 'asset-usd-vnd',
        symbol: 'USD/VND',
        direction: 'above',
        target_price: 25400,
        status: 'active'
      }, snapshot, { now: FIXED_NOW });

      assert.equal(snapshot.currency, 'VND');
      assert.equal(snapshot.changeBasis, 'UNAVAILABLE');
      assert.equal(outcome.evaluated, true);
      assert.equal(outcome.triggered, true);
      assert.equal(outcome.evaluatedPrice, 25450.5);
    });
  });

  // =========================================================================
  // Section 3: Production Route Layer Integration & Validation
  // =========================================================================
  describe('3. Production Express Route Layer Integration', () => {
    let serverInstance;
    let baseUrl;
    let alertStore = [];
    let dbErrorActive = false;

    before(async () => {
      alertStore = [
        {
          id: 'alert-singleton-fpt',
          profile_id: SINGLETON_PROFILE_ID,
          asset_id: 'asset-fpt',
          direction: 'above',
          target_price: 80000,
          status: 'active',
          last_evaluated_price: 75000,
          created_at: '2026-08-28T08:00:00.000Z',
          asset: { id: 'asset-fpt', symbol: 'FPT', name: 'Công ty Cổ phần FPT', asset_type: 'stock', exchange: 'HOSE' }
        },
        {
          id: 'alert-foreign-vcb',
          profile_id: 'foreign-profile-999',
          asset_id: 'asset-vcb',
          direction: 'below',
          target_price: 50000,
          status: 'active',
          created_at: '2026-08-28T08:00:00.000Z',
          asset: { id: 'asset-vcb', symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock', exchange: 'HOSE' }
        }
      ];

      const appInstance = createApp({
        getInvestorProfileFn: async () => ({ id: SINGLETON_PROFILE_ID }),
        getAlertsFn: async () => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          return alertStore.filter((a) => a.profile_id === SINGLETON_PROFILE_ID);
        },
        createAlertFn: async ({ asset_id, symbol, direction, target_price }) => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const targetSym = symbol || (asset_id === 'asset-fpt' ? 'FPT' : 'VCB');
          if (targetSym === 'NONEXISTENT') {
            const err = new Error(`Asset '${asset_id || symbol}' not found`);
            err.statusCode = 400;
            throw err;
          }

          // Check duplicate identity: (profile_id, asset_id, direction, target_price)
          const existing = alertStore.find(
            (a) =>
              a.profile_id === SINGLETON_PROFILE_ID &&
              (a.asset?.symbol === targetSym || a.asset_id === asset_id) &&
              a.direction === direction &&
              a.target_price === target_price
          );
          if (existing) return existing;

          const newAlert = {
            id: 'alert-new-' + Date.now(),
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: asset_id || 'asset-' + targetSym.toLowerCase(),
            direction,
            target_price,
            status: 'active',
            last_evaluated_price: null,
            last_evaluated_at: null,
            triggered_at: null,
            created_at: new Date().toISOString(),
            asset: {
              id: asset_id || 'asset-' + targetSym.toLowerCase(),
              symbol: targetSym,
              name: targetSym + ' Corp',
              asset_type: 'stock',
              exchange: 'HOSE'
            }
          };
          alertStore.push(newAlert);
          return newAlert;
        },
        deleteAlertFn: async (alertId) => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const index = alertStore.findIndex(
            (a) => a.profile_id === SINGLETON_PROFILE_ID && a.id === alertId
          );
          if (index === -1) {
            return { id: alertId, deleted: false, message: `Alert '${alertId}' not found` };
          }
          alertStore.splice(index, 1);
          return { id: alertId, deleted: true };
        },
        reactivateAlertFn: async (alertId) => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const alert = alertStore.find(
            (a) => a.profile_id === SINGLETON_PROFILE_ID && a.id === alertId
          );
          if (!alert) {
            const err = new Error(`Alert '${alertId}' not found`);
            err.statusCode = 404;
            throw err;
          }
          alert.status = 'active';
          alert.triggered_at = null;
          alert.last_evaluated_price = null;
          alert.last_evaluated_at = null;
          return alert;
        },
        evaluateAndPersistAlertsFn: async () => {
          if (dbErrorActive) throw new Error('Database query error: Connection terminated');
          const activeAlerts = alertStore.filter(
            (a) => a.profile_id === SINGLETON_PROFILE_ID && a.status === 'active'
          );
          const snaps = { FPT: { price: 82000 } };
          const { evaluatedCount, triggeredCount, unavailableCount, updatedAlerts } = evaluateAlertsBatch(
            activeAlerts,
            snaps,
            { now: FIXED_NOW }
          );

          for (const u of updatedAlerts) {
            const idx = alertStore.findIndex((a) => a.id === u.id);
            if (idx !== -1) alertStore[idx] = u;
          }

          return {
            evaluatedCount,
            triggeredCount,
            unavailableCount,
            alerts: alertStore.filter((a) => a.profile_id === SINGLETON_PROFILE_ID)
          };
        }
      });

      serverInstance = http.createServer(appInstance);
      await new Promise((resolve) => serverInstance.listen(0, resolve));
      const port = serverInstance.address().port;
      baseUrl = 'http://localhost:' + port;
    });

    after(async () => {
      if (serverInstance) {
        await new Promise((resolve) => serverInstance.close(resolve));
      }
    });

    test('1. GET /api/alerts returns 200 with only singleton profile alerts', async () => {
      const res = await fetch(baseUrl + '/api/alerts');
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.count, 1);
      assert.equal(json.data[0].id, 'alert-singleton-fpt');
      assert.ok(!json.data.some((a) => a.id === 'alert-foreign-vcb'), 'Foreign alert must NOT be returned');
    });

    test('2. POST /api/alerts adds valid alert with 201', async () => {
      const res = await fetch(baseUrl + '/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'VCB',
          direction: 'below',
          target_price: 55000
        })
      });
      const json = await res.json();

      assert.equal(res.status, 201);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.asset?.symbol, 'VCB');
      assert.equal(json.data.direction, 'below');
      assert.equal(json.data.target_price, 55000);
      assert.equal(json.data.profile_id, SINGLETON_PROFILE_ID);
    });

    test('3. POST /api/alerts duplicate alert is conflict-safe and idempotent', async () => {
      const res = await fetch(baseUrl + '/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'VCB',
          direction: 'below',
          target_price: 55000
        })
      });
      const json = await res.json();

      assert.equal(res.status, 201);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.asset?.symbol, 'VCB');
    });

    test('4. POST /api/alerts strictly rejects numeric strings and invalid prices (400)', async () => {
      const invalidBodies = [
        { symbol: 'VCB', direction: 'below', target_price: '55000' }, // string
        { symbol: 'VCB', direction: 'below', target_price: 0 }, // zero
        { symbol: 'VCB', direction: 'below', target_price: -100 }, // negative
        { symbol: 'VCB', direction: 'below', target_price: null }, // null
        { symbol: 'VCB', direction: 'invalid_dir', target_price: 55000 } // bad direction
      ];

      for (const body of invalidBodies) {
        const res = await fetch(baseUrl + '/api/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();

        assert.equal(res.status, 400, `Must reject: ${JSON.stringify(body)}`);
        assert.equal(json.status, 'error');
        assert.ok(json.errors || json.message);
      }
    });

    test('5. POST /api/alerts returns 400 for nonexistent asset', async () => {
      const res = await fetch(baseUrl + '/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'NONEXISTENT',
          direction: 'above',
          target_price: 50000
        })
      });
      const json = await res.json();

      assert.equal(res.status, 400);
      assert.equal(json.status, 'error');
      assert.ok(json.message.includes('not found'));
    });

    test('6. POST /api/alerts/evaluate evaluates active alerts', async () => {
      const res = await fetch(baseUrl + '/api/alerts/evaluate', {
        method: 'POST'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(typeof json.data.evaluatedCount, 'number');
      assert.equal(typeof json.data.triggeredCount, 'number');
      assert.ok(Array.isArray(json.data.alerts));
    });

    test('7. POST /api/alerts/:id/reactivate reactivates triggered alert', async () => {
      // Find FPT alert which was triggered in evaluate
      const fptAlert = alertStore.find((a) => a.asset?.symbol === 'FPT');
      assert.ok(fptAlert);

      const res = await fetch(baseUrl + `/api/alerts/${fptAlert.id}/reactivate`, {
        method: 'POST'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.status, 'active');
      assert.equal(json.data.triggered_at, null);
    });

    test('8. DELETE /api/alerts/:id removes alert', async () => {
      const vcbAlert = alertStore.find((a) => a.asset?.symbol === 'VCB' && a.profile_id === SINGLETON_PROFILE_ID);
      assert.ok(vcbAlert);

      const res = await fetch(baseUrl + `/api/alerts/${vcbAlert.id}`, {
        method: 'DELETE'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.deleted, true);

      // Verify removed
      const checkRes = await fetch(baseUrl + '/api/alerts');
      const checkJson = await checkRes.json();
      assert.ok(!checkJson.data.some((a) => a.id === vcbAlert.id));
    });

    test('9. DELETE /api/alerts/:id for nonexistent item returns clean response', async () => {
      const res = await fetch(baseUrl + '/api/alerts/NONEXISTENT_ID', {
        method: 'DELETE'
      });
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.data.deleted, false);
    });
  });
});
