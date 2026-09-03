import { getInvestorProfile, privateSupabase } from './supabase.js';

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

export function normalizeOpeningPosition(row) {
  if (!row) return null;

  const lockedAt = row.locked_at || null;
  const cancelledAt = row.cancelled_at || null;
  const fxProvenance = row.fx_provenance ?? row.fxProvenance;

  return {
    id: row.id,
    profileId: row.profile_id || row.profileId,
    assetId: row.asset_id || row.assetId,
    openingQuantity: normalizeDatabaseNumber(row.opening_quantity ?? row.openingQuantity, 'opening quantity'),
    openingAverageCost: normalizeDatabaseNumber(row.opening_average_cost ?? row.openingAverageCost, 'opening average cost'),
    executionUnitPrice: normalizeDatabaseNumber(
      row.execution_unit_price ?? row.executionUnitPrice,
      'execution unit price',
      { nullable: true }
    ),
    priceCurrency: row.price_currency || row.priceCurrency || 'VND',
    fxRateToVnd: normalizeDatabaseNumber(
      row.fx_rate_to_vnd ?? row.fxRateToVnd,
      'fx rate to vnd',
      { nullable: true }
    ),
    fxProvenance: fxProvenance && typeof fxProvenance === 'object' && !Array.isArray(fxProvenance)
      ? { ...fxProvenance }
      : null,
    fxObservedAt: row.fx_observed_at || row.fxObservedAt || null,
    accountingCutoffAt: row.accounting_cutoff_at || row.accountingCutoffAt,
    provenanceType: row.provenance_type || row.provenanceType,
    lockedAt,
    cancelledAt,
    correctionAllowed: lockedAt === null && cancelledAt === null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt
  };
}

function normalizeHolding(row) {
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

function openingPositionDatabaseError(error, fallbackMessage) {
  const err = new Error(error?.message || fallbackMessage);
  err.code = error?.code;

  if (['OP001', 'OP002', 'OP003', 'OP004'].includes(error?.code)) {
    err.statusCode = 400;
  } else if (error?.code === 'OP005' || error?.code === 'OP007') {
    err.statusCode = 409;
  } else if (error?.code === 'OP006') {
    err.statusCode = 404;
  }

  return err;
}

function normalizeOpeningResult(data) {
  if (!data || typeof data !== 'object' || !data.openingPosition) {
    throw new Error('Database returned malformed opening position result');
  }

  return {
    openingPosition: normalizeOpeningPosition(data.openingPosition),
    holding: normalizeHolding(data.holding)
  };
}

export async function createOpeningPosition({
  profileId,
  assetId,
  quantity,
  averageCost,
  executionUnitPrice,
  priceCurrency,
  fxRateToVnd,
  fxProvenance,
  fxObservedAt
}, client = privateSupabase) {
  const db = requireDatabaseClient(client);

  const rpcArgs = {
    p_asset_id: assetId,
    p_quantity: quantity,
    p_average_cost: averageCost
  };
  if (profileId) {
    rpcArgs.p_profile_id = profileId;
  }
  if (executionUnitPrice !== undefined && executionUnitPrice !== null) {
    rpcArgs.p_execution_unit_price = executionUnitPrice;
  }
  if (priceCurrency !== undefined && priceCurrency !== null) {
    rpcArgs.p_price_currency = typeof priceCurrency === 'string' ? priceCurrency.trim().toUpperCase() : priceCurrency;
  }
  if (fxRateToVnd !== undefined && fxRateToVnd !== null) {
    rpcArgs.p_fx_rate_to_vnd = fxRateToVnd;
  }
  if (fxProvenance !== undefined && fxProvenance !== null) {
    rpcArgs.p_fx_provenance = fxProvenance;
  }
  if (fxObservedAt !== undefined && fxObservedAt !== null) {
    rpcArgs.p_fx_observed_at = fxObservedAt;
  }

  const { data, error } = await db.rpc('create_opening_position', rpcArgs);

  if (error) {
    throw openingPositionDatabaseError(error, 'Failed to create opening position');
  }

  return normalizeOpeningResult(data);
}

export async function correctOpeningPosition({ profileId, id, quantity, averageCost }, client = privateSupabase) {
  const db = requireDatabaseClient(client);

  const rpcArgs = {
    p_opening_position_id: id,
    p_quantity: quantity,
    p_average_cost: averageCost
  };
  if (profileId) {
    rpcArgs.p_profile_id = profileId;
  }

  const { data, error } = await db.rpc('correct_opening_position', rpcArgs);

  if (error) {
    throw openingPositionDatabaseError(error, 'Failed to correct opening position');
  }

  return normalizeOpeningResult(data);
}

export async function cancelOpeningPosition({ profileId, id }, client = privateSupabase) {
  const db = requireDatabaseClient(client);

  const rpcArgs = {
    p_opening_position_id: id
  };
  if (profileId) {
    rpcArgs.p_profile_id = profileId;
  }

  const { data, error } = await db.rpc('cancel_opening_position', rpcArgs);

  if (error) {
    throw openingPositionDatabaseError(error, 'Failed to cancel opening position');
  }

  return normalizeOpeningResult(data);
}
