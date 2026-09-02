import { privateSupabase } from './supabase.js';
import { normalizeCashLedgerEntry } from './cash.js';

export const TRANSACTION_TYPES = Object.freeze(['BUY', 'SELL']);
export const SETTLEMENT_MODES = Object.freeze(['INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT']);
export const FX_PROVENANCE_METHODS = Object.freeze([
  'TWELVE_DATA_USD_VND',
  'BINANCE_P2P_USDT_VND',
  'USER_SUPPLIED_VND_BASIS',
  'USD_VND_DIRECT'
]);

export const TRANSACTION_METHODOLOGY = Object.freeze({
  costBasisMethod: 'weighted_average',
  realizedPnLMethod: '(sellPrice - preSellAverageCost) * sellQuantity',
  cashAmountMethod: 'quantity * price',
  cashReconciliation: 'transactions recorded after Feature 15 activation affect current cash atomically at accounting time',
  legacyTransactionsCashReconciled: false,
  feesIncluded: false,
  taxesIncluded: false,
  legacyHoldingsMayPredateLedger: true,
  duplicateRequestSemantics: 'separate_transactions',
  reportingCurrency: 'VND',
  settlementModes: ['INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT']
});

const EXPLICIT_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function requireDatabaseClient(client) {
  if (!client) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }
  return client;
}

function normalizeDatabaseNumber(value, field, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`Database returned missing ${field}`);
  }

  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`Database returned invalid ${field}`);
  }
  return normalized;
}

export function normalizeExplicitTimestamp(value) {
  if (typeof value !== 'string') return null;

  const match = EXPLICIT_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (
    year < 1 ||
    month < 1 || month > 12 ||
    day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function normalizeTransaction(row) {
  if (!row) return null;
  const asset = row.assets || row.asset || {};
  const settlementMode = row.settlement_mode || row.settlementMode || 'INTERNAL_VND_CASH';
  const rawSettlementCurrency = row.settlement_currency ?? row.settlementCurrency;
  const settlementCurrency = typeof rawSettlementCurrency === 'string' && rawSettlementCurrency.trim()
    ? rawSettlementCurrency.trim().toUpperCase()
    : (settlementMode === 'INTERNAL_VND_CASH' ? 'VND' : null);
  const fxProvenance = row.fx_provenance ?? row.fxProvenance;
  const normalizedFxProvenance = typeof fxProvenance === 'string' && fxProvenance.trim()
    ? fxProvenance.trim()
    : (fxProvenance && typeof fxProvenance === 'object' && !Array.isArray(fxProvenance) ? { ...fxProvenance } : null);

  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    assetId: row.asset_id || row.assetId,
    symbol: row.symbol || asset.symbol || null,
    assetName: row.asset_name || asset.name || null,
    assetType: row.asset_type || asset.asset_type || null,
    transactionType: row.transaction_type || row.transactionType,
    quantity: normalizeDatabaseNumber(row.quantity, 'transaction quantity'),
    price: normalizeDatabaseNumber(row.price, 'transaction price'),
    realizedPnL: normalizeDatabaseNumber(row.realized_pnl ?? row.realizedPnL, 'realized P/L', { nullable: true }),
    executionUnitPrice: normalizeDatabaseNumber(
      row.execution_unit_price ?? row.executionUnitPrice,
      'execution unit price',
      { nullable: true }
    ),
    priceCurrency: row.price_currency || row.priceCurrency || 'VND',
    settlementMode,
    settlementCurrency,
    fxRateToVnd: normalizeDatabaseNumber(
      row.fx_rate_to_vnd ?? row.fxRateToVnd,
      'fx rate to vnd',
      { nullable: true }
    ),
    fxProvenance: normalizedFxProvenance,
    fxObservedAt: row.fx_observed_at || row.fxObservedAt || null,
    executedAt: row.executed_at || row.executedAt,
    createdAt: row.created_at || row.createdAt
  };
}

function normalizeHoldingState(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    assetId: row.asset_id || row.assetId,
    openingPositionId: row.opening_position_id || row.openingPositionId || null,
    quantity: normalizeDatabaseNumber(row.quantity, 'holding quantity'),
    averageCost: normalizeDatabaseNumber(row.average_cost ?? row.averageCost, 'holding average cost'),
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt
  };
}

function transactionDatabaseError(error, fallbackMessage) {
  const err = new Error(error?.message || fallbackMessage);
  err.code = error?.code;
  if (['PT001', 'PT002', 'PT003', 'PT004', 'PT005', 'CL001'].includes(error?.code)) {
    err.statusCode = 400;
  }
  return err;
}

export async function getPortfolioTransactions({ symbol } = {}, client = privateSupabase) {
  const db = requireDatabaseClient(client);
  const normalizedSymbol = typeof symbol === 'string' && symbol.trim()
    ? symbol.trim().toUpperCase()
    : null;

  const { data, error } = await db.rpc('list_portfolio_transactions', {
    p_symbol: normalizedSymbol
  });

  if (error) {
    throw transactionDatabaseError(error, 'Failed to fetch portfolio transactions');
  }

  if (!Array.isArray(data)) {
    throw new Error('Database returned malformed portfolio transaction list');
  }

  return data.map(normalizeTransaction);
}

export async function createPortfolioTransaction({
  symbol,
  assetId,
  transactionType,
  quantity,
  price,
  executedAt,
  executionUnitPrice,
  priceCurrency,
  settlementMode,
  settlementCurrency,
  fxRateToVnd,
  fxProvenance,
  fxObservedAt
}, client = privateSupabase) {
  const db = requireDatabaseClient(client);

  const rpcArgs = {
    p_symbol: typeof symbol === 'string' && symbol.trim() ? symbol.trim().toUpperCase() : null,
    p_asset_id: typeof assetId === 'string' && assetId.trim() ? assetId.trim() : null,
    p_transaction_type: transactionType,
    p_quantity: quantity,
    p_price: price,
    p_executed_at: executedAt || null
  };
  if (executionUnitPrice !== undefined && executionUnitPrice !== null) {
    rpcArgs.p_execution_unit_price = executionUnitPrice;
  }
  if (priceCurrency !== undefined && priceCurrency !== null) {
    rpcArgs.p_price_currency = typeof priceCurrency === 'string' ? priceCurrency.trim().toUpperCase() : priceCurrency;
  }
  if (settlementMode !== undefined && settlementMode !== null) {
    rpcArgs.p_settlement_mode = typeof settlementMode === 'string' ? settlementMode.trim().toUpperCase() : settlementMode;
  }
  if (settlementCurrency !== undefined && settlementCurrency !== null) {
    rpcArgs.p_settlement_currency = typeof settlementCurrency === 'string' ? settlementCurrency.trim().toUpperCase() : settlementCurrency;
  }
  if (fxRateToVnd !== undefined && fxRateToVnd !== null) {
    rpcArgs.p_fx_rate_to_vnd = fxRateToVnd;
  }
  if (fxProvenance !== undefined && fxProvenance !== null) {
    rpcArgs.p_fx_provenance = typeof fxProvenance === 'string' ? fxProvenance.trim() : fxProvenance;
  }
  if (fxObservedAt !== undefined && fxObservedAt !== null) {
    rpcArgs.p_fx_observed_at = fxObservedAt;
  }

  const { data, error } = await db.rpc('create_portfolio_transaction', rpcArgs);

  if (error) {
    throw transactionDatabaseError(error, 'Failed to create portfolio transaction');
  }

  if (!data || typeof data !== 'object' || !data.transaction) {
    throw new Error('Database returned malformed portfolio transaction result');
  }

  return {
    transaction: normalizeTransaction(data.transaction),
    holding: normalizeHoldingState(data.holding),
    holdingRemoved: data.holdingRemoved === true,
    cashEntry: normalizeCashLedgerEntry(data.cashEntry),
    currentCash: normalizeDatabaseNumber(data.currentCash, 'current cash')
  };
}
