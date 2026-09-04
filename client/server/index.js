export const ALERT_EVALUATION_CADENCE_MINUTES = 15;
export const ALERT_EVALUATION_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';
export const APP_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';

export function isApiRequestPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function proxyApiRequest(request, fetchFn = fetch) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, APP_API_BASE_URL);
  return fetchFn(new Request(upstreamUrl, request));
}

function schedulerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function runScheduledAlertEvaluation(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('ALERT_SCHEDULER_NOT_CONFIGURED', 'Alert scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${ALERT_EVALUATION_API_BASE_URL}/api/internal/alerts/evaluate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      redirect: 'error',
      signal: controller.signal
    });

    if (!response.ok) {
      throw schedulerError('ALERT_SCHEDULER_HTTP_ERROR', `Alert evaluator returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status !== 'ok' || !payload.data || typeof payload.data !== 'object') {
      throw schedulerError('ALERT_SCHEDULER_MALFORMED_RESPONSE', 'Alert evaluator returned malformed data');
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScheduledContextRefresh(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('CONTEXT_SCHEDULER_NOT_CONFIGURED', 'Context scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${APP_API_BASE_URL}/api/internal/context/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      redirect: 'error',
      signal: controller.signal
    });

    if (!response.ok) {
      throw schedulerError('CONTEXT_SCHEDULER_HTTP_ERROR', `Context refresh returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status !== 'ok' || !payload.data || typeof payload.data !== 'object') {
      throw schedulerError('CONTEXT_SCHEDULER_MALFORMED_RESPONSE', 'Context refresh returned malformed data');
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiRequestPath(url.pathname)) {
      return proxyApiRequest(request);
    }

    const response = await env.ASSETS.fetch(request);

    if (
      response.status !== 404
      || request.method !== 'GET'
      || !request.headers.get('accept')?.includes('text/html')
    ) {
      return response;
    }

    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        runScheduledAlertEvaluation(env),
        runScheduledContextRefresh(env)
      ]).then(([alertResult, contextResult]) => {
        if (alertResult.status === 'rejected') {
          console.error('Scheduled alert evaluation failed', alertResult.reason?.code || 'ALERT_SCHEDULER_FAILED');
        }
        if (contextResult.status === 'rejected') {
          console.error('Scheduled context refresh failed', contextResult.reason?.code || 'CONTEXT_SCHEDULER_FAILED');
        }
        return [alertResult, contextResult];
      })
    );
  }
};
