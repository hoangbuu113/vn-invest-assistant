import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApp } from '../index.js';
import {
  createPortfolioTransaction,
  getPortfolioTransactions,
  normalizeExplicitTimestamp,
  TRANSACTION_METHODOLOGY
} from '../src/transactions.js';

const SINGLETON_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN as OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';
const FOREIGN_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const FPT_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VCB_ASSET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BTC_ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USD_VND_ASSET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function cloneRows(rows) {
  return rows.map(row => ({ ...row }));
}

function createFakeTransactionDatabase({
  holdings = [],
  cashAvailable = 100000000,
  failAfterTransactionInsert = false
} = {}) {
  const assets = [
    { id: FPT_ASSET_ID, symbol: 'FPT', name: 'FPT Corporation', asset_type: 'stock', quote_currency: 'VND', is_active: true, portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: VCB_ASSET_ID, symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock', quote_currency: 'VND', is_active: true, portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: BTC_ASSET_ID, symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', asset_type: 'crypto', quote_currency: 'USD', is_active: true, portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: USD_VND_ASSET_ID, symbol: 'USD/VND', name: 'US Dollar / Vietnamese Dong', asset_type: 'fx', quote_currency: 'VND', is_active: true, portfolio_eligibility: 'REFERENCE_ONLY' }
  ];

  const state = {
    holdings: cloneRows(holdings),
    transactions: [],
    cashLedger: [],
    cashAvailable,
    rpcCalls: []
  };

  let sequence = 0;

  function rpcError(code, message) {
    return { data: null, error: { code, message } };
  }

  async function rpc(name, args) {
    state.rpcCalls.push({ name, args: { ...args } });

    if (name === 'list_portfolio_transactions') {
      const symbol = args.p_symbol ? args.p_symbol.toUpperCase() : null;
      const data = state.transactions
        .filter(row => row.profile_id === SINGLETON_PROFILE_ID)
        .filter(row => !symbol || assets.find(asset => asset.id === row.asset_id)?.symbol === symbol)
        .map(row => {
          const asset = assets.find(candidate => candidate.id === row.asset_id);
          return {
            ...row,
            symbol: asset.symbol,
            asset_name: asset.name,
            asset_type: asset.asset_type
          };
        })
        .sort((left, right) => {
          const executedOrder = right.executed_at.localeCompare(left.executed_at);
          if (executedOrder !== 0) return executedOrder;
          const createdOrder = right.created_at.localeCompare(left.created_at);
          if (createdOrder !== 0) return createdOrder;
          return right.id.localeCompare(left.id);
        });
      return { data, error: null };
    }

    if (name !== 'create_portfolio_transaction') {
      return rpcError('42883', `Unknown RPC ${name}`);
    }

    const {
      p_symbol: symbol,
      p_asset_id: assetId,
      p_transaction_type: transactionType,
      p_quantity: quantity,
      p_price: price,
      p_executed_at: executedAt
    } = args;

    if (!['BUY', 'SELL'].includes(transactionType)) {
      return rpcError('PT004', 'transactionType must be BUY or SELL');
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      return rpcError('PT004', 'quantity must be a finite number greater than 0');
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return rpcError('PT004', 'price must be a finite number greater than 0');
    }

    const asset = assetId
      ? assets.find(candidate => candidate.id === assetId)
      : assets.find(candidate => candidate.symbol === symbol);
    if (!asset) return rpcError('PT001', 'asset not found');
    if (asset.quote_currency !== 'VND') {
      return rpcError('PT005', 'non-VND asset transactions are unsupported until FX accounting exists');
    }

    const stagedHoldings = cloneRows(state.holdings);
    const stagedTransactions = cloneRows(state.transactions);
    const stagedCashLedger = cloneRows(state.cashLedger);
    const existingIndex = stagedHoldings.findIndex(row => (
      row.profile_id === SINGLETON_PROFILE_ID && row.asset_id === asset.id
    ));
    const existing = existingIndex >= 0 ? stagedHoldings[existingIndex] : null;

    let newQuantity;
    let newAverageCost;
    let realizedPnL = null;
    let holdingRemoved = false;

    if (transactionType === 'BUY') {
      if (quantity * price > state.cashAvailable) {
        return rpcError('CL001', 'insufficient current cash for BUY transaction');
      }
      if (existing) {
        newQuantity = existing.quantity + quantity;
        newAverageCost = (
          (existing.quantity * existing.average_cost) + (quantity * price)
        ) / newQuantity;
      } else {
        newQuantity = quantity;
        newAverageCost = price;
      }
    } else {
      if (!existing) return rpcError('PT002', 'cannot SELL an asset without an existing holding');
      if (quantity > existing.quantity) {
        return rpcError('PT003', 'sell quantity exceeds current holding quantity');
      }
      newQuantity = existing.quantity - quantity;
      newAverageCost = existing.average_cost;
      realizedPnL = (price - existing.average_cost) * quantity;
      holdingRemoved = newQuantity === 0;
    }

    sequence += 1;
    const createdAt = `2026-08-28T10:00:${String(sequence).padStart(2, '0')}.000Z`;
    const transaction = {
      id: `transaction-${String(sequence).padStart(4, '0')}`,
      profile_id: SINGLETON_PROFILE_ID,
      asset_id: asset.id,
      transaction_type: transactionType,
      quantity,
      price,
      realized_pnl: realizedPnL,
      executed_at: executedAt || createdAt,
      created_at: createdAt,
      asset
    };
    stagedTransactions.push(transaction);

    if (failAfterTransactionInsert) {
      return rpcError('XX000', 'simulated holdings mutation failure');
    }

    let resultHolding = null;
    if (transactionType === 'BUY' && existing) {
      resultHolding = {
        ...existing,
        quantity: newQuantity,
        average_cost: newAverageCost,
        updated_at: createdAt
      };
      stagedHoldings[existingIndex] = resultHolding;
    } else if (transactionType === 'BUY') {
      resultHolding = {
        id: `holding-${asset.symbol.toLowerCase()}`,
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: asset.id,
        quantity: newQuantity,
        average_cost: newAverageCost,
        created_at: createdAt,
        updated_at: createdAt
      };
      stagedHoldings.push(resultHolding);
    } else if (holdingRemoved) {
      stagedHoldings.splice(existingIndex, 1);
    } else {
      resultHolding = {
        ...existing,
        quantity: newQuantity,
        average_cost: newAverageCost,
        updated_at: createdAt
      };
      stagedHoldings[existingIndex] = resultHolding;
    }

    const cashAmount = quantity * price;
    const cashEntry = {
      id: `cash-entry-${String(sequence).padStart(4, '0')}`,
      profile_id: SINGLETON_PROFILE_ID,
      entry_type: transactionType,
      amount: cashAmount,
      portfolio_transaction_id: transaction.id,
      effective_at: transaction.executed_at,
      created_at: createdAt,
      metadata: {},
      symbol: asset.symbol
    };
    stagedCashLedger.push(cashEntry);
    const newCash = transactionType === 'BUY'
      ? state.cashAvailable - cashAmount
      : state.cashAvailable + cashAmount;

    state.transactions.splice(0, state.transactions.length, ...stagedTransactions);
    state.holdings.splice(0, state.holdings.length, ...stagedHoldings);
    state.cashLedger.splice(0, state.cashLedger.length, ...stagedCashLedger);
    state.cashAvailable = newCash;

    return {
      data: {
        transaction,
        holding: resultHolding,
        holdingRemoved,
        cashEntry,
        currentCash: newCash
      },
      error: null
    };
  }

  return {
    client: { rpc },
    state,
    assets
  };
}

function startingHolding({
  assetId = FPT_ASSET_ID,
  quantity = 100,
  averageCost = 10,
  profileId = SINGLETON_PROFILE_ID
} = {}) {
  return {
    id: `holding-${assetId}`,
    profile_id: profileId,
    asset_id: assetId,
    quantity,
    average_cost: averageCost,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z'
  };
}

describe('Feature 14 — Transaction Ledger Core + Atomic Production Path', () => {
  test('A. BUY first position creates one holding and one immutable ledger row', async () => {
    const { client, state } = createFakeTransactionDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'fpt',
      transactionType: 'BUY',
      quantity: 100,
      price: 10,
      executedAt: '2026-08-20T03:00:00.000Z'
    }, client);

    assert.equal(state.holdings.length, 1);
    assert.equal(state.transactions.length, 1);
    assert.equal(result.holding.quantity, 100);
    assert.equal(result.holding.averageCost, 10);
    assert.equal(result.transaction.realizedPnL, null);
  });

  test('B. BUY adds to an existing position using exact weighted-average cost', async () => {
    const { client } = createFakeTransactionDatabase({ holdings: [startingHolding()] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 50, price: 16
    }, client);

    assert.equal(result.holding.quantity, 150);
    assert.equal(result.holding.averageCost, 12);
  });

  test('C. fractional BUY retains full precision without two-decimal intermediate rounding', async () => {
    const initial = startingHolding({ quantity: 1.25, averageCost: 10.12345 });
    const { client } = createFakeTransactionDatabase({ holdings: [initial] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 0.75, price: 16.98765
    }, client);

    const expected = ((1.25 * 10.12345) + (0.75 * 16.98765)) / 2;
    assert.equal(result.holding.quantity, 2);
    assert.equal(result.holding.averageCost, expected);
    assert.notEqual(result.holding.averageCost, Math.round(expected * 100) / 100);
  });

  test('C2. fractional quantity 0.001 remains valid on the generic VND transaction path', async () => {
    const { client } = createFakeTransactionDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 0.001, price: 1000
    }, client);

    assert.equal(result.transaction.quantity, 0.001);
    assert.equal(result.holding.quantity, 0.001);
  });

  test('C3. non-VND asset is rejected before transaction, holding, or VND cash mutation', async () => {
    const { client, state } = createFakeTransactionDatabase();
    const startingCash = state.cashAvailable;

    await assert.rejects(
      createPortfolioTransaction({
        symbol: 'BTC/USD', transactionType: 'BUY', quantity: 0.001, price: 60000
      }, client),
      error => error.statusCode === 400 && error.code === 'PT005'
    );

    assert.equal(state.transactions.length, 0);
    assert.equal(state.holdings.length, 0);
    assert.equal(state.cashLedger.length, 0);
    assert.equal(state.cashAvailable, startingCash);
  });

  test('D/E. partial SELL preserves average cost and persists realized gain', async () => {
    const { client, state } = createFakeTransactionDatabase({ holdings: [startingHolding()] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 40, price: 13
    }, client);

    assert.equal(result.holding.quantity, 60);
    assert.equal(result.holding.averageCost, 10);
    assert.equal(result.transaction.realizedPnL, 120);
    assert.equal(state.transactions[0].realized_pnl, 120);
  });

  test('F. SELL at a loss persists a negative realized P/L', async () => {
    const { client } = createFakeTransactionDatabase({ holdings: [startingHolding()] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 25, price: 8
    }, client);
    assert.equal(result.transaction.realizedPnL, -50);
    assert.equal(result.holding.averageCost, 10);
  });

  test('G. full SELL removes the holding but retains the realized-loss transaction', async () => {
    const { client, state } = createFakeTransactionDatabase({ holdings: [startingHolding()] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 100, price: 9
    }, client);

    assert.equal(result.holding, null);
    assert.equal(result.holdingRemoved, true);
    assert.equal(result.transaction.realizedPnL, -100);
    assert.equal(state.holdings.length, 0);
    assert.equal(state.transactions.length, 1);
  });

  test('H. oversell is rejected with no ledger or holding mutation', async () => {
    const original = startingHolding();
    const { client, state } = createFakeTransactionDatabase({ holdings: [original] });

    await assert.rejects(
      createPortfolioTransaction({
        symbol: 'FPT', transactionType: 'SELL', quantity: 101, price: 12
      }, client),
      error => error.statusCode === 400 && error.code === 'PT003'
    );
    assert.deepEqual(state.holdings, [original]);
    assert.equal(state.transactions.length, 0);
  });

  test('I. SELL without an existing holding is rejected without a transaction', async () => {
    const { client, state } = createFakeTransactionDatabase();
    await assert.rejects(
      createPortfolioTransaction({
        symbol: 'FPT', transactionType: 'SELL', quantity: 1, price: 12
      }, client),
      error => error.statusCode === 400 && error.code === 'PT002'
    );
    assert.equal(state.holdings.length, 0);
    assert.equal(state.transactions.length, 0);
  });

  test('L. without an idempotency key, exact duplicate requests are separate intentional transactions', async () => {
    const { client, state } = createFakeTransactionDatabase();
    const input = { symbol: 'FPT', transactionType: 'BUY', quantity: 5, price: 10 };
    await createPortfolioTransaction(input, client);
    await createPortfolioTransaction(input, client);

    assert.equal(state.transactions.length, 2);
    assert.notEqual(state.transactions[0].id, state.transactions[1].id);
    assert.equal(state.holdings[0].quantity, 10);
    assert.equal(TRANSACTION_METHODOLOGY.duplicateRequestSemantics, 'separate_transactions');
  });

  test('M. production RPC payload never accepts or sends a client profile ID', async () => {
    const { client, state } = createFakeTransactionDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT',
      transactionType: 'BUY',
      quantity: 1,
      price: 10,
      profile_id: FOREIGN_PROFILE_ID,
      profileId: FOREIGN_PROFILE_ID
    }, client);

    const createCall = state.rpcCalls.find(call => call.name === 'create_portfolio_transaction');
    assert.ok(createCall);
    assert.equal(Object.hasOwn(createCall.args, 'p_profile_id'), false);
    assert.equal(result.transaction.profileId, SINGLETON_PROFILE_ID);
  });

  test('P0.1 future write contract aligns linked cash economic time without backdating audit time', async () => {
    const { client } = createFakeTransactionDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT',
      transactionType: 'BUY',
      quantity: 1,
      price: 10,
      executedAt: '2026-08-20T00:00:00.000Z'
    }, client);

    assert.equal(result.transaction.executedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(result.cashEntry.effectiveAt, result.transaction.executedAt);
    assert.notEqual(result.cashEntry.createdAt, result.cashEntry.effectiveAt);
  });

  test('N. listing is deterministic newest-first and supports normalized symbol filtering', async () => {
    const { client } = createFakeTransactionDatabase();
    await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: 10,
      executedAt: '2026-08-20T00:00:00.000Z'
    }, client);
    await createPortfolioTransaction({
      symbol: 'VCB', transactionType: 'BUY', quantity: 1, price: 20,
      executedAt: '2026-08-22T00:00:00.000Z'
    }, client);
    await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 1, price: 11,
      executedAt: '2026-08-21T00:00:00.000Z'
    }, client);

    const all = await getPortfolioTransactions({}, client);
    assert.deepEqual(all.map(row => row.executedAt), [
      '2026-08-22T00:00:00.000Z',
      '2026-08-21T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z'
    ]);
    const fpt = await getPortfolioTransactions({ symbol: 'fpt' }, client);
    assert.deepEqual(fpt.map(row => row.symbol), ['FPT', 'FPT']);
  });

  test('O. simulated failure after ledger insert rolls back both staged changes', async () => {
    const original = startingHolding();
    const { client, state } = createFakeTransactionDatabase({
      holdings: [original],
      failAfterTransactionInsert: true
    });

    await assert.rejects(createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 5, price: 12
    }, client));
    assert.deepEqual(state.holdings, [original]);
    assert.equal(state.transactions.length, 0);
  });

  test('atomicity is implemented in one production RPC and one PostgreSQL function', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260828150000_create_portfolio_transactions.sql',
      import.meta.url
    ));
    const modulePath = fileURLToPath(new URL('../src/transactions.js', import.meta.url));
    const migration = readFileSync(migrationPath, 'utf8');
    const productionModule = readFileSync(modulePath, 'utf8');

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_portfolio_transaction/);
    assert.match(migration, /SECURITY DEFINER/);
    assert.match(migration, /SET search_path = ''/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /INSERT INTO public\.portfolio_transactions/);
    assert.match(migration, /UPDATE public\.holdings/);
    assert.match(migration, /DELETE FROM public\.holdings/);
    assert.match(migration, /v_existing_holding\.quantity \* v_existing_holding\.average_cost/);
    assert.match(migration, /v_realized_pnl := \(p_price - v_existing_holding\.average_cost\) \* p_quantity/);
    assert.match(migration, /ALTER COLUMN quantity TYPE NUMERIC/);
    assert.match(migration, /ALTER COLUMN average_cost TYPE NUMERIC/);
    assert.doesNotMatch(migration, /INSERT INTO public\.portfolio_transactions[\s\S]*INSERT INTO public\.portfolio_transactions/);
    assert.doesNotMatch(productionModule, /\.from\(['"](?:holdings|portfolio_transactions)['"]\)/);
  });

  test('Feature 16 migration enforces the VND-only transaction guard before ledger insertion', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260828210000_canonical_multi_asset_foundation.sql',
      import.meta.url
    ));
    const migration = readFileSync(migrationPath, 'utf8');

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enforce_vnd_portfolio_transaction_asset/);
    assert.match(migration, /v_quote_currency IS DISTINCT FROM 'VND'/);
    assert.match(migration, /ERRCODE = 'PT005'/);
    assert.match(migration, /BEFORE INSERT ON public\.portfolio_transactions/);
    assert.doesNotMatch(migration, /INSERT INTO public\.(?:cash_ledger_entries|portfolio_transactions|holdings)/);
  });
});

describe('Feature 14 — Strict Timestamp Contract', () => {
  test('accepts explicit UTC and offset timestamps and canonicalizes them', () => {
    assert.equal(
      normalizeExplicitTimestamp('2026-08-28T10:15:30Z'),
      '2026-08-28T10:15:30.000Z'
    );
    assert.equal(
      normalizeExplicitTimestamp('2026-08-28T17:15:30+07:00'),
      '2026-08-28T10:15:30.000Z'
    );
  });

  test('rejects ambiguous, missing, and invalid timestamps', () => {
    const invalid = [
      undefined,
      null,
      '2026-08-28',
      '2026-08-28T10:15:30',
      '2026-02-30T10:15:30Z',
      '2026-08-28T25:00:00Z',
      1787900000000
    ];
    for (const value of invalid) assert.equal(normalizeExplicitTimestamp(value), null);
  });
});

describe('Feature 14 — Actual Express Routes + Actual Production Data Access', () => {
  let fake;
  let server;
  let baseUrl;

  before(async () => {
    fake = createFakeTransactionDatabase();
    const app = createApp({
      transactionClient: fake.client,
      ownerAccessToken: OWNER_ACCESS_TOKEN,
      getAssetByIdFn: async (id) => fake.assets.find((asset) => asset.id === id) || null,
      getAssetBySymbolFn: async (symbol) => fake.assets.find((asset) => asset.symbol === symbol) || null
    });
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('P. POST and GET use production routes and production RPC data-access functions', async () => {
    const createResponse = await ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'FPT',
        transactionType: 'BUY',
        quantity: 100,
        price: 10,
        executedAt: '2026-08-28T17:00:00+07:00',
        profileId: FOREIGN_PROFILE_ID,
        profile_id: FOREIGN_PROFILE_ID
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(created.data.transaction.profileId, SINGLETON_PROFILE_ID);
    assert.equal(created.data.transaction.executedAt, '2026-08-28T10:00:00.000Z');
    assert.equal(created.methodology.costBasisMethod, 'weighted_average');

    const listResponse = await ownerFetch(`${baseUrl}/api/transactions?symbol=fpt`);
    const listed = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listed.count, 1);
    assert.equal(listed.data[0].symbol, 'FPT');
    assert.deepEqual(
      fake.state.rpcCalls.map(call => call.name),
      ['create_portfolio_transaction', 'list_portfolio_transactions']
    );
  });

  test('J/K. route rejects numeric strings, invalid/missing numbers, and invalid types before RPC', async () => {
    const invalidBodies = [
      { symbol: 'FPT', transactionType: 'BUY', quantity: '100', price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: 100, price: '10' },
      { symbol: 'FPT', transactionType: 'BUY', quantity: null, price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: 0, price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: -1, price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: true, price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: [1], price: 10 },
      { symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: {} },
      { symbol: 'FPT', transactionType: 'HOLD', quantity: 1, price: 10 },
      { symbol: 'FPT', quantity: 1, price: 10 },
      { symbol: 'FPT', transactionType: 'SELL', price: 10 },
      { symbol: 'FPT', transactionType: 'SELL', quantity: 1 }
    ];

    for (const body of invalidBodies) {
      const callCount = fake.state.rpcCalls.length;
      const response = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(fake.state.rpcCalls.length, callCount, 'invalid request must not reach database RPC');
    }
  });

  test('ambiguous timezone-less timestamps and conflicting asset selectors are rejected', async () => {
    const invalidBodies = [
      {
        symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: 10,
        executedAt: '2026-08-28T10:00:00'
      },
      {
        symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: 10,
        executedAt: '2026-08-28'
      },
      {
        symbol: 'FPT', assetId: FPT_ASSET_ID,
        transactionType: 'BUY', quantity: 1, price: 10
      }
    ];
    for (const body of invalidBodies) {
      const response = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
    }
  });

  test('asset absence and invalid SELL conditions keep deterministic client errors', async () => {
    const absentAsset = await ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'NOPE', transactionType: 'BUY', quantity: 1, price: 10
      })
    });
    assert.equal(absentAsset.status, 400);

    const nonexistentHolding = await ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'VCB', transactionType: 'SELL', quantity: 1, price: 10
      })
    });
    assert.equal(nonexistentHolding.status, 400);
  });

  test('reference-only FX is rejected at the authenticated API boundary before any RPC mutation', async () => {
    const before = JSON.stringify(fake.state);
    const response = await ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetId: USD_VND_ASSET_ID,
        transactionType: 'BUY',
        quantity: 1,
        price: 25000
      })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.message, /reference-only/i);
    assert.equal(JSON.stringify(fake.state), before);
  });
});
