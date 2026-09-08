import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { isPortfolioEligibleAsset, normalizeAsset } from '../src/assets.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const SCHEMA_PATH = path.join(REPO_ROOT, 'server', 'db', 'schema.sql');
const CROSS_CURRENCY_MIGRATION_PATH = path.join(
  MIGRATIONS_DIR,
  '20260901010000_v1_1_cross_currency_accounting_foundation.sql'
);
const P01_MIGRATION_PATH = path.join(
  MIGRATIONS_DIR,
  '20260908000000_portfolio_v1_accounting_foundation.sql'
);

async function createDisposableSupabaseDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE SCHEMA extensions;
  `);
  return db;
}

describe('Portfolio V1 P0.1 database rebuild contract', () => {
  test('canonical eligibility keeps supported long-only classes and excludes reference FX', () => {
    for (const assetType of ['stock', 'etf', 'fund', 'gold', 'crypto']) {
      assert.equal(isPortfolioEligibleAsset(normalizeAsset({
        id: `${assetType}-id`,
        symbol: assetType.toUpperCase(),
        name: assetType,
        asset_type: assetType,
        quote_currency: assetType === 'stock' || assetType === 'etf' || assetType === 'fund' ? 'VND' : 'USD',
        is_active: true,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      })), true);
    }
    assert.equal(isPortfolioEligibleAsset(normalizeAsset({
      id: 'usd-vnd-id',
      symbol: 'USD/VND',
      name: 'USD / VND',
      asset_type: 'fx',
      base_currency: 'USD',
      quote_currency: 'VND',
      is_active: true,
      portfolio_eligibility: 'REFERENCE_ONLY'
    })), false);
  });

  test('chronological migration directory truthfully exposes its missing initial-schema prerequisite', async () => {
    const db = await createDisposableSupabaseDatabase();
    try {
      const migrationNames = (await readdir(MIGRATIONS_DIR))
        .filter((name) => name.endsWith('.sql'))
        .sort();
      const firstMigration = migrationNames[0];
      const sql = await readFile(path.join(MIGRATIONS_DIR, firstMigration), 'utf8');

      await assert.rejects(
        db.exec(sql),
        (error) => {
          assert.equal(firstMigration, '20260827122345_add_investor_profile_singleton_key.sql');
          assert.match(error.message, /investor_profile.*does not exist/i);
          return true;
        }
      );

      const tables = await db.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      assert.deepEqual(tables.rows, []);
    } finally {
      await db.close();
    }
  });

  test('immutable cross-currency migration reproduces its historical cash-ledger column defect', async () => {
    const db = await createDisposableSupabaseDatabase();
    try {
      const schema = await readFile(SCHEMA_PATH, 'utf8');
      const preCrossCurrencySchema = schema.split('-- Feature 30B1: single-owner security boundary')[0];
      assert.ok(preCrossCurrencySchema.length < schema.length, 'pre-cross-currency schema marker must exist');
      await db.exec(preCrossCurrencySchema);

      await db.exec(`
        INSERT INTO public.assets (
          id, symbol, name, asset_type, exchange, market_code, quote_currency,
          market_policy, market_timezone, quantity_unit, is_active
        ) VALUES (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FPT', 'FPT Corporation',
          'stock', 'HOSE', 'VN', 'VND', 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE
        );
        INSERT INTO public.investor_profile (
          id, singleton_key, cash_available, risk_tolerance, investment_horizon
        ) VALUES (
          '11111111-1111-4111-8111-111111111111', 1, 100, 'moderate', 'long'
        );
      `);

      await db.exec(await readFile(CROSS_CURRENCY_MIGRATION_PATH, 'utf8'));

      await assert.rejects(
        db.query(`
          SELECT public.create_portfolio_transaction(
            'FPT', NULL, 'BUY', 1, 10, '2026-08-02T00:00:00Z'
          )
        `),
        /column "balance_after" of relation "cash_ledger_entries" does not exist/i
      );

      const columns = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_ledger_entries'
        ORDER BY ordinal_position
      `);
      const names = columns.rows.map((row) => row.column_name);
      assert.ok(names.includes('portfolio_transaction_id'));
      assert.ok(names.includes('effective_at'));
      assert.ok(names.includes('metadata'));
      assert.equal(names.includes('balance_after'), false);
      assert.equal(names.includes('description'), false);
      assert.equal(names.includes('transaction_id'), false);
    } finally {
      await db.close();
    }
  });

  test('authoritative current-schema bootstrap builds Portfolio-critical objects on a blank database', async () => {
    const db = await createDisposableSupabaseDatabase();
    try {
      await db.exec(await readFile(SCHEMA_PATH, 'utf8'));

      const objects = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'investor_profile',
            'holdings',
            'portfolio_transactions',
            'cash_ledger_entries',
            'position_opening_baselines'
          )
        ORDER BY table_name
      `);
      assert.deepEqual(objects.rows.map((row) => row.table_name), [
        'cash_ledger_entries',
        'holdings',
        'investor_profile',
        'portfolio_transactions',
        'position_opening_baselines'
      ]);

      const ownershipConstraint = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM pg_constraint
        WHERE conrelid = 'public.investor_profile'::regclass
          AND confrelid = 'auth.users'::regclass
          AND contype = 'f'
      `);
      assert.deepEqual(ownershipConstraint.rows, [{ count: 1 }]);

      const eligibilityColumn = await db.query(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'assets'
          AND column_name = 'portfolio_eligibility'
      `);
      assert.deepEqual(eligibilityColumn.rows, [{ is_nullable: 'NO' }]);

      const trustBoundaries = await db.query(`
        SELECT
          has_table_privilege('anon', 'public.portfolio_transactions', 'INSERT') AS anon_transaction_insert,
          has_table_privilege('anon', 'public.cash_ledger_entries', 'INSERT') AS anon_cash_insert,
          has_table_privilege('service_role', 'public.portfolio_transactions', 'INSERT') AS service_transaction_insert,
          has_table_privilege('service_role', 'public.cash_ledger_entries', 'INSERT') AS service_cash_insert
      `);
      assert.deepEqual(trustBoundaries.rows, [{
        anon_transaction_insert: false,
        anon_cash_insert: false,
        service_transaction_insert: true,
        service_cash_insert: true
      }]);

      const functionBoundary = await db.query(`
        SELECT
          has_function_privilege(
            'anon',
            'public.create_portfolio_transaction(uuid,text,text,text,numeric,numeric,timestamp with time zone,numeric,text,text,text,numeric,text,timestamp with time zone)',
            'EXECUTE'
          ) AS anon_transaction_execute,
          has_function_privilege(
            'service_role',
            'public.create_portfolio_transaction(uuid,text,text,text,numeric,numeric,timestamp with time zone,numeric,text,text,text,numeric,text,timestamp with time zone)',
            'EXECUTE'
          ) AS service_transaction_execute
      `);
      assert.deepEqual(functionBoundary.rows, [{
        anon_transaction_execute: false,
        service_transaction_execute: true
      }]);

      const criticalConstraints = await db.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid IN (
          'public.assets'::regclass,
          'public.cash_ledger_entries'::regclass,
          'public.portfolio_transactions'::regclass,
          'public.position_opening_baselines'::regclass
        )
          AND conname IN (
            'assets_portfolio_eligibility_check',
            'cash_ledger_entries_amount_check',
            'portfolio_transactions_quantity_check',
            'position_opening_baselines_opening_quantity_check'
          )
        ORDER BY conname
      `);
      assert.ok(criticalConstraints.rows.some((row) => row.conname === 'assets_portfolio_eligibility_check'));
      assert.ok(criticalConstraints.rows.length >= 3);

      const triggers = await db.query(`
        SELECT DISTINCT trigger_name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND trigger_name IN (
            'trg_portfolio_transaction_asset_eligibility',
            'trg_opening_position_asset_eligibility',
            'trg_align_trade_cash_economic_time'
          )
        ORDER BY trigger_name
      `);
      assert.deepEqual(triggers.rows.map((row) => row.trigger_name), [
        'trg_align_trade_cash_economic_time',
        'trg_opening_position_asset_eligibility',
        'trg_portfolio_transaction_asset_eligibility'
      ]);

      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111');
        INSERT INTO public.investor_profile (
          id, user_id, cash_available, risk_tolerance, investment_horizon
        ) VALUES (
          '22222222-2222-4222-8222-222222222222',
          '11111111-1111-4111-8111-111111111111', 100, 'moderate', 'long'
        );
        INSERT INTO public.assets (
          id, symbol, name, asset_type, exchange, market_code, quote_currency,
          base_currency, market_policy, market_timezone, quantity_unit, is_active,
          portfolio_eligibility
        ) VALUES
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FPT', 'FPT Corporation',
           'stock', 'HOSE', 'VN', 'VND', NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh',
           'share', TRUE, 'PORTFOLIO_ELIGIBLE'),
          ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'USD/VND', 'USD / VND',
           'fx', NULL, 'FX', 'VND', 'USD', 'GLOBAL_24_5', 'UTC',
           'currency unit', TRUE, 'REFERENCE_ONLY');
      `);

      const result = await db.query(`
        SELECT public.create_portfolio_transaction(
          '22222222-2222-4222-8222-222222222222'::uuid,
          'FPT', NULL, 'BUY', 1, 10, '2026-08-02T00:00:00Z'::timestamptz
        ) AS result
      `);
      assert.equal(
        new Date(result.rows[0].result.transaction.executed_at).toISOString(),
        '2026-08-02T00:00:00.000Z'
      );

      const linkedCash = await db.query(`
        SELECT effective_at, created_at, portfolio_transaction_id, metadata
        FROM public.cash_ledger_entries
        WHERE entry_type = 'BUY'
      `);
      assert.equal(linkedCash.rows.length, 1);
      assert.equal(new Date(linkedCash.rows[0].effective_at).toISOString(), '2026-08-02T00:00:00.000Z');
      assert.notEqual(
        new Date(linkedCash.rows[0].created_at).toISOString(),
        new Date(linkedCash.rows[0].effective_at).toISOString()
      );
      assert.equal(
        linkedCash.rows[0].metadata.economicTimeAuthority,
        'portfolio_transaction.executed_at'
      );

      const beforeCounts = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM public.portfolio_transactions) AS transactions,
          (SELECT COUNT(*)::int FROM public.holdings) AS holdings,
          (SELECT COUNT(*)::int FROM public.cash_ledger_entries) AS cash_entries
      `);
      await assert.rejects(
        db.query(`
          SELECT public.create_portfolio_transaction(
            '22222222-2222-4222-8222-222222222222'::uuid,
            'USD/VND', NULL, 'BUY', 1, 1, '2026-08-03T00:00:00Z'::timestamptz
          )
        `),
        /asset is not portfolio eligible/i
      );
      await assert.rejects(
        db.query(`
          SELECT public.create_opening_position(
            '22222222-2222-4222-8222-222222222222'::uuid,
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 25000
          )
        `),
        /asset is not portfolio eligible/i
      );
      const afterCounts = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM public.portfolio_transactions) AS transactions,
          (SELECT COUNT(*)::int FROM public.holdings) AS holdings,
          (SELECT COUNT(*)::int FROM public.cash_ledger_entries) AS cash_entries
      `);
      assert.deepEqual(afterCounts.rows, beforeCounts.rows);
    } finally {
      await db.close();
    }
  });

  test('exact P0.1 forward migration applies cleanly after the authoritative pre-P0.1 baseline', async () => {
    const db = await createDisposableSupabaseDatabase();
    try {
      const schema = await readFile(SCHEMA_PATH, 'utf8');
      const marker = '-- Portfolio V1 P0.1: accounting-time and asset-eligibility trust boundaries.';
      const preP01Schema = schema.split(marker)[0];
      assert.ok(preP01Schema.length < schema.length, 'P0.1 schema marker must exist');

      await db.exec(preP01Schema);
      await db.exec(await readFile(P01_MIGRATION_PATH, 'utf8'));

      const result = await db.query(`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'assets'
              AND column_name = 'portfolio_eligibility'
              AND is_nullable = 'NO'
          ) AS eligibility_ready,
          EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND trigger_name = 'trg_align_trade_cash_economic_time'
          ) AS cash_time_trigger_ready,
          EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND trigger_name = 'trg_portfolio_transaction_asset_eligibility'
          ) AS transaction_guard_ready,
          EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND trigger_name = 'trg_opening_position_asset_eligibility'
          ) AS opening_guard_ready
      `);
      assert.deepEqual(result.rows, [{
        eligibility_ready: true,
        cash_time_trigger_ready: true,
        transaction_guard_ready: true,
        opening_guard_ready: true
      }]);
    } finally {
      await db.close();
    }
  });
});
