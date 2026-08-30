const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';

const PRODUCTION_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';

const resolvedApiBaseUrl =
  configuredApiBaseUrl ||
  (import.meta.env.PROD ? PRODUCTION_API_BASE_URL : '');

export const API_BASE_URL = resolvedApiBaseUrl.replace(/\/+$/, '');

export function apiUrl(path) {
  if (typeof path !== 'string') return path;
  if (!path.startsWith('/api')) return path;
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options);
}
