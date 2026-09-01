export const ALERT_EVALUATION_CADENCE_MINUTES = 15;
export const ALERT_EVALUATION_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';

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

export default {
  async fetch(request, env) {
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
      runScheduledAlertEvaluation(env).catch((error) => {
        console.error('Scheduled alert evaluation failed', error?.code || 'ALERT_SCHEDULER_FAILED');
      })
    );
  }
};
