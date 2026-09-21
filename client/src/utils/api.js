import { getAccessToken } from './supabase.js';

export const API_BASE_URL = '';
export const AUTH_INVALID_EVENT = 'vn-invest-auth-invalid';

export const PRIVATE_API_PREFIXES = Object.freeze([
  '/api/profile',
  '/api/holdings',
  '/api/positions',
  '/api/transactions',
  '/api/accounting-rate',
  '/api/cash',
  '/api/news/personalized',
  '/api/opportunities',
  '/api/investment-brief',
  '/api/market-strategist',
  '/api/portfolio',
  '/api/watchlist',
  '/api/alerts',
  '/api/push'
]);

export function isPrivateApiPath(path, method = 'POST') {
  if (typeof path !== 'string') return false;
  let pathname = path;
  try {
    pathname = new URL(path, 'http://local.invalid').pathname;
  } catch {
    pathname = path.split('?')[0];
  }
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api/market-strategist' && typeof method === 'string' && method.toUpperCase() === 'GET') {
    return false;
  }
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

/**
 * Parses Retry-After header value into milliseconds.
 * Supports integer seconds and HTTP-date formats.
 * Returns null if missing or invalid.
 */
export function parseRetryAfterMs(headerValue) {
  if (headerValue === null || headerValue === undefined) return null;
  const trimmed = String(headerValue).trim();
  if (!trimmed) return null;

  // Check if it's a numeric seconds value
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
    return null;
  }

  // Check if it's an HTTP-date format (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = signal.reason || (typeof DOMException !== 'undefined' ? new DOMException('The user aborted a request.', 'AbortError') : new Error('The user aborted a request.'));
      return reject(err);
    }
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timeout);
        const err = signal.reason || (typeof DOMException !== 'undefined' ? new DOMException('The user aborted a request.', 'AbortError') : new Error('The user aborted a request.'));
        reject(err);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// In-flight deduplication map for idempotent GET requests: key -> { waiters: [] }
const inFlightGetRequests = new Map();

export function clearInFlightRequests() {
  inFlightGetRequests.clear();
}

/**
 * Executes a single fetch attempt or bounded retries on 429/503/transient network errors.
 */
async function executeWithRetry(url, fetchOptions, retryConfig, isPrivate, onRetry) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    jitterRatio = 0.15,
    retryOn = [429, 503]
  } = retryConfig;

  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    let response = null;
    let networkError = null;

    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      networkError = err;
    }

    // Check for explicit caller abort
    if (fetchOptions.signal?.aborted) {
      if (networkError) throw networkError;
      const abortErr = fetchOptions.signal.reason || (typeof DOMException !== 'undefined' ? new DOMException('The user aborted a request.', 'AbortError') : new Error('The user aborted a request.'));
      throw abortErr;
    }

    // If network error occurred:
    if (networkError) {
      if (attempt < maxAttempts) {
        const rawDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        const jitter = rawDelay * jitterRatio * (Math.random() * 2 - 1);
        const delayMs = Math.min(maxDelayMs, Math.max(100, Math.round(rawDelay + jitter)));

        if (typeof onRetry === 'function') {
          onRetry({
            attempt,
            maxAttempts,
            delayMs,
            status: null,
            error: networkError
          });
        }

        await sleep(delayMs, fetchOptions.signal);
        continue;
      }
      throw networkError;
    }

    // Check if status requires retry
    const shouldRetry = retryOn.includes(response.status);
    if (shouldRetry && attempt < maxAttempts) {
      let delayMs;
      const retryAfterHeader = response.headers?.get?.('Retry-After');
      const retryAfterMs = parseRetryAfterMs(retryAfterHeader);

      if (retryAfterMs !== null) {
        delayMs = Math.min(maxDelayMs, Math.max(100, retryAfterMs));
      } else {
        const rawDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        const jitter = rawDelay * jitterRatio * (Math.random() * 2 - 1);
        delayMs = Math.min(maxDelayMs, Math.max(100, Math.round(rawDelay + jitter)));
      }

      if (typeof onRetry === 'function') {
        onRetry({
          attempt,
          maxAttempts,
          delayMs,
          status: response.status,
          error: null
        });
      }

      await sleep(delayMs, fetchOptions.signal);
      continue;
    }

    // Non-retryable status or retries exhausted
    if (isPrivate && response.status === 401) {
      notifyAuthInvalid();
    }

    return response;
  }
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = options.method || 'GET';
  const method = (options.method || 'GET').toUpperCase();
  const isPrivate = isPrivateApiPath(path, method);

  if (isPrivateApiPath(path, method)) {
    const token = await getAccessToken();
  let token = null;
  if (isPrivate) {
    token = await getAccessToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(apiUrl(path), {
  // Deduplication check: only for safe GET requests without explicit opt-out
  const canDedupe = method === 'GET' && !options.body && options.dedupe !== false && options.skipDedupe !== true;
  const fullUrl = apiUrl(path);
  const dedupeKey = canDedupe ? `${token || 'anon'}:${fullUrl}` : null;

  if (canDedupe && inFlightGetRequests.has(dedupeKey)) {
    const entry = inFlightGetRequests.get(dedupeKey);
    if (options.signal?.aborted) {
      const err = options.signal.reason || (typeof DOMException !== 'undefined' ? new DOMException('The user aborted a request.', 'AbortError') : new Error('The user aborted a request.'));
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal: options.signal };

      if (options.signal) {
        const onAbort = () => {
          const idx = entry.waiters.indexOf(waiter);
          if (idx !== -1) entry.waiters.splice(idx, 1);
          const err = options.signal.reason || (typeof DOMException !== 'undefined' ? new DOMException('The user aborted a request.', 'AbortError') : new Error('The user aborted a request.'));
          reject(err);
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => options.signal.removeEventListener('abort', onAbort);
      }

      entry.waiters.push(waiter);
    });
  }

  // Retry configuration:
  // Enabled by default for GET requests; disabled for mutations unless explicitly requested in options.retry
  let retryConfig = { maxAttempts: 1 };
  if (options.retry !== false) {
    if (method === 'GET' || typeof options.retry === 'object') {
      retryConfig = {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterRatio: 0.15,
        retryOn: [429, 503],
        ...(typeof options.retry === 'object' ? options.retry : {})
      };
    }
  }

  const fetchOptions = {
    ...options,
    method,
    credentials: options.credentials || 'same-origin',
    headers
  });
  };

  // 401 AUTH_INVALID triggers session cleanup and return to login
  if (isPrivateApiPath(path) && response.status === 401) {
    notifyAuthInvalid();
  if (canDedupe) {
    const entry = { waiters: [] };
    inFlightGetRequests.set(dedupeKey, entry);

    try {
      const response = await executeWithRetry(fullUrl, fetchOptions, retryConfig, isPrivate, options.onRetry);

      // Distribute cloned responses to in-flight waiters
      for (const waiter of entry.waiters) {
        if (waiter.cleanup) waiter.cleanup();
        try {
          waiter.resolve(response.clone());
        } catch {
          waiter.resolve(response);
        }
      }
      return response;
    } catch (err) {
      for (const waiter of entry.waiters) {
        if (waiter.cleanup) waiter.cleanup();
        waiter.reject(err);
      }
      throw err;
    } finally {
      inFlightGetRequests.delete(dedupeKey);
    }
  }
  // Note: 403 (PROFILE_REQUIRED) is specifically NOT treated as logout!

  return response;
  // Non-deduplicated requests (e.g. POST, PUT, DELETE, or explicit opt-out)
  return executeWithRetry(fullUrl, fetchOptions, retryConfig, isPrivate, options.onRetry);
}
