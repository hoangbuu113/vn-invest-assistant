import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const rawUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

// Sanitize URL in case trailing slashes or /rest/v1 were included
const supabaseUrl = rawUrl
  ? rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  : null;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  supabaseKey !== 'your-supabase-publishable-key' &&
  supabaseKey !== 'your-supabase-anon-key'
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

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
    .select('id, symbol, name, asset_type, exchange, created_at')
    .order('symbol', { ascending: true });

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return data || [];
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
    .select('id, symbol, name, asset_type, exchange, created_at')
    .eq('symbol', normalizedSymbol)
    .maybeSingle();

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return data;
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
export async function getInvestorProfile(client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
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
 * Updates the single investor profile in Supabase.
 */
export async function updateInvestorProfile({ cash_available, risk_tolerance, investment_horizon }, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const currentProfile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('investor_profile')
    .update({
      cash_available,
      risk_tolerance,
      investment_horizon,
      updated_at: new Date().toISOString()
    })
    .eq('id', currentProfile.id)
    .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Database update error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  return normalizeProfile(data);
}

/**
 * Normalizes a holding row from Supabase.
 */
function normalizeHolding(row) {
  if (!row) return null;
  return {
    id: row.id,
    profile_id: row.profile_id,
    asset_id: row.asset_id,
    quantity: typeof row.quantity === 'number' ? row.quantity : Number(row.quantity),
    average_cost: typeof row.average_cost === 'number' ? row.average_cost : Number(row.average_cost),
    created_at: row.created_at,
    updated_at: row.updated_at,
    asset: row.assets || null
  };
}

/**
 * Fetches all holdings for the single investor profile with joined asset information.
 */
export async function getHoldings(client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('holdings')
    .select('id, profile_id, asset_id, quantity, average_cost, created_at, updated_at, assets (id, symbol, name, asset_type, exchange)')
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
export async function addHolding({ asset_id, quantity, average_cost }, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
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
export async function updateHolding(id, { quantity, average_cost }, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
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
export async function deleteHolding(id, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
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

/**
 * Normalizes a watchlist_item row from Supabase.
 */
function normalizeWatchlistItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    profile_id: row.profile_id,
    asset_id: row.asset_id,
    created_at: row.created_at,
    asset: row.assets || null
  };
}

/**
 * Fetches all watchlist items for the single investor profile with joined asset metadata.
 */
export async function getWatchlist(client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const profile = await getInvestorProfile(db);

  const { data, error } = await db
    .from('watchlist_items')
    .select('id, profile_id, asset_id, created_at, assets (id, symbol, name, asset_type, exchange)')
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
export async function addToWatchlist({ asset_id, symbol }, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  if ((!asset_id || typeof asset_id !== 'string') && (!symbol || typeof symbol !== 'string')) {
    const err = new Error('Either asset_id or symbol is required');
    err.statusCode = 400;
    throw err;
  }

  const profile = await getInvestorProfile(db);

  // Look up asset by asset_id or symbol
  let assetQuery = db.from('assets').select('id, symbol, name, asset_type, exchange');
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
    .select('id, profile_id, asset_id, created_at, assets (id, symbol, name, asset_type, exchange)')
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
    .select('id, profile_id, asset_id, created_at, assets (id, symbol, name, asset_type, exchange)')
    .single();

  if (error) {
    // Handle concurrent insertion conflict gracefully
    if (error.code === '23505') {
      const { data: refetched, error: refetchErr } = await db
        .from('watchlist_items')
        .select('id, profile_id, asset_id, created_at, assets (id, symbol, name, asset_type, exchange)')
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
export async function removeFromWatchlist(assetIdentifier, client = supabase) {
  const db = client || supabase;
  if (!db) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
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
