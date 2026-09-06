/**
 * Observability & Data Health Module (V1.3 — 01E)
 *
 * Implements deterministic operational observability for core market intelligence pipelines:
 * - Deterministic Health States: HEALTHY, DEGRADED, FAILED, UNKNOWN
 * - Minimum 7 Observed Pipelines: VN market context, official macro/monetary, customs trade,
 *   news refresh, claims reconciliation, market strategist, and alert scheduler
 * - Structured metadata: jobName, lastAttemptAt, lastSuccessAt, durationMs, status,
 *   errorCode, errorCategory, recordsRead, recordsWritten, dataAsOf, policyVersion
 * - Never fabricates freshness: missing timestamps strictly evaluate to UNKNOWN
 * - Decoupled from market facts: pipeline failure != negative market regime
 * - Zero secrets, tokens, stack traces, or DB credentials exposed
 * - Durable persistence across container restarts via public.market_context_collector_checkpoints
 * - In production: DB failure must NOT silently fall back to memory
 */

import { privateSupabase } from '../supabase.js';

export const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN'
});

export const VALID_HEALTH_STATES = Object.freeze(Object.values(HEALTH_STATES));

export const OBSERVED_JOBS = Object.freeze({
  VN_MARKET_CONTEXT_COLLECTOR: 'vn_market_context_collector',
  OFFICIAL_MACRO_MONETARY_COLLECTOR: 'official_macro_monetary_collector',
  CUSTOMS_TRADE_COLLECTOR: 'customs_trade_collector',
  NEWS_REFRESH_COLLECTOR: 'news_refresh_collector',
  CLAIMS_RECONCILIATION: 'claims_reconciliation',
  MARKET_STRATEGIST_REFRESH: 'market_strategist_refresh',
  ALERT_SCHEDULER: 'alert_scheduler',
  VN_EQUITY_EVIDENCE_REFRESH: 'vn_equity_evidence_refresh',
  VN_OPPORTUNITY_ENGINE_REFRESH: 'vn_opportunity_engine_refresh'
});

export const ALL_OBSERVED_JOBS = Object.freeze(Object.values(OBSERVED_JOBS));

export const ERROR_CATEGORIES = Object.freeze({
  NETWORK: 'NETWORK',
  UPSTREAM_PROVIDER: 'UPSTREAM_PROVIDER',
  DATABASE: 'DATABASE',
  VALIDATION: 'VALIDATION',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL'
});

// In-memory fallback store for unit tests and intentional offline mode
const memoryJobHealth = new Map();
let testClientOverride = undefined;

export function setTestDataHealthClientOverride(client) {
  testClientOverride = client;
}

export function clearDataHealthMemoryStore() {
  memoryJobHealth.clear();
  testClientOverride = undefined;
}

function isTestEnvironment() {
  if (process.env.NODE_ENV === 'production') return false;
  return (
    process.env.NODE_ENV === 'test' ||
    process.execArgv.some((a) => typeof a === 'string' && a.includes('--test')) ||
    process.argv.some((a) => typeof a === 'string' && (a.includes('test') || a.includes('mocha')))
  );
}

function getActiveSupabaseClient() {
  if (testClientOverride !== undefined) {
    return testClientOverride;
  }
  return privateSupabase;
}

/**
 * Strips sensitive keys (tokens, secrets, passwords, connection strings, stack traces).
 */
export function sanitizeOperationalMetadata(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};
  const sanitized = {};
  const sensitivePatterns = [
    'token', 'secret', 'key', 'password', 'auth', 'credential',
    'stack', 'cookie', 'bearer', 'authorization'
  ];

  for (const [k, v] of Object.entries(meta)) {
    const lk = k.toLowerCase();
    const isSensitive = sensitivePatterns.some((pattern) => lk.includes(pattern));
    if (isSensitive) continue;

    if (typeof v === 'string') {
      // Strip potential URL user credentials e.g. postgres://user:pass@host
      sanitized[k] = v.replace(/:\/\/[^/@]+:[^/@]+@/g, '://***:***@');
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      sanitized[k] = sanitizeOperationalMetadata(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * Normalizes an Error or exception into sanitized errorCode and errorCategory.
 */
export function normalizeJobError(error) {
  if (!error) return { errorCode: null, errorCategory: null };

  let code = error.code || error.errorCode || null;
  let message = typeof error === 'string' ? error : (error.message || String(error));
  let category = ERROR_CATEGORIES.INTERNAL;

  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes('timeout') || lowerMsg.includes('etimedout') || lowerMsg.includes('abort')) {
    code = code || 'TIMEOUT';
    category = ERROR_CATEGORIES.TIMEOUT;
  } else if (lowerMsg.includes('network') || lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
    code = code || 'NETWORK_ERROR';
    category = ERROR_CATEGORIES.NETWORK;
  } else if (lowerMsg.includes('access denied') || lowerMsg.includes('forbidden') || lowerMsg.includes('403') || lowerMsg.includes('request rejected') || lowerMsg.includes('waf')) {
    code = code || 'PROVIDER_ACCESS_DENIED';
    category = ERROR_CATEGORIES.UPSTREAM_PROVIDER;
  } else if (lowerMsg.includes('database') || lowerMsg.includes('supabase') || lowerMsg.includes('postgres') || code?.startsWith('PGRST') || code?.startsWith('23')) {
    code = code || 'DATABASE_ERROR';
    category = ERROR_CATEGORIES.DATABASE;
  } else if (lowerMsg.includes('validation') || lowerMsg.includes('invalid') || lowerMsg.includes('unsupported')) {
    code = code || 'VALIDATION_ERROR';
    category = ERROR_CATEGORIES.VALIDATION;
  } else {
    code = code || 'INTERNAL_ERROR';
    category = ERROR_CATEGORIES.INTERNAL;
  }

  return { errorCode: String(code), errorCategory: category };
}

/**
 * Durably records health and operational metrics for an observed job.
 */
export async function recordJobHealth({
  jobName,
  status = HEALTH_STATES.HEALTHY,
  durationMs = null,
  recordsRead = 0,
  recordsWritten = 0,
  dataAsOf = null,
  policyVersion = null,
  errorCode = null,
  errorCategory = null,
  error = null,
  metadata = {},
  client = undefined,
  now = new Date()
} = {}) {
  if (!jobName || typeof jobName !== 'string') {
    throw new TypeError('recordJobHealth: jobName must be a non-empty string');
  }

  if (!VALID_HEALTH_STATES.includes(status)) {
    throw new TypeError(`recordJobHealth: invalid status "${status}". Allowed: ${VALID_HEALTH_STATES.join(', ')}`);
  }

  const nowIso = now.toISOString();

  // Determine error info
  let resolvedCode = errorCode;
  let resolvedCategory = errorCategory;
  if (error) {
    const norm = normalizeJobError(error);
    resolvedCode = resolvedCode || norm.errorCode;
    resolvedCategory = resolvedCategory || norm.errorCategory;
  }

  // Sanitize any extra metadata
  const sanitizedMeta = sanitizeOperationalMetadata(metadata);

  const isMemoryMode = client === null
    || (client === undefined && isTestEnvironment() && !testClientOverride);

  // Process memory is authoritative only in explicit offline/test mode. A
  // DB-backed write must never derive durable state from a memory checkpoint.
  const previousMemoryHealth = isMemoryMode
    ? (memoryJobHealth.get(jobName) || {})
    : {};
  const resolvedLastSuccessAt = status === HEALTH_STATES.HEALTHY
    ? nowIso
    : (previousMemoryHealth.lastSuccessAt || null);

  const structuredHealth = {
    jobName,
    status,
    lastAttemptAt: nowIso,
    lastSuccessAt: resolvedLastSuccessAt,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    errorCode: resolvedCode || null,
    errorCategory: resolvedCategory || null,
    recordsRead: Number.isInteger(recordsRead) ? Math.max(0, recordsRead) : 0,
    recordsWritten: Number.isInteger(recordsWritten) ? Math.max(0, recordsWritten) : 0,
    dataAsOf: dataAsOf || null,
    policyVersion: policyVersion || null,
    metadata: sanitizedMeta,
    updatedAt: nowIso
  };

  // Explicit offline/test mode is the only path where memory is authoritative.
  if (isMemoryMode) {
    memoryJobHealth.set(jobName, structuredHealth);
    return { isDurable: false, health: structuredHealth };
  }

  const activeClient = client !== undefined ? client : getActiveSupabaseClient();

  if (!activeClient) {
    throw new Error(
      'DATA_HEALTH_CLIENT_UNCONFIGURED: Supabase client is unconfigured or unavailable in production. Durable health recording cannot proceed.'
    );
  }

  // DB status mapping according to CHECK (status IN ('idle', 'in_progress', 'success', 'failed', 'quarantined', 'blocked/access_denied'))
  let dbStatus = 'success';
  if (status === HEALTH_STATES.FAILED) {
    dbStatus = 'failed';
  } else if (status === HEALTH_STATES.DEGRADED) {
    dbStatus = (resolvedCategory === ERROR_CATEGORIES.UPSTREAM_PROVIDER && resolvedCode === 'PROVIDER_ACCESS_DENIED')
      ? 'blocked/access_denied'
      : 'quarantined';
  } else if (status === HEALTH_STATES.UNKNOWN) {
    dbStatus = 'idle';
  }

  const dbRow = {
    source_key: jobName,
    last_attempted_at: nowIso,
    ...(resolvedLastSuccessAt ? { last_success_at: resolvedLastSuccessAt } : {}),
    status: dbStatus,
    metadata: {
      healthState: status,
      durationMs: structuredHealth.durationMs,
      recordsRead: structuredHealth.recordsRead,
      recordsWritten: structuredHealth.recordsWritten,
      dataAsOf: structuredHealth.dataAsOf,
      policyVersion: structuredHealth.policyVersion,
      errorCode: structuredHealth.errorCode,
      errorCategory: structuredHealth.errorCategory,
      ...sanitizedMeta
    },
    updated_at: nowIso
  };

  try {
    const { data, error: dbErr } = await activeClient
      .from('market_context_collector_checkpoints')
      .upsert(dbRow, { onConflict: 'source_key' })
      .select();

    if (dbErr) {
      if (!isTestEnvironment()) {
        const err = new Error(`DATA_HEALTH_PERSISTENCE_FAILED: ${dbErr.message}`);
        err.cause = dbErr;
        throw err;
      }
      return { isDurable: false, error: dbErr, health: structuredHealth };
    }

    const savedRow = data?.[0] || dbRow;
    const durableHealth = {
      ...structuredHealth,
      lastSuccessAt: savedRow.last_success_at || (status === HEALTH_STATES.HEALTHY ? nowIso : null)
    };

    // DB-backed paths cross the trust boundary only after durable persistence.
    // Memory may mirror the durable checkpoint, but can never precede it.
    memoryJobHealth.set(jobName, durableHealth);

    return {
      isDurable: true,
      health: durableHealth
    };
  } catch (err) {
    if (!isTestEnvironment()) {
      throw err;
    }
    return { isDurable: false, error: err, health: structuredHealth };
  }
}

/**
 * Maps a database checkpoint row to a structured operational telemetry object.
 * Strictly adheres to: Missing timestamp -> UNKNOWN. Never fabricate freshness!
 */
export function rowToJobHealth(row, jobName) {
  if (!row || typeof row !== 'object') {
    return {
      jobName,
      status: HEALTH_STATES.UNKNOWN,
      lastAttemptAt: null,
      lastSuccessAt: null,
      durationMs: null,
      errorCode: null,
      errorCategory: null,
      recordsRead: 0,
      recordsWritten: 0,
      dataAsOf: null,
      policyVersion: null
    };
  }

  const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
  const lastAttemptAt = row.last_attempted_at || null;
  const lastSuccessAt = row.last_success_at || null;

  // Never fabricate freshness: missing last_attempted_at -> UNKNOWN
  let status = HEALTH_STATES.UNKNOWN;
  if (lastAttemptAt) {
    if (meta.healthState && VALID_HEALTH_STATES.includes(meta.healthState)) {
      status = meta.healthState;
    } else {
      // Deterministic fallback based on DB status constraint
      if (row.status === 'success') {
        status = HEALTH_STATES.HEALTHY;
      } else if (row.status === 'quarantined' || row.status === 'blocked/access_denied') {
        status = HEALTH_STATES.DEGRADED;
      } else if (row.status === 'failed') {
        status = HEALTH_STATES.FAILED;
      } else {
        status = HEALTH_STATES.UNKNOWN;
      }
    }
  }

  return {
    jobName: row.source_key || jobName,
    status,
    lastAttemptAt,
    lastSuccessAt,
    durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : null,
    errorCode: meta.errorCode || null,
    errorCategory: meta.errorCategory || null,
    recordsRead: Number.isInteger(meta.recordsRead) ? meta.recordsRead : 0,
    recordsWritten: Number.isInteger(meta.recordsWritten) ? meta.recordsWritten : 0,
    dataAsOf: meta.dataAsOf || null,
    policyVersion: meta.policyVersion || null
  };
}

/**
 * Pure, provider-free query to retrieve operational health for all observed jobs.
 * Safe public operational metadata only. Zero secrets, tokens, passwords, or stack traces.
 */
export async function getSystemDataHealth({
  client = undefined,
  now = new Date()
} = {}) {
  const activeClient = client !== undefined ? client : getActiveSupabaseClient();
  const isMemoryMode = client === null || (client === undefined && isTestEnvironment() && !testClientOverride);

  let rowsByJob = new Map();

  if (!isMemoryMode) {
    if (!activeClient) {
      if (!isTestEnvironment()) {
        throw new Error('DATA_HEALTH_CLIENT_UNCONFIGURED: Supabase client is unconfigured in production.');
      }
    } else {
      try {
        const { data, error } = await activeClient
          .from('market_context_collector_checkpoints')
          .select('source_key, last_attempted_at, last_success_at, status, metadata, updated_at');

        if (error) {
          if (!isTestEnvironment()) {
            const err = new Error(`DATA_HEALTH_QUERY_FAILED: ${error.message}`);
            err.cause = error;
            throw err;
          }
        } else if (Array.isArray(data)) {
          for (const row of data) {
            if (row && row.source_key) {
              rowsByJob.set(row.source_key, row);
            }
          }
        }
      } catch (err) {
        if (!isTestEnvironment()) {
          throw err;
        }
      }
    }
  }

  // Construct job telemetry for each observed job
  const jobs = ALL_OBSERVED_JOBS.map((jobName) => {
    // DB-backed reads treat the durable store as authoritative. A missing row
    // means UNKNOWN; process memory is consulted only in explicit offline mode.
    if (rowsByJob.has(jobName)) {
      return rowToJobHealth(rowsByJob.get(jobName), jobName);
    }
    if (isMemoryMode && memoryJobHealth.has(jobName)) {
      const mem = memoryJobHealth.get(jobName);
      return {
        jobName,
        status: mem.status || HEALTH_STATES.UNKNOWN,
        lastAttemptAt: mem.lastAttemptAt || null,
        lastSuccessAt: mem.lastSuccessAt || null,
        durationMs: mem.durationMs ?? null,
        errorCode: mem.errorCode || null,
        errorCategory: mem.errorCategory || null,
        recordsRead: mem.recordsRead ?? 0,
        recordsWritten: mem.recordsWritten ?? 0,
        dataAsOf: mem.dataAsOf || null,
        policyVersion: mem.policyVersion || null
      };
    }
    // Never run -> UNKNOWN
    return {
      jobName,
      status: HEALTH_STATES.UNKNOWN,
      lastAttemptAt: null,
      lastSuccessAt: null,
      durationMs: null,
      errorCode: null,
      errorCategory: null,
      recordsRead: 0,
      recordsWritten: 0,
      dataAsOf: null,
      policyVersion: null
    };
  });

  // Calculate deterministic aggregate system status
  let systemStatus = HEALTH_STATES.HEALTHY;
  const hasFailed = jobs.some((j) => j.status === HEALTH_STATES.FAILED);
  const hasDegraded = jobs.some((j) => j.status === HEALTH_STATES.DEGRADED);
  const hasUnknown = jobs.some((j) => j.status === HEALTH_STATES.UNKNOWN);

  if (hasFailed) {
    systemStatus = HEALTH_STATES.FAILED;
  } else if (hasDegraded) {
    systemStatus = HEALTH_STATES.DEGRADED;
  } else if (hasUnknown) {
    systemStatus = HEALTH_STATES.UNKNOWN;
  } else {
    systemStatus = HEALTH_STATES.HEALTHY;
  }

  return {
    systemStatus,
    evaluatedAt: now.toISOString(),
    jobsCount: jobs.length,
    jobs
  };
}
