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
export async function getAssets() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const { data, error } = await supabase
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
export async function getAssetBySymbol(symbol) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  if (!symbol || typeof symbol !== 'string') {
    return null;
  }

  const normalizedSymbol = symbol.trim().toUpperCase();

  const { data, error } = await supabase
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
 * If no profile row exists, seeds and returns a default profile.
 */
export async function getInvestorProfile() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const { data, error } = await supabase
    .from('investor_profile')
    .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Database query error: ${error.message} (code: ${error.code || 'UNKNOWN'})`);
  }

  if (!data || data.length === 0) {
    const defaultProfile = {
      cash_available: 0,
      risk_tolerance: 'moderate',
      investment_horizon: 'medium'
    };

    const { data: inserted, error: insertError } = await supabase
      .from('investor_profile')
      .insert([defaultProfile])
      .select('id, cash_available, risk_tolerance, investment_horizon, created_at, updated_at')
      .single();

    if (insertError) {
      throw new Error(`Failed to initialize default investor profile: ${insertError.message}`);
    }

    return normalizeProfile(inserted);
  }

  return normalizeProfile(data[0]);
}

/**
 * Updates the single investor profile in Supabase.
 */
export async function updateInvestorProfile({ cash_available, risk_tolerance, investment_horizon }) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }

  const currentProfile = await getInvestorProfile();

  const { data, error } = await supabase
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

