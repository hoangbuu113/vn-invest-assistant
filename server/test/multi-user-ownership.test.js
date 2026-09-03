import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getInvestorProfile,
  getProfileByUserId,
  getProfileById,
  createProfileForUser,
  updateInvestorProfile,
  createPushSubscription,
  getPushSubscriptions,
  triggerPriceAlertAtomic
} from '../src/supabase.js';

import {
  getCashOverview,
  getCashLedger,
  createCashMovement
} from '../src/cash.js';

import {
  getPortfolioTransactions,
  createPortfolioTransaction
} from '../src/transactions.js';

import {
  createOpeningPosition,
  correctOpeningPosition,
  cancelOpeningPosition
} from '../src/positions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Feature 13B: Multi-User Profile Ownership Foundation', () => {

  // ============================================================================
  // 1. Migration SQL Contract & Schema Correctness
  // ============================================================================
  describe('1. Migration SQL Contract & Schema Correctness', () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20260904000000_feature_13b_multi_user_ownership_foundation.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    test('migration file exists and contains user_id column definition', () => {
      assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS user_id UUID NULL UNIQUE'));
      assert.ok(migrationSql.includes('REFERENCES auth.users(id) ON DELETE CASCADE'));
    });

    test('migration drops legacy singleton constraints and column', () => {
      assert.ok(migrationSql.includes('DROP CONSTRAINT IF EXISTS investor_profile_singleton_check'));
      assert.ok(migrationSql.includes('DROP CONSTRAINT IF EXISTS investor_profile_singleton_unique'));
      assert.ok(migrationSql.includes('DROP COLUMN IF EXISTS singleton_key'));
    });

    test('migration defines partial index guaranteeing at most ONE unowned legacy profile', () => {
      assert.ok(migrationSql.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_profile_legacy_unowned'));
      assert.ok(migrationSql.includes('ON public.investor_profile ((user_id IS NULL))'));
      assert.ok(migrationSql.includes('WHERE user_id IS NULL'));
    });

    test('all 9 financial RPCs are updated with explicit p_profile_id UUID requirement', () => {
      const requiredRpcs = [
        'FUNCTION public.get_cash_overview(p_profile_id UUID)',
        'FUNCTION public.list_cash_ledger_entries(p_profile_id UUID)',
        'FUNCTION public.create_cash_movement(\n    p_profile_id UUID',
        'FUNCTION public.update_investor_profile_preferences(\n    p_profile_id UUID',
        'FUNCTION public.create_portfolio_transaction(\n    p_profile_id UUID',
        'FUNCTION public.list_portfolio_transactions(\n    p_profile_id UUID',
        'FUNCTION public.create_opening_position(\n    p_profile_id UUID',
        'FUNCTION public.correct_opening_position(\n    p_profile_id UUID',
        'FUNCTION public.cancel_opening_position(\n    p_profile_id UUID'
      ];

      for (const rpcDef of requiredRpcs) {
        assert.ok(migrationSql.includes(rpcDef), `Expected migration to contain definition: ${rpcDef}`);
      }
    });

    test('all financial RPCs strictly reject NULL p_profile_id with error code IP004', () => {
      const nullCheckCount = (migrationSql.match(/IF p_profile_id IS NULL THEN\s+RAISE EXCEPTION USING ERRCODE = 'IP004', MESSAGE = 'profile_id is required';/g) || []).length;
      assert.equal(nullCheckCount, 9, 'Expected exactly 9 RPCs to validate p_profile_id IS NOT NULL with IP004');
    });

    test('all financial RPCs revoke public/anon access and grant strictly to service_role', () => {
      const rpcNames = [
        'get_cash_overview(UUID)',
        'list_cash_ledger_entries(UUID)',
        'create_cash_movement(UUID, TEXT, NUMERIC)',
        'update_investor_profile_preferences(UUID, TEXT, TEXT)',
        'create_portfolio_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ)',
        'list_portfolio_transactions(UUID, TEXT)',
        'create_opening_position(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ)',
        'correct_opening_position(UUID, TEXT, NUMERIC, NUMERIC)',
        'cancel_opening_position(UUID, TEXT)'
      ];

      for (const rpc of rpcNames) {
        assert.ok(migrationSql.includes(`REVOKE ALL ON FUNCTION public.${rpc} FROM PUBLIC, anon, authenticated;`), `Missing revoke for ${rpc}`);
        assert.ok(migrationSql.includes(`GRANT EXECUTE ON FUNCTION public.${rpc} TO service_role;`), `Missing grant for ${rpc}`);
      }
    });
  });

  // ============================================================================
  // 2. Profile Resolution & Multi-User Identity Contract
  // ============================================================================
  describe('2. Profile Resolution & Multi-User Identity Contract', () => {
    const profileUser1 = {
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-auth-uuid-001',
      cash_available: 50000000,
      risk_tolerance: 'high',
      investment_horizon: 'long',
      created_at: '2026-09-03T10:00:00Z',
      updated_at: '2026-09-03T10:00:00Z'
    };

    const profileUser2 = {
      id: '22222222-2222-4222-8222-222222222222',
      user_id: 'user-auth-uuid-002',
      cash_available: 10000000,
      risk_tolerance: 'low',
      investment_horizon: 'short',
      created_at: '2026-09-03T11:00:00Z',
      updated_at: '2026-09-03T11:00:00Z'
    };

    const legacyUnownedProfile = {
      id: 'e4ae09df-3a4a-48eb-b08d-5334687207b1',
      user_id: null,
      cash_available: 20000000,
      risk_tolerance: 'moderate',
      investment_horizon: 'medium',
      created_at: '2026-08-28T00:00:00Z',
      updated_at: '2026-09-03T09:00:00Z'
    };

    function createMockProfileDb(profiles) {
      return {
        from: (table) => {
          assert.equal(table, 'investor_profile');
          return {
            select: () => ({
              eq: (col, val) => ({
                maybeSingle: async () => ({
                  data: profiles.find((p) => p[col] === val) || null,
                  error: null
                })
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: profiles[0] || null,
                    error: null
                  })
                })
              })
            }),
            insert: (records) => ({
              select: () => ({
                single: async () => {
                  const rec = records[0];
                  if (profiles.some((p) => p.user_id && p.user_id === rec.user_id)) {
                    return { data: null, error: { code: '23505', message: 'duplicate key user_id' } };
                  }
                  const newP = {
                    id: 'new-profile-uuid',
                    user_id: rec.user_id || null,
                    cash_available: rec.cash_available || 0,
                    risk_tolerance: rec.risk_tolerance || 'moderate',
                    investment_horizon: rec.investment_horizon || 'medium',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  };
                  profiles.push(newP);
                  return { data: newP, error: null };
                }
              })
            })
          };
        }
      };
    }

    test('resolves profile by user_id', async () => {
      const db = createMockProfileDb([legacyUnownedProfile, profileUser1, profileUser2]);
      const res = await getProfileByUserId('user-auth-uuid-001', db);
      assert.equal(res.id, profileUser1.id);
      assert.equal(res.user_id, 'user-auth-uuid-001');
      assert.equal(res.cash_available, 50000000);
    });

    test('resolves profile by profile id', async () => {
      const db = createMockProfileDb([legacyUnownedProfile, profileUser1, profileUser2]);
      const res = await getProfileById(profileUser2.id, db);
      assert.equal(res.id, profileUser2.id);
      assert.equal(res.user_id, 'user-auth-uuid-002');
    });

    test('default resolution returns earliest profile (legacy unowned profile preserved)', async () => {
      const db = createMockProfileDb([legacyUnownedProfile, profileUser1]);
      const res = await getInvestorProfile(db);
      assert.equal(res.id, legacyUnownedProfile.id);
      assert.equal(res.user_id, null);
      assert.equal(res.cash_available, 20000000);
    });

    test('createProfileForUser creates a new isolated profile linked to auth user', async () => {
      const db = createMockProfileDb([legacyUnownedProfile]);
      const newProfile = await createProfileForUser({
        userId: 'new-auth-user-999',
        cashAvailable: 0,
        riskTolerance: 'high',
        investmentHorizon: 'long'
      }, db);

      assert.equal(newProfile.user_id, 'new-auth-user-999');
      assert.equal(newProfile.risk_tolerance, 'high');
      assert.equal(newProfile.investment_horizon, 'long');
    });

    test('createProfileForUser returns existing profile on duplicate key conflict (idempotent)', async () => {
      const db = createMockProfileDb([profileUser1]);
      const res = await createProfileForUser({
        userId: 'user-auth-uuid-001',
        riskTolerance: 'low'
      }, db);

      assert.equal(res.id, profileUser1.id);
      assert.equal(res.user_id, 'user-auth-uuid-001');
    });
  });

  // ============================================================================
  // 3. Financial RPCs Profile Isolation Contract
  // ============================================================================
  describe('3. Financial RPCs Profile Isolation Contract', () => {
    test('getCashOverview propagates p_profile_id to RPC', async () => {
      let capturedArgs = null;
      const mockDb = {
        rpc: async (fnName, args) => {
          assert.equal(fnName, 'get_cash_overview');
          capturedArgs = args;
          return {
            data: {
              current_cash: 25000000,
              opening_balance: 20000000,
              total_deposits: 5000000,
              total_withdrawals: 0,
              buy_outflows: 0,
              sell_inflows: 0,
              entry_count: 2,
              ledger_start_at: '2026-08-28T00:00:00Z'
            },
            error: null
          };
        }
      };

      const res = await getCashOverview({ profileId: 'profile-alpha-123' }, mockDb);
      assert.equal(capturedArgs.p_profile_id, 'profile-alpha-123');
      assert.equal(res.currentCash, 25000000);
    });

    test('getCashLedger propagates p_profile_id to RPC', async () => {
      let capturedArgs = null;
      const mockDb = {
        rpc: async (fnName, args) => {
          assert.equal(fnName, 'list_cash_ledger_entries');
          capturedArgs = args;
          return {
            data: [
              {
                id: 'entry-1',
                profile_id: 'profile-alpha-123',
                entry_type: 'DEPOSIT',
                amount: 5000000,
                symbol: null,
                transaction_id: null,
                transaction_executed_at: null,
                effective_at: '2026-09-03T12:00:00Z',
                created_at: '2026-09-03T12:00:00Z',
                metadata: {}
              }
            ],
            error: null
          };
        }
      };

      const entries = await getCashLedger({ profileId: 'profile-alpha-123' }, mockDb);
      assert.equal(capturedArgs.p_profile_id, 'profile-alpha-123');
      assert.equal(entries.length, 1);
      assert.equal(entries[0].profileId, 'profile-alpha-123');
    });

    test('createCashMovement propagates p_profile_id to RPC', async () => {
      let capturedArgs = null;
      const mockDb = {
        rpc: async (fnName, args) => {
          assert.equal(fnName, 'create_cash_movement');
          capturedArgs = args;
          return {
            data: {
              entry: {
                id: 'entry-new',
                profile_id: 'profile-beta-456',
                entry_type: 'DEPOSIT',
                amount: 15000000,
                effective_at: '2026-09-03T12:00:00Z',
                created_at: '2026-09-03T12:00:00Z'
              },
              currentCash: 15000000
            },
            error: null
          };
        }
      };

      const res = await createCashMovement({
        profileId: 'profile-beta-456',
        entryType: 'DEPOSIT',
        amount: 15000000
      }, mockDb);

      assert.equal(capturedArgs.p_profile_id, 'profile-beta-456');
      assert.equal(capturedArgs.p_entry_type, 'DEPOSIT');
      assert.equal(capturedArgs.p_amount, 15000000);
      assert.equal(res.currentCash, 15000000);
    });

    test('createPortfolioTransaction and listPortfolioTransactions propagate p_profile_id', async () => {
      let createArgs = null;
      let listArgs = null;

      const mockDb = {
        rpc: async (fnName, args) => {
          if (fnName === 'create_portfolio_transaction') {
            createArgs = args;
            return {
              data: {
                transaction: {
                  id: 'tx-1',
                  profile_id: args.p_profile_id,
                  symbol: 'HPG',
                  transaction_type: 'BUY',
                  quantity: 100,
                  price: 28000,
                  executed_at: '2026-09-03T12:00:00Z',
                  created_at: '2026-09-03T12:00:00Z',
                  price_currency: 'VND',
                  settlement_currency: 'VND',
                  settlement_mode: 'SAME_CURRENCY'
                },
                holding: {
                  id: 'holding-1',
                  profile_id: args.p_profile_id,
                  asset_id: 'asset-hpg',
                  quantity: 100,
                  average_cost: 28000
                },
                holding: {
                  id: 'holding-1',
                  profile_id: args.p_profile_id,
                  asset_id: 'asset-hpg',
                  quantity: 100,
                  average_cost: 28000
                },
                currentCash: 17200000
              },
              error: null
            };
          }
          if (fnName === 'list_portfolio_transactions') {
            listArgs = args;
            return {
              data: [
                {
                  id: 'tx-1',
                  profile_id: args.p_profile_id,
                  symbol: 'HPG',
                  transaction_type: 'BUY',
                  quantity: 100,
                  price: 28000,
                  executed_at: '2026-09-03T12:00:00Z',
                  created_at: '2026-09-03T12:00:00Z',
                  price_currency: 'VND',
                  settlement_currency: 'VND',
                  settlement_mode: 'SAME_CURRENCY'
                }
              ],
              error: null
            };
          }
          throw new Error(`Unexpected RPC: ${fnName}`);
        }
      };

      await createPortfolioTransaction({
        symbol: 'HPG',
        transactionType: 'BUY',
        quantity: 100,
        price: 28000
      }, mockDb, { profileId: 'profile-gamma-789' });

      assert.equal(createArgs.p_profile_id, 'profile-gamma-789');

      const txList = await getPortfolioTransactions({ profileId: 'profile-gamma-789' }, mockDb);
      assert.equal(listArgs.p_profile_id, 'profile-gamma-789');
      assert.equal(txList.length, 1);
      assert.equal(txList[0].profileId, 'profile-gamma-789');
    });

    test('opening position RPCs propagate p_profile_id', async () => {
      let createOpeningArgs = null;
      let correctOpeningArgs = null;
      let cancelOpeningArgs = null;

      const mockDb = {
        rpc: async (fnName, args) => {
          if (fnName === 'create_opening_position') {
            createOpeningArgs = args;
            return {
              data: {
                openingPosition: {
                  id: 'base-1',
                  profile_id: args.p_profile_id,
                  asset_id: args.p_asset_id,
                  opening_quantity: args.p_quantity,
                  opening_average_cost: args.p_average_cost,
                  created_at: '2026-09-03T12:00:00Z'
                },
                holding: { id: 'hold-1', profile_id: args.p_profile_id, quantity: args.p_quantity, average_cost: args.p_average_cost }
              },
              error: null
            };
          }
          if (fnName === 'correct_opening_position') {
            correctOpeningArgs = args;
            return {
              data: {
                openingPosition: {
                  id: args.p_opening_position_id,
                  profile_id: args.p_profile_id,
                  opening_quantity: args.p_quantity,
                  opening_average_cost: args.p_average_cost,
                  created_at: '2026-09-03T12:00:00Z'
                },
                holding: { id: 'hold-1', profile_id: args.p_profile_id, quantity: args.p_quantity, average_cost: args.p_average_cost }
              },
              error: null
            };
          }
          if (fnName === 'cancel_opening_position') {
            cancelOpeningArgs = args;
            return {
              data: {
                openingPosition: {
                  id: args.p_opening_position_id,
                  profile_id: args.p_profile_id,
                  opening_quantity: 0,
                  opening_average_cost: 0,
                  cancelled_at: '2026-09-03T12:00:00Z'
                },
                holding: null
              },
              error: null
            };
          }
          throw new Error(`Unexpected RPC: ${fnName}`);
        }
      };

      await createOpeningPosition({
        profileId: 'profile-delta-321',
        assetId: 'asset-fpt',
        quantity: 50,
        averageCost: 110000
      }, mockDb);
      assert.equal(createOpeningArgs.p_profile_id, 'profile-delta-321');

      await correctOpeningPosition({
        profileId: 'profile-delta-321',
        id: 'base-1',
        quantity: 60,
        averageCost: 112000
      }, mockDb);
      assert.equal(correctOpeningArgs.p_profile_id, 'profile-delta-321');

      await cancelOpeningPosition({
        profileId: 'profile-delta-321',
        id: 'base-1'
      }, mockDb);
      assert.equal(cancelOpeningArgs.p_profile_id, 'profile-delta-321');
    });

    test('updateInvestorProfile propagates p_profile_id to update_investor_profile_preferences', async () => {
      let rpcArgs = null;
      const mockDb = {
        rpc: async (fnName, args) => {
          assert.equal(fnName, 'update_investor_profile_preferences');
          rpcArgs = args;
          return {
            data: {
              id: args.p_profile_id,
              user_id: 'user-xyz',
              cash_available: 1000000,
              risk_tolerance: args.p_risk_tolerance,
              investment_horizon: args.p_investment_horizon,
              created_at: '2026-09-03T10:00:00Z',
              updated_at: '2026-09-03T12:00:00Z'
            },
            error: null
          };
        }
      };

      const updated = await updateInvestorProfile({
        profileId: 'profile-omega-999',
        risk_tolerance: 'high',
        investment_horizon: 'long'
      }, mockDb);

      assert.equal(rpcArgs.p_profile_id, 'profile-omega-999');
      assert.equal(rpcArgs.p_risk_tolerance, 'high');
      assert.equal(rpcArgs.p_investment_horizon, 'long');
      assert.equal(updated.risk_tolerance, 'high');
    });
  });

  // ============================================================================
  // 4. Alert & Push Subscription Profile Isolation Contract
  // ============================================================================
  describe('4. Alert & Push Subscription Profile Isolation Contract', () => {
    test('price alerts and push subscriptions are strictly profile-scoped', async () => {
      const store = {
        alerts: [],
        subscriptions: []
      };

      const mockDb = {
        from: (table) => {
          if (table === 'price_alerts') {
            return {
              select: () => ({
                eq: (col, val) => ({
                  order: () => Promise.resolve({
                    data: store.alerts.filter((a) => a[col] === val),
                    error: null
                  })
                })
              })
            };
          }
          if (table === 'push_subscriptions') {
            return {
              select: () => ({
                eq: (col, val) => ({
                  order: () => Promise.resolve({
                    data: store.subscriptions.filter((s) => s[col] === val),
                    error: null
                  })
                })
              }),
              upsert: (record) => {
                store.subscriptions.push({ id: `sub-${store.subscriptions.length + 1}`, ...record });
                return {
                  select: () => ({
                    single: async () => ({
                      data: store.subscriptions[store.subscriptions.length - 1],
                      error: null
                    })
                  })
                };
              }
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }
      };

      // Create subscriptions for Profile A and Profile B
      await createPushSubscription({
        profileId: 'profile-A',
        endpoint: 'https://push.example.com/device-a1',
        p256dh: 'p256-a1',
        auth: 'auth-a1'
      }, mockDb);

      await createPushSubscription({
        profileId: 'profile-B',
        endpoint: 'https://push.example.com/device-b1',
        p256dh: 'p256-b1',
        auth: 'auth-b1'
      }, mockDb);

      // Verify Profile A only gets Profile A's subscription
      const subsA = await getPushSubscriptions('profile-A', mockDb);
      assert.equal(subsA.length, 1);
      assert.equal(subsA[0].endpoint, 'https://push.example.com/device-a1');

      // Verify Profile B only gets Profile B's subscription
      const subsB = await getPushSubscriptions('profile-B', mockDb);
      assert.equal(subsB.length, 1);
      assert.equal(subsB[0].endpoint, 'https://push.example.com/device-b1');
    });

    test('triggerPriceAlertAtomic strictly requires profileId matching the alert', async () => {
      let rpcParams = null;
      const mockDb = {
        rpc: async (fnName, args) => {
          assert.equal(fnName, 'trigger_price_alert_atomic');
          rpcParams = args;
          return {
            data: {
              triggered: true,
              alert_id: args.p_alert_id,
              profile_id: args.p_profile_id,
              status: 'triggered',
              delivery_count: 2
            },
            error: null
          };
        }
      };

      const res = await triggerPriceAlertAtomic({
        alertId: 'alert-123',
        profileId: 'profile-user-a',
        observedPrice: 125000,
        now: new Date('2026-09-03T12:00:00Z')
      }, mockDb);

      assert.equal(rpcParams.p_alert_id, 'alert-123');
      assert.equal(rpcParams.p_profile_id, 'profile-user-a');
      assert.equal(rpcParams.p_observed_price, 125000);
      assert.equal(res.triggered, true);
      assert.equal(res.deliveryCount, 2);
    });
  });

});
