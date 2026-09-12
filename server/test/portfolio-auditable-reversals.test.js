import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../index.js';
import { ownerFetch } from './helpers/owner-auth.js';
import {
  reconstructCashBalance,
  reconstructHoldingsState
} from '../src/performance.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'server', 'db', 'schema.sql');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase', 'migrations', '20260912000000_portfolio_auditable_reversals.sql');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const USER_2_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_2_ID = '44444444-4444-4444-8444-444444444444';

const FPT_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BTC_ASSET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE SCHEMA extensions;
  `);

  const schema = await readFile(SCHEMA_PATH, 'utf8');
  await db.exec(schema);

  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_ID}'), ('${USER_2_ID}');
    INSERT INTO public.investor_profile (
      id, user_id, cash_available, risk_tolerance, investment_horizon
    ) VALUES
      ('${PROFILE_ID}', '${USER_ID}', 100000000, 'moderate', 'long'),
      ('${PROFILE_2_ID}', '${USER_2_ID}', 50000000, 'low', 'medium');

    INSERT INTO public.assets (
      id, symbol, name, asset_type, exchange, market_code, quote_currency,
      base_currency, market_policy, market_timezone, quantity_unit, is_active,
      portfolio_eligibility
    ) VALUES
      ('${FPT_ASSET_ID}', 'FPT', 'FPT Corporation', 'stock', 'HOSE', 'VN', 'VND',
       NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE, 'PORTFOLIO_ELIGIBLE'),
      ('${BTC_ASSET_ID}', 'BTC', 'Bitcoin', 'crypto', 'BINANCE', 'CRYPTO', 'USD',
       'BTC', 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE, 'PORTFOLIO_ELIGIBLE');
  `);

  return db;
}

describe('Portfolio P1B — Auditable Reversals (Database Layer)', () => {
  test('audit table and schema additions exist with strict RLS and service_role grant', async () => {
    const db = await createTestDatabase();
    try {
      const tableCheck = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_reversals'
      `);
      assert.equal(tableCheck.rows.length, 1);

      const rlsCheck = await db.query(`
        SELECT relrowsecurity
        FROM pg_class
        WHERE relname = 'portfolio_reversals'
      `);
      assert.equal(rlsCheck.rows[0].relrowsecurity, true);

      const privCheck = await db.query(`
        SELECT
          has_table_privilege('anon', 'public.portfolio_reversals', 'SELECT') AS anon_select,
          has_table_privilege('authenticated', 'public.portfolio_reversals', 'SELECT') AS auth_select,
          has_table_privilege('service_role', 'public.portfolio_reversals', 'SELECT') AS service_select
      `);
      assert.deepEqual(privCheck.rows[0], {
        anon_select: false,
        auth_select: false,
        service_select: true
      });
    } finally {
      await db.close();
    }
  });

  test('actual migration 20260912000000_portfolio_auditable_reversals.sql executes cleanly on pre-P1B schema', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id UUID PRIMARY KEY);
        CREATE SCHEMA extensions;
      `);

      const fullSchema = await readFile(SCHEMA_PATH, 'utf8');
      const preP1BSchema = fullSchema.split('-- Schema Migration: 20260912000000_portfolio_auditable_reversals.sql')[0];
      assert.ok(preP1BSchema.length > 0 && preP1BSchema.length < fullSchema.length);
      await db.exec(preP1BSchema);

      // Verify reversals table does not exist before migration
      const beforeCheck = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_reversals'
      `);
      assert.equal(beforeCheck.rows.length, 0);

      // Execute actual migration file
      const migrationSql = await readFile(MIGRATION_PATH, 'utf8');
      await db.exec(migrationSql);

      // Verify reversals table exists after migration
      const afterCheck = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_reversals'
      `);
      assert.equal(afterCheck.rows.length, 1);
    } finally {
      await db.close();
    }
  });

  test('Case A: BUY Reversal refunds cash, decrements holding, creates compensating row, preserves original row', async () => {
    const db = await createTestDatabase();
    try {
      // 1. Create initial BUY (10 FPT @ 100,000 VND)
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-for-reversal-1'
        ) AS result
      `);
      const origTxId = buyRes.rows[0].result.transaction.id;
      assert.equal(buyRes.rows[0].result.currentCash, 99000000);

      // 2. Reverse the BUY
      const revRes = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_transaction_id => '${origTxId}'::uuid,
          p_reason => 'Entered wrong quantity by mistake',
          p_idempotency_key => 'buy-rev-key-001'
        ) AS result
      `);
      const revData = revRes.rows[0].result;
      assert.equal(revData.replayed, false);
      assert.equal(revData.reversal.originalEventId, origTxId);
      assert.equal(revData.reversalTransaction.transaction_type, 'BUY_REVERSAL');
      assert.equal(revData.reversalTransaction.is_reversal, true);
      assert.equal(revData.reversalTransaction.reversal_of_id, origTxId);
      assert.equal(revData.currentCash, 100000000, 'Cash must be fully refunded to 100M');

      // 3. Verify original row is IMMUTABLE (not deleted, not updated)
      const origTx = await db.query(`SELECT * FROM public.portfolio_transactions WHERE id = '${origTxId}'`);
      assert.equal(origTx.rows.length, 1);
      assert.equal(origTx.rows[0].transaction_type, 'BUY');
      assert.equal(Number(origTx.rows[0].quantity), 10);
      assert.equal(Number(origTx.rows[0].price), 100000);

      // 4. Verify holding is reduced back to 0 (holding row removed)
      const holding = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(holding.rows.length, 0, 'Holding row is removed when quantity reaches 0');

      // 5. Verify portfolio_reversals audit entry
      const audit = await db.query(`SELECT * FROM public.portfolio_reversals WHERE original_event_id = '${origTxId}'`);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].original_event_type, 'BUY');
      assert.equal(audit.rows[0].reason, 'Entered wrong quantity by mistake');
    } finally {
      await db.close();
    }
  });

  test('Case B: SELL Reversal restores holding quantity & pre-trade cost, offsets realized P/L, deducts proceeds', async () => {
    const db = await createTestDatabase();
    try {
      // 1. Buy 20 FPT @ 80,000 VND (cost = 1,600,000, cash becomes 98,400,000)
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 20,
          p_price => 80000,
          p_executed_at => '2026-09-10T09:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-20-fpt'
        )
      `);

      // 2. Sell 10 FPT @ 100,000 VND (proceeds = 1,000,000, cash becomes 99,400,000, realized P/L = 200,000)
      const sellRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'SELL',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'sell-10-fpt'
        ) AS result
      `);
      const sellTxId = sellRes.rows[0].result.transaction.id;
      assert.equal(sellRes.rows[0].result.currentCash, 99400000);
      assert.equal(Number(sellRes.rows[0].result.transaction.realized_pnl), 200000);

      // Verify holding after SELL: 10 shares @ 80,000
      const midHolding = await db.query(`SELECT quantity, average_cost FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(midHolding.rows[0].quantity), 10);
      assert.equal(Number(midHolding.rows[0].average_cost), 80000);

      // 3. Reverse the SELL
      const revRes = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_transaction_id => '${sellTxId}'::uuid,
          p_reason => 'Accidental sell order',
          p_idempotency_key => 'rev-sell-key-001'
        ) AS result
      `);
      const revData = revRes.rows[0].result;
      assert.equal(revData.replayed, false);
      assert.equal(revData.reversalTransaction.transaction_type, 'SELL_REVERSAL');
      assert.equal(Number(revData.reversalTransaction.realized_pnl), -200000, 'Compensating row must have negated realized P/L');
      assert.equal(revData.currentCash, 98400000, 'Proceeds must be deducted from cash');

      // 4. Verify restored holding state: exactly 20 shares @ 80,000
      const finalHolding = await db.query(`SELECT quantity, average_cost FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(finalHolding.rows[0].quantity), 20);
      assert.equal(Number(finalHolding.rows[0].average_cost), 80000);

      // 5. Verify total net realized P/L across transactions is 0
      const pnlSum = await db.query(`
        SELECT SUM(realized_pnl) AS total_pnl
        FROM public.portfolio_transactions
        WHERE profile_id = '${PROFILE_ID}'
      `);
      assert.equal(Number(pnlSum.rows[0].total_pnl), 0);
    } finally {
      await db.close();
    }
  });

  test('Case C & D: Cash DEPOSIT and WITHDRAWAL reversals', async () => {
    const db = await createTestDatabase();
    try {
      // 1. DEPOSIT 5,000,000 VND -> cash = 105,000,000
      const depRes = await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'DEPOSIT',
          p_amount => 5000000,
          p_idempotency_key => 'dep-5m'
        ) AS result
      `);
      const depEntryId = depRes.rows[0].result.entry.id;
      assert.equal(depRes.rows[0].result.currentCash, 105000000);

      // Reverse the DEPOSIT -> compensating WITHDRAWAL created, cash returns to 100,000,000
      const revDepRes = await db.query(`
        SELECT public.reverse_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_cash_entry_id => '${depEntryId}'::uuid,
          p_reason => 'Bank transfer failed at counterparty',
          p_idempotency_key => 'rev-dep-5m'
        ) AS result
      `);
      assert.equal(revDepRes.rows[0].result.currentCash, 100000000);
      assert.equal(revDepRes.rows[0].result.reversalCashEntry.entry_type, 'WITHDRAWAL');
      assert.equal(revDepRes.rows[0].result.reversalCashEntry.is_reversal, true);
      assert.equal(revDepRes.rows[0].result.reversalCashEntry.reversal_of_id, depEntryId);

      // 2. WITHDRAWAL 10,000,000 VND -> cash = 90,000,000
      const withRes = await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'WITHDRAWAL',
          p_amount => 10000000,
          p_idempotency_key => 'with-10m'
        ) AS result
      `);
      const withEntryId = withRes.rows[0].result.entry.id;
      assert.equal(withRes.rows[0].result.currentCash, 90000000);

      // Reverse the WITHDRAWAL -> compensating DEPOSIT created, cash returns to 100,000,000
      const revWithRes = await db.query(`
        SELECT public.reverse_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_cash_entry_id => '${withEntryId}'::uuid,
          p_reason => 'Cancelled withdrawal before bank processing',
          p_idempotency_key => 'rev-with-10m'
        ) AS result
      `);
      assert.equal(revWithRes.rows[0].result.currentCash, 100000000);
      assert.equal(revWithRes.rows[0].result.reversalCashEntry.entry_type, 'DEPOSIT');
      assert.equal(revWithRes.rows[0].result.reversalCashEntry.is_reversal, true);
      assert.equal(revWithRes.rows[0].result.reversalCashEntry.reversal_of_id, withEntryId);
    } finally {
      await db.close();
    }
  });

  test('Case E: Cash Overdraft Protection (CL001) prevents reversing deposit/sell if balance insufficient', async () => {
    const db = await createTestDatabase();
    try {
      // User starts with 100M cash. Deposit 5M -> 105M.
      const depRes = await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'DEPOSIT',
          p_amount => 5000000,
          p_idempotency_key => 'dep-5m-overdraft'
        ) AS result
      `);
      const depId = depRes.rows[0].result.entry.id;

      // Withdraw 104M -> cash drops to 1M
      await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'WITHDRAWAL',
          p_amount => 104000000,
          p_idempotency_key => 'drain-cash'
        )
      `);

      // Attempt to reverse 5M deposit when only 1M is available -> must reject with CL001
      await assert.rejects(
        db.query(`
          SELECT public.reverse_cash_movement(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_cash_entry_id => '${depId}'::uuid,
            p_reason => 'Reversal exceeds cash balance',
            p_idempotency_key => 'rev-fail-overdraft'
          )
        `),
        /withdrawal amount exceeds current cash/i
      );

      // Verify cash balance remains 1M
      const profile = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(profile.rows[0].cash_available), 1000000);
    } finally {
      await db.close();
    }
  });

  test('Case F: Double Reversal rejected (RC001) and reversing a reversal rejected (RC004)', async () => {
    const db = await createTestDatabase();
    try {
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 5,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-for-double-rev'
        ) AS result
      `);
      const origTxId = buyRes.rows[0].result.transaction.id;

      // Reversal 1 succeeds
      const rev1 = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_transaction_id => '${origTxId}'::uuid,
          p_reason => 'First reversal',
          p_idempotency_key => 'rev-first'
        ) AS result
      `);
      const revTxId = rev1.rows[0].result.reversalTransaction.id;

      // Reversal 2 on same original transaction with new key -> rejected with RC001
      await assert.rejects(
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${origTxId}'::uuid,
            p_reason => 'Second reversal attempt',
            p_idempotency_key => 'rev-second'
          )
        `),
        /transaction has already been reversed/i
      );

      // Reversal attempt on the reversal transaction itself -> rejected with RC004
      await assert.rejects(
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${revTxId}'::uuid,
            p_reason => 'Attempt to reverse a reversal',
            p_idempotency_key => 'rev-of-rev'
          )
        `),
        /cannot reverse a reversal transaction/i
      );
    } finally {
      await db.close();
    }
  });

  test('Case G: Fail closed on later transactions (RC002)', async () => {
    const db = await createTestDatabase();
    try {
      // Day 1: Buy 10 FPT
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-day-1'
        ) AS result
      `);
      const buyTxId = buyRes.rows[0].result.transaction.id;

      // Day 2: Sell 5 FPT
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'SELL',
          p_quantity => 5,
          p_price => 110000,
          p_executed_at => '2026-09-11T10:00:00Z'::timestamptz,
          p_idempotency_key => 'sell-day-2'
        )
      `);

      // Attempt to reverse Day 1 BUY -> rejected with RC002
      await assert.rejects(
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${buyTxId}'::uuid,
            p_reason => 'Try to reverse earlier buy',
            p_idempotency_key => 'rev-earlier-buy'
          )
        `),
        /cannot reverse transaction when subsequent transactions depend on it/i
      );
    } finally {
      await db.close();
    }
  });

  test('Case H: Trade cash entries cannot be reversed directly (RC003)', async () => {
    const db = await createTestDatabase();
    try {
      // Buy 5 FPT -> generates trade cash ledger entry
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 5,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-trade-cash'
        )
      `);

      const tradeCashEntry = await db.query(`
        SELECT id FROM public.cash_ledger_entries
        WHERE profile_id = '${PROFILE_ID}' AND portfolio_transaction_id IS NOT NULL
        LIMIT 1
      `);
      const tradeCashId = tradeCashEntry.rows[0].id;

      // Attempting to reverse this cash entry directly must fail with RC003
      await assert.rejects(
        db.query(`
          SELECT public.reverse_cash_movement(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_cash_entry_id => '${tradeCashId}'::uuid,
            p_reason => 'Trying to reverse trade cash directly',
            p_idempotency_key => 'rev-trade-cash-direct'
          )
        `),
        /cannot reverse trade-linked cash entry directly/i
      );
    } finally {
      await db.close();
    }
  });

  test('Case I: P1A Idempotency Integration: Transparent replay and concurrent safety', async () => {
    const db = await createTestDatabase();
    try {
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'buy-for-idemp-test'
        ) AS result
      `);
      const origTxId = buyRes.rows[0].result.transaction.id;
      const key = 'reversal-idemp-key-777';

      // Concurrent execution: two identical calls with same key
      const [res1, res2] = await Promise.all([
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${origTxId}'::uuid,
            p_reason => 'Accidental purchase',
            p_idempotency_key => '${key}'
          ) AS result
        `),
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${origTxId}'::uuid,
            p_reason => 'Accidental purchase',
            p_idempotency_key => '${key}'
          ) AS result
        `)
      ]);

      const results = [res1.rows[0].result, res2.rows[0].result];
      const newSuccess = results.filter(r => r.replayed === false);
      const replayedSuccess = results.filter(r => r.replayed === true);

      assert.equal(newSuccess.length, 1, 'Expected exactly 1 new execution');
      assert.equal(replayedSuccess.length, 1, 'Expected exactly 1 replayed execution');
      assert.equal(newSuccess[0].reversalTransaction.id, replayedSuccess[0].reversalTransaction.id);
      assert.equal(newSuccess[0].currentCash, 100000000);
      assert.equal(replayedSuccess[0].currentCash, 100000000);

      // Verify exact mutations: exactly 1 reversal row in portfolio_transactions
      const revTxCount = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM public.portfolio_transactions
        WHERE is_reversal = TRUE AND profile_id = '${PROFILE_ID}'
      `);
      assert.equal(revTxCount.rows[0].count, 1);

      // Same key with different payload rejects with IC001
      await assert.rejects(
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_transaction_id => '${origTxId}'::uuid,
            p_reason => 'DIFFERENT REASON REUSING SAME KEY',
            p_idempotency_key => '${key}'
          )
        `),
        /idempotency key reused with different parameters/i
      );
    } finally {
      await db.close();
    }
  });

  test('Case J: Cross-Profile Security prevents Profile 2 from reversing Profile 1 transaction', async () => {
    const db = await createTestDatabase();
    try {
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'prof1-buy'
        ) AS result
      `);
      const origTxId = buyRes.rows[0].result.transaction.id;

      // Profile 2 attempts to reverse Profile 1's transaction -> fails with PT001
      await assert.rejects(
        db.query(`
          SELECT public.reverse_portfolio_transaction(
            p_profile_id => '${PROFILE_2_ID}'::uuid,
            p_transaction_id => '${origTxId}'::uuid,
            p_reason => 'Attacker trying to reverse victim transaction',
            p_idempotency_key => 'cross-prof-key'
          )
        `),
        /transaction not found/i
      );

      // Verify Profile 1's transaction and cash remain intact
      const p1Cash = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(p1Cash.rows[0].cash_available), 99000000);
    } finally {
      await db.close();
    }
  });

  test('Case K: Multi-Asset Contract: BTC USD transaction reversal preserves quote currency and does not mutate VND cash', async () => {
    const db = await createTestDatabase();
    try {
      // BTC buy with EXTERNAL_SETTLEMENT (USD quote currency)
      const btcBuy = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'BTC',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 0.5,
          p_price => 1500000000,
          p_execution_unit_price => 60000,
          p_price_currency => 'USD',
          p_settlement_mode => 'EXTERNAL_SETTLEMENT',
          p_settlement_currency => 'USD',
          p_fx_rate_to_vnd => 25000,
          p_fx_provenance => 'TWELVE_DATA_USD_VND',
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => 'btc-buy-key'
        ) AS result
      `);
      const btcTxId = btcBuy.rows[0].result.transaction.id;
      assert.equal(btcBuy.rows[0].result.currentCash, 100000000, 'VND cash must remain untouched for EXTERNAL_SETTLEMENT');

      // Reverse the BTC BUY
      const btcRev = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_transaction_id => '${btcTxId}'::uuid,
          p_reason => 'Reversing crypto external trade',
          p_idempotency_key => 'btc-rev-key'
        ) AS result
      `);
      assert.equal(btcRev.rows[0].result.currentCash, 100000000, 'VND cash remains untouched after reversal');
      assert.equal(btcRev.rows[0].result.reversalTransaction.price_currency, 'USD', 'Currency must be preserved as USD');

      // Verify BTC holding is back to 0 (holding row removed)
      const btcHolding = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${BTC_ASSET_ID}'`);
      assert.equal(btcHolding.rows.length, 0, 'Holding row is removed when quantity reaches 0');
    } finally {
      await db.close();
    }
  });
});

describe('Portfolio P1B — Performance & Valuation Engine Reversals', () => {
  test('reconstructHoldingsState & reconstructCashBalance restore clean zero state after BUY + BUY_REVERSAL', () => {
    const transactions = [
      {
        id: 'tx-1',
        assetId: FPT_ASSET_ID,
        transactionType: 'BUY',
        quantity: 10,
        price: 100000,
        executedAt: '2026-09-01T10:00:00Z'
      },
      {
        id: 'tx-2',
        assetId: FPT_ASSET_ID,
        transactionType: 'BUY_REVERSAL',
        quantity: 10,
        price: 100000,
        executedAt: '2026-09-02T10:00:00Z',
        isReversal: true,
        reversalOfId: 'tx-1'
      }
    ];

    const cashEntries = [
      {
        id: 'cash-1',
        portfolioTransactionId: 'tx-1',
        entryType: 'BUY',
        amount: 1000000,
        effectiveAt: '2026-09-01T10:00:00Z'
      },
      {
        id: 'cash-2',
        portfolioTransactionId: 'tx-2',
        entryType: 'BUY_REVERSAL',
        amount: 1000000,
        effectiveAt: '2026-09-02T10:00:00Z',
        isReversal: true
      }
    ];

    const cashActivation = { openingBalanceAmount: 100000000, activatedAt: '2026-08-01T00:00:00Z' };

    // As of 2026-09-01 (post-buy, pre-reversal):
    const holdings01 = reconstructHoldingsState('2026-09-01', [], transactions);
    const cash01 = reconstructCashBalance('2026-09-01', cashActivation, cashEntries, transactions);
    assert.equal(holdings01.get(FPT_ASSET_ID).quantity, 10);
    assert.equal(holdings01.get(FPT_ASSET_ID).averageCost, 100000);
    assert.equal(cash01, 99000000);

    // As of 2026-09-02 (post-reversal):
    const holdings02 = reconstructHoldingsState('2026-09-02', [], transactions);
    const cash02 = reconstructCashBalance('2026-09-02', cashActivation, cashEntries, transactions);
    assert.equal(holdings02.get(FPT_ASSET_ID).quantity, 0);
    assert.equal(holdings02.get(FPT_ASSET_ID).averageCost, 0);
    assert.equal(cash02, 100000000, 'Cash balance must be completely restored');
  });

  test('reconstructHoldingsState restores pre-trade average cost after SELL + SELL_REVERSAL', () => {
    const transactions = [
      {
        id: 'tx-1',
        assetId: FPT_ASSET_ID,
        transactionType: 'BUY',
        quantity: 20,
        price: 80000,
        executedAt: '2026-09-01T10:00:00Z'
      },
      {
        id: 'tx-2',
        assetId: FPT_ASSET_ID,
        transactionType: 'SELL',
        quantity: 10,
        price: 100000,
        preTradeAverageCost: 80000,
        realizedPnL: 200000,
        executedAt: '2026-09-02T10:00:00Z'
      },
      {
        id: 'tx-3',
        assetId: FPT_ASSET_ID,
        transactionType: 'SELL_REVERSAL',
        quantity: 10,
        price: 100000,
        preTradeAverageCost: 80000,
        realizedPnL: -200000,
        executedAt: '2026-09-03T10:00:00Z',
        isReversal: true,
        reversalOfId: 'tx-2'
      }
    ];

    const holdings03 = reconstructHoldingsState('2026-09-03', [], transactions);
    assert.equal(holdings03.get(FPT_ASSET_ID).quantity, 20);
    assert.equal(holdings03.get(FPT_ASSET_ID).averageCost, 80000, 'Pre-sale average cost must be restored');
  });
});

describe('Portfolio P1B — Express HTTP Routes Integration', () => {
  test('POST /api/transactions/:id/reversal maps errors and handles Idempotent-Replayed header', async () => {
    let capturedPayload = null;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      reversePortfolioTransactionFn: async (payload) => {
        capturedPayload = payload;
        if (payload.idempotencyKey === 'conflict-key') {
          const err = new Error('already reversed');
          err.code = 'RC001';
          err.statusCode = 409;
          throw err;
        }
        if (payload.idempotencyKey === 'later-tx-key') {
          const err = new Error('later transactions exist');
          err.code = 'RC002';
          err.statusCode = 400;
          throw err;
        }
        if (payload.idempotencyKey === 'replayed-key') {
          return {
            reversalTransaction: { id: 'rev-tx-1' },
            replayed: true
          };
        }
        return {
          reversalTransaction: { id: 'rev-tx-1' },
          replayed: false
        };
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Fresh reversal request
      const res1 = await ownerFetch(`${baseUrl}/api/transactions/tx-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'fresh-rev-01'
        },
        body: JSON.stringify({ reason: 'Entered wrong price' })
      });
      assert.equal(res1.status, 201);
      assert.equal(res1.headers.get('Idempotent-Replayed'), null);
      assert.equal(capturedPayload.transactionId, 'tx-123');
      assert.equal(capturedPayload.reason, 'Entered wrong price');

      // 2. Replayed reversal request
      const res2 = await ownerFetch(`${baseUrl}/api/transactions/tx-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'replayed-key'
        },
        body: JSON.stringify({ reason: 'Entered wrong price' })
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('Idempotent-Replayed'), 'true');

      // 3. RC001 409 Conflict
      const res3 = await ownerFetch(`${baseUrl}/api/transactions/tx-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'conflict-key'
        },
        body: JSON.stringify({ reason: 'Already reversed' })
      });
      assert.equal(res3.status, 409);
      const body3 = await res3.json();
      assert.equal(body3.code, 'RC001');

      // 4. Missing reason returns 400
      const res4 = await ownerFetch(`${baseUrl}/api/transactions/tx-123/reversal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(res4.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('POST /api/cash/ledger/:id/reversal forwards cashEntryId and preserves reversal idempotency semantics', async () => {
    let capturedPayload = null;
    const idempotencyRecords = new Map();
    const reversedCashEntryIds = new Set();
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      reverseCashMovementFn: async (payload) => {
        capturedPayload = payload;

        if (!payload.cashEntryId) {
          const err = new Error('cashEntryId is required');
          err.statusCode = 500;
          throw err;
        }

        const requestHash = JSON.stringify({
          cashEntryId: payload.cashEntryId,
          reason: payload.reason
        });
        const existing = idempotencyRecords.get(payload.idempotencyKey);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            const err = new Error('idempotency key reused with different parameters');
            err.code = 'IC001';
            err.statusCode = 409;
            throw err;
          }
          return {
            ...existing.result,
            replayed: true
          };
        }

        if (reversedCashEntryIds.has(payload.cashEntryId)) {
          const err = new Error('cash ledger entry has already been reversed');
          err.code = 'RC001';
          err.statusCode = 409;
          throw err;
        }

        const result = {
          reversalCashEntry: { id: 'rev-cash-1' },
          replayed: false
        };
        reversedCashEntryIds.add(payload.cashEntryId);
        idempotencyRecords.set(payload.idempotencyKey, { requestHash, result });
        return result;
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Fresh cash reversal request
      const res1 = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'fresh-cash-rev-01'
        },
        body: JSON.stringify({ reason: 'Wrong bank deposit entry' })
      });
      assert.equal(res1.status, 201);
      assert.equal(res1.headers.get('Idempotent-Replayed'), null);
      assert.equal(capturedPayload.cashEntryId, 'cash-123');

      // 2. Same request/key is replayed.
      const res2 = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'fresh-cash-rev-01'
        },
        body: JSON.stringify({ reason: 'Wrong bank deposit entry' })
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('Idempotent-Replayed'), 'true');
      const body2 = await res2.json();
      assert.equal(body2.data.replayed, true);

      // 3. Reusing the key with a changed payload conflicts before reversal checks.
      const res3 = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'fresh-cash-rev-01'
        },
        body: JSON.stringify({ reason: 'Changed reversal reason' })
      });
      assert.equal(res3.status, 409);
      const body3 = await res3.json();
      assert.equal(body3.code, 'IC001');

      // 4. A new key cannot create a second reversal.
      const res4 = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-123/reversal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'second-cash-rev-01'
        },
        body: JSON.stringify({ reason: 'Wrong bank deposit entry' })
      });
      assert.equal(res4.status, 409);
      const body4 = await res4.json();
      assert.equal(body4.code, 'RC001');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
