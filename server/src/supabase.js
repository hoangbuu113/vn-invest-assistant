import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { evaluateAlertsBatch } from './alerts.js';
import { getMarketSnapshot } from './market.js';
import { normalizeAsset, normalizeProviderMapping } from './assets.js';

dotenv.config();

const rawUrl = process.env.SUPABASE_URL;
const publicSupabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  serviceRoleKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  serviceRoleKey !== 'your-supabase-service-role-key'
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
  ? createClient(supabaseUrl, serviceRoleKey, CLIENT_AUTH_OPTIONS)
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
    cash_available: typeof row.cash_available === 'number' ? row.cash_available : Number(row.cash_available),
    risk_tolerance: row.risk_tolerance,
    investment_horizon: row.investment_horizon,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Fetches the single investor profile from Supabase.
 * Reads the authoritative singleton profile row.
 */
export async function getInvestorProfile(client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const { data, error } = await db
    .from('investor_profile')
    .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  if (!data) {
    const defaultProfile = {
      singleton_key: 1,
      cash_available: 0,
      risk_tolerance: 'moderate',
      investment_horizon: 'medium'
    };

    const { data: inserted, error: insertError } = await db
      .from('investor_profile')
      .insert([defaultProfile])
      .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
      .single();

    if (insertError) {
      // If concurrent insert occurred, fetch the existing singleton row
      if (insertError.code === '23505') {
        const { data: refetched, error: refetchErr } = await db
          .from('investor_profile')
          .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
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

/**
 * Updates non-cash preferences for the single investor profile.
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

  const { risk_tolerance, investment_horizon } = input || {};

  const { data, error } = await db.rpc('update_investor_profile_preferences', {
    p_risk_tolerance: risk_tolerance,
    p_investment_horizon: investment_horizon
  });

  if (error) {
    const err = new Error(`Database update error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
    if (error.code === 'IP001') err.statusCode = 400;
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
    average_cost: typeof row.average_cost === 'number' ? row.average_cost : Number(row.average_cost),
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
          opening_average_cost: typeof openingPosition.opening_average_cost === 'number'
            ? openingPosition.opening_average_cost
            : Number(openingPosition.opening_average_cost),
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
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('holdings')
    .select(`
      id,
      profile_id,
      asset_id,
      opening_position_id,
      quantity,
      average_cost,
      created_at,
      updated_at,
      assets (id, symbol, name, asset_type, exchange, quote_currency),
      opening_position:position_opening_baselines (
        id,
        opening_quantity,
        opening_average_cost,
        accounting_cutoff_at,
        provenance_type,
        locked_at,
        cancelled_at,
        created_at,
        updated_at
      )
    `)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeHolding);
}

/**
 * Adds a new holding for the singleton investor profile.
 */
export async function addHolding({ asset_id, quantity, average_cost }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);

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
    .eq('profile_id', profile.id)
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
        profile_id: profile.id,
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
 * Updates an existing holding by ID, strictly scoped to the singleton profile.
 */
export async function updateHolding(id, { quantity, average_cost }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!id || typeof id !== 'string') {
    const err = new Error('Invalid holding ID');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('holdings')
    .update({
      quantity,
      average_cost,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('profile_id', profile.id)
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
 * Deletes a holding by ID, strictly scoped to the singleton profile.
 */
export async function deleteHolding(id, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!id || typeof id !== 'string') {
    const err = new Error('Invalid holding ID');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

  // Check if holding exists for this profile first
  const { data: existing, error: findErr } = await db
    .from('holdings')
    .select('id')
    .eq('id', id)
    .eq('profile_id', profile.id)
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
    .eq('profile_id', profile.id);

  if (error) {
    throw new Error(`Database delete error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return { id, deleted: true };
}

const CANONICAL_ASSET_PROJECTION = 'id, symbol, name, asset_type, exchange, market_code, quote_currency, base_currency, market_policy, market_timezone, quantity_unit';
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
    quantityUnit
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
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('watchlist_items')
    .select(WATCHLIST_SELECT)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeWatchlistItem);
}

/**
 * Adds an asset to the singleton investor profile's watchlist.
 * Deterministic and idempotent.
 */
export async function addToWatchlist({ asset_id, symbol }, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if ((!asset_id || typeof asset_id !== 'string') && (!symbol || typeof symbol !== 'string')) {
    const err = new Error('Either asset_id or symbol is required');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

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
    .eq('profile_id', profile.id)
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
        profile_id: profile.id,
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
        .eq('profile_id', profile.id)
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
 * Removes an asset from the singleton investor profile's watchlist.
 * assetIdentifier can be an asset UUID, symbol, or watchlist item ID.
 * Returns deterministic sensible result even if item not in watchlist.
 */
export async function removeFromWatchlist(assetIdentifier, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!assetIdentifier || typeof assetIdentifier !== 'string' || !assetIdentifier.trim()) {
    const err = new Error('Valid asset identifier is required');
    err.statusCode = 400;
    throw err;
  }

  const targetId = assetIdentifier.trim();
  const profile = await getInvestorProfile(db);

  // 1. First check if targetId matches a watchlist_item directly by asset_id or id
  let { data: existing, error: findErr } = await db
    .from('watchlist_items')
    .select('id, profile_id, asset_id')
    .eq('profile_id', profile.id)
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
        .eq('profile_id', profile.id)
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
    .eq('profile_id', profile.id);

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
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('price_alerts')
    .select(ALERT_SELECT)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map(normalizeAlert);
}

/**
 * Creates a new one-shot price alert for the singleton investor profile.
 * Prevents exact duplicates deterministically (returns existing alert without error).
 */
export async function createAlert({ symbol, asset_id, direction, target_price }, client = privateSupabase) {
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

  const profile = await getInvestorProfile(db);

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
    .eq('profile_id', profile.id)
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
        profile_id: profile.id,
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
        .eq('profile_id', profile.id)
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
 * Deletes a price alert by ID scoped to the singleton investor profile.
 */
export async function deleteAlert(alertId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!alertId || typeof alertId !== 'string' || !alertId.trim()) {
    const err = new Error('Valid alert ID is required');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

  const { data: existing, error: findErr } = await db
    .from('price_alerts')
    .select('id, profile_id, asset_id')
    .eq('id', alertId.trim())
    .eq('profile_id', profile.id)
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
    .eq('profile_id', profile.id);

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
export async function reactivateAlert(alertId, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  if (!alertId || typeof alertId !== 'string' || !alertId.trim()) {
    const err = new Error('Valid alert ID is required');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('price_alerts')
    .update({
      status: 'active',
      triggered_at: null,
      last_evaluated_price: null,
      last_evaluated_at: null
    })
    .eq('id', alertId.trim())
    .eq('profile_id', profile.id)
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
 * Evaluates all active alerts for the singleton profile against market snapshots and persists any state changes.
 */
export async function evaluateAndPersistAlerts({ getMarketSnapshotFn = getMarketSnapshot, now = new Date() } = {}, client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);

  // 1. Fetch all alerts for singleton profile
  const { data: alertsData, error: alertsErr } = await db
    .from('price_alerts')
    .select(ALERT_SELECT)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false });

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
  const { evaluatedCount, triggeredCount, unavailableCount, updatedAlerts } = evaluateAlertsBatch(
    activeAlerts,
    marketSnapshotsMap,
    { now }
  );

  // 4. Persist any state changes for evaluated or triggered alerts
  for (const updated of updatedAlerts) {
    if (updated.status === 'triggered') {
      await db
        .from('price_alerts')
        .update({
          status: 'triggered',
          triggered_at: updated.triggered_at,
          last_evaluated_price: updated.last_evaluated_price,
          last_evaluated_at: updated.last_evaluated_at
        })
        .eq('id', updated.id)
        .eq('profile_id', profile.id);
    } else if (updated.last_evaluated_at) {
      await db
        .from('price_alerts')
        .update({
          last_evaluated_price: updated.last_evaluated_price,
          last_evaluated_at: updated.last_evaluated_at
        })
        .eq('id', updated.id)
        .eq('profile_id', profile.id);
    }
  }

  // 5. Re-fetch all alerts to return up-to-date list
  const refreshedAlerts = await getAlerts(db);

  return {
    evaluatedCount,
    triggeredCount,
    unavailableCount,
    alerts: refreshedAlerts
  };
}

/**
 * Fetches the cash ledger activation record for the singleton profile.
 */
export async function getCashActivation(client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);
  const { data, error } = await db
    .from('cash_ledger_activation')
    .select('profile_id, opening_balance_amount, activated_at')
    .eq('profile_id', profile.id)
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
 * Fetches all position opening baselines for the singleton profile.
 */
export async function getPositionOpeningBaselines(client = privateSupabase) {
  const db = client || privateSupabase;
  if (!db) {
    throw new Error('Private database access is not configured');
  }

  const profile = await getInvestorProfile(db);
  const { data, error } = await db
    .from('position_opening_baselines')
    .select(`
      id,
      profile_id,
      asset_id,
      opening_quantity,
      opening_average_cost,
      accounting_cutoff_at,
      provenance_type,
      locked_at,
      cancelled_at,
      created_at,
      updated_at,
      assets (id, symbol, name, asset_type, exchange, quote_currency)
    `)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    assetId: row.asset_id,
    openingQuantity: typeof row.opening_quantity === 'number' ? row.opening_quantity : Number(row.opening_quantity),
    openingAverageCost: typeof row.opening_average_cost === 'number' ? row.opening_average_cost : Number(row.opening_average_cost),
    accountingCutoffAt: row.accounting_cutoff_at,
    provenanceType: row.provenance_type,
    lockedAt: row.locked_at || null,
    cancelledAt: row.cancelled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    asset: row.assets || null
  }));
}
