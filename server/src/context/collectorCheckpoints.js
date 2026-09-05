/**
 * Collector Checkpoints — Durable due-gating and checkpoint management for official context sources.
 *
 * Invariant:
 * The Cloudflare cron triggers every ~15 minutes. Slow-moving NSO and SBV sources
 * must NOT be polled on every tick. Checkpoints persist the nextDueAt timestamp
 * in public.market_context_collector_checkpoints so state survives Render container restarts.
 */

import { privateSupabase } from '../supabase.js';

// In-process fallback store for tests and offline/local execution
const memoryCheckpoints = new Map();

export const SOURCE_KEYS = Object.freeze({
  NSO_MONTHLY: 'nso_monthly',
  NSO_QUARTERLY: 'nso_quarterly',
  SBV_FX_CENTRAL: 'sbv_fx_central',
  SBV_INTERBANK_DAILY: 'sbv_interbank_daily',
  SBV_MONTHLY_MONETARY: 'sbv_monthly_monetary'
});

export const CHECKPOINT_STATUS = Object.freeze({
  IDLE: 'idle',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  FAILED: 'failed',
  QUARANTINED: 'quarantined',
  BLOCKED_ACCESS_DENIED: 'blocked/access_denied'
});

export const VALID_CHECKPOINT_STATUSES = Object.freeze(Object.values(CHECKPOINT_STATUS));

/**
 * Calculates deterministic nextDueAt for each source key based on official release cadences,
 * observed release metadata, and backoff states.
 */
export function calculateNextDueAt(sourceKey, now = new Date(), { nextReleaseAt = null, status = 'success' } = {}) {
  const nowMs = now.getTime();

  // 1. If provider was blocked or access denied by WAF, apply conservative long backoff (>= 24h)
  if (status === CHECKPOINT_STATUS.BLOCKED_ACCESS_DENIED || status === 'blocked/access_denied') {
    return new Date(nowMs + 24 * 3600 * 1000).toISOString();
  }

  // 2. If authoritative next release date is known and in the future, schedule next check at that date
  if (nextReleaseAt) {
    const nextMs = Date.parse(nextReleaseAt);
    if (Number.isFinite(nextMs) && nextMs > nowMs) {
      return new Date(nextMs).toISOString();
    }
  }

  // Helper to format ICT time
  const ictFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    weekday: 'short',
    hour12: false
  });
  const parts = ictFormatter.formatToParts(now);
  const partMap = {};
  for (const p of parts) partMap[p.type] = p.value;

  const month = Number(partMap.month);
  const hour = Number(partMap.hour);
  const weekday = partMap.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  switch (sourceKey) {
    case SOURCE_KEYS.NSO_MONTHLY: {
      // Conservative release-aware strategy:
      // Astra research established releases vary (e.g. Aug published Sep 3, next Oct 3).
      // Daily low-cost cadence (24h) avoids 15m polling and hardcoded window assumptions.
      return new Date(nowMs + 24 * 3600 * 1000).toISOString();
    }

    case SOURCE_KEYS.NSO_QUARTERLY: {
      // Conservative quarterly cadence:
      // Daily check during quarter-end/reporting months (3, 6, 9, 12), weekly otherwise.
      // Avoids guessing fixed day 25-31 windows.
      const isQuarterEndMonth = month === 3 || month === 6 || month === 9 || month === 12;
      const intervalMs = isQuarterEndMonth ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
      return new Date(nowMs + intervalMs).toISOString();
    }

    case SOURCE_KEYS.SBV_FX_CENTRAL: {
      // SBV central rate published every business morning (~09:00 ICT)
      if (isWeekend) {
        return new Date(nowMs + 24 * 3600 * 1000).toISOString();
      }
      const isBusinessHours = hour >= 8 && hour <= 18;
      const intervalMs = isBusinessHours ? 4 * 3600 * 1000 : 12 * 3600 * 1000;
      return new Date(nowMs + intervalMs).toISOString();
    }

    case SOURCE_KEYS.SBV_INTERBANK_DAILY: {
      // Daily interbank published with ~1 day lag on business days
      if (isWeekend) {
        return new Date(nowMs + 24 * 3600 * 1000).toISOString();
      }
      const intervalMs = (hour >= 8 && hour <= 18) ? 6 * 3600 * 1000 : 12 * 3600 * 1000;
      return new Date(nowMs + intervalMs).toISOString();
    }

    case SOURCE_KEYS.SBV_MONTHLY_MONETARY: {
      // SBV credit and M2 monthly tables have 1-2 month publication lag
      return new Date(nowMs + 24 * 3600 * 1000).toISOString();
    }

    default:
      return new Date(nowMs + 4 * 3600 * 1000).toISOString();
  }
}

/**
 * Checks whether a source job is currently due for collection.
 * Pure read: compares current time against next_due_at in durable storage or memory.
 */
export async function isSourceDue(sourceKey, { now = new Date(), client = privateSupabase } = {}) {
  // Check memory store first for test overrides or cached state
  const mem = memoryCheckpoints.get(sourceKey);

  if (!client) {
    if (!mem || !mem.next_due_at) return true;
    return now.getTime() >= Date.parse(mem.next_due_at);
  }

  try {
    const { data, error } = await client
      .from('market_context_collector_checkpoints')
      .select('next_due_at, status')
      .eq('source_key', sourceKey)
      .maybeSingle();

    if (error || !data) {
      if (mem && mem.next_due_at) {
        return now.getTime() >= Date.parse(mem.next_due_at);
      }
      // If no checkpoint found, source is due for its initial collection
      return true;
    }

    if (!data.next_due_at) return true;
    return now.getTime() >= Date.parse(data.next_due_at);
  } catch {
    if (mem && mem.next_due_at) {
      return now.getTime() >= Date.parse(mem.next_due_at);
    }
    return true;
  }
}

/**
 * Records source job execution result and sets next due timestamp durably.
 */
export async function recordCheckpoint(sourceKey, {
  status = 'success',
  nextDueAt = null,
  metadata = {},
  client = privateSupabase,
  now = new Date()
} = {}) {
  const resolvedNextDue = nextDueAt || calculateNextDueAt(sourceKey, now, {
    nextReleaseAt: metadata?.nextReleaseAt,
    status
  });
  const checkpoint = {
    source_key: sourceKey,
    last_attempted_at: now.toISOString(),
    ...(status === 'success' ? { last_success_at: now.toISOString() } : {}),
    next_due_at: resolvedNextDue,
    status,
    metadata,
    updated_at: now.toISOString()
  };

  // Always update memory store
  const existingMem = memoryCheckpoints.get(sourceKey) || {};
  memoryCheckpoints.set(sourceKey, {
    ...existingMem,
    ...checkpoint
  });

  if (!client) {
    return { isDurable: false, checkpoint };
  }

  try {
    const { data, error } = await client
      .from('market_context_collector_checkpoints')
      .upsert(checkpoint, { onConflict: 'source_key' })
      .select();

    if (error) {
      return { isDurable: false, error, checkpoint };
    }
    return { isDurable: true, checkpoint: data?.[0] || checkpoint };
  } catch (err) {
    return { isDurable: false, error: err, checkpoint };
  }
}

/**
 * Resets in-memory checkpoint store for testing.
 */
export function clearCheckpoints() {
  memoryCheckpoints.clear();
}