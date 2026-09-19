import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../index.js';
import { reconstructHoldingsState } from '../src/performance.js';
import { calculatePortfolioValuation, getPortfolioOverview } from '../src/portfolio.js';
import { createOpeningPosition } from '../src/positions.js';
import { ownerFetch } from './helpers/owner-auth.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'server', 'db', 'schema.sql');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260909000000_portfolio_native_opening_cost.sql'
);
const RECREATED_OPENING_MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260919000000_allow_recreated_opening_positions.sql'
);
const OPENING_MODAL_PATH = path.join(REPO_ROOT, 'client', 'src', 'components', 'OpeningPositionModal.jsx');
const APP_PATH = path.join(REPO_ROOT, 'client', 'src', 'App.jsx');
const PORTFOLIO_HOLDINGS_PATH = path.join(REPO_ROOT, 'client', 'src', 'components', 'PortfolioSummaryHoldings.jsx');
const PORTFOLIO_DISPLAY_PATH = path.join(REPO_ROOT, 'client', 'src', 'utils', 'portfolioSnapshotDisplay.js');

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const BTC_ID = '22222222-2222-4222-8222-222222222222';
const FPT_ID = '33333333-3333-4333-8333-333333333333';
const FX_ID = '44444444-4444-4444-8444-444444444444';
const ONDO_ID = '55555555-5555-4555-8555-555555555555';

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
  return db;
}

function createPglitePositionClient(db) {
  return {
    async rpc(name, args) {
      if (name !== 'create_opening_position') {
        return { data: null, error: { code: 'PGRST202', message: `Unsupported test RPC: ${name}` } };
      }

      try {
        const result = await db.query(`
          SELECT public.create_opening_position(
            $1::uuid, $2::text, $3::numeric, $4::numeric, $5::numeric,
            $6::text, $7::numeric, $8::text, $9::timestamptz, $10::text
          ) AS result
        `, [
          args.p_profile_id,
          args.p_asset_id,
          args.p_quantity,
          args.p_average_cost,
          args.p_execution_unit_price ?? null,
          args.p_price_currency ?? 'VND',
          args.p_fx_rate_to_vnd ?? null,
          args.p_fx_provenance ?? null,
          args.p_fx_observed_at ?? null,
          args.p_idempotency_key ?? null
        ]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            code: error.code,
            message: error.message,
            constraint: error.constraint_name || error.constraint || null
          }
        };
      }
    }
  };
}

function cryptoHolding() {
  return {
    id: 'holding-btc',
    asset_id: BTC_ID,
    quantity: 1234,
    average_cost: null,
    asset: {
      id: BTC_ID,
      symbol: 'BTC',
      name: 'Bitcoin',
      asset_type: 'crypto',
      quote_currency: 'USD'
    },
    opening_position: {
      id: 'opening-btc',
      execution_unit_price: 0.82,
      price_currency: 'USDT',
      locked_at: null,
      cancelled_at: null
    }
  };
}

describe('Portfolio V1 P0.2.1 native-currency opening positions', () => {
  test('production HTTP route accepts quantity plus USDT average cost without a VND basis', async () => {
    let receivedPayload;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetByIdFn: async () => ({
        id: BTC_ID,
        symbol: 'BTC',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createOpeningPositionFn: async (payload) => {
        receivedPayload = payload;
        return {
          openingPosition: { openingAverageCost: null, nativeAverageCost: 0.82, nativeCostCurrency: 'USDT' },
          holding: { averageCost: null, quantity: 1234 }
        };
      }
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await ownerFetch(`http://127.0.0.1:${server.address().port}/api/positions/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: BTC_ID,
          quantity: 1234,
          averageCost: null,
          executionUnitPrice: 0.82,
          priceCurrency: 'USDT'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      assert.equal(body.status, 'ok');
      assert.deepEqual(receivedPayload, {
        assetId: BTC_ID,
        quantity: 1234,
        averageCost: null,
        executionUnitPrice: 0.82,
        priceCurrency: 'USDT'
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('production HTTP route rejects a non-VND opening position without explicit native price and currency', async () => {
    let createCalls = 0;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetByIdFn: async () => ({
        id: BTC_ID,
        symbol: 'BTC',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createOpeningPositionFn: async () => {
        createCalls += 1;
        throw new Error('must not be called');
      }
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await ownerFetch(`http://127.0.0.1:${server.address().port}/api/positions/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: BTC_ID, quantity: 1, averageCost: null })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.deepEqual(body.errors, [
        'priceCurrency is required for a non-VND opening position',
        'executionUnitPrice is required for a non-VND opening position'
      ]);
      assert.equal(createCalls, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('unexpected opening-position persistence errors expose a stable public code and log only sanitized diagnostics', async () => {
    const sensitiveMessage = 'duplicate row contained secret-token-value and internal database details';
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetByIdFn: async () => ({
        id: ONDO_ID,
        symbol: 'ONDO',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createOpeningPositionFn: async () => {
        const error = new Error(sensitiveMessage);
        error.code = '23505';
        throw error;
      }
    });
    const server = http.createServer(app);
    const logs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => logs.push(args);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const response = await ownerFetch(`http://127.0.0.1:${server.address().port}/api/positions/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: ONDO_ID,
          quantity: 226,
          averageCost: null,
          executionUnitPrice: 0.36402,
          priceCurrency: 'USDT'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.deepEqual(body, {
        status: 'error',
        code: 'OPENING_POSITION_CREATE_FAILED',
        message: 'Failed to create opening position'
      });
      assert.deepEqual(logs, [[
        '[opening-position] unexpected persistence failure',
        { operation: 'create', code: '23505' }
      ]]);
      assert.equal(JSON.stringify({ body, logs }).includes(sensitiveMessage), false);
    } finally {
      console.error = originalConsoleError;
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('service preserves a nullable VND basis and native USDT cost without coercion', async () => {
    let captured;
    const client = {
      async rpc(name, args) {
        captured = { name, args };
        return {
          data: {
            openingPosition: {
              id: 'opening-btc',
              profile_id: PROFILE_ID,
              asset_id: BTC_ID,
              opening_quantity: args.p_quantity,
              opening_average_cost: null,
              execution_unit_price: args.p_execution_unit_price,
              price_currency: args.p_price_currency,
              accounting_cutoff_at: '2026-09-09T00:00:00.000Z',
              provenance_type: 'USER_DECLARED_INITIAL',
              locked_at: null,
              cancelled_at: null
            },
            holding: {
              id: 'holding-btc',
              profile_id: PROFILE_ID,
              asset_id: BTC_ID,
              opening_position_id: 'opening-btc',
              quantity: args.p_quantity,
              average_cost: null
            }
          },
          error: null
        };
      }
    };

    const result = await createOpeningPosition({
      profileId: PROFILE_ID,
      assetId: BTC_ID,
      quantity: 1234,
      averageCost: null,
      executionUnitPrice: 0.82,
      priceCurrency: 'usdt'
    }, client);

    assert.equal(captured.name, 'create_opening_position');
    assert.equal(captured.args.p_average_cost, null);
    assert.equal(captured.args.p_execution_unit_price, 0.82);
    assert.equal(captured.args.p_price_currency, 'USDT');
    assert.equal(result.openingPosition.openingAverageCost, null);
    assert.equal(result.openingPosition.nativeAverageCost, 0.82);
    assert.equal(result.openingPosition.nativeCostCurrency, 'USDT');
    assert.equal(result.holding.averageCost, null);
  });

  test('same-currency native P/L is available while VND cost and VND P/L remain unavailable', () => {
    const result = calculatePortfolioValuation(
      { cash_available: 200000000 },
      [cryptoHolding()],
      { BTC: { price: 0.91, currency: 'USD', priceAsOf: '2026-09-09T00:00:00.000Z' } },
      { USDT: { baseCurrency: 'USDT', quoteCurrency: 'VND', rate: 25000, availability: 'available', provider: 'test-fx', sourceTimestamp: '2026-09-09T00:00:00.000Z', freshness: 'current' } },
      { BTC: { price: 0.91, currency: 'USDT', source: 'Binance', priceAsOf: '2026-09-09T00:00:01.000Z' } }
    );

    const holding = result.holdings[0];
    assert.equal(holding.nativeAverageCost, 0.82);
    assert.equal(holding.nativeCostCurrency, 'USDT');
    assert.equal(holding.nativeCostBasis, 1011.88);
    assert.ok(Math.abs(holding.nativeUnrealizedPnL - 111.06) < 1e-10);
    assert.equal(holding.nativePnlStatus, 'available');
    assert.equal(holding.averageCost, null);
    assert.equal(holding.costBasis, null);
    assert.equal(holding.unrealizedPnL, null);
    assert.equal(holding.pnlReason, 'VND_COST_BASIS_UNKNOWN');
    assert.equal(holding.reportingMarketValue, 1234 * 0.91 * 25000);
    assert.equal(result.summary.totalCostBasis, null);
    assert.equal(result.summary.totalUnrealizedPnL, null);
    assert.equal(result.summary.pnlCoverageStatus, 'unavailable');
  });

  test('canonical USD snapshot cannot masquerade as a USDT current price', () => {
    const result = calculatePortfolioValuation(
      { cash_available: 0 },
      [cryptoHolding()],
      { BTC: { price: 0.91, currency: 'USD' } },
      { USD: { baseCurrency: 'USD', quoteCurrency: 'VND', rate: 25000, availability: 'available', provider: 'test-fx', sourceTimestamp: '2026-09-09T00:00:00.000Z', freshness: 'current' } }
    );
    assert.equal(result.holdings[0].nativeCurrentPrice, null);
    assert.equal(result.holdings[0].nativeUnrealizedPnL, null);
    assert.equal(result.holdings[0].nativePnlStatus, 'unavailable');
    assert.equal(result.holdings[0].reportingMarketValue, null);
    assert.equal(result.holdings[0].nativeMarketValue, null);
  });

  test('later ledger replay cannot fabricate a VND basis for an unknown-cost opening position', () => {
    const state = reconstructHoldingsState('2026-09-09', [{
      assetId: BTC_ID,
      openingQuantity: 2,
      openingAverageCost: null,
      accountingCutoffAt: '2026-09-01T00:00:00.000Z'
    }], [{
      assetId: BTC_ID,
      transactionType: 'BUY',
      quantity: 1,
      price: 25000000,
      executedAt: '2026-09-08T00:00:00.000Z',
      createdAt: '2026-09-08T00:00:01.000Z'
    }]);
    assert.equal(state.get(BTC_ID).quantity, 3);
    assert.equal(state.get(BTC_ID).averageCost, null);
  });

  test('overview requests Binance reference only for unlocked USDT opening cost and keeps accounting snapshot separate', async () => {
    let snapshotCalls = 0;
    let realtimeCalls = 0;
    const result = await getPortfolioOverview({
      getCashOverviewFn: async () => ({ currentCash: 100 }),
      getHoldingsFn: async () => [cryptoHolding()],
      getMarketSnapshotFn: async () => {
        snapshotCalls += 1;
        return { price: 1, currency: 'USD' };
      },
      getMarketRealtimeFn: async () => {
        realtimeCalls += 1;
        return {
          price: 1.1,
          currency: 'USDT',
          observedAt: '2026-09-09T00:00:01.000Z',
          source: 'binance_websocket'
        };
      },
      getFxRateFn: async () => ({
        baseCurrency: 'USDT', quoteCurrency: 'VND', rate: 25000, availability: 'available',
        provider: 'test-fx', sourceTimestamp: '2026-09-09T00:00:00.000Z', freshness: 'current'
      })
    });

    assert.equal(snapshotCalls, 1);
    assert.equal(realtimeCalls, 1);
    assert.equal(result.holdings[0].reportingMarketValue, 1234 * 1.1 * 25000);
    assert.equal(result.holdings[0].nativeCurrentPrice, 1.1);
    assert.equal(result.holdings[0].nativeCurrentPriceAsOf, '2026-09-09T00:00:01.000Z');
    assert.equal(result.holdings[0].nativeCurrentPriceSource, 'binance_websocket');
  });

  test('current bootstrap executes native-cost RPC, preserves cash, and rejects reference-only assets atomically', async () => {
    const db = await createDatabase();
    try {
      await db.exec(await readFile(SCHEMA_PATH, 'utf8'));
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        INSERT INTO public.investor_profile (
          id, user_id, cash_available, risk_tolerance, investment_horizon
        ) VALUES (
          '${PROFILE_ID}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200000000, 'moderate', 'long'
        );
        INSERT INTO public.assets (
          id, symbol, name, asset_type, market_code, quote_currency,
          market_policy, market_timezone, quantity_unit, is_active, portfolio_eligibility
        ) VALUES
          ('${BTC_ID}', 'BTC', 'Bitcoin', 'crypto', 'CRYPTO', 'USD', 'CONTINUOUS_24_7', 'UTC', 'coin', TRUE, 'PORTFOLIO_ELIGIBLE'),
          ('${FPT_ID}', 'FPT', 'FPT Corporation', 'stock', 'VN', 'VND', 'VN_EXCHANGE', 'Asia/Ho_Chi_Minh', 'share', TRUE, 'PORTFOLIO_ELIGIBLE'),
          ('${FX_ID}', 'USD/VND', 'USD / VND', 'fx', 'FX', 'VND', 'GLOBAL_24_5', 'UTC', 'currency unit', TRUE, 'REFERENCE_ONLY');
        INSERT INTO public.asset_provider_mappings (asset_id, provider, provider_symbol, provider_market)
        VALUES ('${BTC_ID}', 'binance', 'BTCUSDT', 'SPOT');
      `);

      const beforeCash = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      const native = await db.query(`
        SELECT public.create_opening_position(
          '${PROFILE_ID}'::uuid, '${BTC_ID}', 1234, NULL, 0.82, 'USDT', 26000,
          'USER_DECLARED', '2026-09-09T00:00:00Z'::timestamptz
        ) AS result
      `);
      assert.equal(native.rows[0].result.openingPosition.opening_average_cost, null);
      assert.equal(Number(native.rows[0].result.openingPosition.execution_unit_price), 0.82);
      assert.equal(native.rows[0].result.openingPosition.price_currency, 'USDT');
      assert.equal(native.rows[0].result.holding.average_cost, null);

      const corrected = await db.query(`
        SELECT public.correct_opening_position(
          '${PROFILE_ID}'::uuid,
          '${native.rows[0].result.openingPosition.id}',
          1000, NULL, 0.8, 'USDT'
        ) AS result
      `);
      assert.equal(Number(corrected.rows[0].result.openingPosition.execution_unit_price), 0.8);
      assert.equal(corrected.rows[0].result.holding.average_cost, null);
      assert.equal(Number(corrected.rows[0].result.holding.quantity), 1000);

      const afterCash = await db.query(`SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}'`);
      assert.deepEqual(afterCash.rows, beforeCash.rows);
      const ledgers = await db.query(`SELECT COUNT(*)::int AS count FROM public.portfolio_transactions`);
      assert.equal(ledgers.rows[0].count, 0);

      await db.query(`
        SELECT public.create_opening_position(
          '${PROFILE_ID}'::uuid, '${FPT_ID}', 10, 35000
        )
      `);
      const fpt = await db.query(`SELECT average_cost FROM public.holdings WHERE asset_id = '${FPT_ID}'`);
      assert.equal(Number(fpt.rows[0].average_cost), 35000);

      const countsBefore = await db.query(`
        SELECT (SELECT COUNT(*)::int FROM public.holdings) AS holdings,
               (SELECT COUNT(*)::int FROM public.position_opening_baselines) AS baselines
      `);
      await assert.rejects(
        db.query(`SELECT public.create_opening_position('${PROFILE_ID}'::uuid, '${FX_ID}', 1, 25000)`),
        /asset is not portfolio eligible/i
      );
      const countsAfter = await db.query(`
        SELECT (SELECT COUNT(*)::int FROM public.holdings) AS holdings,
               (SELECT COUNT(*)::int FROM public.position_opening_baselines) AS baselines
      `);
      assert.deepEqual(countsAfter.rows, countsBefore.rows);
    } finally {
      await db.close();
    }
  });

  test('production route recreates exact ONDO native opening position after a cancelled baseline without financial ledger writes', async () => {
    const db = await createDatabase();
    try {
      await db.exec(await readFile(SCHEMA_PATH, 'utf8'));
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        INSERT INTO public.investor_profile (
          id, user_id, cash_available, risk_tolerance, investment_horizon
        ) VALUES (
          '${PROFILE_ID}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200000000, 'moderate', 'long'
        );
        INSERT INTO public.assets (
          id, symbol, name, asset_type, market_code, quote_currency,
          market_policy, market_timezone, quantity_unit, is_active, portfolio_eligibility
        ) VALUES (
          '${ONDO_ID}', 'ONDO', 'Ondo', 'crypto', 'CRYPTO', 'USD',
          'CONTINUOUS_24_7', 'UTC', 'coin', TRUE, 'PORTFOLIO_ELIGIBLE'
        );
        INSERT INTO public.asset_provider_mappings (
          asset_id, provider, provider_symbol, provider_market
        ) VALUES (
          '${ONDO_ID}', 'binance', 'ONDOUSDT', 'SPOT'
        );
      `);

      const initial = await db.query(`
        SELECT public.create_opening_position(
          '${PROFILE_ID}'::uuid, '${ONDO_ID}', 1, NULL, 0.5, 'USDT',
          NULL, NULL, NULL, 'cancelled-ondo-key'
        ) AS result
      `);
      await db.query(`
        SELECT public.cancel_opening_position(
          '${PROFILE_ID}'::uuid,
          '${initial.rows[0].result.openingPosition.id}'
        )
      `);

      const before = await db.query(`
        SELECT
          (SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}') AS cash_available,
          (SELECT COUNT(*)::int FROM public.cash_ledger_entries WHERE profile_id = '${PROFILE_ID}') AS cash_entries,
          (SELECT COUNT(*)::int FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}') AS transactions
      `);

      const app = createApp({
        getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
        getAssetByIdFn: async () => ({
          id: ONDO_ID,
          symbol: 'ONDO',
          asset_type: 'crypto',
          quote_currency: 'USD',
          portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
          is_active: true
        }),
        positionClient: createPglitePositionClient(db)
      });
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      try {
        const request = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'recreated-ondo-key'
          },
          body: JSON.stringify({
            assetId: ONDO_ID,
            quantity: 226,
            averageCost: null,
            executionUnitPrice: 0.36402,
            priceCurrency: 'USDT',
            idempotencyKey: 'recreated-ondo-key'
          })
        };
        const url = `http://127.0.0.1:${server.address().port}/api/positions/opening`;
        const response = await ownerFetch(url, request);
        const body = await response.json();

        assert.equal(response.status, 201);
        assert.equal(body.status, 'ok');
        assert.equal(body.data.openingPosition.openingQuantity, 226);
        assert.equal(body.data.openingPosition.openingAverageCost, null);
        assert.equal(body.data.openingPosition.nativeAverageCost, 0.36402);
        assert.equal(body.data.openingPosition.nativeCostCurrency, 'USDT');
        assert.equal(body.data.openingPosition.openingQuantity * body.data.openingPosition.nativeAverageCost, 82.26852);

        const replay = await ownerFetch(url, request);
        assert.equal(replay.status, 200);
        assert.equal(replay.headers.get('idempotent-replayed'), 'true');
        assert.equal((await replay.json()).data.replayed, true);

        const duplicateResponse = await ownerFetch(url, {
          ...request,
          headers: {
            ...request.headers,
            'Idempotency-Key': 'duplicate-active-ondo-key'
          },
          body: JSON.stringify({
            ...JSON.parse(request.body),
            idempotencyKey: 'duplicate-active-ondo-key'
          })
        });
        const duplicateBody = await duplicateResponse.json();
        assert.equal(duplicateResponse.status, 400);
        assert.equal(duplicateBody.code, 'OP003');

        const persisted = await db.query(`
          SELECT b.opening_quantity, b.opening_average_cost, b.execution_unit_price,
                 b.price_currency, h.quantity, h.average_cost,
                 h.native_average_cost, h.native_cost_currency
          FROM public.position_opening_baselines b
          JOIN public.holdings h ON h.opening_position_id = b.id
          WHERE b.profile_id = '${PROFILE_ID}'
            AND b.asset_id = '${ONDO_ID}'
            AND b.cancelled_at IS NULL
        `);
        assert.equal(persisted.rows.length, 1);
        assert.equal(Number(persisted.rows[0].opening_quantity), 226);
        assert.equal(persisted.rows[0].opening_average_cost, null);
        assert.equal(Number(persisted.rows[0].execution_unit_price), 0.36402);
        assert.equal(persisted.rows[0].price_currency, 'USDT');
        assert.equal(Number(persisted.rows[0].quantity), 226);
        assert.equal(persisted.rows[0].average_cost, null);
        assert.equal(Number(persisted.rows[0].native_average_cost), 0.36402);
        assert.equal(persisted.rows[0].native_cost_currency, 'USDT');

        const after = await db.query(`
          SELECT
            (SELECT cash_available FROM public.investor_profile WHERE id = '${PROFILE_ID}') AS cash_available,
            (SELECT COUNT(*)::int FROM public.cash_ledger_entries WHERE profile_id = '${PROFILE_ID}') AS cash_entries,
            (SELECT COUNT(*)::int FROM public.portfolio_transactions WHERE profile_id = '${PROFILE_ID}') AS transactions,
            (SELECT COUNT(*)::int FROM public.position_opening_baselines WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${ONDO_ID}') AS baselines,
            (SELECT COUNT(*)::int FROM public.position_opening_baselines WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${ONDO_ID}' AND cancelled_at IS NOT NULL) AS cancelled_baselines,
            (SELECT COUNT(*)::int FROM public.position_opening_baselines WHERE profile_id = '${PROFILE_ID}' AND asset_id = '${ONDO_ID}' AND cancelled_at IS NULL) AS active_baselines
        `);
        assert.equal(after.rows[0].cash_available, before.rows[0].cash_available);
        assert.equal(after.rows[0].cash_entries, before.rows[0].cash_entries);
        assert.equal(after.rows[0].transactions, before.rows[0].transactions);
        assert.equal(after.rows[0].baselines, 2);
        assert.equal(after.rows[0].cancelled_baselines, 1);
        assert.equal(after.rows[0].active_baselines, 1);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      await db.close();
    }
  });

  test('replacement migration preserves cancelled history and limits uniqueness to active baselines', async () => {
    const migration = await readFile(RECREATED_OPENING_MIGRATION_PATH, 'utf8');
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_position_opening_baseline_profile_asset_active/);
    assert.match(migration, /ON public\.position_opening_baselines \(profile_id, asset_id\)\s+WHERE cancelled_at IS NULL/);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS uq_position_opening_baseline_profile_asset/);
    assert.doesNotMatch(migration, /\bUPDATE\s+public\.position_opening_baselines\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+public\.position_opening_baselines\b/i);
  });

  test('forward migration is additive, nullable, capability-based, and never derives VND cost from FX', async () => {
    const migration = await readFile(MIGRATION_PATH, 'utf8');
    assert.match(migration, /ALTER COLUMN opening_average_cost DROP NOT NULL/);
    assert.match(migration, /ALTER COLUMN average_cost DROP NOT NULL/);
    assert.match(migration, /asset_provider_mappings/);
    assert.match(migration, /provider_symbol\) LIKE '%USDT'/);
    assert.doesNotMatch(migration, /p_execution_unit_price\s*\*\s*p_fx_rate_to_vnd/);
    assert.doesNotMatch(migration, /UPDATE\s+public\.(?:holdings|position_opening_baselines)[\s\S]*?SET\s+(?:average_cost|opening_average_cost)\s*=\s*[^;]*fx_rate/i);
    assert.match(migration, /FROM PUBLIC, anon, authenticated/);
    assert.match(migration, /TO service_role/);
  });

  test('forward migration preserves existing historical VND basis rows unchanged', async () => {
    const db = await createDatabase();
    try {
      const schema = await readFile(SCHEMA_PATH, 'utf8');
      const marker = '-- Migration: 20260909000000_portfolio_native_opening_cost.sql';
      const preMigrationSchema = schema.split(marker)[0];
      assert.ok(preMigrationSchema.length < schema.length);
      await db.exec(preMigrationSchema);
      await db.exec(`
        INSERT INTO auth.users (id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        INSERT INTO public.investor_profile (
          id, user_id, cash_available, risk_tolerance, investment_horizon
        ) VALUES (
          '${PROFILE_ID}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 200000000, 'moderate', 'long'
        );
        INSERT INTO public.assets (
          id, symbol, name, asset_type, market_code, quote_currency,
          market_policy, market_timezone, quantity_unit, is_active, portfolio_eligibility
        ) VALUES (
          '${BTC_ID}', 'BTC', 'Bitcoin', 'crypto', 'CRYPTO', 'USD',
          'CONTINUOUS_24_7', 'UTC', 'coin', TRUE, 'PORTFOLIO_ELIGIBLE'
        );
        INSERT INTO public.position_opening_baselines (
          id, profile_id, asset_id, opening_quantity, opening_average_cost,
          accounting_cutoff_at, provenance_type, execution_unit_price, price_currency
        ) VALUES (
          '55555555-5555-4555-8555-555555555555', '${PROFILE_ID}', '${BTC_ID}',
          2, 40000000, '2026-09-01T00:00:00Z', 'USER_RECORDED', 1600, 'USD'
        );
        INSERT INTO public.holdings (
          id, profile_id, asset_id, opening_position_id, quantity, average_cost
        ) VALUES (
          '66666666-6666-4666-8666-666666666666', '${PROFILE_ID}', '${BTC_ID}',
          '55555555-5555-4555-8555-555555555555', 2, 40000000
        );
      `);

      const before = await db.query(`
        SELECT b.opening_quantity, b.opening_average_cost, b.execution_unit_price,
               b.price_currency, h.quantity, h.average_cost
        FROM public.position_opening_baselines b
        JOIN public.holdings h ON h.opening_position_id = b.id
      `);
      await db.exec(await readFile(MIGRATION_PATH, 'utf8'));
      const after = await db.query(`
        SELECT b.opening_quantity, b.opening_average_cost, b.execution_unit_price,
               b.price_currency, h.quantity, h.average_cost
        FROM public.position_opening_baselines b
        JOIN public.holdings h ON h.opening_position_id = b.id
      `);
      assert.deepEqual(after.rows, before.rows);

      const nullability = await db.query(`
        SELECT table_name, column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('holdings', 'average_cost'),
            ('position_opening_baselines', 'opening_average_cost')
          )
        ORDER BY table_name
      `);
      assert.deepEqual(nullability.rows.map((row) => row.is_nullable), ['YES', 'YES']);
    } finally {
      await db.close();
    }
  });

  test('opening-position UI asks for native purchase price and never requires invented VND conversion', async () => {
    const [modal, app, holdingsView, displayModel] = await Promise.all([
      readFile(OPENING_MODAL_PATH, 'utf8'),
      readFile(APP_PATH, 'utf8'),
      readFile(PORTFOLIO_HOLDINGS_PATH, 'utf8'),
      readFile(PORTFOLIO_DISPLAY_PATH, 'utf8')
    ]);
    assert.match(modal, /Giá mua trung bình \*/);
    assert.match(modal, /Không cần tự quy đổi sang VND/);
    assert.doesNotMatch(modal, /Giá vốn trung bình quy đổi VND/);
    assert.doesNotMatch(modal, /USER_SUPPLIED_OPENING_VND_BASIS/);
    assert.match(app, /PortfolioSummaryHoldings/);
    assert.match(displayModel, /nativeAverageCost/);
    assert.match(displayModel, /nativeCurrentPrice/);
    assert.match(displayModel, /nativeUnrealizedPnL/);
    assert.match(displayModel, /nativeCostCurrency/);
    assert.match(modal, /json\.code/);
    assert.match(modal, /OPENING_POSITION_CREATE_FAILED|safeCode/);
    assert.match(holdingsView, /holding\.averageCost/);
    assert.match(holdingsView, /holding\.currentPrice/);
    assert.match(holdingsView, /holding\.unrealizedPnl/);
    assert.doesNotMatch(`${app}\n${holdingsView}\n${displayModel}`, /USER_SUPPLIED_OPENING_VND_BASIS/);
  });
});
