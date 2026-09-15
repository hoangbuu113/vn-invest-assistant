import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { evaluateAlertsBatch } from './alerts.js';
import { getMarketSnapshot } from './market.js';
import { normalizeAsset, normalizeProviderMapping } from './assets.js';

dotenv.config();

const rawUrl = process.env.SUPABASE_URL;
const publicSupabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export function resolvePrivilegedSupabaseKey(environment = process.env) {
  const secretKey = typeof environment?.SUPABASE_SECRET_KEY === 'string'
    ? environment.SUPABASE_SECRET_KEY.trim()
    : '';
  if (secretKey && secretKey !== 'your-supabase-secret-key') return secretKey;

  const legacyServiceRoleKey = typeof environment?.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? environment.SUPABASE_SERVICE_ROLE_KEY.trim()
    : '';
  if (legacyServiceRoleKey && legacyServiceRoleKey !== 'your-supabase-service-role-key') {
    return legacyServiceRoleKey;
  }

  return null;
}

const privilegedSupabaseKey = resolvePrivilegedSupabaseKey();

// Sanitize URL in case trailing slashes or /rest/v1 were included
const supabaseUrl = rawUrl
  ? rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  : null;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  publicSupabaseKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  publicSupabaseKey !== 'your-supabase-publishable-key' &&
  publicSupabaseKey !== 'your-supabase-anon-key'
);

export const isPrivilegedSupabaseConfigured = Boolean(
  supabaseUrl &&
  privilegedSupabaseKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co'
);

const CLIENT_AUTH_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
};

export const publicSupabase = isSupabaseConfigured
  ? createClient(supabaseUrl, publicSupabaseKey, CLIENT_AUTH_OPTIONS)
  : null;

export const privateSupabase = isPrivilegedSupabaseConfigured
  ? createClient(supabaseUrl, privilegedSupabaseKey, CLIENT_AUTH_OPTIONS)
  : null;

// Backward-compatible public metadata client. Private data-access functions
// intentionally default to privateSupabase instead.
export const supabase = publicSupabase;

const ASSET_SELECT_FIELDS = [
  'id',
  'symbol',
  'name',
  'asset_type',
  'exchange',
  'market_code',
  'quote_currency',
  'base_currency',
  'market_policy',
  'market_timezone',
  'quantity_unit',
  'portfolio_eligibility',
  'fundamentals_company_type',
  'is_active',
  'created_at'
].join(', ');

/**
 * Verifies actual communication with Supabase.
 * Returns an object indicating connection status and details.
 */
export async function checkSupabaseConnection() {
  if (!isSupabaseConfigured || !supabase) {
    return {
      connected: false,
      error: 'Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env'
    };
  }

  try {
    // Attempt a request to Supabase to verify connectivity and API key validity.
    const { error, status } = await supabase
      .from('_healthcheck')
      .select('*', { count: 'exact', head: true });

    // HTTP 401/403 indicates invalid or unauthorized credentials
    if (status === 401 || status === 403) {
      return {
        connected: false,
        status,
        error: error?.message || 'Authentication failed: Invalid SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY'
      };
    }

    // Network failures or unreachable hostname (fetch failed, ENOTFOUND, etc.)
    if (error && (status === 0 || !status || status >= 500)) {
      return {
        connected: false,
        status,
        error: error.message || 'Failed to reach Supabase network endpoint'
      };
    }

    // A valid response from the Supabase API (e.g. 200, or 400/404 PGRST table not found) confirms reachability and valid API key
    return {
      connected: true,
      message: 'Connected to Supabase successfully'
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message || 'Unknown error communicating with Supabase'
    };
  }
}

/**
 * Fetches all assets from the Supabase assets table.
 */
/**
 * Fetches all assets from the Supabase assets table.
 */
export async function getAssets(client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const { data, error } = await db
    .from('assets')
    .select(ASSET_SELECT_FIELDS)
    .order('symbol', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeAsset);
}

/**
 * Fetches a single asset by symbol from the Supabase assets table.
 */
export async function getAssetBySymbol(symbol, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  if (!symbol || typeof symbol !== 'string') {
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();

  const { data, error } = await db
    .from('assets')
    .select(ASSET_SELECT_FIELDS)
    .eq('symbol', normalizedSymbol)
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return data ? normalizeAsset(data) : null;
}

/**
 * Fetches a single asset by UUID from the Supabase assets table.
 */
export async function getAssetById(id, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  if (!id || typeof id !== 'string') {
    return null;
  }

  const { data, error } = await db
    .from('assets')
    .select(ASSET_SELECT_FIELDS)
    .eq('id', id.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return data ? normalizeAsset(data) : null;
}

/**
 * Fetches one explicit provider identity for a canonical asset.
 * No provider symbol is inferred when a mapping is absent.
 */
export async function getAssetProviderMapping(assetId, provider, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  if (
    typeof assetId !== 'string' || !assetId.trim() ||
    typeof provider !== 'string' || !provider.trim()
  ) {
    return null;
  }

  const { data, error } = await db
    .from('asset_provider_mappings')
    .select('id, asset_id, provider, provider_symbol, provider_market, created_at')
    .eq('asset_id', assetId.trim())
    .eq('provider', provider.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return data ? normalizeProviderMapping(data) : null;
}

/**
 * Normalizes an investor profile row from Supabase.
 */
function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id || null,
    cash_available: typeof row.cash_available === 'number' ? row.cash_available : Number(row.cash_available),
    risk_tolerance: row.risk_tolerance,
    investment_horizon: row.investment_horizon,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Fetches an investor profile from Supabase.
 * If identifier is provided, resolves by user_id or id.
 * Otherwise resolves the first active profile (legacy unowned or earliest created).
 */
export async function getInvestorProfile(client = privateSupabase) {
  const options = arguments[1] || {};
  let db = privateSupabase;
  let identifier = null;

  if (typeof client === 'string') {
    identifier = { id: client };
    db = options?.client || privateSupabase;
  } else if (client && typeof client.from === 'function') {
    db = client;
    identifier = options && typeof options === 'object' ? options : null;
  } else if (client && typeof client === 'object' && (client.userId || client.id || client.profileId)) {
    identifier = client;
    db = options?.client || client.client || privateSupabase;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const selectFields = identifier?.userId
    ? 'id, user_id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at'
    : 'id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at';

  let query = db
    .from('investor_profile')
    .select(selectFields);

  if (identifier?.userId) {
    query = query.eq('user_id', identifier.userId);
  } else if (identifier?.id || identifier?.profileId) {
    query = query.eq('id', identifier.id || identifier.profileId);
  } else {
    query = query.order('created_at', { ascending: true }).limit(1);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  if (!data) {
    if (identifier?.userId || identifier?.id || identifier?.profileId) {
      return null;
    }

    const defaultProfile = {
      cash_available: 0,
      risk_tolerance: 'moderate',
      investment_horizon: 'medium'
    };

    const { data: inserted, error: insertError } = await db
      .from('investor_profile')
      .insert([defaultProfile])
      .select(selectFields)
      .single();

    if (insertError) {
      // If concurrent insert occurred, fetch the existing row
      if (insertError.code === '23505') {
        const { data: refetched, error: refetchErr } = await db
          .from('investor_profile')
          .select(selectFields)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!refetchErr && refetched) {
          return normalizeProfile(refetched);
        }
      }
      throw new Error(`Failed to initialize default investor profile: ${insertError.message}`);
    }

    return normalizeProfile(inserted);
  }

  return normalizeProfile(data);
}

export async function getProfileByUserId(userId, client = privateSupabase) {
  return getInvestorProfile(client, { userId });
}

export async function getProfileById(profileId, client = privateSupabase) {
  return getInvestorProfile(client, { id: profileId });
}

export async function createProfileForUser(arg1, arg2, arg3) {
  let userId;
  let cashAvailable = 0;
  let riskTolerance = 'moderate';
  let investmentHorizon = 'medium';
  let client = privateSupabase;

  if (typeof arg1 === 'string') {
    userId = arg1;
    if (arg2 && typeof arg2 === 'object' && !(typeof arg2.from === 'function')) {
      cashAvailable = arg2.cashAvailable ?? arg2.cash_available ?? 0;
      riskTolerance = arg2.riskTolerance ?? arg2.risk_tolerance ?? 'moderate';
      investmentHorizon = arg2.investmentHorizon ?? arg2.investment_horizon ?? 'medium';
      client = arg3 || privateSupabase;
    } else {
      client = arg2 || privateSupabase;
    }
  } else if (arg1 && typeof arg1 === 'object') {
    userId = arg1.userId ?? arg1.user_id;
    cashAvailable = arg1.cashAvailable ?? arg1.cash_available ?? 0;
    riskTolerance = arg1.riskTolerance ?? arg1.risk_tolerance ?? 'moderate';
    investmentHorizon = arg1.investmentHorizon ?? arg1.investment_horizon ?? 'medium';
    client = arg2 || privateSupabase;
  }

  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');
  if (!userId) throw new Error('userId is required');

  const { data, error } = await db
    .from('investor_profile')
    .insert([{
      user_id: userId,
      cash_available: cashAvailable,
      risk_tolerance: riskTolerance,
      investment_horizon: investmentHorizon
    }])
    .select('id, user_id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return getProfileByUserId(userId, db);
    }
    throw new Error(`Failed to create investor profile: ${error.message}`);
  }
  return normalizeProfile(data);
}

/**
 * Updates non-cash preferences for an investor profile.
 * Feature 15 cash is ledger-managed and cannot be written through this path.
 */
export async function updateInvestorProfile(input, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (Object.prototype.hasOwnProperty.call(input || {}, 'cash_available')) {
    const err = new Error('cash_available is ledger-managed; use the cash deposit or withdrawal endpoints');
    err.statusCode = 409;
    throw err;
  }

  const { profileId, risk_tolerance, investment_horizon } = input || {};
  const rpcArgs = {
    p_risk_tolerance: risk_tolerance,
    p_investment_horizon: investment_horizon
  };
  if (profileId) {
    rpcArgs.p_profile_id = profileId;
  }

  const { data, error } = await db.rpc('update_investor_profile_preferences', rpcArgs);

  if (error) {
    const err = new Error(`Database update error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
    if (error.code === 'IP001' || error.code === 'IP002' || error.code === 'IP004') err.statusCode = 400;
    throw err;
  }

  return normalizeProfile(data);
}

/**
 * Normalizes a holding row from Supabase.
 */
function normalizeHolding(row) {
  if (!row) return null;
  const openingPosition = row.opening_position || null;
  const openingCorrectionAllowed = Boolean(
    openingPosition && !openingPosition.locked_at && !openingPosition.cancelled_at
  );

  return {
    id: row.id,
    profile_id: row.profile_id,
    asset_id: row.asset_id,
    opening_position_id: row.opening_position_id || null,
    quantity: typeof row.quantity === 'number' ? row.quantity : Number(row.quantity),
    average_cost: row.average_cost === null || row.average_cost === undefined
      ? null
      : (typeof row.average_cost === 'number' ? row.average_cost : Number(row.average_cost)),
    native_average_cost: row.native_average_cost === null || row.native_average_cost === undefined
      ? null
      : (typeof row.native_average_cost === 'number' ? row.native_average_cost : Number(row.native_average_cost)),
    native_cost_currency: row.native_cost_currency || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    asset: row.assets || null,
    position_origin: openingPosition && !openingPosition.cancelled_at
      ? openingPosition.provenance_type
      : 'LEDGER',
    opening_correction_allowed: openingCorrectionAllowed,
    opening_position: openingPosition
      ? {
          id: openingPosition.id,
          opening_quantity: typeof openingPosition.opening_quantity === 'number'
            ? openingPosition.opening_quantity
            : Number(openingPosition.opening_quantity),
          opening_average_cost: openingPosition.opening_average_cost === null || openingPosition.opening_average_cost === undefined
            ? null
            : (typeof openingPosition.opening_average_cost === 'number'
                ? openingPosition.opening_average_cost
                : Number(openingPosition.opening_average_cost)),
          execution_unit_price: openingPosition.execution_unit_price === null
            ? null
            : (typeof openingPosition.execution_unit_price === 'number'
                ? openingPosition.execution_unit_price
                : Number(openingPosition.execution_unit_price)),
          price_currency: openingPosition.price_currency || null,
          native_average_cost: openingPosition.execution_unit_price === null
            ? null
            : (typeof openingPosition.execution_unit_price === 'number'
                ? openingPosition.execution_unit_price
                : Number(openingPosition.execution_unit_price)),
          native_cost_currency: openingPosition.price_currency || null,
          fx_rate_to_vnd: openingPosition.fx_rate_to_vnd === null
            ? null
            : (typeof openingPosition.fx_rate_to_vnd === 'number'
                ? openingPosition.fx_rate_to_vnd
                : Number(openingPosition.fx_rate_to_vnd)),
          fx_provenance: openingPosition.fx_provenance || null,
          fx_observed_at: openingPosition.fx_observed_at || null,
          accounting_cutoff_at: openingPosition.accounting_cutoff_at,
          provenance_type: openingPosition.provenance_type,
          locked_at: openingPosition.locked_at || null,
          cancelled_at: openingPosition.cancelled_at || null,
          correction_allowed: openingCorrectionAllowed,
          created_at: openingPosition.created_at,
          updated_at: openingPosition.updated_at
        }
      : null
  };
}

/**
 * Fetches all holdings for the single investor profile with joined asset information.
 */
export async function getHoldings(client = privateSupabase) {
  const options = arguments[1] || {};
  let db = privateSupabase;
  let profileId = null;

  if (typeof client === 'string') {
    profileId = client;
    db = options?.client || privateSupabase;
  } else if (client && typeof client.from === 'function') {
    db = client;
    profileId = options?.profileId || null;
  } else if (client && typeof client === 'object' && client.profileId) {
    profileId = client.profileId;
    db = options?.client || client.client || privateSupabase;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('holdings')
    .select(`
      id,
      profile_id,
      asset_id,
      opening_position_id,
      quantity,
      average_cost,
      native_average_cost,
      native_cost_currency,
      created_at,
      updated_at,
      assets (id, symbol, name, asset_type, exchange, quote_currency, quantity_unit),
      opening_position:position_opening_baselines (
        id,
        opening_quantity,
        opening_average_cost,
        execution_unit_price,
        price_currency,
        fx_rate_to_vnd,
        fx_provenance,
        fx_observed_at,
        accounting_cutoff_at,
        provenance_type,
        locked_at,
        cancelled_at,
        created_at,
        updated_at
      )
    `)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeHolding);
}

/**
 * Adds a new holding for an investor profile.
 */
export async function addHolding({ profileId, asset_id, quantity, average_cost }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  let targetProfileId = profileId;
  if (!targetProfileId) {
    const profile = await getInvestorProfile(db);
    targetProfileId = profile.id;
  }

  // Check if asset exists
  const { data: asset, error: assetErr } = await db
    .from('assets')
    .select('id, symbol, name, asset_type, exchange')
    .eq('id', asset_id)
    .maybeSingle();

  if (assetErr) {
    throw new Error(`Database query error: ${assetErr.message} (code: ${assetErr.code || 'UNKNOWN'})`);
  }

  if (!asset) {
    const notFoundErr = new Error(`Asset with ID '${asset_id}' not found`);
    notFoundErr.statusCode = 400;
    throw notFoundErr;
  }

  // Check if holding for this asset already exists for profile
  const { data: existing, error: existingErr } = await db
    .from('holdings')
    .select('id')
    .eq('profile_id', targetProfileId)
    .eq('asset_id', asset_id)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Database query error: ${existingErr.message}`);
  }

  if (existing) {
    const dupErr = new Error(`Holding for asset '${asset.symbol}' already exists. Edit the existing holding instead.`);
    dupErr.statusCode = 400;
    throw dupErr;
  }

  const { data, error } = await db
    .from('holdings')
    .insert([
      {
        profile_id: targetProfileId,
        asset_id,
        quantity,
        average_cost
      }
    ])
    .select('id, profile_id, asset_id, quantity, average_cost, created_at, updated_at, assets (id, symbol, name, asset_type, exchange)')
    .single();

  if (error) {
    if (error.code === '23505') {
      const dupErr = new Error(`Holding for asset '${asset.symbol}' already exists. Edit the existing holding instead.`);
      dupErr.statusCode = 400;
      throw dupErr;
    }
    throw new Error(`Database insert error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return normalizeHolding(data);
}

/**
 * Updates an existing holding by ID, strictly scoped to an investor profile.
 */
export async function updateHolding(id, { profileId, quantity, average_cost }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!id || typeof id !== 'string') {
    const err = new Error('Invalid holding ID');
    err.statusCode = 400;
    throw err;
  }

  let targetProfileId = profileId;
  if (!targetProfileId) {
    const profile = await getInvestorProfile(db);
    targetProfileId = profile.id;
  }

  const { data, error } = await db
    .from('holdings')
    .update({
      quantity,
      average_cost,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('profile_id', targetProfileId)
    .select('id, profile_id, asset_id, quantity, average_cost, created_at, updated_at, assets (id, symbol, name, asset_type, exchange)')
    .maybeSingle();

  if (error) {
    // If invalid UUID format or not found in PG
    if (error.code === '22P02') {
      const err = new Error(`Holding with ID '${id}' not found`);
      err.statusCode = 404;
      throw err;
    }
    throw new Error(`Database update error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  if (!data) {
    const err = new Error(`Holding with ID '${id}' not found`);
    err.statusCode = 404;
    throw err;
  }

  return normalizeHolding(data);
}

/**
 * Deletes a holding by ID, strictly scoped to an investor profile.
 */
export async function deleteHolding(id, profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!id || typeof id !== 'string') {
    const err = new Error('Invalid holding ID');
    err.statusCode = 400;
    throw err;
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  // Check if holding exists for this profile first
  const { data: existing, error: findErr } = await db
    .from('holdings')
    .select('id')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle();

  if (findErr) {
    if (findErr.code === '22P02') {
      const err = new Error(`Holding with ID '${id}' not found`);
      err.statusCode = 404;
      throw err;
    }
    throw new Error(`Database query error: ${findErr.message}`);
  }

  if (!existing) {
    const err = new Error(`Holding with ID '${id}' not found`);
    err.statusCode = 404;
    throw err;
  }

  const { error } = await db
    .from('holdings')
    .delete()
    .eq('id', id)
    .eq('profile_id', profileId);

  if (error) {
    throw new Error(`Database delete error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return { id, deleted: true };
}

const CANONICAL_ASSET_PROJECTION = 'id, symbol, name, asset_type, exchange, market_code, quote_currency, base_currency, market_policy, market_timezone, quantity_unit, portfolio_eligibility';
const WATCHLIST_SELECT = `id, profile_id, asset_id, created_at, assets (${CANONICAL_ASSET_PROJECTION})`;
const ALERT_SELECT = `id, profile_id, asset_id, direction, target_price, status, last_evaluated_price, last_evaluated_at, triggered_at, created_at, assets (${CANONICAL_ASSET_PROJECTION})`;

function normalizeCanonicalAssetProjection(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const assetId = asset.id ?? null;
  const assetType = asset.assetType ?? asset.asset_type ?? null;
  const marketCode = asset.marketCode ?? asset.market_code ?? null;
  const quoteCurrency = asset.quoteCurrency ?? asset.quote_currency ?? null;
  const baseCurrency = asset.baseCurrency ?? asset.base_currency ?? null;
  const marketPolicy = asset.marketPolicy ?? asset.market_policy ?? null;
  const marketTimezone = asset.marketTimezone ?? asset.market_timezone ?? null;
  const quantityUnit = asset.quantityUnit ?? asset.quantity_unit ?? null;
  const portfolioEligibility = asset.portfolioEligibility ?? asset.portfolio_eligibility ?? null;

  return {
    ...asset,
    id: assetId,
    assetId,
    assetType,
    marketCode,
    quoteCurrency,
    baseCurrency,
    marketPolicy,
    marketTimezone,
    quantityUnit,
    portfolioEligibility
  };
}

/**
 * Normalizes a watchlist_item row from Supabase.
 */
function normalizeWatchlistItem(row) {
  if (!row) return null;
  const asset = normalizeCanonicalAssetProjection(row.assets || row.asset);
  return {
    id: row.id,
    profile_id: row.profile_id,
    asset_id: row.asset_id,
    created_at: row.created_at,
    assetId: row.asset_id,
    symbol: asset?.symbol ?? null,
    name: asset?.name ?? null,
    assetType: asset?.assetType ?? null,
    quoteCurrency: asset?.quoteCurrency ?? null,
    marketPolicy: asset?.marketPolicy ?? null,
    marketTimezone: asset?.marketTimezone ?? null,
    exchange: asset?.exchange ?? null,
    marketCode: asset?.marketCode ?? null,
    asset
  };
}

/**
 * Fetches all watchlist items for the single investor profile with joined asset metadata.
 */
export async function getWatchlist(client = privateSupabase) {
  const options = arguments[1] || {};
  let db = privateSupabase;
  let profileId = null;

  if (typeof client === 'string') {
    profileId = client;
    db = options?.client || privateSupabase;
  } else if (client && typeof client.from === 'function') {
    db = client;
    profileId = options?.profileId || null;
  } else if (client && typeof client === 'object' && client.profileId) {
    profileId = client.profileId;
    db = options?.client || client.client || privateSupabase;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('watchlist_items')
    .select(WATCHLIST_SELECT)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeWatchlistItem);
}

/**
 * Adds an asset to an investor profile's watchlist.
 * Deterministic and idempotent.
 */
export async function addToWatchlist({ profileId, asset_id, symbol }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if ((!asset_id || typeof asset_id !== 'string') && (!symbol || typeof symbol !== 'string')) {
    const err = new Error('Either asset_id or symbol is required');
    err.statusCode = 400;
    throw err;
  }

  let targetProfileId = profileId;
  if (!targetProfileId) {
    const profile = await getInvestorProfile(db);
    targetProfileId = profile.id;
  }

  // Look up asset by asset_id or symbol
  let assetQuery = db.from('assets').select(CANONICAL_ASSET_PROJECTION);
  if (asset_id && typeof asset_id === 'string' && asset_id.trim()) {
    assetQuery = assetQuery.eq('id', asset_id.trim());
  } else if (symbol && typeof symbol === 'string' && symbol.trim()) {
    assetQuery = assetQuery.eq('symbol', symbol.trim().toUpperCase());
  }

  const { data: asset, error: assetErr } = await assetQuery.maybeSingle();

  if (assetErr) {
    throw new Error(`Database query error: ${assetErr.message} (code: ${assetErr.code || 'UNKNOWN'})`);
  }

  if (!asset) {
    const notFoundErr = new Error(`Asset '${asset_id || symbol}' not found`);
    notFoundErr.statusCode = 400;
    throw notFoundErr;
  }

  // Check if already in watchlist (idempotent)
  const { data: existing, error: existingErr } = await db
    .from('watchlist_items')
    .select(WATCHLIST_SELECT)
    .eq('profile_id', targetProfileId)
    .eq('asset_id', asset.id)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Database query error: ${existingErr.message}`);
  }

  if (existing) {
    return normalizeWatchlistItem(existing);
  }

  // Insert into watchlist
  const { data, error } = await db
    .from('watchlist_items')
    .insert([
      {
        profile_id: targetProfileId,
        asset_id: asset.id
      }
    ])
    .select(WATCHLIST_SELECT)
    .single();

  if (error) {
    // Handle concurrent insertion conflict gracefully
    if (error.code === '23505') {
      const { data: refetched, error: refetchErr } = await db
        .from('watchlist_items')
        .select(WATCHLIST_SELECT)
        .eq('profile_id', targetProfileId)
        .eq('asset_id', asset.id)
        .maybeSingle();
      if (!refetchErr && refetched) {
        return normalizeWatchlistItem(refetched);
      }
    }
    throw new Error(`Database insert error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return normalizeWatchlistItem(data);
}

/**
 * Removes an asset from an investor profile's watchlist.
 * assetIdentifier can be an asset UUID, symbol, or watchlist item ID.
 * Returns deterministic sensible result even if item not in watchlist.
 */
export async function removeFromWatchlist(assetIdentifier, profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!assetIdentifier || typeof assetIdentifier !== 'string' || !assetIdentifier.trim()) {
    const err = new Error('Valid asset identifier is required');
    err.statusCode = 400;
    throw err;
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const targetId = assetIdentifier.trim();

  // 1. First check if targetId matches a watchlist_item directly by asset_id or id
  let { data: existing, error: findErr } = await db
    .from('watchlist_items')
    .select('id, profile_id, asset_id')
    .eq('profile_id', profileId)
    .or(`id.eq.${targetId},asset_id.eq.${targetId}`)
    .maybeSingle();

  // If error is invalid UUID syntax (e.g. symbol passed like 'FPT'), or not found, try lookup by symbol
  if (findErr || !existing) {
    const { data: assetBySymbol, error: symbolErr } = await db
      .from('assets')
      .select('id')
      .eq('symbol', targetId.toUpperCase())
      .maybeSingle();

    if (!symbolErr && assetBySymbol) {
      const { data: byAssetId, error: byAssetErr } = await db
        .from('watchlist_items')
        .select('id, profile_id, asset_id')
        .eq('profile_id', profileId)
        .eq('asset_id', assetBySymbol.id)
        .maybeSingle();

      if (!byAssetErr && byAssetId) {
        existing = byAssetId;
        findErr = null;
      }
    }
  }

  if (findErr && findErr.code !== '22P02') {
    throw new Error(`Database query error: ${findErr.message}`);
  }

  if (!existing) {
    return {
      removed: false,
      deleted: false,
      message: `Asset '${targetId}' was not in watchlist`
    };
  }

  const { error: deleteErr } = await db
    .from('watchlist_items')
    .delete()
    .eq('id', existing.id)
    .eq('profile_id', profileId);

  if (deleteErr) {
    throw new Error(`Database delete error: ${deleteErr.message} (code: ${deleteErr.code || 'UNKNOWN'})`);
  }

  return {
    id: existing.id,
    asset_id: existing.asset_id,
    deleted: true,
    removed: true
  };
}

/**
 * Normalizes a price alert row from Supabase.
 */
export function normalizeAlert(row) {
  if (!row) return null;
  const asset = normalizeCanonicalAssetProjection(row.assets || row.asset);
  return {
    id: row.id,
    profile_id: row.profile_id,
    asset_id: row.asset_id,
    direction: row.direction,
    target_price: typeof row.target_price === 'number' ? row.target_price : Number(row.target_price),
    status: row.status,
    last_evaluated_price: row.last_evaluated_price !== null && row.last_evaluated_price !== undefined
      ? (typeof row.last_evaluated_price === 'number' ? row.last_evaluated_price : Number(row.last_evaluated_price))
      : null,
    last_evaluated_at: row.last_evaluated_at || null,
    triggered_at: row.triggered_at || null,
    created_at: row.created_at,
    assetId: row.asset_id,
    symbol: asset?.symbol ?? null,
    assetType: asset?.assetType ?? null,
    quoteCurrency: asset?.quoteCurrency ?? null,
    marketPolicy: asset?.marketPolicy ?? null,
    marketTimezone: asset?.marketTimezone ?? null,
    exchange: asset?.exchange ?? null,
    marketCode: asset?.marketCode ?? null,
    asset: asset || undefined
  };
}

/**
 * Fetches all price alerts for the singleton investor profile.
 */
export async function getAlerts(client = privateSupabase) {
  const options = arguments[1] || {};
  let db = privateSupabase;
  let profileId = null;

  if (typeof client === 'string') {
    profileId = client;
    db = options?.client || privateSupabase;
  } else if (client && typeof client.from === 'function') {
    db = client;
    profileId = options?.profileId || null;
  } else if (client && typeof client === 'object' && client.profileId) {
    profileId = client.profileId;
    db = options?.client || client.client || privateSupabase;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('price_alerts')
    .select(ALERT_SELECT)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeAlert);
}

/**
 * Creates a new one-shot price alert for an investor profile.
 * Prevents exact duplicates deterministically (returns existing alert without error).
 */
export async function createAlert({ profileId, symbol, asset_id, direction, target_price }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const cleanDir = typeof direction === 'string' ? direction.trim().toLowerCase() : '';
  if (cleanDir !== 'above' && cleanDir !== 'below') {
    const err = new Error("direction must be 'above' or 'below'");
    err.statusCode = 400;
    throw err;
  }

  if (typeof target_price !== 'number' || !Number.isFinite(target_price) || target_price <= 0) {
    const err = new Error('target_price must be a positive finite number');
    err.statusCode = 400;
    throw err;
  }

  if ((!asset_id || typeof asset_id !== 'string') && (!symbol || typeof symbol !== 'string')) {
    const err = new Error('Either asset_id or symbol is required');
    err.statusCode = 400;
    throw err;
  }

  let targetProfileId = profileId;
  if (!targetProfileId) {
    const profile = await getInvestorProfile(db);
    targetProfileId = profile.id;
  }

  // Look up asset
  let assetQuery = db.from('assets').select(CANONICAL_ASSET_PROJECTION);
  if (asset_id && typeof asset_id === 'string' && asset_id.trim()) {
    assetQuery = assetQuery.eq('id', asset_id.trim());
  } else if (symbol && typeof symbol === 'string' && symbol.trim()) {
    assetQuery = assetQuery.eq('symbol', symbol.trim().toUpperCase());
  }

  const { data: asset, error: assetErr } = await assetQuery.maybeSingle();

  if (assetErr) {
    throw new Error(`Database query error: ${assetErr.message} (code: ${assetErr.code || 'UNKNOWN'})`);
  }

  if (!asset) {
    const notFoundErr = new Error(`Asset '${asset_id || symbol}' not found`);
    notFoundErr.statusCode = 400;
    throw notFoundErr;
  }

  // Check for exact duplicate alert: (profile_id, asset_id, direction, target_price)
  const { data: existing, error: existingErr } = await db
    .from('price_alerts')
    .select(ALERT_SELECT)
    .eq('profile_id', targetProfileId)
    .eq('asset_id', asset.id)
    .eq('direction', cleanDir)
    .eq('target_price', target_price)
    .maybeSingle();

  if (existingErr) {
    throw new Error(`Database query error: ${existingErr.message}`);
  }

  if (existing) {
    return normalizeAlert(existing);
  }

  // Insert alert
  const { data, error } = await db
    .from('price_alerts')
    .insert([
      {
        profile_id: targetProfileId,
        asset_id: asset.id,
        direction: cleanDir,
        target_price,
        status: 'active'
      }
    ])
    .select(ALERT_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: refetched } = await db
        .from('price_alerts')
        .select(ALERT_SELECT)
        .eq('profile_id', targetProfileId)
        .eq('asset_id', asset.id)
        .eq('direction', cleanDir)
        .eq('target_price', target_price)
        .maybeSingle();
      if (refetched) return normalizeAlert(refetched);
    }
    throw new Error(`Database insert error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return normalizeAlert(data);
}

/**
 * Deletes a price alert by ID scoped to an investor profile.
 */
export async function deleteAlert(alertId, profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!alertId || typeof alertId !== 'string' || !alertId.trim()) {
    const err = new Error('Valid alert ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data: existing, error: findErr } = await db
    .from('price_alerts')
    .select('id, profile_id, asset_id')
    .eq('id', alertId.trim())
    .eq('profile_id', profileId)
    .maybeSingle();

  if (findErr) {
    throw new Error(`Database query error: ${findErr.message}`);
  }

  if (!existing) {
    return {
      id: alertId.trim(),
      deleted: false,
      message: `Alert '${alertId}' not found or belongs to another profile`
    };
  }

  const { error: deleteErr } = await db
    .from('price_alerts')
    .delete()
    .eq('id', existing.id)
    .eq('profile_id', profileId);

  if (deleteErr) {
    throw new Error(`Database delete error: ${deleteErr.message} (code: ${deleteErr.code || 'UNKNOWN'})`);
  }

  return {
    id: existing.id,
    deleted: true
  };
}

/**
 * Reactivates a triggered alert back to active status.
 */
export async function reactivateAlert(alertId, profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!alertId || typeof alertId !== 'string' || !alertId.trim()) {
    const err = new Error('Valid alert ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('price_alerts')
    .update({
      status: 'active',
      triggered_at: null,
      last_evaluated_price: null,
      last_evaluated_at: null
    })
    .eq('id', alertId.trim())
    .eq('profile_id', profileId)
    .select(ALERT_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`Database update error: ${error.message}`);
  }

  if (!data) {
    const notFoundErr = new Error(`Alert '${alertId}' not found`);
    notFoundErr.statusCode = 404;
    throw notFoundErr;
  }

  return normalizeAlert(data);
}

/**
 * Conditionally persists one active-alert evaluation. The status predicate is
 * part of the production update, making a one-shot trigger safe across
 * overlapping requests and process restarts.
 */
export async function persistActiveAlertEvaluation(updated, profileId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  let values;
  if (updated?.status === 'triggered') {
    values = {
      status: 'triggered',
      triggered_at: updated.triggered_at,
      last_evaluated_price: updated.last_evaluated_price,
      last_evaluated_at: updated.last_evaluated_at
    };
  } else if (updated?.status === 'active' && updated.last_evaluated_at) {
    values = {
      last_evaluated_price: updated.last_evaluated_price,
      last_evaluated_at: updated.last_evaluated_at
    };
  } else {
    return false;
  }

  const { data, error } = await db
    .from('price_alerts')
    .update(values)
    .eq('id', updated.id)
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`Database update error: ${error.message}`);
  return Boolean(data);
}

/**
 * Evaluates active alerts against market snapshots and persists state changes.
 * When profileId is specified, scopes to that profile; otherwise evaluates all active alerts.
 */
export async function evaluateAndPersistAlerts({
  getMarketSnapshotFn = getMarketSnapshot,
  now = new Date(),
  profileId = null
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  let alertsQuery = db
    .from('price_alerts')
    .select(ALERT_SELECT)
    .order('created_at', { ascending: false });

  if (profileId) {
    alertsQuery = alertsQuery.eq('profile_id', profileId);
  }

  const { data: alertsData, error: alertsErr } = await alertsQuery;

  if (alertsErr) {
    throw new Error(`Database query error: ${alertsErr.message}`);
  }

  const allAlerts = (alertsData || []).map(normalizeAlert);
  const activeAlerts = allAlerts.filter((a) => a.status === 'active');

  if (activeAlerts.length === 0) {
    return {
      evaluatedCount: 0,
      triggeredCount: 0,
      unavailableCount: 0,
      staleCount: 0,
      alerts: allAlerts
    };
  }

  // 2. Fetch market snapshots in parallel with failure isolation
  const uniqueSymbols = [...new Set(activeAlerts.map((a) => a.asset?.symbol).filter(Boolean))];
  const marketSnapshotsMap = {};

  await Promise.allSettled(
    uniqueSymbols.map(async (sym) => {
      try {
        const snap = await getMarketSnapshotFn(sym);
        if (snap && typeof snap === 'object') {
          marketSnapshotsMap[sym] = snap;
        }
      } catch {
        marketSnapshotsMap[sym] = null;
      }
    })
  );

  // 3. Evaluate using deterministic evaluation engine
  const { evaluatedCount, unavailableCount, staleCount, updatedAlerts } = evaluateAlertsBatch(
    activeAlerts,
    marketSnapshotsMap,
    { now }
  );

  // 4. Persist state changes only while the row is still active. PostgreSQL
  // re-checks this predicate after row locking, so overlapping scheduler/manual
  // evaluations cannot claim the same one-shot trigger twice.
  // For triggers, use atomic trigger + outbox enqueue. For active/evaluated, update last evaluated.
  let persistedTriggeredCount = 0;
  for (const updated of updatedAlerts) {
    if (updated.status === 'triggered') {
      const triggerRes = await triggerPriceAlertAtomic({
        alertId: updated.id,
        profileId: updated.profile_id,
        observedPrice: updated.last_evaluated_price,
        now
      }, db);
      if (triggerRes?.triggered) persistedTriggeredCount++;
    } else {
      await persistActiveAlertEvaluation(updated, updated.profile_id, db);
    }
  }

  // 5. Re-fetch alerts to return up-to-date list
  const refreshedAlerts = await getAlerts(profileId || db, profileId ? db : undefined);

  return {
    evaluatedCount,
    triggeredCount: persistedTriggeredCount,
    unavailableCount,
    staleCount,
    alerts: refreshedAlerts
  };
}

/**
 * Normalizes a raw push_subscriptions row into canonical JavaScript object.
 */
export function normalizePushSubscription(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Normalizes a raw alert_notification_deliveries row into canonical JavaScript object.
 */
export function normalizeAlertDelivery(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    alertId: row.alert_id,
    profileId: row.profile_id,
    subscriptionId: row.subscription_id,
    triggerEventId: row.trigger_event_id,
    assetId: row.asset_id,
    direction: row.direction,
    targetPrice: row.target_price !== null && row.target_price !== undefined ? Number(row.target_price) : null,
    observedPrice: row.observed_price !== null && row.observed_price !== undefined ? Number(row.observed_price) : null,
    triggerEventAt: row.trigger_event_at,
    status: row.status,
    attemptCount: row.attempt_count !== null && row.attempt_count !== undefined ? Number(row.attempt_count) : 0,
    lastAttemptAt: row.last_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Feature 12B: Creates or upserts a device Web Push subscription for an investor profile.
 */
export async function createPushSubscription({
  profileId,
  endpoint,
  p256dh,
  auth,
  userAgent = null
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  if (!profileId || !endpoint || !p256dh || !auth) {
    throw new Error('profileId, endpoint, p256dh, and auth are required');
  }

  const { data, error } = await db
    .from('push_subscriptions')
    .upsert({
      profile_id: profileId,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' })
    .select('*')
    .single();

  if (error) throw new Error(`Database subscription upsert error: ${error.message}`);
  return normalizePushSubscription(data);
}

/**
 * Feature 12B: Fetches active push subscriptions for a profile.
 */
export async function getPushSubscriptions(profileId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  const { data, error } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Database subscription query error: ${error.message}`);
  return (data || []).map(normalizePushSubscription);
}

/**
 * Feature 12B: Deletes a push subscription (e.g. user unsubscribes or endpoint expired).
 */
export async function deletePushSubscription(subscriptionId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  const { data, error } = await db
    .from('push_subscriptions')
    .delete()
    .eq('id', subscriptionId)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`Database subscription delete error: ${error.message}`);
  return data ? normalizePushSubscription(data) : null;
}

/**
 * Feature 12C: Fetches a push subscription by its unique id.
 */
export async function getPushSubscriptionById(subscriptionId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  const { data, error } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (error) throw new Error(`Database subscription query error: ${error.message}`);
  return data ? normalizePushSubscription(data) : null;
}

/**
 * Feature 12C: Deletes a push subscription by its unique endpoint and owner profileId.
 */
export async function deletePushSubscriptionByEndpoint(endpoint, profileId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');
  if (!endpoint || !profileId) throw new Error('endpoint and profileId are required');

  const { data, error } = await db
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('profile_id', profileId)
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`Database subscription delete error: ${error.message}`);
  return data ? normalizePushSubscription(data) : null;
}

export const upsertPushSubscription = createPushSubscription;

/**
 * Feature 12B: Atomically triggers an active price alert and fans out delivery jobs
 * to all active push subscriptions for the profile.
 */
export async function triggerPriceAlertAtomic({
  alertId,
  profileId,
  observedPrice,
  now = new Date()
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  if (!alertId || !profileId || observedPrice === undefined || observedPrice === null) {
    throw new Error('alertId, profileId, and observedPrice are required');
  }

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('trigger_price_alert_atomic', {
      p_alert_id: alertId,
      p_profile_id: profileId,
      p_observed_price: observedPrice,
      p_now: nowIso
    });

    if (error) {
      throw new Error(`Database trigger error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
    }

    if (!data || typeof data !== 'object') {
      return { triggered: false, triggerEventId: null, deliveryCount: 0, alert: null };
    }

    return {
      triggered: Boolean(data.triggered),
      triggerEventId: data.trigger_event_id || null,
      deliveryCount: typeof data.delivery_count === 'number' ? data.delivery_count : 0,
      alert: data.alert ? normalizeAlert(data.alert) : null
    };
  }

  // Fallback for test environments without RPC engine
  const { data: updatedAlert, error: alertErr } = await db
    .from('price_alerts')
    .update({
      status: 'triggered',
      triggered_at: nowIso,
      last_evaluated_price: observedPrice,
      last_evaluated_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', alertId)
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .select(ALERT_SELECT)
    .maybeSingle();

  if (alertErr) throw new Error(`Database update error: ${alertErr.message}`);
  if (!updatedAlert) {
    return { triggered: false, triggerEventId: null, deliveryCount: 0, alert: null };
  }

  const triggerEventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'event-' + Date.now();
  let deliveryCount = 0;

  // Query subscriptions for fanout
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('*')
    .eq('profile_id', profileId);

  if (subs && subs.length > 0) {
    const rowsToInsert = subs.map(sub => ({
      alert_id: alertId,
      profile_id: profileId,
      subscription_id: sub.id,
      trigger_event_id: triggerEventId,
      asset_id: updatedAlert.asset_id || updatedAlert.asset?.id,
      direction: updatedAlert.direction,
      target_price: updatedAlert.target_price,
      observed_price: observedPrice,
      trigger_event_at: nowIso,
      status: 'pending',
      attempt_count: 0,
      created_at: nowIso,
      updated_at: nowIso
    }));

    const { data: inserted, error: delivErr } = await db
      .from('alert_notification_deliveries')
      .insert(rowsToInsert)
      .select('*');

    if (delivErr) throw new Error(`Database outbox insert error: ${delivErr.message}`);
    deliveryCount = (inserted || []).length;
  }

  return {
    triggered: true,
    triggerEventId,
    deliveryCount,
    alert: normalizeAlert(updatedAlert)
  };
}

/**
 * Feature 12B: Atomically claims eligible delivery jobs, advancing attempt count and granting lease.
 */
export async function claimPendingAlertDeliveries({
  batchSize = 5,
  leaseSeconds = 120,
  now = new Date()
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  const boundedBatchSize = Math.min(Math.max(Number.isFinite(Number(batchSize)) ? Math.floor(Number(batchSize)) : 5, 1), 25);
  const boundedLeaseSeconds = Math.min(Math.max(Number.isFinite(Number(leaseSeconds)) ? Math.floor(Number(leaseSeconds)) : 120, 30), 600);
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('claim_pending_alert_deliveries', {
      p_batch_size: boundedBatchSize,
      p_lease_seconds: boundedLeaseSeconds,
      p_now: nowIso
    });

    if (error) {
      throw new Error(`Database claim error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
    }

    return (data || []).map(normalizeAlertDelivery);
  }

  return [];
}

/**
 * Feature 12B: Marks a claimed delivery row as SENT.
 */
export async function markAlertDeliverySent({
  deliveryId,
  now = new Date()
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  if (!deliveryId) throw new Error('deliveryId is required');

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  const { data, error } = await db
    .from('alert_notification_deliveries')
    .update({
      status: 'sent',
      delivered_at: nowIso,
      lease_expires_at: null,
      updated_at: nowIso
    })
    .eq('id', deliveryId)
    .eq('status', 'sending')
    .select('*')
    .maybeSingle();

  if (error) throw new Error(`Database update error: ${error.message}`);
  return data ? normalizeAlertDelivery(data) : null;
}

/**
 * Feature 12B: Marks a claimed delivery row as FAILED_RETRYABLE (or FAILED_PERMANENT if attempt_count >= 3).
 */
export async function markAlertDeliveryFailedRetryable({
  deliveryId,
  error,
  nextAttemptAt,
  now = new Date()
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  if (!deliveryId) throw new Error('deliveryId is required');

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const nextAttemptIso = nextAttemptAt instanceof Date ? nextAttemptAt.toISOString() : (nextAttemptAt || null);

  const { data: current, error: readErr } = await db
    .from('alert_notification_deliveries')
    .select('id, attempt_count, status')
    .eq('id', deliveryId)
    .maybeSingle();

  if (readErr) throw new Error(`Database read error: ${readErr.message}`);
  if (!current) return null;

  const isExhausted = (current.attempt_count || 0) >= 3;
  const newStatus = isExhausted ? 'failed_permanent' : 'failed_retryable';
  const newError = isExhausted ? 'MAX_ATTEMPTS_EXHAUSTED' : (error || 'RETRYABLE_DELIVERY_FAILURE');

  const { data, error: updateErr } = await db
    .from('alert_notification_deliveries')
    .update({
      status: newStatus,
      last_error: newError,
      next_attempt_at: isExhausted ? null : nextAttemptIso,
      lease_expires_at: null,
      updated_at: nowIso
    })
    .eq('id', deliveryId)
    .eq('status', 'sending')
    .select('*')
    .maybeSingle();

  if (updateErr) throw new Error(`Database update error: ${updateErr.message}`);
  return data ? normalizeAlertDelivery(data) : null;
}

/**
 * Feature 12B: Marks a claimed delivery row as FAILED_PERMANENT.
 */
export async function markAlertDeliveryFailedPermanent({
  deliveryId,
  error,
  now = new Date()
} = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  if (!deliveryId) throw new Error('deliveryId is required');

  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  const { data, error: updateErr } = await db
    .from('alert_notification_deliveries')
    .update({
      status: 'failed_permanent',
      last_error: error || 'PERMANENT_DELIVERY_FAILURE',
      lease_expires_at: null,
      updated_at: nowIso
    })
    .eq('id', deliveryId)
    .eq('status', 'sending')
    .select('*')
    .maybeSingle();

  if (updateErr) throw new Error(`Database update error: ${updateErr.message}`);
  return data ? normalizeAlertDelivery(data) : null;
}

/**
 * Feature 12B: Queries alert notification deliveries for an alert (ordered chronologically).
 */
export async function getAlertDeliveriesByAlertId(alertId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) throw new Error('Private database access is not configured');

  const { data, error } = await db
    .from('alert_notification_deliveries')
    .select('*')
    .eq('alert_id', alertId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Database query error: ${error.message}`);
  return (data || []).map(normalizeAlertDelivery);
}

export async function getCashActivation(profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('cash_ledger_activation')
    .select('profile_id, opening_balance_amount, activated_at')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  if (!data) return null;
  return {
    profileId: data.profile_id,
    openingBalanceAmount: typeof data.opening_balance_amount === 'number'
      ? data.opening_balance_amount
      : Number(data.opening_balance_amount),
    activatedAt: data.activated_at
  };
}

/**
 * Fetches all position opening baselines for an investor profile.
 */
export async function getPositionOpeningBaselines(profileIdOrClient = privateSupabase, client = privateSupabase) {
  let db = privateSupabase;
  let profileId = null;

  if (typeof profileIdOrClient === 'string') {
    profileId = profileIdOrClient;
    db = client || privateSupabase;
  } else if (profileIdOrClient && typeof profileIdOrClient.from === 'function') {
    db = profileIdOrClient;
  }

  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!profileId) {
    const profile = await getInvestorProfile(db);
    profileId = profile.id;
  }

  const { data, error } = await db
    .from('position_opening_baselines')
    .select(`
      id,
      profile_id,
      asset_id,
      opening_quantity,
      opening_average_cost,
      execution_unit_price,
      price_currency,
      fx_rate_to_vnd,
      fx_provenance,
      fx_observed_at,
      accounting_cutoff_at,
      provenance_type,
      locked_at,
      cancelled_at,
      created_at,
      updated_at,
      assets (id, symbol, name, asset_type, exchange, quote_currency)
    `)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    assetId: row.asset_id,
    openingQuantity: typeof row.opening_quantity === 'number' ? row.opening_quantity : Number(row.opening_quantity),
    openingAverageCost: row.opening_average_cost === null || row.opening_average_cost === undefined
      ? null
      : (typeof row.opening_average_cost === 'number' ? row.opening_average_cost : Number(row.opening_average_cost)),
    executionUnitPrice: row.execution_unit_price === null
      ? null
      : (typeof row.execution_unit_price === 'number' ? row.execution_unit_price : Number(row.execution_unit_price)),
    priceCurrency: row.price_currency || null,
    nativeAverageCost: row.execution_unit_price === null
      ? null
      : (typeof row.execution_unit_price === 'number' ? row.execution_unit_price : Number(row.execution_unit_price)),
    nativeCostCurrency: row.price_currency || null,
    fxRateToVnd: row.fx_rate_to_vnd === null
      ? null
      : (typeof row.fx_rate_to_vnd === 'number' ? row.fx_rate_to_vnd : Number(row.fx_rate_to_vnd)),
    fxProvenance: row.fx_provenance || null,
    fxObservedAt: row.fx_observed_at || null,
    accountingCutoffAt: row.accounting_cutoff_at,
    provenanceType: row.provenance_type,
    lockedAt: row.locked_at || null,
    cancelledAt: row.cancelled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    asset: row.assets || null
  }));
}
