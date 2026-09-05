import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || 'placeholder-publishable-key';

export const isSupabaseConfigured = Boolean(
  import.meta.env?.VITE_SUPABASE_URL &&
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY &&
  import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder.supabase.co'
);

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let activeAccessToken = null;

if (supabase?.auth) {
  supabase.auth.getSession().then(({ data }) => {
    activeAccessToken = data?.session?.access_token || null;
  }).catch(() => {
    activeAccessToken = null;
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    activeAccessToken = session?.access_token || null;
  });
}

/**
 * Returns the current Supabase session access token for Bearer authentication.
 * @returns {Promise<string|null>}
 */
export async function getAccessToken() {
  if (activeAccessToken) {
    return activeAccessToken;
  }
  try {
    const { data } = await supabase.auth.getSession();
    activeAccessToken = data?.session?.access_token || null;
    return activeAccessToken;
  } catch {
    return null;
  }
}

/**
 * Explicitly clears cached token reference on logout.
 */
export function clearCachedAccessToken() {
  activeAccessToken = null;
}

/**
 * Explicitly sets or updates the cached token reference immediately upon login/session receipt.
 * @param {string|null} token
 */
export function setActiveAccessToken(token) {
  activeAccessToken = typeof token === 'string' && token.trim() ? token.trim() : null;
}
