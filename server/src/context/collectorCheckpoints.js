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

/**
 * Calculates deterministic nextDueAt for each source key based on official release cadences.
 */
export function calculateNextDueAt(sourceKey, now = new Date()) {
  const nowMs = now.getTime();

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

  const day = Number(partMap.day);
  const month = Number(partMap.month);
  const hour = Number(partMap.hour);
  const weekday = partMap.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  switch (sourceKey) {
    case SOURCE_KEYS.NSO_MONTHLY: {
      // NSO monthly socioeconomic / CPI report window: 25th - 31st of the month
      const isInReleaseWindow = day >= 25;
      const intervalMs = isInReleaseWindow ? 6 * 3600 * 1000 : 24 * 3600 * 1000;
      return new Date(nowMs + intervalMs).toISOString();
    }

    case SOURCE_KEYS.NSO_QUARTERLY: {
      // Quarterly GDP window: end of Mar, Jun, Sep, Dec (months 3, 6, 9, 12, days 25-31)
      const isQuarterEndMonth = month === 3 || month === 6 || month === 9 || month === 12;
      const isInWindow = isQuarterEndMonth && day >= 25;
      const intervalMs = isInWindow ? 12 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
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
  const resolvedNextDue = nextDueAt || calculateNextDueAt(sourceKey, now);
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