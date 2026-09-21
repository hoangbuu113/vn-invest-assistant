export const ALERT_EVALUATION_CADENCE_MINUTES = 15;
export const ALERT_EVALUATION_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';
export const APP_API_BASE_URL = 'https://vn-invest-assistant-api.onrender.com';
export const PORTFOLIO_DAILY_VALUATION_TIMEZONE = 'Asia/Ho_Chi_Minh';

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

export function getPortfolioDailyValuationSchedule(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw schedulerError('PORTFOLIO_VALUATION_CLOCK_INVALID', 'Portfolio valuation scheduler clock is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTFOLIO_DAILY_VALUATION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    valuationDate: `${values.year}-${values.month}-${values.day}`,
    due: hour === 23 && minute >= 45
  };
}

export async function runScheduledPortfolioDailyValuation(env, options = {}) {
  const schedule = getPortfolioDailyValuationSchedule(options.now || new Date());
  if (!schedule.due) return { due: false, valuationDate: schedule.valuationDate };

  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('PORTFOLIO_VALUATION_SCHEDULER_NOT_CONFIGURED', 'Portfolio valuation scheduler secret is not configured');
  }
  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${APP_API_BASE_URL}/api/internal/portfolio/daily-valuations/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal
    });
    if (!response.ok) {
      throw schedulerError(
        'PORTFOLIO_VALUATION_SCHEDULER_HTTP_ERROR',
        `Portfolio daily valuation capture returned HTTP ${response.status}`
      );
    }
    const payload = await response.json();
    if (payload?.status !== 'ok' || !payload.data || typeof payload.data !== 'object') {
      throw schedulerError(
        'PORTFOLIO_VALUATION_SCHEDULER_MALFORMED_RESPONSE',
        'Portfolio daily valuation capture returned malformed data'
      );
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScheduledAlertEvaluation(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('ALERT_SCHEDULER_NOT_CONFIGURED', 'Alert scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
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
      redirect: 'manual',
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
  } catch (error) {
    throw error?.code
      ? error
      : schedulerError('ALERT_SCHEDULER_TRANSPORT_ERROR', 'Alert evaluator transport failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScheduledContextRefresh(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('CONTEXT_SCHEDULER_NOT_CONFIGURED', 'Context scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
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
      redirect: 'manual',
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
  } catch (error) {
    throw error?.code
      ? error
      : schedulerError('CONTEXT_SCHEDULER_TRANSPORT_ERROR', 'Context refresh transport failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScheduledNewsRefresh(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('NEWS_SCHEDULER_NOT_CONFIGURED', 'News scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${APP_API_BASE_URL}/api/internal/news/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal
    });

    if (!response.ok) {
      throw schedulerError('NEWS_SCHEDULER_HTTP_ERROR', `News refresh returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status !== 'ok' || !payload.data || typeof payload.data !== 'object') {
      throw schedulerError('NEWS_SCHEDULER_MALFORMED_RESPONSE', 'News refresh returned malformed data');
    }
    return payload.data;
  } catch (error) {
    throw error?.code
      ? error
      : schedulerError('NEWS_SCHEDULER_TRANSPORT_ERROR', 'News refresh transport failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScheduledAcquisitionFxEnrichment(env, options = {}) {
  const token = env?.ALERT_SCHEDULER_TOKEN;
  if (typeof token !== 'string' || token.length < 32) {
    throw schedulerError('ACQUISITION_FX_SCHEDULER_NOT_CONFIGURED', 'Acquisition FX scheduler secret is not configured');
  }

  const fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 5;
    const response = await fetchFn(`${APP_API_BASE_URL}/api/internal/portfolio/acquisition-fx/enrich`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit, triggerSource: 'scheduler' }),
      redirect: 'manual',
      signal: controller.signal
    });

    if (!response.ok && response.status !== 503) {
      throw schedulerError('ACQUISITION_FX_SCHEDULER_HTTP_ERROR', `Acquisition FX enrichment returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.data || typeof payload.data !== 'object') {
      throw schedulerError('ACQUISITION_FX_SCHEDULER_MALFORMED_RESPONSE', 'Acquisition FX enrichment returned malformed data');
    }
    return payload.data;
  } catch (error) {
    throw error?.code
      ? error
      : schedulerError('ACQUISITION_FX_SCHEDULER_TRANSPORT_ERROR', 'Acquisition FX enrichment transport failed');
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

  async scheduled(controller, env, ctx) {
    const scheduledNow = Number.isFinite(controller?.scheduledTime)
      ? new Date(controller.scheduledTime)
      : new Date();
    ctx.waitUntil(
      Promise.allSettled([
        runScheduledAlertEvaluation(env),
        runScheduledContextRefresh(env),
        runScheduledNewsRefresh(env),
        runScheduledPortfolioDailyValuation(env, { now: scheduledNow }),
        runScheduledAcquisitionFxEnrichment(env)
      ]).then(([alertResult, contextResult, newsResult, portfolioValuationResult, acquisitionFxResult]) => {
        if (alertResult.status === 'rejected') {
          console.error('Scheduled alert evaluation failed', alertResult.reason?.code || 'ALERT_SCHEDULER_FAILED');
        }
        if (contextResult.status === 'rejected') {
          console.error('Scheduled context refresh failed', contextResult.reason?.code || 'CONTEXT_SCHEDULER_FAILED');
        }
        if (newsResult.status === 'rejected') {
          console.error('Scheduled news refresh failed', newsResult.reason?.code || 'NEWS_SCHEDULER_FAILED');
        }
        if (portfolioValuationResult.status === 'rejected') {
          console.error(
            'Scheduled Portfolio daily valuation failed',
            portfolioValuationResult.reason?.code || 'PORTFOLIO_VALUATION_SCHEDULER_FAILED'
          );
        }
        if (acquisitionFxResult?.status === 'rejected') {
          console.error(
            'Scheduled acquisition FX enrichment failed',
            acquisitionFxResult.reason?.code || 'ACQUISITION_FX_SCHEDULER_FAILED'
          );
        }
        return [alertResult, contextResult, newsResult, portfolioValuationResult, acquisitionFxResult];
      })
    );
  }
};
