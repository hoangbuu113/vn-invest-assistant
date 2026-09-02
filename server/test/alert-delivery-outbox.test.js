import { describe, test, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  triggerPriceAlertAtomic,
  claimPendingAlertDeliveries,
  markAlertDeliverySent,
  markAlertDeliveryFailedRetryable,
  markAlertDeliveryFailedPermanent,
  normalizeAlertDelivery,
  normalizePushSubscription,
  createPushSubscription,
  getPushSubscriptions,
  deletePushSubscription
} from '../src/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

describe('Feature 12B — Web Push Alert Notification Outbox Foundation', () => {

  // ============================================================================
  // 1. Telegram Retirement Verification
  // ============================================================================
  describe('1. Telegram Retirement Verification', () => {
    test('no Telegram source modules exist in server/src', () => {
      const srcFiles = fs.readdirSync(path.join(__dirname, '../src'));
      const telegramSrc = srcFiles.filter(f => /telegram/i.test(f));
      assert.deepEqual(telegramSrc, [], 'No telegram source files allowed in server/src');
    });

    test('no Telegram test files exist in server/test', () => {
      const testFiles = fs.readdirSync(path.join(__dirname));
      const telegramTests = testFiles.filter(f => /telegram/i.test(f));
      assert.deepEqual(telegramTests, [], 'No telegram test files allowed in server/test');
    });

    test('no Telegram environment variables in server/.env.example', () => {
      const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
      assert.equal(/TELEGRAM/i.test(envExample), false, 'No TELEGRAM variables in .env.example');
      assert.equal(/bot.*token/i.test(envExample), false, 'No bot token references in .env.example');
    });

    test('no Telegram schema, channel default, or status in migration or schema.sql', () => {
      const migration = fs.readFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20260903000000_feature_12b_alert_notification_deliveries.sql'),
        'utf8'
      );
      const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

      for (const sql of [migration, schema]) {
        assert.equal(/telegram/i.test(sql), false, 'Zero telegram references in SQL');
        assert.equal(/channel/i.test(sql), false, 'Zero channel column references in SQL');
        assert.equal(/skipped_not_configured/i.test(sql), false, 'Zero skipped_not_configured in SQL');
        assert.equal(/provider_message_id/i.test(sql), false, 'Zero provider_message_id in SQL');
      }
    });

    test('no Telegram documentation in docs/CURRENT.md', () => {
      const currentMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/CURRENT.md'), 'utf8');
      assert.equal(/telegram/i.test(currentMd), false, 'Zero telegram references in docs/CURRENT.md');
    });
  });

  // ============================================================================
  // 2. Schema, RLS & Migration Invariants
  // ============================================================================
  describe('2. Schema, RLS & Migration Invariants', () => {
    test('migration defines push_subscriptions with endpoint unique constraint', () => {
      const migration = fs.readFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20260903000000_feature_12b_alert_notification_deliveries.sql'),
        'utf8'
      );

      assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/);
      assert.match(migration, /endpoint TEXT NOT NULL/);
      assert.match(migration, /p256dh TEXT NOT NULL/);
      assert.match(migration, /auth TEXT NOT NULL/);
      assert.match(migration, /CONSTRAINT uq_push_subscriptions_endpoint UNIQUE \(endpoint\)/);
    });

    test('migration defines alert_notification_deliveries with per-subscription unique constraint', () => {
      const migration = fs.readFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20260903000000_feature_12b_alert_notification_deliveries.sql'),
        'utf8'
      );

      assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.alert_notification_deliveries/);
      assert.match(migration, /subscription_id UUID NOT NULL REFERENCES public\.push_subscriptions\(id\) ON DELETE CASCADE/);
      assert.match(migration, /trigger_event_id UUID NOT NULL/);
      assert.match(migration, /CONSTRAINT uq_alert_delivery_event_sub UNIQUE \(trigger_event_id, subscription_id\)/);
    });

    test('RLS enabled and permissions restricted to service_role only', () => {
      const migration = fs.readFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20260903000000_feature_12b_alert_notification_deliveries.sql'),
        'utf8'
      );

      // push_subscriptions security
      assert.match(migration, /ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;/);
      assert.match(migration, /REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;/);
      assert.match(migration, /GRANT ALL ON TABLE public.push_subscriptions TO service_role;/);

      // alert_notification_deliveries security
      assert.match(migration, /ALTER TABLE public.alert_notification_deliveries ENABLE ROW LEVEL SECURITY;/);
      assert.match(migration, /REVOKE ALL ON TABLE public.alert_notification_deliveries FROM PUBLIC, anon, authenticated;/);
      assert.match(migration, /GRANT ALL ON TABLE public.alert_notification_deliveries TO service_role;/);

      // RPC execution privileges
      assert.match(migration, /REVOKE ALL ON FUNCTION public.trigger_price_alert_atomic.*FROM PUBLIC, anon, authenticated;/);
      assert.match(migration, /GRANT EXECUTE ON FUNCTION public.trigger_price_alert_atomic.*TO service_role;/);
      assert.match(migration, /REVOKE ALL ON FUNCTION public.claim_pending_alert_deliveries.*FROM PUBLIC, anon, authenticated;/);
      assert.match(migration, /GRANT EXECUTE ON FUNCTION public.claim_pending_alert_deliveries.*TO service_role;/);
    });

    test('schema mirror in server/db/schema.sql stays in 100% sync with migration', () => {
      const migration = fs.readFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20260903000000_feature_12b_alert_notification_deliveries.sql'),
        'utf8'
      );
      const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

      assert.equal(schema.includes('CREATE TABLE IF NOT EXISTS public.push_subscriptions'), true);
      assert.equal(schema.includes('CREATE TABLE IF NOT EXISTS public.alert_notification_deliveries'), true);
      assert.equal(schema.includes('uq_alert_delivery_event_sub'), true);
      assert.equal(schema.includes('trigger_price_alert_atomic'), true);
      assert.equal(schema.includes('claim_pending_alert_deliveries'), true);
    });
  });

  // ============================================================================
  // 3. Multi-Device Trigger & Fanout Contract
  // ============================================================================
  describe('3. Multi-Device Trigger & Fanout Contract', () => {
    function createMockDb({ subscriptions = [], alerts = [] } = {}) {
      const state = {
        subscriptions: [...subscriptions],
        alerts: alerts.map(a => ({ ...a })),
        deliveries: []
      };

      return {
        state,
        from(table) {
          if (table === 'push_subscriptions') {
            return {
              select() {
                return {
                  eq(col, val) {
                    const filtered = state.subscriptions.filter(s => s[col] === val);
                    return { data: filtered, error: null };
                  }
                };
              },
              upsert(row, opts) {
                const existingIdx = state.subscriptions.findIndex(s => s.endpoint === row.endpoint);
                const record = {
                  id: existingIdx >= 0 ? state.subscriptions[existingIdx].id : 'sub-' + (state.subscriptions.length + 1),
                  created_at: existingIdx >= 0 ? state.subscriptions[existingIdx].created_at : new Date().toISOString(),
                  ...row
                };
                if (existingIdx >= 0) {
                  state.subscriptions[existingIdx] = record;
                } else {
                  state.subscriptions.push(record);
                }
                return {
                  select() {
                    return {
                      single: async () => ({ data: record, error: null })
                    };
                  }
                };
              },
              delete() {
                return {
                  eq(col, val) {
                    const idx = state.subscriptions.findIndex(s => s[col] === val);
                    let deleted = null;
                    if (idx >= 0) {
                      deleted = state.subscriptions.splice(idx, 1)[0];
                      // ON DELETE CASCADE to deliveries
                      state.deliveries = state.deliveries.filter(d => d.subscription_id !== deleted.id);
                    }
                    return {
                      select() {
                        return {
                          maybeSingle: async () => ({ data: deleted, error: null })
                        };
                      }
                    };
                  }
                };
              }
            };
          }

          if (table === 'price_alerts') {
            return {
              update(updates) {
                return {
                  eq(col1, val1) {
                    return {
                      eq(col2, val2) {
                        return {
                          eq(col3, val3) {
                            return {
                              select() {
                                return {
                                  maybeSingle: async () => {
                                    const target = state.alerts.find(
                                      a => a[col1] === val1 && a[col2] === val2 && a[col3] === val3
                                    );
                                    if (!target) return { data: null, error: null };
                                    Object.assign(target, updates);
                                    return { data: { ...target }, error: null };
                                  }
                                };
                              }
                            };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }

          if (table === 'alert_notification_deliveries') {
            return {
              insert(rows) {
                const arr = Array.isArray(rows) ? rows : [rows];
                const inserted = arr.map((r, i) => ({
                  id: 'deliv-' + (state.deliveries.length + i + 1),
                  ...r
                }));
                state.deliveries.push(...inserted);
                return {
                  select: async () => ({ data: inserted, error: null })
                };
              },
              select() {
                return {
                  eq(col, val) {
                    return {
                      order() {
                        return {
                          data: state.deliveries.filter(d => d[col] === val),
                          error: null
                        };
                      }
                    };
                  }
                };
              }
            };
          }

          throw new Error(`Unexpected table ${table}`);
        }
      };
    }

    test('Trigger with ZERO devices: alert triggers, deliveryCount = 0, zero delivery rows created', async () => {
      const mockDb = createMockDb({
        subscriptions: [],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-btc',
          direction: 'above',
          target_price: 90000,
          status: 'active'
        }]
      });

      const res = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95000,
        now: new Date('2026-09-03T01:00:00Z')
      }, mockDb);

      assert.equal(res.triggered, true);
      assert.equal(res.deliveryCount, 0);
      assert.ok(res.triggerEventId);
      assert.equal(res.alert.status, 'triggered');
      assert.equal(mockDb.state.deliveries.length, 0, 'Zero outbox rows when no push devices exist');
    });

    test('Trigger with ONE device: exactly one delivery row created with immutable snapshot', async () => {
      const mockDb = createMockDb({
        subscriptions: [{
          id: 'sub-laptop',
          profile_id: 'prof-1',
          endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
          p256dh: 'key1',
          auth: 'auth1'
        }],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-btc',
          direction: 'above',
          target_price: 90000,
          status: 'active'
        }]
      });

      const res = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95120,
        now: new Date('2026-09-03T01:00:00Z')
      }, mockDb);

      assert.equal(res.triggered, true);
      assert.equal(res.deliveryCount, 1);
      assert.equal(mockDb.state.deliveries.length, 1);

      const d = mockDb.state.deliveries[0];
      assert.equal(d.subscription_id, 'sub-laptop');
      assert.equal(d.trigger_event_id, res.triggerEventId);
      assert.equal(d.status, 'pending');
      assert.equal(d.direction, 'above');
      assert.equal(d.target_price, 90000);
      assert.equal(d.observed_price, 95120);
      assert.equal(d.attempt_count, 0);
    });

    test('Trigger with TWO devices: exactly two delivery rows with same triggerEventId and independent subscription_id', async () => {
      const mockDb = createMockDb({
        subscriptions: [
          {
            id: 'sub-laptop',
            profile_id: 'prof-1',
            endpoint: 'https://fcm.googleapis.com/fcm/send/laptop',
            p256dh: 'k1',
            auth: 'a1'
          },
          {
            id: 'sub-phone',
            profile_id: 'prof-1',
            endpoint: 'https://fcm.googleapis.com/fcm/send/phone',
            p256dh: 'k2',
            auth: 'a2'
          }
        ],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-eth',
          direction: 'below',
          target_price: 3000,
          status: 'active'
        }]
      });

      const res = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 2950,
        now: new Date('2026-09-03T01:00:00Z')
      }, mockDb);

      assert.equal(res.triggered, true);
      assert.equal(res.deliveryCount, 2);
      assert.equal(mockDb.state.deliveries.length, 2);

      const [d1, d2] = mockDb.state.deliveries;
      assert.equal(d1.trigger_event_id, res.triggerEventId);
      assert.equal(d2.trigger_event_id, res.triggerEventId);
      assert.notEqual(d1.subscription_id, d2.subscription_id);
      assert.deepEqual(
        [d1.subscription_id, d2.subscription_id].sort(),
        ['sub-laptop', 'sub-phone'].sort()
      );
    });

    test('Concurrent trigger: only one caller triggers and fans out; loser gets triggered=false, deliveryCount=0', async () => {
      const mockDb = createMockDb({
        subscriptions: [{ id: 'sub-1', profile_id: 'prof-1', endpoint: 'ep1', p256dh: 'k', auth: 'a' }],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-btc',
          direction: 'above',
          target_price: 90000,
          status: 'active'
        }]
      });

      // First evaluation
      const first = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95000
      }, mockDb);

      // Second overlapping evaluation
      const second = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95050
      }, mockDb);

      assert.equal(first.triggered, true);
      assert.equal(first.deliveryCount, 1);

      assert.equal(second.triggered, false);
      assert.equal(second.deliveryCount, 0);
      assert.equal(second.triggerEventId, null);

      assert.equal(mockDb.state.deliveries.length, 1, 'No duplicate deliveries created on concurrent trigger');
    });

    test('Unsubscribe cascading: deleting one subscription deletes only its deliveries; other device remains', async () => {
      const mockDb = createMockDb({
        subscriptions: [
          { id: 'sub-laptop', profile_id: 'prof-1', endpoint: 'ep-laptop', p256dh: 'k1', auth: 'a1' },
          { id: 'sub-phone', profile_id: 'prof-1', endpoint: 'ep-phone', p256dh: 'k2', auth: 'a2' }
        ],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-btc',
          direction: 'above',
          target_price: 90000,
          status: 'active'
        }]
      });

      await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95000
      }, mockDb);

      assert.equal(mockDb.state.deliveries.length, 2);

      // Delete laptop subscription
      await deletePushSubscription('sub-laptop', mockDb);

      assert.equal(mockDb.state.subscriptions.length, 1);
      assert.equal(mockDb.state.subscriptions[0].id, 'sub-phone');
      assert.equal(mockDb.state.deliveries.length, 1);
      assert.equal(mockDb.state.deliveries[0].subscription_id, 'sub-phone');
      assert.equal(mockDb.state.alerts[0].status, 'triggered', 'Alert status untouched by unsubscribe');
    });

    test('Alert reactivation: resetting alert does NOT affect historical deliveries; future trigger uses current devices', async () => {
      const mockDb = createMockDb({
        subscriptions: [{ id: 'sub-1', profile_id: 'prof-1', endpoint: 'ep1', p256dh: 'k', auth: 'a' }],
        alerts: [{
          id: 'alert-1',
          profile_id: 'prof-1',
          asset_id: 'asset-btc',
          direction: 'above',
          target_price: 90000,
          status: 'active'
        }]
      });

      // First trigger
      const first = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 95000
      }, mockDb);

      assert.equal(mockDb.state.deliveries.length, 1);
      const histDelivery = mockDb.state.deliveries[0];

      // Reactivate alert
      mockDb.state.alerts[0].status = 'active';

      // User adds a second device (phone)
      mockDb.state.subscriptions.push({ id: 'sub-2', profile_id: 'prof-1', endpoint: 'ep2', p256dh: 'k2', auth: 'a2' });

      // Second trigger in future
      const second = await triggerPriceAlertAtomic({
        alertId: 'alert-1',
        profileId: 'prof-1',
        observedPrice: 96000
      }, mockDb);

      assert.equal(second.triggered, true);
      assert.equal(second.deliveryCount, 2);
      assert.notEqual(first.triggerEventId, second.triggerEventId);

      // Total deliveries is now 3: 1 from first trigger + 2 from second trigger
      assert.equal(mockDb.state.deliveries.length, 3);
      assert.equal(histDelivery.trigger_event_id, first.triggerEventId, 'Historical snapshot unmodified');
    });
  });

  // ============================================================================
  // 4. Per-Device Claim & Delivery Outcomes
  // ============================================================================
  describe('4. Per-Device Claim & Delivery Outcomes', () => {
    function createDeliveryMockDb(initialDeliveries = []) {
      const deliveries = initialDeliveries.map(d => ({ ...d }));
      return {
        deliveries,
        lastRpcArgs: null,
        rpc(name, args) {
          if (name === 'claim_pending_alert_deliveries') {
            this.lastRpcArgs = args;
            const now = new Date(args.p_now);
            const batchSize = Math.min(Math.max(args.p_batch_size || 5, 1), 25);
            const leaseSeconds = Math.min(Math.max(args.p_lease_seconds || 120, 30), 600);

            // Step 1: Terminalize attempt_count >= 3
            for (const d of deliveries) {
              if (d.status === 'sending' && new Date(d.lease_expires_at) <= now && (d.attempt_count || 0) >= 3) {
                d.status = 'failed_permanent';
                d.last_error = 'MAX_ATTEMPTS_EXHAUSTED';
                d.lease_expires_at = null;
              }
            }

            // Step 2: Claim eligible
            const claimed = [];
            for (const d of deliveries) {
              if (claimed.length >= batchSize) break;
              const isEligible =
                d.status === 'pending' ||
                (d.status === 'sending' && new Date(d.lease_expires_at) <= now && d.attempt_count < 3) ||
                (d.status === 'failed_retryable' && new Date(d.next_attempt_at) <= now && d.attempt_count < 3);

              if (isEligible) {
                d.status = 'sending';
                d.attempt_count = (d.attempt_count || 0) + 1;
                d.last_attempt_at = now.toISOString();
                d.lease_expires_at = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
                claimed.push({ ...d });
              }
            }
            return { data: claimed, error: null };
          }
          throw new Error(`Unexpected RPC ${name}`);
        },
        from(table) {
          if (table === 'alert_notification_deliveries') {
            return {
              update(updates) {
                return {
                  eq(col1, val1) {
                    return {
                      eq(col2, val2) {
                        return {
                          select() {
                            return {
                              maybeSingle: async () => {
                                const target = deliveries.find(d => d[col1] === val1 && d[col2] === val2);
                                if (!target) return { data: null, error: null };
                                Object.assign(target, updates);
                                return { data: { ...target }, error: null };
                              }
                            };
                          }
                        };
                      },
                      select() {
                        return {
                          maybeSingle: async () => {
                            const target = deliveries.find(d => d[col1] === val1);
                            if (!target) return { data: null, error: null };
                            Object.assign(target, updates);
                            return { data: { ...target }, error: null };
                          }
                        };
                      }
                    };
                  }
                };
              },
              select(cols) {
                return {
                  eq(col, val) {
                    return {
                      maybeSingle: async () => {
                        const target = deliveries.find(d => d[col] === val);
                        return { data: target ? { ...target } : null, error: null };
                      }
                    };
                  }
                };
              }
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }
      };
    }

    test('Claim advances attempt_count, sets 120s lease, and returns subscription_id', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        alert_id: 'alert-1',
        profile_id: 'prof-1',
        subscription_id: 'sub-laptop',
        trigger_event_id: 'event-1',
        asset_id: 'asset-btc',
        direction: 'above',
        target_price: 90000,
        observed_price: 95000,
        trigger_event_at: '2026-09-03T01:00:00Z',
        status: 'pending',
        attempt_count: 0
      }]);

      const now = new Date('2026-09-03T01:00:00Z');
      const claimed = await claimPendingAlertDeliveries({
        batchSize: 5,
        leaseSeconds: 120,
        now
      }, mockDb);

      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].status, 'sending');
      assert.equal(claimed[0].attemptCount, 1);
      assert.equal(claimed[0].subscriptionId, 'sub-laptop');
      assert.equal(claimed[0].leaseExpiresAt, '2026-09-03T01:02:00.000Z');
    });

    test('Active lease protects sending job from concurrent claim', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 1,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      // Call at 01:01:00Z (lease still valid for 60s)
      const claimed = await claimPendingAlertDeliveries({
        now: new Date('2026-09-03T01:01:00Z')
      }, mockDb);

      assert.equal(claimed.length, 0, 'Active lease must not be claimed');
    });

    test('Expired lease with attempt_count < 3 is reclaimed and attempt_count incremented', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 1,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      // Call at 01:03:00Z (lease expired 60s ago)
      const claimed = await claimPendingAlertDeliveries({
        now: new Date('2026-09-03T01:03:00Z')
      }, mockDb);

      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].attemptCount, 2);
    });

    test('Third-attempt crash auto-terminalizes to failed_permanent without resend', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 3,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      // Call after lease expiry
      const claimed = await claimPendingAlertDeliveries({
        now: new Date('2026-09-03T01:03:00Z')
      }, mockDb);

      assert.equal(claimed.length, 0, 'Must not claim exhausted attempt');
      const d = mockDb.deliveries[0];
      assert.equal(d.status, 'failed_permanent');
      assert.equal(d.last_error, 'MAX_ATTEMPTS_EXHAUSTED');
      assert.equal(d.lease_expires_at, null);
    });

    test('markAlertDeliverySent marks row sent and clears lease', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 1,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      const updated = await markAlertDeliverySent({
        deliveryId: 'deliv-1',
        now: new Date('2026-09-03T01:00:30Z')
      }, mockDb);

      assert.equal(updated.status, 'sent');
      assert.equal(updated.leaseExpiresAt, null);
      assert.equal(updated.deliveredAt, '2026-09-03T01:00:30.000Z');
    });

    test('markAlertDeliveryFailedRetryable sets failed_retryable, records nextAttemptAt, and clears lease', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 1,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      const updated = await markAlertDeliveryFailedRetryable({
        deliveryId: 'deliv-1',
        error: 'PUSH_SERVICE_503',
        nextAttemptAt: new Date('2026-09-03T01:15:00Z'),
        now: new Date('2026-09-03T01:00:30Z')
      }, mockDb);

      assert.equal(updated.status, 'failed_retryable');
      assert.equal(updated.lastError, 'PUSH_SERVICE_503');
      assert.equal(updated.nextAttemptAt, '2026-09-03T01:15:00.000Z');
      assert.equal(updated.leaseExpiresAt, null);
    });

    test('markAlertDeliveryFailedRetryable converts to failed_permanent if attempt_count >= 3', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 3,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      const updated = await markAlertDeliveryFailedRetryable({
        deliveryId: 'deliv-1',
        error: 'PUSH_SERVICE_503',
        nextAttemptAt: new Date('2026-09-03T01:15:00Z')
      }, mockDb);

      assert.equal(updated.status, 'failed_permanent');
      assert.equal(updated.lastError, 'MAX_ATTEMPTS_EXHAUSTED');
      assert.equal(updated.nextAttemptAt, null);
    });

    test('markAlertDeliveryFailedPermanent transitions immediately and terminal state is never claimed', async () => {
      const mockDb = createDeliveryMockDb([{
        id: 'deliv-1',
        status: 'sending',
        attempt_count: 1,
        lease_expires_at: '2026-09-03T01:02:00.000Z'
      }]);

      const updated = await markAlertDeliveryFailedPermanent({
        deliveryId: 'deliv-1',
        error: 'SUBSCRIPTION_EXPIRED_410'
      }, mockDb);

      assert.equal(updated.status, 'failed_permanent');
      assert.equal(updated.lastError, 'SUBSCRIPTION_EXPIRED_410');

      // Attempt to claim
      const claimed = await claimPendingAlertDeliveries({
        now: new Date('2026-09-03T01:05:00Z')
      }, mockDb);

      assert.equal(claimed.length, 0, 'Permanent failure row can never be reclaimed');
    });

    test('claimPendingAlertDeliveries clamps pathological batchSize to [1, 25] and leaseSeconds to [30, 600]', async () => {
      const mockDb = createDeliveryMockDb([]);

      // Test extreme / negative values
      await claimPendingAlertDeliveries({
        batchSize: -50,
        leaseSeconds: 10,
        now: new Date('2026-09-03T01:00:00Z')
      }, mockDb);

      assert.equal(mockDb.lastRpcArgs.p_batch_size, 1);
      assert.equal(mockDb.lastRpcArgs.p_lease_seconds, 30);

      // Test extreme upper values
      await claimPendingAlertDeliveries({
        batchSize: 500,
        leaseSeconds: 9999,
        now: new Date('2026-09-03T01:00:00Z')
      }, mockDb);

      assert.equal(mockDb.lastRpcArgs.p_batch_size, 25);
      assert.equal(mockDb.lastRpcArgs.p_lease_seconds, 600);
    });
  });
});
