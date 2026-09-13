import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../index.js';
import { issueAccountingRateQuoteProof } from '../src/accountingRate.js';
import { ownerFetch } from './helpers/owner-auth.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'server', 'db', 'schema.sql');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase', 'migrations', '20260910000000_portfolio_idempotent_writes.sql');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const FPT_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BTC_ASSET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNTING_RATE_QUOTE_SECRET = 'test-accounting-rate-quote-secret-at-least-32-bytes';

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
    INSERT INTO auth.users (id) VALUES ('${USER_ID}');
    INSERT INTO public.investor_profile (
      id, user_id, cash_available, risk_tolerance, investment_horizon
    ) VALUES (
      '${PROFILE_ID}', '${USER_ID}', 100000000, 'moderate', 'long'
    );
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

function createPglitePortfolioClient(db, counters = {}) {
  return {
    from(table) {
      const filters = {};
      const query = {
        select(columns) {
          assert.equal(table, 'portfolio_idempotency_records');
          assert.equal(columns, 'idempotency_key');
          return this;
        },
        eq(column, value) {
          filters[column] = value;
          return this;
        },
        async maybeSingle() {
          counters.idempotencyLookups = (counters.idempotencyLookups || 0) + 1;
          const result = await db.query(`
            SELECT idempotency_key
            FROM public.portfolio_idempotency_records
            WHERE profile_id = $1::uuid AND idempotency_key = $2::text
            LIMIT 1
          `, [filters.profile_id, filters.idempotency_key]);
          return { data: result.rows[0] || null, error: null };
        }
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'create_portfolio_transaction');
      counters.rpcCalls = (counters.rpcCalls || 0) + 1;
      try {
        const result = await db.query(`
          SELECT public.create_portfolio_transaction(
            p_profile_id => $1::uuid,
            p_symbol => $2::text,
            p_asset_id => $3::text,
            p_transaction_type => $4::text,
            p_quantity => $5::numeric,
            p_price => $6::numeric,
            p_executed_at => $7::timestamptz,
            p_execution_unit_price => $8::numeric,
            p_price_currency => $9::text,
            p_settlement_mode => $10::text,
            p_settlement_currency => $11::text,
            p_fx_rate_to_vnd => $12::numeric,
            p_fx_provenance => $13::text,
            p_fx_observed_at => $14::timestamptz,
            p_idempotency_key => $15::text
          ) AS result
        `, [
          args.p_profile_id,
          args.p_symbol,
          args.p_asset_id,
          args.p_transaction_type,
          args.p_quantity,
          args.p_price,
          args.p_executed_at,
          args.p_execution_unit_price,
          args.p_price_currency,
          args.p_settlement_mode,
          args.p_settlement_currency,
          args.p_fx_rate_to_vnd,
          args.p_fx_provenance,
          args.p_fx_observed_at,
          args.p_idempotency_key
        ]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            code: error.code,
            message: error.message
          }
        };
      }
    }
  };
}

describe('Portfolio P1A — Idempotent Financial Writes (Database Layer)', () => {
  test('idempotency table exists with strict RLS and service_role grant', async () => {
    const db = await createTestDatabase();
    try {
      const tableCheck = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_idempotency_records'
      `);
      assert.equal(tableCheck.rows.length, 1);

      const rlsCheck = await db.query(`
        SELECT relrowsecurity
        FROM pg_class
        WHERE relname = 'portfolio_idempotency_records'
      `);
      assert.equal(rlsCheck.rows[0].relrowsecurity, true);

      const privCheck = await db.query(`
        SELECT
          has_table_privilege('anon', 'public.portfolio_idempotency_records', 'SELECT') AS anon_select,
          has_table_privilege('authenticated', 'public.portfolio_idempotency_records', 'SELECT') AS auth_select,
          has_table_privilege('service_role', 'public.portfolio_idempotency_records', 'SELECT') AS service_select
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

  test('actual migration 20260910000000_portfolio_idempotent_writes.sql executes cleanly on pre-P1A schema', async () => {
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
      const preP1ASchema = fullSchema.split('-- Portfolio P1A: Idempotent Financial Writes')[0];
      assert.ok(preP1ASchema.length > 0 && preP1ASchema.length < fullSchema.length, 'pre-P1A schema cut must be valid');
      await db.exec(preP1ASchema);

      // Verify table does not exist before migration
      const beforeCheck = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_idempotency_records'
      `);
      assert.equal(beforeCheck.rows.length, 0);

      // Execute actual migration file
      const migrationSql = await readFile(MIGRATION_PATH, 'utf8');
      await db.exec(migrationSql);

      // Verify table exists after migration
      const afterCheck = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'portfolio_idempotency_records'
      `);
      assert.equal(afterCheck.rows.length, 1);

      // Verify RPC signature contains p_idempotency_key
      const rpcCheck = await db.query(`
        SELECT proname, proargnames
        FROM pg_proc
        WHERE proname = 'create_opening_position'
      `);
      assert.ok(rpcCheck.rows[0]?.proargnames.includes('p_idempotency_key'));
    } finally {
      await db.close();
    }
  });

  test('BUY transaction is idempotent: replays identical result, never duplicates rows or deducts cash twice', async () => {
    const db = await createTestDatabase();
    try {
      const key = 'test-buy-key-001';
      const initialCashEntries = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries`);

      // First call
      const res1 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);
      const data1 = res1.rows[0].result;
      assert.equal(data1.replayed, false);
      assert.equal(data1.transaction.quantity, 10);
      assert.equal(data1.transaction.price, 100000);
      assert.equal(data1.currentCash, 99000000);

      // Verify DB state after call 1
      const txCount1 = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions`);
      const cashEntries1 = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries`);
      const holding1 = await db.query(`SELECT quantity FROM public.holdings WHERE asset_id = '${FPT_ASSET_ID}'`);
      const profile1 = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(txCount1.rows[0].count, 1);
      assert.equal(cashEntries1.rows[0].count, initialCashEntries.rows[0].count + 1);
      assert.equal(Number(holding1.rows[0].quantity), 10);
      assert.equal(Number(profile1.rows[0].cash_available), 99000000);

      // Second call (replay with exact same key & params)
      const res2 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);
      const data2 = res2.rows[0].result;
      assert.equal(data2.replayed, true);
      assert.equal(data2.transaction.id, data1.transaction.id);
      assert.equal(data2.currentCash, 99000000);

      // Verify DB state is COMPLETELY UNCHANGED
      const txCount2 = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions`);
      const cashEntries2 = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries`);
      const holding2 = await db.query(`SELECT quantity FROM public.holdings WHERE asset_id = '${FPT_ASSET_ID}'`);
      const profile2 = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(txCount2.rows[0].count, 1);
      assert.equal(cashEntries2.rows[0].count, cashEntries1.rows[0].count);
      assert.equal(Number(holding2.rows[0].quantity), 10);
      assert.equal(Number(profile2.rows[0].cash_available), 99000000);
    } finally {
      await db.close();
    }
  });

  test('BUY transaction rejects reused idempotency key with conflicting payload (IC001)', async () => {
    const db = await createTestDatabase();
    try {
      const key = 'test-buy-conflict-key';

      // First call: buy 10 @ 100,000
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);

      // Second call: same key, but quantity is 20 instead of 10
      await assert.rejects(
        db.query(`
          SELECT public.create_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_symbol => 'FPT',
            p_asset_id => NULL,
            p_transaction_type => 'BUY',
            p_quantity => 20,
            p_price => 100000,
            p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
            p_idempotency_key => '${key}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );
    } finally {
      await db.close();
    }
  });

  test('SELL transaction is idempotent: replays identical result, never sells twice or credits proceeds twice', async () => {
    const db = await createTestDatabase();
    try {
      // First buy 20 shares
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 20,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz
        )
      `);

      const sellKey = 'test-sell-key-001';

      // First sell call: sell 10 shares @ 120,000
      const res1 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'SELL',
          p_quantity => 10,
          p_price => 120000,
          p_executed_at => '2026-09-10T11:00:00Z'::timestamptz,
          p_idempotency_key => '${sellKey}'
        ) AS result
      `);
      const data1 = res1.rows[0].result;
      assert.equal(data1.replayed, false);
      assert.equal(data1.transaction.quantity, 10);
      assert.equal(data1.holding.quantity, 10);
      assert.equal(data1.currentCash, 99200000); // 100M - 2M + 1.2M = 99.2M

      // Second sell call with same key
      const res2 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'SELL',
          p_quantity => 10,
          p_price => 120000,
          p_executed_at => '2026-09-10T11:00:00Z'::timestamptz,
          p_idempotency_key => '${sellKey}'
        ) AS result
      `);
      const data2 = res2.rows[0].result;
      assert.equal(data2.replayed, true);
      assert.equal(data2.transaction.id, data1.transaction.id);

      // Verify DB holding still has 10 shares (not 0), and cash was credited only once
      const holding = await db.query(`SELECT quantity FROM public.holdings WHERE asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(holding.rows[0].quantity), 10);
      const profile = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(profile.rows[0].cash_available), 99200000);
    } finally {
      await db.close();
    }
  });

  test('Cash DEPOSIT and WITHDRAWAL are idempotent', async () => {
    const db = await createTestDatabase();
    try {
      const depKey = 'test-dep-key-001';

      // 1. DEPOSIT
      const dep1 = await db.query(`
        SELECT public.create_cash_movement(
          '${PROFILE_ID}'::uuid,
          'DEPOSIT',
          10000000,
          '${depKey}'
        ) AS result
      `);
      assert.equal(dep1.rows[0].result.replayed, false);
      assert.equal(dep1.rows[0].result.currentCash, 110000000);

      // Replay DEPOSIT
      const dep2 = await db.query(`
        SELECT public.create_cash_movement(
          '${PROFILE_ID}'::uuid,
          'DEPOSIT',
          10000000,
          '${depKey}'
        ) AS result
      `);
      assert.equal(dep2.rows[0].result.replayed, true);
      assert.equal(dep2.rows[0].result.currentCash, 110000000);
      assert.equal(dep2.rows[0].result.entry.id, dep1.rows[0].result.entry.id);

      const cashCheck = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(cashCheck.rows[0].cash_available), 110000000);

      // DEPOSIT conflict
      await assert.rejects(
        db.query(`
          SELECT public.create_cash_movement(
            '${PROFILE_ID}'::uuid,
            'DEPOSIT',
            20000000,
            '${depKey}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );

      // 2. WITHDRAWAL
      const withKey = 'test-with-key-001';
      const with1 = await db.query(`
        SELECT public.create_cash_movement(
          '${PROFILE_ID}'::uuid,
          'WITHDRAWAL',
          5000000,
          '${withKey}'
        ) AS result
      `);
      assert.equal(with1.rows[0].result.replayed, false);
      assert.equal(with1.rows[0].result.currentCash, 105000000);

      // Replay WITHDRAWAL
      const with2 = await db.query(`
        SELECT public.create_cash_movement(
          '${PROFILE_ID}'::uuid,
          'WITHDRAWAL',
          5000000,
          '${withKey}'
        ) AS result
      `);
      assert.equal(with2.rows[0].result.replayed, true);
      assert.equal(with2.rows[0].result.currentCash, 105000000);
      assert.equal(with2.rows[0].result.entry.id, with1.rows[0].result.entry.id);

      const cashCheck2 = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(cashCheck2.rows[0].cash_available), 105000000);
    } finally {
      await db.close();
    }
  });

  test('Opening position is idempotent and does not fail on replay with OP005', async () => {
    const db = await createTestDatabase();
    try {
      const openKey = 'test-open-key-001';

      // First call
      const res1 = await db.query(`
        SELECT public.create_opening_position(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_asset_id => '${FPT_ASSET_ID}',
          p_quantity => 50,
          p_average_cost => 85000,
          p_idempotency_key => '${openKey}'
        ) AS result
      `);
      const data1 = res1.rows[0].result;
      assert.equal(data1.replayed, false);
      assert.equal(data1.openingPosition.opening_quantity, 50);
      assert.equal(data1.openingPosition.opening_average_cost, 85000);
      assert.equal(data1.holding.quantity, 50);

      // Replay with identical key: must return original baseline without throwing OP005 (already has holding)
      const res2 = await db.query(`
        SELECT public.create_opening_position(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_asset_id => '${FPT_ASSET_ID}',
          p_quantity => 50,
          p_average_cost => 85000,
          p_idempotency_key => '${openKey}'
        ) AS result
      `);
      const data2 = res2.rows[0].result;
      assert.equal(data2.replayed, true);
      assert.equal(data2.openingPosition.id, data1.openingPosition.id);
      assert.equal(data2.holding.id, data1.holding.id);

      // Verify row counts in tables
      const opCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.position_opening_baselines`);
      const hCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.holdings`);
      assert.equal(opCount.rows[0].count, 1);
      assert.equal(hCount.rows[0].count, 1);

      // Conflicting payload on same key
      await assert.rejects(
        db.query(`
          SELECT public.create_opening_position(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_asset_id => '${FPT_ASSET_ID}',
            p_quantity => 100,
            p_average_cost => 85000,
            p_idempotency_key => '${openKey}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );
    } finally {
      await db.close();
    }
  });

  test('Transactions without idempotency key execute normally without recording in idempotency table', async () => {
    const db = await createTestDatabase();
    try {
      await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'DEPOSIT',
          p_amount => 1000000
        )
      `);
      await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 5,
          p_price => 50000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz
        )
      `);

      const idempCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_idempotency_records`);
      assert.equal(idempCount.rows[0].count, 0);
    } finally {
      await db.close();
    }
  });

  test('CONCURRENCY: Two concurrent requests with same key/payload produce exactly 1 mutation, 1 new success, 1 replay success', async () => {
    const db = await createTestDatabase();
    try {
      const key = 'concurrent-buy-key-888';
      const initialCashEntries = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries WHERE profile_id = '${PROFILE_ID}'`);

      const queryStr = `
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `;

      // Launch both requests simultaneously
      const [res1, res2] = await Promise.all([
        db.query(queryStr),
        db.query(queryStr)
      ]);

      const data1 = res1.rows[0].result;
      const data2 = res2.rows[0].result;

      // Exactly one must be new (replayed: false) and one must be replay (replayed: true)
      const results = [data1, data2];
      const newSuccess = results.filter(r => r.replayed === false);
      const replaySuccess = results.filter(r => r.replayed === true);

      assert.equal(newSuccess.length, 1, 'Expected exactly 1 NEW_SUCCESS');
      assert.equal(replaySuccess.length, 1, 'Expected exactly 1 REPLAYED_SUCCESS');

      // Both callers receive consistent transaction ID and cash
      assert.equal(newSuccess[0].transaction.id, replaySuccess[0].transaction.id);
      assert.equal(newSuccess[0].currentCash, 99000000);
      assert.equal(replaySuccess[0].currentCash, 99000000);

      // Verify exact DB mutations: exactly 1 transaction row, 1 cash mutation, 1 holding effect
      const txCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}'`);
      const cashEntries = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries WHERE profile_id = '${PROFILE_ID}'`);
      const holding = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      const profile = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);

      assert.equal(txCount.rows[0].count, 1, 'Exactly 1 transaction row must exist');
      assert.equal(cashEntries.rows[0].count, initialCashEntries.rows[0].count + 1, 'Exactly 1 cash ledger entry must be added');
      assert.equal(Number(holding.rows[0].quantity), 10, 'Holding quantity must be exactly 10');
      assert.equal(Number(profile.rows[0].cash_available), 99000000, 'Cash balance must be deducted exactly once');
    } finally {
      await db.close();
    }
  });

  test('TIMEOUT / RETRY: Lost response followed by retry returns original result with zero additional mutation', async () => {
    const db = await createTestDatabase();
    try {
      const key = 'timeout-retry-key-999';

      // 1. Initial request commits in DB
      const res1 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 15,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);
      const data1 = res1.rows[0].result;
      assert.equal(data1.replayed, false);
      const originalTxId = data1.transaction.id;

      // Simulated network failure: client never receives res1 or times out waiting for response

      // 2. Client retries with identical idempotency key
      const res2 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 15,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);
      const data2 = res2.rows[0].result;

      assert.equal(data2.replayed, true, 'Retry must be flagged as replayed');
      assert.equal(data2.transaction.id, originalTxId, 'Retry must return original transaction ID');
      assert.equal(data2.currentCash, 98500000);

      // Verify zero second mutation in DB
      const txRows = await db.query(`SELECT id, quantity, price FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}'`);
      assert.equal(txRows.rows.length, 1);
      assert.equal(txRows.rows[0].id, originalTxId);

      const holding = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(holding.rows[0].quantity), 15);

      const profile = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(profile.rows[0].cash_available), 98500000);
    } finally {
      await db.close();
    }
  });

  test('KEY CONFLICT & NEW KEY: Conflicting payload fails with IC001 with zero mutation; distinct key succeeds as new operation', async () => {
    const db = await createTestDatabase();
    try {
      const key = 'conflict-vs-new-key-1';

      // Call 1: Buy 10 FPT
      const res1 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${key}'
        ) AS result
      `);
      assert.equal(res1.rows[0].result.replayed, false);

      // Conflict: same key, different payload (quantity = 25) -> IC001
      await assert.rejects(
        db.query(`
          SELECT public.create_portfolio_transaction(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_symbol => 'FPT',
            p_asset_id => NULL,
            p_transaction_type => 'BUY',
            p_quantity => 25,
            p_price => 100000,
            p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
            p_idempotency_key => '${key}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );

      // Verify zero additional mutation from conflict
      const txCount1 = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}'`);
      assert.equal(txCount1.rows[0].count, 1);
      const holding1 = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(holding1.rows[0].quantity), 10);
      const profile1 = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(profile1.rows[0].cash_available), 99000000);

      // New operation with DIFFERENT key but same logical payload (Buy 10 FPT @ 100k)
      const freshKey = 'conflict-vs-new-key-2';
      const res2 = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 10,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:05:00Z'::timestamptz,
          p_idempotency_key => '${freshKey}'
        ) AS result
      `);
      assert.equal(res2.rows[0].result.replayed, false);
      assert.notEqual(res2.rows[0].result.transaction.id, res1.rows[0].result.transaction.id);

      // Verify distinct second mutation: 2 transactions, 20 total shares, cash = 98M
      const txCount2 = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}'`);
      assert.equal(txCount2.rows[0].count, 2);
      const holding2 = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(holding2.rows[0].quantity), 20);
      const profile2 = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.equal(Number(profile2.rows[0].cash_available), 98000000);
    } finally {
      await db.close();
    }
  });

  test('OPERATION SCOPE & PROFILE SCOPE: No cross-operation replay allowed, keys scoped per profile', async () => {
    const db = await createTestDatabase();
    try {
      // Create second profile for cross-profile test
      const USER_2 = '33333333-3333-4333-8333-333333333333';
      const PROFILE_2 = '44444444-4444-4444-8444-444444444444';
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('${USER_2}');
        INSERT INTO public.investor_profile (id, user_id, cash_available, risk_tolerance, investment_horizon)
        VALUES ('${PROFILE_2}', '${USER_2}', 50000000, 'low', 'medium');
      `);

      const sharedKey = 'shared-scope-key-123';

      // 1. Profile 1 executes BUY with sharedKey
      const buyRes = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 5,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${sharedKey}'
        ) AS result
      `);
      assert.equal(buyRes.rows[0].result.replayed, false);

      // 2. Profile 1 attempts to use sharedKey on CASH DEPOSIT -> must fail with IC001 (operation_type mismatch)
      await assert.rejects(
        db.query(`
          SELECT public.create_cash_movement(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_entry_type => 'DEPOSIT',
            p_amount => 500000,
            p_idempotency_key => '${sharedKey}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );

      // 3. Profile 1 attempts to use sharedKey on OPENING POSITION -> must fail with IC001 (operation_type mismatch)
      await assert.rejects(
        db.query(`
          SELECT public.create_opening_position(
            p_profile_id => '${PROFILE_ID}'::uuid,
            p_asset_id => '${BTC_ASSET_ID}',
            p_quantity => 1,
            p_average_cost => 50000000,
            p_idempotency_key => '${sharedKey}'
          ) AS result
        `),
        /idempotency key reused with different parameters/i
      );

      // Verify no cash movement or opening position was created for Profile 1
      const cashCheck = await db.query(`SELECT COUNT(*)::int AS count FROM public.cash_ledger_entries WHERE profile_id = '${PROFILE_ID}' AND entry_type = 'DEPOSIT'`);
      assert.equal(cashCheck.rows[0].count, 0);
      const opCheck = await db.query(`SELECT COUNT(*)::int AS count FROM public.position_opening_baselines WHERE profile_id = '${PROFILE_ID}'`);
      assert.equal(opCheck.rows[0].count, 0);

      // 4. Profile 2 uses the EXACT same key string -> must SUCCEED independently because keys are scoped per profile
      const prof2Res = await db.query(`
        SELECT public.create_portfolio_transaction(
          p_profile_id => '${PROFILE_2}'::uuid,
          p_symbol => 'FPT',
          p_asset_id => NULL,
          p_transaction_type => 'BUY',
          p_quantity => 5,
          p_price => 100000,
          p_executed_at => '2026-09-10T10:00:00Z'::timestamptz,
          p_idempotency_key => '${sharedKey}'
        ) AS result
      `);
      assert.equal(prof2Res.rows[0].result.replayed, false, 'Profile 2 using same key must execute as fresh operation');
      assert.equal(prof2Res.rows[0].result.currentCash, 49500000);

      // Verify Profile 2 holding created independently
      const p2Holding = await db.query(`SELECT quantity FROM public.holdings WHERE profile_id = '${PROFILE_2}' AND asset_id = '${FPT_ASSET_ID}'`);
      assert.equal(Number(p2Holding.rows[0].quantity), 5);
    } finally {
      await db.close();
    }
  });
});

describe('Portfolio P1A — Express HTTP Route Integration', () => {
  test('POST /api/transactions forwards Idempotency-Key, returns Idempotent-Replayed header, and maps IC001 to 409', async () => {
    let callParams = [];
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async (sym) => ({
        id: FPT_ASSET_ID,
        symbol: 'FPT',
        asset_type: 'stock',
        quote_currency: 'VND',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createPortfolioTransactionFn: async (payload) => {
        callParams.push(payload);
        if (payload.idempotencyKey === 'conflict-key') {
          const err = new Error('idempotency key reused with different request parameters');
          err.code = 'IC001';
          err.statusCode = 409;
          throw err;
        }
        if (payload.idempotencyKey === 'replayed-key') {
          return {
            transaction: { id: 'tx-1', symbol: 'FPT', quantity: 10, price: 100000 },
            replayed: true
          };
        }
        return {
          transaction: { id: 'tx-1', symbol: 'FPT', quantity: 10, price: 100000 },
          replayed: false
        };
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Initial request with header
      const res1 = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'fresh-key-01'
        },
        body: JSON.stringify({
          symbol: 'FPT',
          transactionType: 'BUY',
          quantity: 10,
          price: 100000
        })
      });
      assert.equal(res1.status, 201);
      assert.equal(res1.headers.get('Idempotent-Replayed'), null);
      assert.equal(callParams[0].idempotencyKey, 'fresh-key-01');

      // 2. Replay request
      const res2 = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'replayed-key'
        },
        body: JSON.stringify({
          symbol: 'FPT',
          transactionType: 'BUY',
          quantity: 10,
          price: 100000
        })
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.headers.get('Idempotent-Replayed'), 'true');
      const body2 = await res2.json();
      assert.equal(body2.data.replayed, true);

      // 3. Conflict request
      const res3 = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'conflict-key'
        },
        body: JSON.stringify({
          symbol: 'FPT',
          transactionType: 'BUY',
          quantity: 20,
          price: 100000
        })
      });
      assert.equal(res3.status, 409);
      const body3 = await res3.json();
      assert.equal(body3.code, 'IC001');

      // 4. Invalid key format rejects with 400
      const res4 = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'invalid key with spaces and special @#$%'
        },
        body: JSON.stringify({
          symbol: 'FPT',
          transactionType: 'BUY',
          quantity: 10,
          price: 100000
        })
      });
      assert.equal(res4.status, 400);
      const body4 = await res4.json();
      assert.match(body4.errors[0], /1 and 128 characters/i);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('automatic CURRENT quote replay crosses expiry through the real P1A RPC while new keys stay stale and conflicts stay IC001', async () => {
    const db = await createTestDatabase();
    const counters = { idempotencyLookups: 0, rpcCalls: 0 };
    const transactionClient = createPglitePortfolioClient(db, counters);
    const observedAt = '2026-09-12T12:00:00.000Z';
    const rate = 25325;
    const executionUnitPrice = 0.36402;
    const quoteProof = issueAccountingRateQuoteProof({
      availability: 'available',
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      rate,
      provider: 'CoinGecko',
      provenance: 'COINGECKO_USDT_VND',
      observedAt,
      requestedAt: observedAt,
      observationDeltaMs: 0,
      mode: 'CURRENT',
      reason: null
    }, {
      secret: ACCOUNTING_RATE_QUOTE_SECRET,
      now: new Date(observedAt)
    });
    assert.equal(typeof quoteProof, 'string');

    let serverNow = new Date('2026-09-12T12:09:59.000Z');
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async () => ({
        id: BTC_ASSET_ID,
        symbol: 'BTC',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      transactionClient,
      accountingRateEnabled: true,
      accountingRateQuoteSecret: ACCOUNTING_RATE_QUOTE_SECRET,
      accountingRateNowFn: () => serverNow
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const idempotencyKey = 'auto-expiry-p1a-key';
    const body = {
      symbol: 'BTC',
      transactionType: 'BUY',
      quantity: 1,
      price: executionUnitPrice * rate,
      executionUnitPrice,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      fxRateToVnd: rate,
      fxProvenance: 'COINGECKO_USDT_VND',
      fxObservedAt: observedAt,
      quoteProof
    };
    const post = (key, payload = body) => ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify(payload)
    });

    try {
      const first = await post(idempotencyKey);
      assert.equal(first.status, 201);
      assert.equal(first.headers.get('Idempotent-Replayed'), null);
      assert.equal((await first.json()).data.replayed, false);
      assert.equal(counters.rpcCalls, 1);

      serverNow = new Date('2026-09-12T12:10:00.001Z');
      const replay = await post(idempotencyKey);
      assert.equal(replay.status, 200);
      assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
      assert.equal((await replay.json()).data.replayed, true);
      assert.equal(counters.rpcCalls, 2, 'replay must reach the authoritative P1A RPC');

      let transactionCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions`);
      assert.equal(transactionCount.rows[0].count, 1);

      const staleNewKey = await post('auto-expiry-new-key');
      assert.equal(staleNewKey.status, 400);
      assert.match((await staleNewKey.json()).errors.join(' '), /observation is stale/);
      assert.equal(counters.rpcCalls, 2, 'expired proof with a new key must not reach the RPC');

      const conflict = await post(idempotencyKey, { ...body, quantity: 2 });
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, 'IC001');
      assert.equal(counters.rpcCalls, 3, 'conflict candidate must be decided by P1A');

      const crossOperationKey = 'auto-expiry-cross-operation';
      await db.query(`
        SELECT public.create_cash_movement(
          p_profile_id => '${PROFILE_ID}'::uuid,
          p_entry_type => 'DEPOSIT',
          p_amount => 1000,
          p_idempotency_key => '${crossOperationKey}'
        )
      `);
      const crossOperationConflict = await post(crossOperationKey);
      assert.equal(crossOperationConflict.status, 409);
      assert.equal((await crossOperationConflict.json()).code, 'IC001');
      assert.equal(counters.rpcCalls, 4, 'another operation key must reach P1A only to conflict');

      transactionCount = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions`);
      assert.equal(transactionCount.rows[0].count, 1);
      const idempotencyCount = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM public.portfolio_idempotency_records
        WHERE profile_id = '${PROFILE_ID}' AND idempotency_key = '${idempotencyKey}'
      `);
      assert.equal(idempotencyCount.rows[0].count, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  });

  test('POST /api/cash/deposit and /withdraw forward Idempotency-Key and handle replayed headers', async () => {
    let depositCall = null;
    let withdrawCall = null;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      createCashMovementFn: async (payload) => {
        if (payload.entryType === 'DEPOSIT') {
          depositCall = payload;
          return { currentCash: 120000000, entry: { id: 'dep-1' }, replayed: payload.idempotencyKey === 'dep-replay' };
        }
        if (payload.entryType === 'WITHDRAWAL') {
          withdrawCall = payload;
          return { currentCash: 95000000, entry: { id: 'with-1' }, replayed: payload.idempotencyKey === 'with-replay' };
        }
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // Deposit replay
      const resDep = await ownerFetch(`${baseUrl}/api/cash/deposit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'dep-replay'
        },
        body: JSON.stringify({ amount: 20000000 })
      });
      assert.equal(resDep.status, 200);
      assert.equal(resDep.headers.get('Idempotent-Replayed'), 'true');
      assert.equal(depositCall.idempotencyKey, 'dep-replay');

      // Withdraw replay
      const resWith = await ownerFetch(`${baseUrl}/api/cash/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'with-replay'
        },
        body: JSON.stringify({ amount: 5000000 })
      });
      assert.equal(resWith.status, 200);
      assert.equal(resWith.headers.get('Idempotent-Replayed'), 'true');
      assert.equal(withdrawCall.idempotencyKey, 'with-replay');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('POST /api/positions/opening forwards Idempotency-Key and sets Idempotent-Replayed header', async () => {
    let openingPayload = null;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetByIdFn: async () => ({
        id: FPT_ASSET_ID,
        symbol: 'FPT',
        asset_type: 'stock',
        quote_currency: 'VND',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createOpeningPositionFn: async (payload) => {
        openingPayload = payload;
        return {
          openingPosition: { id: 'op-1', quantity: 50, averageCost: 80000 },
          holding: { id: 'h-1', quantity: 50 },
          replayed: payload.idempotencyKey === 'op-replay'
        };
      }
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      const res = await ownerFetch(`${baseUrl}/api/positions/opening`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'op-replay'
        },
        body: JSON.stringify({
          assetId: FPT_ASSET_ID,
          quantity: 50,
          averageCost: 80000
        })
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Idempotent-Replayed'), 'true');
      assert.equal(openingPayload.idempotencyKey, 'op-replay');
      const body = await res.json();
      assert.equal(body.data.replayed, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
