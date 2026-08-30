const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '');

export function apiUrl(path) {
  if (typeof path !== 'string') return path;
  if (!path.startsWith('/api')) return path;
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options);
}
