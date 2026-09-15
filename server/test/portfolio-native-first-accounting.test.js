import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../index.js';
import { getFxRate } from '../src/fx.js';
import { calculatePortfolioValuation } from '../src/portfolio.js';
import {
  calculatePortfolioPerformance,
  getExternalSettlementFlowForDate
} from '../src/performance.js';
import { ownerFetch } from './helpers/owner-auth.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'server', 'db', 'schema.sql');
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase', 'migrations', '20260915000000_portfolio_native_first_accounting.sql');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const ONDO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE SCHEMA extensions;
  `);
  await db.exec(await readFile(SCHEMA_PATH, 'utf8'));
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_ID}');
    INSERT INTO public.investor_profile (id, user_id, cash_available, risk_tolerance, investment_horizon)
    VALUES ('${PROFILE_ID}', '${USER_ID}', 100000000, 'moderate', 'long');
    INSERT INTO public.assets (
      id, symbol, name, asset_type, exchange, market_code, quote_currency,
      base_currency, market_policy, market_timezone, quantity_unit, is_active,
      portfolio_eligibility
    ) VALUES
      ('${ONDO_ID}', 'ONDO', 'Ondo', 'crypto', 'BINANCE', 'CRYPTO', 'USD',
       'ONDO', 'CONTINUOUS_24_7', 'UTC', 'token', TRUE, 'PORTFOLIO_ELIGIBLE'),
      ('${FPT_ID}', 'FPT', 'FPT Corporation', 'stock', 'HOSE', 'VN', 'VND',
       NULL, 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE, 'PORTFOLIO_ELIGIBLE');
  `);
  return db;
}

async function createTransaction(db, {
  key,
  symbol = 'ONDO',
  type = 'BUY',
  quantity = 226,
  price = null,
  executionUnitPrice = 0.36402,
  priceCurrency = 'USDT',
  settlementMode = 'EXTERNAL_SETTLEMENT',
  executedAt = null,
  fxRateToVnd = null,
  fxProvenance = null,
  fxObservedAt = null
} = {}) {
  const result = await db.query(`
    SELECT public.create_portfolio_transaction(
      p_profile_id => $1::uuid, p_symbol => $2::text, p_asset_id => NULL,
      p_transaction_type => $3::text, p_quantity => $4::numeric,
      p_price => $5::numeric, p_executed_at => $13::timestamptz,
      p_execution_unit_price => $6::numeric, p_price_currency => $7::text,
      p_settlement_mode => $8::text, p_settlement_currency => $7::text,
      p_fx_rate_to_vnd => $9::numeric, p_fx_provenance => $10::text,
      p_fx_observed_at => $11::timestamptz, p_idempotency_key => $12::text
    ) AS result
  `, [PROFILE_ID, symbol, type, quantity, price, executionUnitPrice, priceCurrency,
    settlementMode, fxRateToVnd, fxProvenance, fxObservedAt, key, executedAt]);
  return result.rows[0].result;
}

function createClient(db) {
  return {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(column, value) { filters[column] = value; return this; },
        async maybeSingle() {
          assert.equal(table, 'portfolio_idempotency_records');
          const result = await db.query(`
            SELECT idempotency_key FROM public.portfolio_idempotency_records
            WHERE profile_id = $1::uuid AND idempotency_key = $2::text
          `, [filters.profile_id, filters.idempotency_key]);
          return { data: result.rows[0] || null, error: null };
        }
      };
    },
    async rpc(name, args) {
      assert.equal(name, 'create_portfolio_transaction');
      try {
        const result = await db.query(`
          SELECT public.create_portfolio_transaction(
            p_profile_id => $1::uuid, p_symbol => $2::text, p_asset_id => $3::text,
            p_transaction_type => $4::text, p_quantity => $5::numeric,
            p_price => $6::numeric, p_executed_at => $7::timestamptz,
            p_execution_unit_price => $8::numeric, p_price_currency => $9::text,
            p_settlement_mode => $10::text, p_settlement_currency => $11::text,
            p_fx_rate_to_vnd => $12::numeric, p_fx_provenance => $13::text,
            p_fx_observed_at => $14::timestamptz, p_idempotency_key => $15::text
          ) AS result
        `, [args.p_profile_id, args.p_symbol, args.p_asset_id, args.p_transaction_type,
          args.p_quantity, args.p_price, args.p_executed_at, args.p_execution_unit_price,
          args.p_price_currency, args.p_settlement_mode, args.p_settlement_currency,
          args.p_fx_rate_to_vnd, args.p_fx_provenance, args.p_fx_observed_at,
          args.p_idempotency_key]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    }
  };
}

describe('Native-first portfolio accounting', () => {
  test('forward migration executes cleanly on the exact preceding schema', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth;
        CREATE TABLE auth.users (id UUID PRIMARY KEY); CREATE SCHEMA extensions;
      `);
      const schema = await readFile(SCHEMA_PATH, 'utf8');
      const marker = '-- Schema Migration: 20260915000000_portfolio_native_first_accounting.sql';
      const preMigration = schema.slice(0, schema.indexOf(marker));
      assert.ok(preMigration.length > 0 && preMigration.length < schema.length);
      await db.exec(preMigration);
      await db.exec(await readFile(MIGRATION_PATH, 'utf8'));
      const columns = await db.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'holdings'
          AND column_name IN ('native_average_cost', 'native_cost_currency')
      `);
      assert.equal(columns.rows.length, 2);
    } finally {
      await db.close();
    }
  });

  test('226 ONDO native-only BUY persists exact USDT authority and replays safely', async () => {
    const db = await createDatabase();
    try {
      const first = await createTransaction(db, { key: 'native-ondo-1' });
      assert.equal(first.replayed, false);
      assert.equal(first.accountingStatus, 'UNAVAILABLE');
      assert.equal(first.transaction.price, null);
      assert.equal(Number(first.transaction.quantity), 226);
      assert.equal(Number(first.transaction.execution_unit_price), 0.36402);
      assert.equal(first.transaction.price_currency, 'USDT');
      assert.equal(Number(first.transaction.quantity) * Number(first.transaction.execution_unit_price), 82.26852);
      assert.equal(Number(first.holding.native_average_cost), 0.36402);
      assert.equal(first.holding.native_cost_currency, 'USDT');
      assert.equal(first.holding.average_cost, null);
      assert.equal(first.currentCash, 100000000);

      const replay = await createTransaction(db, { key: 'native-ondo-1' });
      assert.equal(replay.replayed, true);
      const counts = await db.query(`SELECT COUNT(*)::int count FROM public.portfolio_transactions`);
      assert.equal(counts.rows[0].count, 1);

      await assert.rejects(
        createTransaction(db, { key: 'native-ondo-1', quantity: 227 }),
        (error) => error.code === 'IC001'
      );
    } finally {
      await db.close();
    }
  });

  test('native weighted cost, nullable SELL P/L, mixed currency, and exact reversal snapshots', async () => {
    const db = await createDatabase();
    try {
      await createTransaction(db, { key: 'buy-a', quantity: 226, executionUnitPrice: 0.36402 });
      const second = await createTransaction(db, { key: 'buy-b', quantity: 74, executionUnitPrice: 0.4 });
      const expectedAverage = ((226 * 0.36402) + (74 * 0.4)) / 300;
      assert.ok(Math.abs(Number(second.holding.native_average_cost) - expectedAverage) < 1e-12);

      const sell = await createTransaction(db, {
        key: 'sell-native', type: 'SELL', quantity: 25, executionUnitPrice: 0.45
      });
      assert.equal(sell.transaction.realized_pnl, null);
      assert.equal(Number(sell.holding.quantity), 275);
      assert.equal(sell.holding.native_cost_currency, 'USDT');

      const sellReversal = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => $1::uuid, p_transaction_id => $2::uuid,
          p_reason => 'native sell correction', p_idempotency_key => 'reverse-native-sell'
        ) AS result
      `, [PROFILE_ID, sell.transaction.id]);
      assert.equal(Number(sellReversal.rows[0].result.holding.quantity), 300);
      assert.ok(Math.abs(Number(sellReversal.rows[0].result.holding.native_average_cost) - expectedAverage) < 1e-12);

      const mixed = await createTransaction(db, {
        key: 'buy-usd', quantity: 1, executionUnitPrice: 1, priceCurrency: 'USD'
      });
      assert.equal(mixed.holding.native_average_cost, null);
      assert.equal(mixed.holding.native_cost_currency, null);

      const reversed = await db.query(`
        SELECT public.reverse_portfolio_transaction(
          p_profile_id => $1::uuid, p_transaction_id => $2::uuid,
          p_reason => 'mixed currency correction', p_idempotency_key => 'reverse-mixed-buy'
        ) AS result
      `, [PROFILE_ID, mixed.transaction.id]);
      assert.equal(Number(reversed.rows[0].result.holding.quantity), 300);
      assert.equal(reversed.rows[0].result.holding.native_cost_currency, 'USDT');
      assert.ok(Math.abs(Number(reversed.rows[0].result.holding.native_average_cost) - expectedAverage) < 1e-12);
    } finally {
      await db.close();
    }
  });

  test('VND/internal transactions still require price and native-only rows reject partial FX evidence', async () => {
    const db = await createDatabase();
    try {
      await assert.rejects(
        createTransaction(db, { key: 'internal-null', settlementMode: 'INTERNAL_VND_CASH' }),
        (error) => error.code === 'PT004'
      );
      await assert.rejects(
        createTransaction(db, {
          key: 'vnd-null', symbol: 'FPT', executionUnitPrice: 73000,
          priceCurrency: 'VND', settlementMode: 'EXTERNAL_SETTLEMENT'
        }),
        (error) => error.code === 'PT004'
      );
      await assert.rejects(
        createTransaction(db, { key: 'partial-fx', fxRateToVnd: 25000 }),
        (error) => error.code === 'PT005'
      );

      const legacy = await createTransaction(db, {
        key: 'legacy-vnd-basis', price: 9100, fxProvenance: 'USER_SUPPLIED_VND_BASIS'
      });
      assert.equal(Number(legacy.transaction.price), 9100);
      assert.equal(legacy.accountingStatus, 'AVAILABLE');
    } finally {
      await db.close();
    }
  });

  test('Express route succeeds with provider disabled and preserves P1A replay/conflict', async () => {
    const db = await createDatabase();
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async (symbol) => symbol === 'FPT'
        ? {
          id: FPT_ID, symbol: 'FPT', asset_type: 'stock', quote_currency: 'VND',
          portfolio_eligibility: 'PORTFOLIO_ELIGIBLE', is_active: true
        }
        : {
          id: ONDO_ID, symbol: 'ONDO', asset_type: 'crypto', quote_currency: 'USD',
          portfolio_eligibility: 'PORTFOLIO_ELIGIBLE', is_active: true
        },
      transactionClient: createClient(db),
      accountingRateEnabled: false
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const body = {
      symbol: 'ONDO', transactionType: 'BUY', quantity: 226, price: null,
      executionUnitPrice: 0.36402, priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT', settlementCurrency: 'USDT'
    };
    const post = (payload) => ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'route-native-key' },
      body: JSON.stringify(payload)
    });

    try {
      const first = await post(body);
      assert.equal(first.status, 201);
      const firstBody = await first.json();
      assert.equal(firstBody.data.accountingStatus, 'UNAVAILABLE');
      assert.equal(firstBody.data.transaction.price, null);

      const replay = await post(body);
      assert.equal(replay.status, 200);
      assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');

      const conflict = await post({ ...body, quantity: 227 });
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, 'IC001');

      const missingVndPrice = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'route-vnd-null' },
        body: JSON.stringify({
          symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: null,
          executionUnitPrice: 73000, priceCurrency: 'VND',
          settlementMode: 'EXTERNAL_SETTLEMENT', settlementCurrency: 'VND'
        })
      });
      assert.equal(missingVndPrice.status, 400);
      assert.match((await missingVndPrice.json()).errors[0], /price is required/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  });

  test('current native value survives missing VND FX; valid direct USDT/VND enables VND value', () => {
    const holdings = [{
      id: 'h1', asset_id: ONDO_ID, quantity: 226, average_cost: null,
      native_average_cost: 0.36402, native_cost_currency: 'USDT',
      asset: { symbol: 'ONDO', asset_type: 'crypto', quote_currency: 'USD' }
    }];
    const nativeReference = {
      ONDO: { price: 0.5, currency: 'USDT', source: 'Binance', priceAsOf: '2026-09-15T01:00:00Z' }
    };

    const unavailable = calculatePortfolioValuation(
      { cash_available: 0 }, holdings, {}, {}, nativeReference
    );
    assert.equal(unavailable.holdings[0].nativeMarketValue, 113);
    assert.equal(unavailable.holdings[0].nativeCurrency, 'USDT');
    assert.equal(unavailable.holdings[0].marketValue, null);
    assert.equal(unavailable.holdings[0].valuationStatus, 'unavailable');

    const available = calculatePortfolioValuation(
      { cash_available: 0 }, holdings, {}, {
        USDT: {
          baseCurrency: 'USDT', quoteCurrency: 'VND', rate: 25000,
          provider: 'CoinGecko', sourceTimestamp: '2026-09-15T01:00:00Z',
          availability: 'available', freshness: 'current'
        }
      }, nativeReference
    );
    assert.equal(available.holdings[0].marketValue, 2825000);
    assert.ok(Math.abs(available.holdings[0].nativeUnrealizedPnL - (226 * (0.5 - 0.36402))) < 1e-12);
  });

  test('current USDT/VND valuation uses only the governed direct pair and stays unavailable when disabled', async () => {
    const disabled = await getFxRate('USDT', 'VND', {
      accountingRateEnabled: false,
      getAccountingRateFn: async (pair, options) => {
        assert.deepEqual(pair, { baseCurrency: 'USDT', quoteCurrency: 'VND' });
        assert.equal(options.enabled, false);
        return {
          availability: 'unavailable',
          reason: 'PROVIDER_NOT_ENABLED',
          provider: 'CoinGecko'
        };
      }
    });
    assert.equal(disabled.availability, 'unavailable');
    assert.equal(disabled.rate, null);

    const direct = await getFxRate('USDT', 'VND', {
      accountingRateEnabled: true,
      getAccountingRateFn: async (pair) => {
        assert.deepEqual(pair, { baseCurrency: 'USDT', quoteCurrency: 'VND' });
        return {
          availability: 'available',
          baseCurrency: 'USDT',
          quoteCurrency: 'VND',
          rate: 25000,
          provider: 'CoinGecko',
          observedAt: '2026-09-15T01:00:00.000Z'
        };
      }
    });
    assert.equal(direct.availability, 'available');
    assert.equal(direct.baseCurrency, 'USDT');
    assert.equal(direct.quoteCurrency, 'VND');
    assert.equal(direct.rate, 25000);
    assert.equal(direct.provider, 'CoinGecko');
  });

  test('performance treats missing accounting as unavailable but preserves explicit zero', () => {
    const missing = getExternalSettlementFlowForDate('2026-09-15', [{
      transactionType: 'BUY', quantity: 226, price: null,
      settlementMode: 'EXTERNAL_SETTLEMENT', executedAt: '2026-09-15T01:00:00Z'
    }]);
    assert.equal(missing.accountingComplete, false);
    assert.equal(missing.netExternalSettlementFlow, null);
    assert.notEqual(missing.netExternalSettlementFlow, 0);

    const explicit = getExternalSettlementFlowForDate('2026-09-15', [{
      transactionType: 'BUY', quantity: 1, price: 100,
      settlementMode: 'EXTERNAL_SETTLEMENT', executedAt: '2026-09-15T01:00:00Z'
    }, {
      transactionType: 'BUY_REVERSAL', quantity: 1, price: 100,
      settlementMode: 'EXTERNAL_SETTLEMENT', executedAt: '2026-09-15T02:00:00Z'
    }]);
    assert.equal(explicit.accountingComplete, true);
    assert.equal(explicit.netExternalSettlementFlow, 0);

    const performance = calculatePortfolioPerformance({
      range: '1W',
      now: new Date('2026-09-16T10:00:00.000Z'),
      cashActivation: {
        openingBalanceAmount: 100000000,
        activatedAt: '2026-09-10T00:00:00.000Z'
      },
      cashEntries: [],
      positionBaselines: [],
      transactions: [{
        id: 'native-performance-buy',
        assetId: ONDO_ID,
        transactionType: 'BUY',
        quantity: 226,
        price: null,
        settlementMode: 'EXTERNAL_SETTLEMENT',
        executedAt: '2026-09-15T01:00:00.000Z',
        createdAt: '2026-09-15T01:00:00.000Z'
      }],
      assets: [{
        id: ONDO_ID,
        symbol: 'ONDO',
        quoteCurrency: 'USD',
        quote_currency: 'USD'
      }],
      priceHistoryMap: {}
    });
    const missingDay = performance.series.find((point) => point.date === '2026-09-15');
    assert.equal(missingDay.externalSettlementFlowVnd, null);
    assert.equal(missingDay.netExternalFlowVnd, null);
    assert.equal(performance.twr.status, 'unavailable');
    assert.equal(performance.mwr.status, 'unavailable');
    assert.ok(performance.valuationCoverage.reasons.includes(
      'EXTERNAL_SETTLEMENT_VND_BASIS_UNAVAILABLE'
    ));
  });
});
