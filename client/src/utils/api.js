import { getAccessToken } from './supabase.js';

export const API_BASE_URL = '';
export const AUTH_INVALID_EVENT = 'vn-invest-auth-invalid';

export const PRIVATE_API_PREFIXES = Object.freeze([
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
  '/api/alerts',
  '/api/push'
]);

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
  return path;
}

function notifyAuthInvalid() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof Event !== 'function') return;
  window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (isPrivateApiPath(path)) {
    const token = await getAccessToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: options.credentials || 'same-origin',
    headers
  });

  // 401 AUTH_INVALID triggers session cleanup and return to login
  if (isPrivateApiPath(path) && response.status === 401) {
    notifyAuthInvalid();
  }
  // Note: 403 (PROFILE_REQUIRED) is specifically NOT treated as logout!

  return response;
}
