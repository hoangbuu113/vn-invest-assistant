export const API_BASE_URL = '';
export const OWNER_SESSION_INVALID_EVENT = 'vn-invest-owner-session-invalid';

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

function notifyInvalidOwnerSession() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof Event !== 'function') return;
  window.dispatchEvent(new Event(OWNER_SESSION_INVALID_EVENT));
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.delete('Authorization');

  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: options.credentials || 'same-origin',
    headers
  });

  if (isPrivateApiPath(path) && (response.status === 401 || response.status === 403)) {
    notifyInvalidOwnerSession();
  }
  return response;
}
