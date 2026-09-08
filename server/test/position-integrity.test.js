import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createApp } from '../index.js';
import { createOpeningPosition } from '../src/positions.js';
import { createPortfolioTransaction } from '../src/transactions.js';
import { calculatePortfolioValuation } from '../src/portfolio.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const FPT_ID = '22222222-2222-4222-8222-222222222222';
const VCB_ID = '33333333-3333-4333-8333-333333333333';
const BTC_ID = '44444444-4444-4444-8444-444444444444';
const INACTIVE_ID = '55555555-5555-4555-8555-555555555555';
const USD_VND_ID = '66666666-6666-4666-8666-666666666666';
import { ownerFetch, TEST_OWNER_ACCESS_TOKEN as OWNER_ACCESS_TOKEN } from './helpers/owner-auth.js';

function cloneRows(rows) {
  return rows.map(row => ({ ...row }));
}

function rpcError(code, message) {
  return { data: null, error: { code, message } };
}

function createFakePositionDatabase({
  cashAvailable = 100000000,
  holdings = [],
  baselines = [],
  transactions = [],
  cashLedger = [],
  failOpeningAfterBaseline = false,
  failTransactionAfterLedger = false
} = {}) {
  const assets = [
    { id: FPT_ID, symbol: 'FPT', name: 'FPT Corporation', asset_type: 'stock', is_active: true, quote_currency: 'VND', portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: VCB_ID, symbol: 'VCB', name: 'Vietcombank', asset_type: 'stock', is_active: true, quote_currency: 'VND', portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: BTC_ID, symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', asset_type: 'crypto', is_active: true, quote_currency: 'USD', portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: INACTIVE_ID, symbol: 'OLD', name: 'Inactive Asset', asset_type: 'fund', is_active: false, quote_currency: 'VND', portfolio_eligibility: 'PORTFOLIO_ELIGIBLE' },
    { id: USD_VND_ID, symbol: 'USD/VND', name: 'US Dollar / Vietnamese Dong', asset_type: 'fx', is_active: true, quote_currency: 'VND', portfolio_eligibility: 'REFERENCE_ONLY' }
  ];
  let sequence = 0;
  const state = {
    profileId: PROFILE_ID,
    cashAvailable,
    holdings: cloneRows(holdings),
    baselines: cloneRows(baselines),
    transactions: cloneRows(transactions),
    cashLedger: cloneRows(cashLedger),
    rpcCalls: []
  };

  function nextTimestamp() {
    sequence += 1;
    return `2026-08-28T12:00:${String(sequence).padStart(2, '0')}.000Z`;
  }

  async function rpc(name, args) {
    state.rpcCalls.push({ name, args: { ...args } });

    if (name === 'create_opening_position') {
      const asset = assets.find(row => row.id === args.p_asset_id);
      if (!asset) return rpcError('OP001', 'asset not found');
      if (!asset.is_active) return rpcError('OP002', 'asset is inactive');
      if (asset.quote_currency !== 'VND') {
        return rpcError('OP003', 'non-VND opening positions are unsupported until FX accounting exists');
      }
      if (
        state.baselines.some(row => row.profile_id === PROFILE_ID && row.asset_id === asset.id)
        || state.holdings.some(row => row.profile_id === PROFILE_ID && row.asset_id === asset.id)
      ) {
        return rpcError('OP005', 'asset already has a holding or opening baseline');
      }

      const stagedBaselines = cloneRows(state.baselines);
      const stagedHoldings = cloneRows(state.holdings);
      const accountedAt = nextTimestamp();
      const baseline = {
        id: `opening-${sequence}`,
        profile_id: PROFILE_ID,
        asset_id: asset.id,
        opening_quantity: args.p_quantity,
        opening_average_cost: args.p_average_cost,
        accounting_cutoff_at: accountedAt,
        provenance_type: 'USER_RECORDED',
        locked_at: null,
        cancelled_at: null,
        created_at: accountedAt,
        updated_at: accountedAt
      };
      stagedBaselines.push(baseline);

      if (failOpeningAfterBaseline) {
        return rpcError('XX000', 'simulated holding insert failure');
      }

      const holding = {
        id: `holding-${sequence}`,
        profile_id: PROFILE_ID,
        asset_id: asset.id,
        opening_position_id: baseline.id,
        quantity: args.p_quantity,
        average_cost: args.p_average_cost,
        created_at: accountedAt,
        updated_at: accountedAt
      };
      stagedHoldings.push(holding);
      state.baselines.splice(0, state.baselines.length, ...stagedBaselines);
      state.holdings.splice(0, state.holdings.length, ...stagedHoldings);
      return { data: { openingPosition: baseline, holding }, error: null };
    }

    if (name === 'correct_opening_position') {
      const baselineIndex = state.baselines.findIndex(
        row => row.id === args.p_opening_position_id && row.profile_id === PROFILE_ID
      );
      if (baselineIndex < 0) return rpcError('OP006', 'opening position not found');
      const existingBaseline = state.baselines[baselineIndex];
      if (existingBaseline.locked_at || existingBaseline.cancelled_at) {
        return rpcError('OP007', 'opening position is locked and cannot be corrected');
      }
      const holdingIndex = state.holdings.findIndex(
        row => row.opening_position_id === existingBaseline.id && row.profile_id === PROFILE_ID
      );
      if (holdingIndex < 0) return rpcError('OP500', 'opening position holding projection is unavailable');

      const accountedAt = nextTimestamp();
      const baseline = {
        ...existingBaseline,
        opening_quantity: args.p_quantity,
        opening_average_cost: args.p_average_cost,
        updated_at: accountedAt
      };
      const holding = {
        ...state.holdings[holdingIndex],
        quantity: args.p_quantity,
        average_cost: args.p_average_cost,
        updated_at: accountedAt
      };
      state.baselines[baselineIndex] = baseline;
      state.holdings[holdingIndex] = holding;
      return { data: { openingPosition: baseline, holding }, error: null };
    }

    if (name === 'cancel_opening_position') {
      const baselineIndex = state.baselines.findIndex(
        row => row.id === args.p_opening_position_id && row.profile_id === PROFILE_ID
      );
      if (baselineIndex < 0) return rpcError('OP006', 'opening position not found');
      const existingBaseline = state.baselines[baselineIndex];
      if (existingBaseline.locked_at || existingBaseline.cancelled_at) {
        return rpcError('OP007', 'opening position is locked and cannot be cancelled');
      }
      const holdingIndex = state.holdings.findIndex(
        row => row.opening_position_id === existingBaseline.id && row.profile_id === PROFILE_ID
      );
      if (holdingIndex < 0) return rpcError('OP500', 'opening position holding projection is unavailable');

      const accountedAt = nextTimestamp();
      const baseline = {
        ...existingBaseline,
        cancelled_at: accountedAt,
        updated_at: accountedAt
      };
      state.baselines[baselineIndex] = baseline;
      state.holdings.splice(holdingIndex, 1);
      return { data: { openingPosition: baseline, holding: null }, error: null };
    }

    if (name === 'create_portfolio_transaction') {
      const asset = args.p_asset_id
        ? assets.find(row => row.id === args.p_asset_id)
        : assets.find(row => row.symbol === args.p_symbol);
      if (!asset) return rpcError('PT001', 'asset not found');
      if (asset.quote_currency !== 'VND') {
        return rpcError('PT005', 'non-VND asset transactions are unsupported until FX accounting exists');
      }

      const stagedBaselines = cloneRows(state.baselines);
      const stagedHoldings = cloneRows(state.holdings);
      const stagedTransactions = cloneRows(state.transactions);
      const stagedCashLedger = cloneRows(state.cashLedger);
      const accountedAt = nextTimestamp();
      const baselineIndex = stagedBaselines.findIndex(
        row => row.profile_id === PROFILE_ID && row.asset_id === asset.id
          && !row.locked_at && !row.cancelled_at
      );
      if (baselineIndex >= 0) {
        stagedBaselines[baselineIndex] = {
          ...stagedBaselines[baselineIndex],
          locked_at: accountedAt,
          updated_at: accountedAt
        };
      }

      const holdingIndex = stagedHoldings.findIndex(
        row => row.profile_id === PROFILE_ID && row.asset_id === asset.id
      );
      const existing = holdingIndex >= 0 ? stagedHoldings[holdingIndex] : null;
      const quantity = args.p_quantity;
      const price = args.p_price;
      const cashAmount = quantity * price;
      let newQuantity;
      let newAverageCost;
      let realizedPnL = null;
      let holdingRemoved = false;

      if (args.p_transaction_type === 'BUY') {
        if (cashAmount > state.cashAvailable) {
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

      const transaction = {
        id: `transaction-${sequence}`,
        profile_id: PROFILE_ID,
        asset_id: asset.id,
        transaction_type: args.p_transaction_type,
        quantity,
        price,
        realized_pnl: realizedPnL,
        executed_at: args.p_executed_at || accountedAt,
        created_at: accountedAt,
        asset
      };
      stagedTransactions.push(transaction);

      if (failTransactionAfterLedger) {
        return rpcError('XX000', 'simulated post-transaction failure');
      }

      let resultHolding = null;
      if (args.p_transaction_type === 'BUY' && existing) {
        resultHolding = {
          ...existing,
          quantity: newQuantity,
          average_cost: newAverageCost,
          updated_at: accountedAt
        };
        stagedHoldings[holdingIndex] = resultHolding;
      } else if (args.p_transaction_type === 'BUY') {
        resultHolding = {
          id: `holding-${sequence}`,
          profile_id: PROFILE_ID,
          asset_id: asset.id,
          opening_position_id: null,
          quantity: newQuantity,
          average_cost: newAverageCost,
          created_at: accountedAt,
          updated_at: accountedAt
        };
        stagedHoldings.push(resultHolding);
      } else if (holdingRemoved) {
        stagedHoldings.splice(holdingIndex, 1);
      } else {
        resultHolding = {
          ...existing,
          quantity: newQuantity,
          average_cost: newAverageCost,
          updated_at: accountedAt
        };
        stagedHoldings[holdingIndex] = resultHolding;
      }

      const cashEntry = {
        id: `cash-${sequence}`,
        profile_id: PROFILE_ID,
        entry_type: args.p_transaction_type,
        amount: cashAmount,
        portfolio_transaction_id: transaction.id,
        effective_at: transaction.executed_at,
        created_at: accountedAt,
        metadata: {},
        symbol: asset.symbol
      };
      stagedCashLedger.push(cashEntry);
      const newCash = args.p_transaction_type === 'BUY'
        ? state.cashAvailable - cashAmount
        : state.cashAvailable + cashAmount;

      state.baselines.splice(0, state.baselines.length, ...stagedBaselines);
      state.holdings.splice(0, state.holdings.length, ...stagedHoldings);
      state.transactions.splice(0, state.transactions.length, ...stagedTransactions);
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

    return rpcError('42883', `unsupported RPC ${name}`);
  }

  return { client: { rpc }, state, assets };
}

async function withServer(fake, callback) {
  const app = createApp({
    positionClient: fake.client,
    transactionClient: fake.client,
    ownerAccessToken: OWNER_ACCESS_TOKEN,
    getHoldingsFn: async () => fake.state.holdings,
    getAssetByIdFn: async (id) => fake.assets.find((asset) => asset.id === id) || null,
    getAssetBySymbolFn: async (symbol) => fake.assets.find((asset) => asset.symbol === symbol) || null
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function establishOpening(fake, { assetId = FPT_ID, quantity = 100, averageCost = 35000 } = {}) {
  return createOpeningPosition({ assetId, quantity, averageCost }, fake.client);
}

describe('Feature 17A — opening position and ledger authority', () => {
  test('A. production route creates baseline plus holding without transaction or cash mutation', async () => {
    const fake = createFakePositionDatabase();
    const startingCash = fake.state.cashAvailable;
    await withServer(fake, async baseUrl => {
      const response = await ownerFetch(`${baseUrl}/api/positions/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: FPT_ID,
          quantity: 100,
          averageCost: 35000,
          profileId: 'foreign-profile'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      assert.equal(body.data.openingPosition.profileId, PROFILE_ID);
      assert.equal(body.data.holding.quantity, 100);
    });
    assert.equal(fake.state.baselines.length, 1);
    assert.equal(fake.state.holdings.length, 1);
    assert.equal(fake.state.transactions.length, 0);
    assert.equal(fake.state.cashLedger.length, 0);
    assert.equal(fake.state.cashAvailable, startingCash);
    assert.deepEqual(Object.keys(fake.state.rpcCalls[0].args).sort(), [
      'p_asset_id', 'p_average_cost', 'p_profile_id', 'p_quantity'
    ]);
  });

  test('B. duplicate opening is rejected without partial mutation', async () => {
    const fake = createFakePositionDatabase();
    await establishOpening(fake);
    await assert.rejects(establishOpening(fake), error => error.statusCode === 409 && error.code === 'OP005');
    assert.equal(fake.state.baselines.length, 1);
    assert.equal(fake.state.holdings.length, 1);
  });

  test('C. fractional opening quantity is preserved exactly', async () => {
    const fake = createFakePositionDatabase();
    const result = await establishOpening(fake, { quantity: 0.001, averageCost: 12345.6789 });
    assert.equal(result.openingPosition.openingQuantity, 0.001);
    assert.equal(result.holding.quantity, 0.001);
    assert.equal(result.holding.averageCost, 12345.6789);
  });

  test('D. route rejects invalid JSON number types before the production RPC', async () => {
    const fake = createFakePositionDatabase();
    const invalid = [
      { assetId: FPT_ID, quantity: '1', averageCost: 10 },
      { assetId: FPT_ID, quantity: true, averageCost: 10 },
      { assetId: FPT_ID, quantity: null, averageCost: 10 },
      { assetId: FPT_ID, quantity: 0, averageCost: 10 },
      { assetId: FPT_ID, quantity: 1, averageCost: '10' },
      { assetId: FPT_ID, quantity: 1, averageCost: -1 },
      { quantity: 1, averageCost: 10 }
    ];
    await withServer(fake, async baseUrl => {
      for (const body of invalid) {
        const before = fake.state.rpcCalls.length;
        const response = await ownerFetch(`${baseUrl}/api/positions/opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(fake.state.rpcCalls.length, before);
      }

      const opening = await establishOpening(fake);
      const before = fake.state.rpcCalls.length;
      const correction = await ownerFetch(`${baseUrl}/api/positions/opening/${opening.openingPosition.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: '2', averageCost: 10 })
      });
      assert.equal(correction.status, 400);
      assert.equal(fake.state.rpcCalls.length, before);
    });
  });

  test('E/F. absent, inactive, and non-VND assets fail before mutation', async () => {
    for (const [assetId, code] of [
      ['99999999-9999-4999-8999-999999999999', 'OP001'],
      [INACTIVE_ID, 'OP002'],
      [BTC_ID, 'OP003']
    ]) {
      const fake = createFakePositionDatabase();
      await assert.rejects(
        establishOpening(fake, { assetId }),
        error => error.statusCode === 400 && error.code === code
      );
      assert.equal(fake.state.baselines.length, 0);
      assert.equal(fake.state.holdings.length, 0);
      assert.equal(fake.state.transactions.length, 0);
      assert.equal(fake.state.cashLedger.length, 0);
      assert.equal(fake.state.cashAvailable, 100000000);
    }
  });

  test('reference-only FX opening position is rejected by the server boundary with zero mutation', async () => {
    const fake = createFakePositionDatabase();
    await withServer(fake, async (baseUrl) => {
      const response = await ownerFetch(`${baseUrl}/api/positions/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: USD_VND_ID, quantity: 1, averageCost: 25000 })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.message, /reference-only/i);
    });
    assert.equal(fake.state.rpcCalls.length, 0);
    assert.equal(fake.state.baselines.length, 0);
    assert.equal(fake.state.holdings.length, 0);
    assert.equal(fake.state.cashLedger.length, 0);
    assert.equal(fake.state.transactions.length, 0);
  });

  test('G. pre-trade correction atomically updates baseline and holding only', async () => {
    const fake = createFakePositionDatabase();
    const opening = await establishOpening(fake);
    const cashBefore = fake.state.cashAvailable;
    await withServer(fake, async baseUrl => {
      const response = await ownerFetch(`${baseUrl}/api/positions/opening/${opening.openingPosition.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 125.5, averageCost: 36000.125 })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.openingPosition.openingQuantity, 125.5);
      assert.equal(body.data.holding.quantity, 125.5);
      assert.equal(body.data.holding.averageCost, 36000.125);
    });
    assert.equal(fake.state.transactions.length, 0);
    assert.equal(fake.state.cashLedger.length, 0);
    assert.equal(fake.state.cashAvailable, cashBefore);
  });

  test('H. pre-trade cancellation preserves provenance and removes only the holding', async () => {
    const fake = createFakePositionDatabase();
    const opening = await establishOpening(fake);
    const cashBefore = fake.state.cashAvailable;
    await withServer(fake, async baseUrl => {
      const response = await ownerFetch(`${baseUrl}/api/positions/opening/${opening.openingPosition.id}/cancel`, {
        method: 'POST'
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.holding, null);
      assert.ok(body.data.openingPosition.cancelledAt);
      assert.equal(body.data.openingPosition.correctionAllowed, false);
    });
    assert.equal(fake.state.baselines.length, 1);
    assert.equal(fake.state.holdings.length, 0);
    assert.equal(fake.state.transactions.length, 0);
    assert.equal(fake.state.cashLedger.length, 0);
    assert.equal(fake.state.cashAvailable, cashBefore);
  });

  test('I. BUY after opening locks baseline and preserves weighted-average and cash atomicity', async () => {
    const fake = createFakePositionDatabase();
    await establishOpening(fake, { quantity: 100, averageCost: 35000 });
    const result = await createPortfolioTransaction({
      assetId: FPT_ID,
      transactionType: 'BUY',
      quantity: 20.5,
      price: 41000.75
    }, fake.client);
    const expectedAverage = ((100 * 35000) + (20.5 * 41000.75)) / 120.5;
    assert.equal(result.holding.quantity, 120.5);
    assert.equal(result.holding.averageCost, expectedAverage);
    assert.ok(fake.state.baselines[0].locked_at);
    assert.equal(fake.state.transactions.length, 1);
    assert.equal(fake.state.cashLedger.length, 1);
    assert.equal(fake.state.cashAvailable, 100000000 - (20.5 * 41000.75));
  });

  test('J. SELL after opening locks baseline and preserves realized P/L, average cost, and cash', async () => {
    const fake = createFakePositionDatabase();
    await establishOpening(fake, { quantity: 10, averageCost: 35000 });
    const result = await createPortfolioTransaction({
      assetId: FPT_ID,
      transactionType: 'SELL',
      quantity: 2,
      price: 40000
    }, fake.client);
    assert.equal(result.holding.quantity, 8);
    assert.equal(result.holding.averageCost, 35000);
    assert.equal(result.transaction.realizedPnL, 10000);
    assert.ok(fake.state.baselines[0].locked_at);
    assert.equal(fake.state.cashAvailable, 100080000);
  });

  test('K. correction and cancellation after ledger activity return 409 with zero mutation', async () => {
    const fake = createFakePositionDatabase();
    const opening = await establishOpening(fake);
    await createPortfolioTransaction({
      assetId: FPT_ID,
      transactionType: 'BUY',
      quantity: 1,
      price: 36000
    }, fake.client);
    const before = JSON.stringify({
      cashAvailable: fake.state.cashAvailable,
      holdings: fake.state.holdings,
      baselines: fake.state.baselines,
      transactions: fake.state.transactions,
      cashLedger: fake.state.cashLedger
    });
    await withServer(fake, async baseUrl => {
      const correction = await ownerFetch(`${baseUrl}/api/positions/opening/${opening.openingPosition.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 1, averageCost: 1 })
      });
      const cancellation = await ownerFetch(`${baseUrl}/api/positions/opening/${opening.openingPosition.id}/cancel`, {
        method: 'POST'
      });
      assert.equal(correction.status, 409);
      assert.equal(cancellation.status, 409);
    });
    assert.equal(JSON.stringify({
      cashAvailable: fake.state.cashAvailable,
      holdings: fake.state.holdings,
      baselines: fake.state.baselines,
      transactions: fake.state.transactions,
      cashLedger: fake.state.cashLedger
    }), before);
  });

  test('L. full SELL removes holding while retaining locked opening provenance', async () => {
    const fake = createFakePositionDatabase();
    await establishOpening(fake, { quantity: 3.5, averageCost: 35000 });
    const result = await createPortfolioTransaction({
      assetId: FPT_ID,
      transactionType: 'SELL',
      quantity: 3.5,
      price: 40000
    }, fake.client);
    assert.equal(result.holdingRemoved, true);
    assert.equal(result.holding, null);
    assert.equal(fake.state.holdings.length, 0);
    assert.equal(fake.state.baselines.length, 1);
    assert.ok(fake.state.baselines[0].locked_at);
    assert.equal(fake.state.transactions.length, 1);
    assert.equal(fake.state.cashLedger.length, 1);
  });

  test('M. public generic POST/PUT/DELETE holdings routes are unavailable', async () => {
    const fake = createFakePositionDatabase();
    await withServer(fake, async baseUrl => {
      const responses = await Promise.all([
        ownerFetch(`${baseUrl}/api/holdings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }),
        ownerFetch(`${baseUrl}/api/holdings/holding-1`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }),
        ownerFetch(`${baseUrl}/api/holdings/holding-1`, { method: 'DELETE' })
      ]);
      assert.deepEqual(responses.map(response => response.status), [404, 404, 404]);
    });
  });

  test('N/O. migration closes direct holdings DML while approved RPCs retain projection maintenance', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260828230000_create_position_opening_baselines.sql',
      import.meta.url
    ));
    const migration = readFileSync(migrationPath, 'utf8');
    assert.match(migration, /DROP POLICY IF EXISTS "Allow public insert access to holdings"/);
    assert.match(migration, /DROP POLICY IF EXISTS "Allow public update access to holdings"/);
    assert.match(migration, /DROP POLICY IF EXISTS "Allow public delete access to holdings"/);
    assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.holdings FROM anon, authenticated/);
    assert.match(migration, /GRANT SELECT ON public\.holdings TO anon, authenticated, service_role/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_opening_position/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.correct_opening_position/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_opening_position/);
    assert.match(migration, /SECURITY DEFINER/);
    assert.match(migration, /v_asset\.is_active IS DISTINCT FROM TRUE/);
    assert.match(migration, /v_asset\.quote_currency IS DISTINCT FROM 'VND'/);
    assert.match(migration, /INSERT INTO public\.holdings/);
    assert.match(migration, /UPDATE public\.holdings/);
    assert.match(migration, /DELETE FROM public\.holdings/);
    assert.match(migration, /UPDATE public\.position_opening_baselines[\s\S]*SET locked_at = v_accounted_at/);
    assert.match(migration, /v_existing_holding\.quantity \* v_existing_holding\.average_cost/);
    assert.match(migration, /v_realized_pnl := \(p_price - v_existing_holding\.average_cost\) \* p_quantity/);
    assert.ok(
      migration.indexOf('SET locked_at = v_accounted_at')
        < migration.indexOf('INSERT INTO public.portfolio_transactions'),
      'opening baseline must lock before the transaction ledger row is inserted'
    );
  });

  test('P. forced failures roll back opening and transaction-side baseline locks', async () => {
    const failedOpening = createFakePositionDatabase({ failOpeningAfterBaseline: true });
    await assert.rejects(establishOpening(failedOpening));
    assert.equal(failedOpening.state.baselines.length, 0);
    assert.equal(failedOpening.state.holdings.length, 0);

    const failedTransaction = createFakePositionDatabase({ failTransactionAfterLedger: true });
    await establishOpening(failedTransaction);
    const baselineBefore = { ...failedTransaction.state.baselines[0] };
    const holdingBefore = { ...failedTransaction.state.holdings[0] };
    const cashBefore = failedTransaction.state.cashAvailable;
    await assert.rejects(createPortfolioTransaction({
      assetId: FPT_ID,
      transactionType: 'BUY',
      quantity: 1,
      price: 36000
    }, failedTransaction.client));
    assert.deepEqual(failedTransaction.state.baselines[0], baselineBefore);
    assert.deepEqual(failedTransaction.state.holdings[0], holdingBefore);
    assert.equal(failedTransaction.state.transactions.length, 0);
    assert.equal(failedTransaction.state.cashLedger.length, 0);
    assert.equal(failedTransaction.state.cashAvailable, cashBefore);
  });

  test('Q. mixed legacy migration snapshots known current state without replay or fabricated records', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260828230000_create_position_opening_baselines.sql',
      import.meta.url
    ));
    const migration = readFileSync(migrationPath, 'utf8');
    const activationSection = migration.slice(0, migration.indexOf('CREATE OR REPLACE FUNCTION public.create_opening_position'));
    const holding = { symbol: 'E1VFVN30', quantity: 111003, averageCost: 35000 };
    const transaction = { transactionType: 'SELL', quantity: 12121, price: 40000 };
    const cash = 584840000;

    assert.match(activationSection, /holdings\.quantity/);
    assert.match(activationSection, /holdings\.average_cost/);
    assert.match(activationSection, /'LEGACY_MIXED_ACTIVATION'/);
    assert.match(activationSection, /transactions\.created_at <= activation\.activated_at/);
    assert.doesNotMatch(activationSection, /INSERT INTO public\.(?:portfolio_transactions|cash_ledger_entries)/);
    assert.doesNotMatch(activationSection, /SET\s+(?:quantity|average_cost)\s*=/);
    assert.deepEqual(holding, { symbol: 'E1VFVN30', quantity: 111003, averageCost: 35000 });
    assert.deepEqual(transaction, { transactionType: 'SELL', quantity: 12121, price: 40000 });
    assert.equal(cash, 584840000);
    assert.doesNotMatch(activationSection, /123124/);
  });

  test('R. downstream portfolio valuation consumes the opening-derived holdings projection', async () => {
    const fake = createFakePositionDatabase();
    await establishOpening(fake, { quantity: 2.5, averageCost: 35000 });
    const row = fake.state.holdings[0];
    const result = calculatePortfolioValuation(
      { cash_available: fake.state.cashAvailable },
      [{
        ...row,
        asset: {
          symbol: 'FPT',
          name: 'FPT Corporation',
          asset_type: 'stock',
          exchange: 'HOSE',
          quote_currency: 'VND'
        }
      }],
      { FPT: { price: 40000, priceAsOf: '2026-08-28T08:00:00.000Z' } }
    );
    assert.equal(result.holdings[0].quantity, 2.5);
    assert.equal(result.holdings[0].costBasis, 87500);
    assert.equal(result.holdings[0].marketValue, 100000);
    assert.equal(result.summary.totalPortfolioValue, 100100000);
  });
});
