const configuredApiBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim() || '';

const PRODUCTION_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';

const resolvedApiBaseUrl =
  configuredApiBaseUrl ||
  (import.meta.env?.PROD ? PRODUCTION_API_BASE_URL : '');

export const API_BASE_URL = resolvedApiBaseUrl.replace(/\/+$/, '');

export const OWNER_TOKEN_SESSION_KEY = 'vn-invest-owner-access-token';

export const PRIVATE_API_PREFIXES = Object.freeze([
  '/api/owner',
  '/api/profile',
  '/api/holdings',
  '/api/positions',
  '/api/transactions',
  '/api/cash',
  '/api/news/personalized',
  '/api/opportunities',
  '/api/investment-brief',
  '/api/portfolio',
  '/api/watchlist',
  '/api/alerts'
]);

let ownerAccessToken = null;

function sessionStore() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function getOwnerAccessToken() {
  if (ownerAccessToken) return ownerAccessToken;
  const stored = sessionStore()?.getItem(OWNER_TOKEN_SESSION_KEY);
  ownerAccessToken = typeof stored === 'string' && stored ? stored : null;
  return ownerAccessToken;
}

export function setOwnerAccessToken(token) {
  if (typeof token !== 'string' || !token) {
    throw new TypeError('Owner access token must be a non-empty string');
  }
  ownerAccessToken = token;
  sessionStore()?.setItem(OWNER_TOKEN_SESSION_KEY, token);
}

export function clearOwnerAccessToken() {
  ownerAccessToken = null;
  sessionStore()?.removeItem(OWNER_TOKEN_SESSION_KEY);
}

export function isPrivateApiPath(path) {
  if (typeof path !== 'string') return false;
  let pathname = path;
  try {
    pathname = new URL(path, 'http://local.invalid').pathname;
  } catch {
    pathname = path.split('?')[0];
  }
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return PRIVATE_API_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );
}

export function apiUrl(path) {
  if (typeof path !== 'string') return path;
  if (!path.startsWith('/api')) return path;
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.delete('Authorization');

  if (isPrivateApiPath(path)) {
    const token = getOwnerAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(apiUrl(path), {
    ...options,
    headers
  });
}
