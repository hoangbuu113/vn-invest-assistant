import { getInvestorProfile, privateSupabase } from './supabase.js';

export const CASH_MOVEMENT_TYPES = Object.freeze(['DEPOSIT', 'WITHDRAWAL']);

export const CASH_LEDGER_METHODOLOGY = Object.freeze({
  sourceOfTruth: 'cash_ledger',
  currentCashFormula: 'openingBalance + deposits - withdrawals - buyOutflows + sellInflows',
  legacyTransactionsReplayed: false,
  historicalEntrySemantics: 'linked BUY/SELL cash effects use transaction executedAt; createdAt remains recording time',
  feesIncluded: false,
  taxesIncluded: false
});

function requireDatabaseClient(client) {
  if (!client) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }
  return client;
}

function normalizeDatabaseNumber(value, field) {
  const isNumber = typeof value === 'number';
  const isNumericString = typeof value === 'string' && value.trim().length > 0;
  if (!isNumber && !isNumericString) {
    throw new Error(`Database returned invalid ${field}`);
  }

  const normalized = isNumber ? value : Number(value.trim());
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`Database returned invalid ${field}`);
  }
  return normalized;
}

function cashDatabaseError(error, fallbackMessage) {
  const err = new Error(error?.message || fallbackMessage);
  err.code = error?.code;
  if (['CL001', 'CL002'].includes(error?.code)) {
    err.statusCode = 400;
  }
  return err;
}

export function normalizeCashLedgerEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    entryType: row.entry_type,
    amount: normalizeDatabaseNumber(row.amount, 'cash ledger amount'),
    symbol: row.symbol || null,
    transactionId: row.portfolio_transaction_id || row.transaction_id || null,
    transactionExecutedAt: row.transaction_executed_at || null,
    effectiveAt: row.effective_at,
    createdAt: row.created_at,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  };
}

export function normalizeCashOverview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Database returned malformed cash overview');
  }

  return {
    currentCash: normalizeDatabaseNumber(data.current_cash, 'current cash'),
    openingBalance: normalizeDatabaseNumber(data.opening_balance, 'opening balance'),
    totalDeposits: normalizeDatabaseNumber(data.total_deposits, 'total deposits'),
    totalWithdrawals: normalizeDatabaseNumber(data.total_withdrawals, 'total withdrawals'),
    buyOutflows: normalizeDatabaseNumber(data.buy_outflows, 'BUY outflows'),
    sellInflows: normalizeDatabaseNumber(data.sell_inflows, 'SELL inflows'),
    entryCount: normalizeDatabaseNumber(data.entry_count, 'cash ledger entry count'),
    ledgerStartAt: data.ledger_start_at || null
  };
}

export async function getCashOverview(client = privateSupabase, options = {}) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof client === 'string') {
    profileId = client;
    db = options && (typeof options.rpc === 'function' || typeof options.from === 'function')
      ? options
      : (options?.client || privateSupabase);
  } else if (client && (typeof client.rpc === 'function' || typeof client.from === 'function')) {
    db = client;
    profileId = options?.profileId || null;
  } else if (client && typeof client === 'object') {
    profileId = client.profileId || null;
    db = options && (typeof options.rpc === 'function' || typeof options.from === 'function')
      ? options
      : (options?.client || client.client || privateSupabase);
  }
  db = requireDatabaseClient(db);

  const rpcArgs = profileId ? { p_profile_id: profileId } : {};
  const { data, error } = await db.rpc('get_cash_overview', rpcArgs);

  if (error) {
    throw cashDatabaseError(error, 'Failed to fetch cash overview');
  }

  return normalizeCashOverview(data);
}

export async function getCashLedger(client = privateSupabase, options = {}) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof client === 'string') {
    profileId = client;
    db = options && (typeof options.rpc === 'function' || typeof options.from === 'function')
      ? options
      : (options?.client || privateSupabase);
  } else if (client && (typeof client.rpc === 'function' || typeof client.from === 'function')) {
    db = client;
    profileId = options?.profileId || null;
  } else if (client && typeof client === 'object') {
    profileId = client.profileId || null;
    db = options && (typeof options.rpc === 'function' || typeof options.from === 'function')
      ? options
      : (options?.client || client.client || privateSupabase);
  }
  db = requireDatabaseClient(db);

  const rpcArgs = profileId ? { p_profile_id: profileId } : {};
  const { data, error } = await db.rpc('list_cash_ledger_entries', rpcArgs);

  if (error) {
    throw cashDatabaseError(error, 'Failed to fetch cash ledger');
  }
  if (!Array.isArray(data)) {
    throw new Error('Database returned malformed cash ledger');
  }

  return data.map(normalizeCashLedgerEntry);
}

export async function createCashMovement({ profileId: payloadProfileId, entryType, amount } = {}, client = privateSupabase, options = {}) {
  const db = requireDatabaseClient(client);
  const profileId = options?.profileId || payloadProfileId || null;

  const rpcArgs = {
    p_entry_type: entryType,
    p_amount: amount
  };
  if (profileId) {
    rpcArgs.p_profile_id = profileId;
  }

  const { data, error } = await db.rpc('create_cash_movement', rpcArgs);

  if (error) {
    throw cashDatabaseError(error, 'Failed to create cash movement');
  }
  if (!data || typeof data !== 'object' || !data.entry) {
    throw new Error('Database returned malformed cash movement result');
  }

  return {
    entry: normalizeCashLedgerEntry(data.entry),
    currentCash: normalizeDatabaseNumber(data.currentCash, 'current cash')
  };
}
