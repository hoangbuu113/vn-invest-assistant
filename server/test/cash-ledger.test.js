import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApp } from '../index.js';
import {
  CASH_LEDGER_METHODOLOGY,
  createCashMovement,
  getCashLedger,
  getCashOverview
} from '../src/cash.js';
import { getPortfolioOverview } from '../src/portfolio.js';
import { updateInvestorProfile } from '../src/supabase.js';
import { createPortfolioTransaction } from '../src/transactions.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIVATED_AT = '2026-08-28T12:00:00.000Z';
const OWNER_ACCESS_TOKEN = 'test-owner-token-with-high-entropy-placeholder';

function ownerFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${OWNER_ACCESS_TOKEN}`
    }
  });
}

function cloneRows(rows) {
  return rows.map(row => ({
    ...row,
    ...(Object.prototype.hasOwnProperty.call(row, 'metadata')
      ? { metadata: { ...(row.metadata || {}) } }
      : {})
  }));
}

function createFakeAccountingDatabase({
  cashAvailable = 100000000,
  holdings = [],
  legacyTransactions = [],
  failAfterTransactionInsert = false
} = {}) {
  const asset = {
    id: ASSET_ID,
    symbol: 'FPT',
    name: 'FPT Corporation',
    asset_type: 'stock',
    quote_currency: 'VND'
  };
  const openingEntries = cashAvailable > 0
    ? [{
        id: 'cash-opening',
        profile_id: PROFILE_ID,
        entry_type: 'OPENING_BALANCE',
        amount: cashAvailable,
        portfolio_transaction_id: null,
        effective_at: ACTIVATED_AT,
        created_at: ACTIVATED_AT,
        metadata: {
          semantics: 'feature_15_activation_current_cash_baseline',
          historicalCapitalClaim: false
        }
      }]
    : [];

  const state = {
    profile: {
      id: PROFILE_ID,
      cash_available: cashAvailable,
      risk_tolerance: 'moderate',
      investment_horizon: 'medium',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: ACTIVATED_AT
    },
    activation: {
      profile_id: PROFILE_ID,
      opening_balance_amount: cashAvailable,
      activated_at: ACTIVATED_AT
    },
    holdings: cloneRows(holdings),
    transactions: cloneRows(legacyTransactions),
    cashLedger: openingEntries,
    rpcCalls: []
  };

  let sequence = 0;
  const rpcError = (code, message) => ({ data: null, error: { code, message } });
  const currentCashFromLedger = () => state.activation.opening_balance_amount
    + state.cashLedger.reduce((total, entry) => {
      if (entry.entry_type === 'DEPOSIT' || entry.entry_type === 'SELL') return total + entry.amount;
      if (entry.entry_type === 'WITHDRAWAL' || entry.entry_type === 'BUY') return total - entry.amount;
      return total;
    }, 0);

  function nextAccountingTime() {
    sequence += 1;
    return `2026-08-28T12:00:${String(sequence).padStart(2, '0')}.000Z`;
  }

  async function rpc(name, args = {}) {
    state.rpcCalls.push({ name, args: { ...args } });

    if (name === 'get_cash_overview') {
      const currentCash = currentCashFromLedger();
      if (currentCash !== state.profile.cash_available) {
        return rpcError('CL500', 'cash ledger/cache invariant violated');
      }
      const sum = type => state.cashLedger
        .filter(entry => entry.entry_type === type)
        .reduce((total, entry) => total + entry.amount, 0);
      return {
        data: {
          current_cash: currentCash,
          opening_balance: state.activation.opening_balance_amount,
          total_deposits: sum('DEPOSIT'),
          total_withdrawals: sum('WITHDRAWAL'),
          buy_outflows: sum('BUY'),
          sell_inflows: sum('SELL'),
          entry_count: state.cashLedger.length,
          ledger_start_at: state.activation.activated_at
        },
        error: null
      };
    }

    if (name === 'list_cash_ledger_entries') {
      return {
        data: [...state.cashLedger]
          .sort((left, right) => right.effective_at.localeCompare(left.effective_at))
          .map(entry => {
            const transaction = state.transactions.find(row => row.id === entry.portfolio_transaction_id);
            return {
              ...entry,
              symbol: transaction ? asset.symbol : null,
              transaction_executed_at: transaction?.executed_at || null
            };
          }),
        error: null
      };
    }

    if (name === 'update_investor_profile_preferences') {
      state.profile.risk_tolerance = args.p_risk_tolerance;
      state.profile.investment_horizon = args.p_investment_horizon;
      return { data: { ...state.profile }, error: null };
    }

    if (name === 'create_cash_movement') {
      const { p_entry_type: entryType, p_amount: amount } = args;
      if (!['DEPOSIT', 'WITHDRAWAL'].includes(entryType)) {
        return rpcError('CL002', 'entryType must be DEPOSIT or WITHDRAWAL');
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return rpcError('CL002', 'amount must be a finite number greater than 0');
      }
      if (entryType === 'WITHDRAWAL' && amount > state.profile.cash_available) {
        return rpcError('CL001', 'withdrawal amount exceeds current cash');
      }

      const accountedAt = nextAccountingTime();
      const entry = {
        id: `cash-${sequence}`,
        profile_id: PROFILE_ID,
        entry_type: entryType,
        amount,
        portfolio_transaction_id: null,
        effective_at: accountedAt,
        created_at: accountedAt,
        metadata: {}
      };
      state.cashLedger.push(entry);
      state.profile.cash_available += entryType === 'DEPOSIT' ? amount : -amount;
      return { data: { entry, currentCash: state.profile.cash_available }, error: null };
    }

    if (name !== 'create_portfolio_transaction') {
      return rpcError('42883', `Unknown RPC ${name}`);
    }

    const transactionType = args.p_transaction_type;
    const quantity = args.p_quantity;
    const price = args.p_price;
    const cashAmount = quantity * price;
    if (transactionType === 'BUY' && cashAmount > state.profile.cash_available) {
      return rpcError('CL001', 'insufficient current cash for BUY transaction');
    }

    const stagedHoldings = cloneRows(state.holdings);
    const stagedTransactions = cloneRows(state.transactions);
    const stagedCashLedger = cloneRows(state.cashLedger);
    const holdingIndex = stagedHoldings.findIndex(row => row.profile_id === PROFILE_ID && row.asset_id === ASSET_ID);
    const existing = holdingIndex >= 0 ? stagedHoldings[holdingIndex] : null;
    let resultHolding = null;
    let holdingRemoved = false;
    let realizedPnL = null;

    if (transactionType === 'SELL') {
      if (!existing) return rpcError('PT002', 'cannot SELL an asset without an existing holding');
      if (quantity > existing.quantity) return rpcError('PT003', 'sell quantity exceeds current holding quantity');
      realizedPnL = (price - existing.average_cost) * quantity;
    }

    const accountedAt = nextAccountingTime();
    const transaction = {
      id: `transaction-${sequence}`,
      profile_id: PROFILE_ID,
      asset_id: ASSET_ID,
      transaction_type: transactionType,
      quantity,
      price,
      realized_pnl: realizedPnL,
      executed_at: args.p_executed_at || accountedAt,
      created_at: accountedAt,
      asset
    };
    stagedTransactions.push(transaction);

    if (failAfterTransactionInsert) {
      return rpcError('XX000', 'forced failure after transaction insertion');
    }

    if (transactionType === 'BUY') {
      if (existing) {
        const newQuantity = existing.quantity + quantity;
        resultHolding = {
          ...existing,
          quantity: newQuantity,
          average_cost: (
            (existing.quantity * existing.average_cost) + (quantity * price)
          ) / newQuantity,
          updated_at: accountedAt
        };
        stagedHoldings[holdingIndex] = resultHolding;
      } else {
        resultHolding = {
          id: `holding-${sequence}`,
          profile_id: PROFILE_ID,
          asset_id: ASSET_ID,
          quantity,
          average_cost: price,
          created_at: accountedAt,
          updated_at: accountedAt,
          asset
        };
        stagedHoldings.push(resultHolding);
      }
    } else {
      const newQuantity = existing.quantity - quantity;
      holdingRemoved = newQuantity === 0;
      if (holdingRemoved) {
        stagedHoldings.splice(holdingIndex, 1);
      } else {
        resultHolding = { ...existing, quantity: newQuantity, updated_at: accountedAt };
        stagedHoldings[holdingIndex] = resultHolding;
      }
    }

    const cashEntry = {
      id: `cash-transaction-${sequence}`,
      profile_id: PROFILE_ID,
      entry_type: transactionType,
      amount: cashAmount,
      portfolio_transaction_id: transaction.id,
      effective_at: accountedAt,
      created_at: accountedAt,
      metadata: { accountingSemantics: 'recorded_now_affects_current_cash' },
      symbol: asset.symbol
    };
    stagedCashLedger.push(cashEntry);
    const newCash = transactionType === 'BUY'
      ? state.profile.cash_available - cashAmount
      : state.profile.cash_available + cashAmount;

    state.holdings.splice(0, state.holdings.length, ...stagedHoldings);
    state.transactions.splice(0, state.transactions.length, ...stagedTransactions);
    state.cashLedger.splice(0, state.cashLedger.length, ...stagedCashLedger);
    state.profile.cash_available = newCash;

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

  return { client: { rpc }, state, currentCashFromLedger };
}

function holding(quantity = 100, averageCost = 10) {
  return {
    id: 'holding-fpt',
    profile_id: PROFILE_ID,
    asset_id: ASSET_ID,
    quantity,
    average_cost: averageCost,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    asset: { id: ASSET_ID, symbol: 'FPT', name: 'FPT Corporation', asset_type: 'stock' }
  };
}

describe('Feature 15 — Cash / Capital Ledger Accounting Core', () => {
  test('A. activation preserves existing cash as one explicitly non-historical opening baseline', async () => {
    const { client, state } = createFakeAccountingDatabase();
    const overview = await getCashOverview(client);
    const ledger = await getCashLedger(client);

    assert.equal(overview.currentCash, 100000000);
    assert.equal(overview.openingBalance, 100000000);
    assert.equal(overview.entryCount, 1);
    assert.equal(ledger[0].entryType, 'OPENING_BALANCE');
    assert.equal(ledger[0].metadata.historicalCapitalClaim, false);
    assert.equal(state.transactions.length, 0);
  });

  test('zero activation has explicit baseline metadata without a fake positive entry', async () => {
    const { client } = createFakeAccountingDatabase({ cashAvailable: 0 });
    const overview = await getCashOverview(client);
    const ledger = await getCashLedger(client);
    assert.equal(overview.currentCash, 0);
    assert.equal(overview.openingBalance, 0);
    assert.equal(overview.ledgerStartAt, ACTIVATED_AT);
    assert.equal(ledger.length, 0);
  });

  test('B/C. deposit and withdrawal update current cash and append immutable entries', async () => {
    const { client } = createFakeAccountingDatabase();
    const deposit = await createCashMovement({ entryType: 'DEPOSIT', amount: 20000000 }, client);
    const withdrawal = await createCashMovement({ entryType: 'WITHDRAWAL', amount: 40000000 }, client);
    const overview = await getCashOverview(client);

    assert.equal(deposit.currentCash, 120000000);
    assert.equal(withdrawal.currentCash, 80000000);
    assert.equal(overview.totalDeposits, 20000000);
    assert.equal(overview.totalWithdrawals, 40000000);
    assert.equal(overview.currentCash, 80000000);
  });

  test('D/O. over-withdraw is rejected with no negative cash and no ledger mutation', async () => {
    const { client, state } = createFakeAccountingDatabase();
    const before = cloneRows(state.cashLedger);
    await assert.rejects(
      createCashMovement({ entryType: 'WITHDRAWAL', amount: 100000001 }, client),
      error => error.code === 'CL001' && error.statusCode === 400
    );
    assert.equal(state.profile.cash_available, 100000000);
    assert.deepEqual(state.cashLedger, before);
  });

  test('E. BUY atomically reduces cash and creates holding, transaction, and linked cash entry', async () => {
    const { client, state } = createFakeAccountingDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 100, price: 100000
    }, client);

    assert.equal(result.currentCash, 90000000);
    assert.equal(result.cashEntry.entryType, 'BUY');
    assert.equal(result.cashEntry.amount, 10000000);
    assert.equal(result.cashEntry.transactionId, result.transaction.id);
    assert.equal(state.holdings.length, 1);
    assert.equal(state.transactions.length, 1);
  });

  test('F. insufficient-cash BUY rejects every staged mutation', async () => {
    const existing = holding();
    const { client, state } = createFakeAccountingDatabase({ cashAvailable: 5000000, holdings: [existing] });
    const openingLedger = cloneRows(state.cashLedger);
    await assert.rejects(
      createPortfolioTransaction({ symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: 10000000 }, client),
      error => error.code === 'CL001' && error.statusCode === 400
    );
    assert.equal(state.profile.cash_available, 5000000);
    assert.deepEqual(state.holdings, [existing]);
    assert.equal(state.transactions.length, 0);
    assert.deepEqual(state.cashLedger, openingLedger);
  });

  test('G. SELL credits gross proceeds while realized P/L remains independent', async () => {
    const { client } = createFakeAccountingDatabase({ holdings: [holding(100, 40000)] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 100, price: 50000
    }, client);
    assert.equal(result.transaction.realizedPnL, 1000000);
    assert.equal(result.cashEntry.amount, 5000000);
    assert.equal(result.currentCash, 105000000);
  });

  test('H. forced post-transaction failure rolls back transaction, holding, cash entry, and cash', async () => {
    const existing = holding();
    const { client, state } = createFakeAccountingDatabase({
      holdings: [existing],
      failAfterTransactionInsert: true
    });
    const openingLedger = cloneRows(state.cashLedger);
    await assert.rejects(createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 1, price: 1000
    }, client));
    assert.equal(state.profile.cash_available, 100000000);
    assert.deepEqual(state.holdings, [existing]);
    assert.equal(state.transactions.length, 0);
    assert.deepEqual(state.cashLedger, openingLedger);
  });

  test('I. full exit removes holding and credits exact proceeds', async () => {
    const { client, state } = createFakeAccountingDatabase({ holdings: [holding(10, 40)] });
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'SELL', quantity: 10, price: 50
    }, client);
    assert.equal(result.holdingRemoved, true);
    assert.equal(state.holdings.length, 0);
    assert.equal(result.currentCash, 100000500);
  });

  test('J. historical executedAt changes current cash once at accounting time without reconstruction', async () => {
    const { client } = createFakeAccountingDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT',
      transactionType: 'BUY',
      quantity: 2,
      price: 1000,
      executedAt: '2020-01-02T03:00:00.000Z'
    }, client);
    const overview = await getCashOverview(client);
    assert.equal(result.transaction.executedAt, '2020-01-02T03:00:00.000Z');
    assert.notEqual(result.cashEntry.effectiveAt, result.transaction.executedAt);
    assert.equal(overview.currentCash, 99998000);
    assert.match(CASH_LEDGER_METHODOLOGY.historicalEntrySemantics, /accounting time/);
  });

  test('K. existing immutable transactions are not given retroactive cash entries', async () => {
    const legacy = [{
      id: 'legacy-transaction',
      profile_id: PROFILE_ID,
      asset_id: ASSET_ID,
      transaction_type: 'BUY',
      quantity: 10,
      price: 1000,
      realized_pnl: null,
      executed_at: '2026-08-27T03:00:00.000Z',
      created_at: '2026-08-27T03:00:00.000Z'
    }];
    const { client } = createFakeAccountingDatabase({ legacyTransactions: legacy });
    const ledger = await getCashLedger(client);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].entryType, 'OPENING_BALANCE');
    assert.equal(ledger.some(entry => entry.transactionId === 'legacy-transaction'), false);
  });

  test('full-precision transaction cash uses quantity * price without intermediate rounding', async () => {
    const { client } = createFakeAccountingDatabase();
    const result = await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 0.75, price: 16.98765
    }, client);
    const expected = 0.75 * 16.98765;
    assert.equal(result.cashEntry.amount, expected);
    assert.notEqual(expected, Math.round(expected * 100) / 100);
  });

  test('P. production portfolio overview consumes ledger-authoritative cash', async () => {
    const { client, state } = createFakeAccountingDatabase();
    await createPortfolioTransaction({
      symbol: 'FPT', transactionType: 'BUY', quantity: 100, price: 100000
    }, client);

    const overview = await getPortfolioOverview({
      getCashOverviewFn: () => getCashOverview(client),
      getHoldingsFn: async () => state.holdings,
      getMarketSnapshotFn: async () => ({ price: 100000, priceAsOf: '2026-08-28T03:00:00.000Z' })
    });
    assert.equal(overview.summary.cashAvailable, 90000000);
    assert.equal(overview.summary.totalMarketValue, 10000000);
    assert.equal(overview.summary.totalPortfolioValue, 100000000);
  });

  test('Q. production profile data access rejects cash writes and updates preferences only through RPC', async () => {
    const { client, state } = createFakeAccountingDatabase();
    await assert.rejects(
      updateInvestorProfile({
        cash_available: 50000000,
        risk_tolerance: 'high',
        investment_horizon: 'long'
      }, client),
      error => error.statusCode === 409
    );
    assert.equal(state.profile.cash_available, 100000000);

    const updated = await updateInvestorProfile({
      risk_tolerance: 'high', investment_horizon: 'long'
    }, client);
    assert.equal(updated.cash_available, 100000000);
    assert.equal(updated.risk_tolerance, 'high');
    assert.equal(state.rpcCalls.at(-1).name, 'update_investor_profile_preferences');
  });

  test('database migration proves baseline safety, atomic cash integration, and immutable linkage', () => {
    const migration = readFileSync(fileURLToPath(new URL(
      '../../supabase/migrations/20260828180000_create_cash_capital_ledger.sql',
      import.meta.url
    )), 'utf8');

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.cash_ledger_entries/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.cash_ledger_activation/);
    assert.match(migration, /ON CONFLICT \(profile_id\) DO NOTHING/);
    assert.match(migration, /WHERE activation\.opening_balance_amount > 0/);
    assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_cash_ledger_portfolio_transaction/);
    assert.match(migration, /v_cash_amount := p_quantity \* p_price/);
    assert.match(migration, /insufficient current cash for BUY transaction/);
    assert.match(migration, /INSERT INTO public\.portfolio_transactions/);
    assert.match(migration, /INSERT INTO public\.cash_ledger_entries/);
    assert.match(migration, /SET cash_available = v_new_cash/);
    assert.match(migration, /DROP POLICY IF EXISTS "Allow public update access to investor_profile"/);
    assert.doesNotMatch(
      migration,
      /INSERT INTO public\.cash_ledger_entries[\s\S]{0,600}FROM public\.portfolio_transactions/
    );
  });
});

describe('Feature 15 — Production Cash Routes', () => {
  let fake;
  let server;
  let baseUrl;

  before(async () => {
    fake = createFakeAccountingDatabase();
    const app = createApp({
      cashClient: fake.client,
      transactionClient: fake.client,
      getInvestorProfileFn: async () => ({ ...fake.state.profile }),
      updateInvestorProfileFn: input => updateInvestorProfile(input, fake.client),
      ownerAccessToken: OWNER_ACCESS_TOKEN,
      getPortfolioOverviewFn: () => getPortfolioOverview({
        getCashOverviewFn: () => getCashOverview(fake.client),
        getHoldingsFn: async () => fake.state.holdings,
        getMarketSnapshotFn: async () => ({ price: 100000 })
      })
    });
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('R/N. actual routes use production RPC data access and never send client profile ownership', async () => {
    const depositResponse = await ownerFetch(`${baseUrl}/api/cash/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 20000000, profileId: FOREIGN_PROFILE_ID })
    });
    assert.equal(depositResponse.status, 201);

    const buyResponse = await ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'FPT', transactionType: 'BUY', quantity: 100, price: 100000,
        profileId: FOREIGN_PROFILE_ID
      })
    });
    assert.equal(buyResponse.status, 201);

    const overviewResponse = await ownerFetch(`${baseUrl}/api/cash/overview`);
    const overview = await overviewResponse.json();
    assert.equal(overviewResponse.status, 200);
    assert.equal(overview.data.currentCash, 110000000);

    const ledgerResponse = await ownerFetch(`${baseUrl}/api/cash/ledger`);
    const ledger = await ledgerResponse.json();
    assert.equal(ledgerResponse.status, 200);
    assert.equal(ledger.count, 3);

    const mutationCalls = fake.state.rpcCalls.filter(call => (
      call.name === 'create_cash_movement' || call.name === 'create_portfolio_transaction'
    ));
    assert.equal(mutationCalls.every(call => !Object.hasOwn(call.args, 'p_profile_id')), true);
  });

  test('M. deposit/withdraw reject numeric strings and other non-number JSON before RPC', async () => {
    const invalidAmounts = ['1000', null, true, [1000], { amount: 1000 }, 0, -1];
    for (const amount of invalidAmounts) {
      const callCount = fake.state.rpcCalls.length;
      const response = await ownerFetch(`${baseUrl}/api/cash/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      assert.equal(response.status, 400);
      assert.equal(fake.state.rpcCalls.length, callCount);
    }
  });

  test('profile route cannot overwrite ledger cash but still updates preferences', async () => {
    const rejected = await ownerFetch(`${baseUrl}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cash_available: 1,
        risk_tolerance: 'low',
        investment_horizon: 'short'
      })
    });
    assert.equal(rejected.status, 409);
    assert.equal(fake.state.profile.cash_available, 110000000);

    const accepted = await ownerFetch(`${baseUrl}/api/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cash_available: 110000000,
        risk_tolerance: 'low',
        investment_horizon: 'short'
      })
    });
    assert.equal(accepted.status, 200);
    assert.equal(fake.state.profile.cash_available, 110000000);
    assert.equal(fake.state.profile.risk_tolerance, 'low');
  });

  test('V1 exposes no ledger edit or delete routes', async () => {
    const putResponse = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-opening`, { method: 'PUT' });
    const deleteResponse = await ownerFetch(`${baseUrl}/api/cash/ledger/cash-opening`, { method: 'DELETE' });
    assert.equal(putResponse.status, 404);
    assert.equal(deleteResponse.status, 404);
  });
});
