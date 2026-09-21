import {
  USDT_VND_ACCOUNTING_PROVENANCE,
  resolveAcquisitionFx
} from './accountingRate.js';
import { sanitizeOperationalMetadata } from './observability/dataHealth.js';
import { correctOpeningPosition } from './positions.js';
import { privateSupabase } from './supabase.js';

function requireDatabaseClient(client) {
  if (!client) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }
  return client;
}

export const ACQUISITION_FX_SOURCE_KEY = 'acquisition_fx_enrichment';

export const ACQUISITION_FX_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  NO_ELIGIBLE_ROWS: 'NO_ELIGIBLE_ROWS',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_RATE_LIMITED_COOLDOWN: 'PROVIDER_RATE_LIMITED_COOLDOWN',
  PROVIDER_NOT_ENABLED: 'PROVIDER_NOT_ENABLED',
  TIMEOUT: 'TIMEOUT',
  AUTH_FAILURE: 'AUTH_FAILURE',
  ERROR: 'ERROR'
});

export const BACKOFF_STEPS_MS = Object.freeze([
  5 * 60 * 1000,   // Step 1: 5m
  15 * 60 * 1000,  // Step 2: 15m
  30 * 60 * 1000,  // Step 3: 30m
  60 * 60 * 1000   // Step 4+: 60m (cap)
]);

export function getBackoffDurationMs(stepIndex, retryAfterMs = null) {
  const step = Math.max(0, Math.min(stepIndex, BACKOFF_STEPS_MS.length - 1));
  const baseMs = BACKOFF_STEPS_MS[step];
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > baseMs) {
    return retryAfterMs;
  }
  return baseMs;
}

function mapStatusToDbStatus(status) {
  switch (status) {
    case ACQUISITION_FX_STATUS.SUCCESS:
    case ACQUISITION_FX_STATUS.NO_ELIGIBLE_ROWS:
      return 'success';
    case ACQUISITION_FX_STATUS.PARTIAL:
    case ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED:
    case ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN:
      return 'quarantined';
    case ACQUISITION_FX_STATUS.PROVIDER_NOT_ENABLED:
      return 'idle';
    case ACQUISITION_FX_STATUS.TIMEOUT:
    case ACQUISITION_FX_STATUS.AUTH_FAILURE:
    case ACQUISITION_FX_STATUS.ERROR:
    default:
      return 'failed';
  }
}

const DEFAULT_BATCH_LIMIT = 5;

// In-memory state mirror / fallback
let memoryAcquisitionFxState = {
  status: 'IDLE',
  reason: null,
  triggerSource: null,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  processedCount: 0,
  enrichedCount: 0,
  skippedCount: 0,
  lastProcessedBaselineId: null,
  backoffStep: 0,
  cooldownUntilMs: 0,
  cooldownUntilIso: null,
  lastRateLimitAt: null,
  lastSuccessAt: null,
  lastAttemptAt: null
};

export function clearAcquisitionFxMemoryStore() {
  memoryAcquisitionFxState = {
    status: 'IDLE',
    reason: null,
    triggerSource: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    processedCount: 0,
    enrichedCount: 0,
    skippedCount: 0,
    lastProcessedBaselineId: null,
    backoffStep: 0,
    cooldownUntilMs: 0,
    cooldownUntilIso: null,
    lastRateLimitAt: null,
    lastSuccessAt: null,
    lastAttemptAt: null
  };
}

export function getAcquisitionFxRateLimitCooldown() {
  return memoryAcquisitionFxState.cooldownUntilMs;
}

export function setAcquisitionFxRateLimitCooldown(untilMs) {
  const ms = Number(untilMs) || 0;
  memoryAcquisitionFxState.cooldownUntilMs = ms;
  memoryAcquisitionFxState.cooldownUntilIso = ms > 0 ? new Date(ms).toISOString() : null;
}

export async function loadAcquisitionFxCheckpoint(client) {
  if (!client || typeof client.from !== 'function') {
    return memoryAcquisitionFxState;
  }
  try {
    const query = client
      .from('market_context_collector_checkpoints')
      .select('source_key, last_attempted_at, last_success_at, next_due_at, status, metadata, updated_at')
      .eq('source_key', ACQUISITION_FX_SOURCE_KEY);

    const res = typeof query?.maybeSingle === 'function' ? await query.maybeSingle() : await query;
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    if (row && typeof row === 'object' && row.source_key === ACQUISITION_FX_SOURCE_KEY) {
      const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
      const state = {
        sourceKey: row.source_key,
        status: meta.status || row.status || 'IDLE',
        reason: meta.reason || null,
        triggerSource: meta.triggerSource || null,
        startedAt: meta.startedAt || row.last_attempted_at || null,
        finishedAt: meta.finishedAt || row.updated_at || null,
        durationMs: meta.durationMs ?? null,
        processedCount: meta.processedCount ?? 0,
        enrichedCount: meta.enrichedCount ?? 0,
        skippedCount: meta.skippedCount ?? 0,
        lastProcessedBaselineId: meta.lastProcessedBaselineId || null,
        backoffStep: typeof meta.backoffStep === 'number' ? meta.backoffStep : 0,
        cooldownUntilMs: typeof meta.cooldownUntilMs === 'number' ? meta.cooldownUntilMs : 0,
        cooldownUntilIso: meta.cooldownUntilIso || (meta.cooldownUntilMs > 0 ? new Date(meta.cooldownUntilMs).toISOString() : null),
        lastRateLimitAt: meta.lastRateLimitAt || null,
        lastSuccessAt: row.last_success_at || null,
        lastAttemptAt: row.last_attempted_at || null
      };
      memoryAcquisitionFxState = { ...state };
      return state;
    }
  } catch {
    // Graceful fallback to memory on client query error
  }
  return memoryAcquisitionFxState;
}

export async function saveAcquisitionFxCheckpoint(client, state) {
  memoryAcquisitionFxState = { ...state };

  if (!client || typeof client.from !== 'function') {
    return false;
  }

  const dbStatus = mapStatusToDbStatus(state.status);
  const sanitizedMeta = sanitizeOperationalMetadata({
    status: state.status,
    reason: state.reason,
    triggerSource: state.triggerSource,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    durationMs: state.durationMs,
    processedCount: state.processedCount,
    enrichedCount: state.enrichedCount,
    skippedCount: state.skippedCount,
    lastProcessedBaselineId: state.lastProcessedBaselineId,
    backoffStep: state.backoffStep,
    cooldownUntilMs: state.cooldownUntilMs,
    cooldownUntilIso: state.cooldownUntilIso,
    lastRateLimitAt: state.lastRateLimitAt
  });

  const nextDueAt = state.cooldownUntilMs > 0
    ? new Date(state.cooldownUntilMs).toISOString()
    : (state.finishedAt || new Date().toISOString());

  const dbRow = {
    source_key: ACQUISITION_FX_SOURCE_KEY,
    last_attempted_at: state.startedAt,
    ...(state.lastSuccessAt ? { last_success_at: state.lastSuccessAt } : {}),
    status: dbStatus,
    next_due_at: nextDueAt,
    metadata: sanitizedMeta,
    updated_at: state.finishedAt || new Date().toISOString()
  };

  try {
    const table = client.from('market_context_collector_checkpoints');
    if (typeof table.upsert === 'function') {
      const { error } = await table.upsert(dbRow, { onConflict: 'source_key' });
      return !error;
    }
  } catch {
    // Non-fatal if persistence fails in test/mock environment
  }
  return false;
}

export async function getAcquisitionFxStatus({
  client = privateSupabase,
  now = new Date()
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const state = await loadAcquisitionFxCheckpoint(client);
  const cooldownRemainingMs = Math.max(0, (state.cooldownUntilMs || 0) - nowMs);

  return {
    sourceKey: ACQUISITION_FX_SOURCE_KEY,
    status: state.status || 'IDLE',
    reason: state.reason || null,
    triggerSource: state.triggerSource || null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    durationMs: state.durationMs ?? null,
    processedCount: state.processedCount ?? 0,
    enrichedCount: state.enrichedCount ?? 0,
    skippedCount: state.skippedCount ?? 0,
    lastProcessedBaselineId: state.lastProcessedBaselineId || null,
    backoffStep: state.backoffStep ?? 0,
    cooldownUntil: (state.cooldownUntilMs && state.cooldownUntilMs > 0)
      ? new Date(state.cooldownUntilMs).toISOString()
      : null,
    cooldownRemainingMs,
    lastRateLimitAt: state.lastRateLimitAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
    lastAttemptAt: state.lastAttemptAt || null
  };
}

/**
 * Idempotent server-side service to enrich unresolved historical acquisition FX
 * and derive the VND accounting cost basis for eligible non-VND positions and
 * transactions.
 *
 * Eligibility:
 * 1. position_opening_baselines:
 *    - cancelled_at IS NULL
 *    - locked_at IS NULL
 *    - opening_average_cost IS NULL
 *    - execution_unit_price > 0
 *    - price_currency = 'USDT'
 *    - accounting_cutoff_at IS NOT NULL
 *
 * 2. portfolio_transactions:
 *    - transaction_type = 'BUY'
 *    - is_reversal = false
 *    - price IS NULL
 *    - execution_unit_price > 0
 *    - price_currency = 'USDT'
 *    - executed_at IS NOT NULL
 *
 * Rules:
 * - Never overwrites existing authoritative acquisition FX.
 * - Never fabricates rates.
 * - Bounded batches (limit).
 * - Safe to run repeatedly.
 * - Respects provider rate-limits (governed 5m cooldown, breaks immediately on 429).
 * - Respects provider rate-limits (governed backoff progression: 5m -> 15m -> 30m -> 60m cap, breaks immediately on 429).
 * - Durably persists operational state across restarts in market_context_collector_checkpoints.
 */
export async function enrichMissingAcquisitionFx({
  profileId = null,
  limit = DEFAULT_BATCH_LIMIT,
  client = privateSupabase,
  resolveAcquisitionFxFn = resolveAcquisitionFx
} = {}, options = {}) {
  const realStartMs = Date.now();
  const startedAt = options?.now instanceof Date
    ? options.now
    : (typeof options?.nowMs === 'number' ? new Date(options.nowMs) : new Date(realStartMs));
  const startedAtMs = startedAt.getTime();
  const startedAtIso = startedAt.toISOString();
  const triggerSource = options?.triggerSource || 'scheduler';

  // 1. Load persisted checkpoint (DB or memory)
  const persistedState = await loadAcquisitionFxCheckpoint(client);
  let currentBackoffStep = persistedState.backoffStep ?? 0;
  let cooldownUntilMs = persistedState.cooldownUntilMs ?? 0;
  let lastSuccessAt = persistedState.lastSuccessAt ?? null;
  let lastRateLimitAt = persistedState.lastRateLimitAt ?? null;

  // 2. Check if currently in cooldown
  if (startedAtMs < cooldownUntilMs) {
    const finishedAt = new Date(startedAtMs);
    const cooldownRemainingMs = cooldownUntilMs - startedAtMs;

    const cooldownState = {
      ...persistedState,
      status: ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN,
      reason: 'PROVIDER_RATE_LIMITED_COOLDOWN',
      triggerSource,
      startedAt: startedAtIso,
      finishedAt: finishedAt.toISOString(),
      durationMs: 0,
      processedCount: 0,
      enrichedCount: 0,
      skippedCount: 0,
      lastAttemptAt: startedAtIso
    };

    await saveAcquisitionFxCheckpoint(client, cooldownState);

    return {
      status: ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED_COOLDOWN,
      reason: 'PROVIDER_RATE_LIMITED_COOLDOWN',
      triggerSource,
      processedCount: 0,
      enrichedCount: 0,
      skippedCount: 0,
      backoffStep: currentBackoffStep,
      cooldownRemainingMs,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      baselines: [],
      transactions: [],
      errors: []
    };
  }

  const db = requireDatabaseClient(client);
  const maxItems = Math.max(1, Math.min(limit || DEFAULT_BATCH_LIMIT, 50));

  const result = {
    processedCount: 0,
    enrichedCount: 0,
    skippedCount: 0,
    baselines: [],
    transactions: [],
    errors: []
  };

  let rateLimited = false;
  let lastProcessedBaselineId = null;
  let rateLimitReason = null;
  let allSkippedReason = null;

  // Helper to handle rate limit encounter
  function applyRateLimit(reason, retryAfterMs = null) {
    rateLimited = true;
    rateLimitReason = reason || 'COINGECKO_429';
    currentBackoffStep = Math.min(currentBackoffStep + 1, 4);
    const backoffDurationMs = getBackoffDurationMs(currentBackoffStep - 1, retryAfterMs);
    cooldownUntilMs = startedAtMs + backoffDurationMs;
    lastRateLimitAt = new Date().toISOString();
  }

  // Helper to handle successful enrichment
  function applySuccess() {
    currentBackoffStep = 0;
    cooldownUntilMs = 0;
  }

  // 1. Query eligible opening position baselines
  let baselinesQuery = db
    .from('position_opening_baselines')
    .select('id, profile_id, asset_id, opening_quantity, opening_average_cost, execution_unit_price, price_currency, accounting_cutoff_at, fx_rate_to_vnd, created_at')
    .is('cancelled_at', null)
    .is('locked_at', null)
    .is('opening_average_cost', null)
    .gt('execution_unit_price', 0)
    .eq('price_currency', 'USDT')
    .order('created_at', { ascending: true })
    .limit(maxItems);

  if (profileId) {
    baselinesQuery = baselinesQuery.eq('profile_id', profileId);
  }

  const { data: eligibleBaselines, error: baselinesError } = await baselinesQuery;
  if (baselinesError) {
    result.errors.push(`Failed to query eligible baselines: ${baselinesError.message}`);
  } else if (Array.isArray(eligibleBaselines)) {
    for (const baseline of eligibleBaselines) {
      if (result.processedCount >= maxItems) break;
      result.processedCount += 1;
      lastProcessedBaselineId = baseline.id;

      const executedAt = baseline.accounting_cutoff_at || baseline.created_at;
      try {
        const fx = await resolveAcquisitionFxFn({
          baseCurrency: baseline.price_currency || 'USDT',
          reportingCurrency: 'VND',
          executedAt
        }, options);

        if (
          fx?.availability === 'available'
          && typeof fx.rate === 'number'
          && Number.isFinite(fx.rate)
          && fx.rate > 0
        ) {
          const derivedAverageCost = baseline.execution_unit_price * fx.rate;

          // Attempt update via correctOpeningPosition
          try {
            await correctOpeningPosition({
              id: baseline.id,
              profileId: baseline.profile_id,
              quantity: baseline.opening_quantity,
              averageCost: derivedAverageCost,
              executionUnitPrice: baseline.execution_unit_price,
              priceCurrency: baseline.price_currency,
              fxRateToVnd: fx.rate,
              fxProvenance: fx.provenance || USDT_VND_ACCOUNTING_PROVENANCE,
              fxObservedAt: fx.sourceObservedAt
            }, db);

            result.enrichedCount += 1;
            applySuccess();
            result.baselines.push({
              id: baseline.id,
              assetId: baseline.asset_id,
              status: 'ENRICHED',
              rate: fx.rate,
              openingAverageCost: derivedAverageCost,
              observedAt: fx.sourceObservedAt,
              reason: null
            });
          } catch (correctErr) {
            // Direct update fallback if locked/transaction check in RPC prevented correction
            const { error: updateErr } = await db
              .from('position_opening_baselines')
              .update({
                opening_average_cost: derivedAverageCost,
                fx_rate_to_vnd: fx.rate,
                fx_provenance: fx.provenance || USDT_VND_ACCOUNTING_PROVENANCE,
                fx_observed_at: fx.sourceObservedAt,
                updated_at: new Date().toISOString()
              })
              .eq('id', baseline.id)
              .is('opening_average_cost', null);

            if (updateErr) {
              result.skippedCount += 1;
              allSkippedReason = allSkippedReason || correctErr.message || updateErr.message;
              result.baselines.push({
                id: baseline.id,
                assetId: baseline.asset_id,
                status: 'FAILED',
                rate: fx.rate,
                openingAverageCost: null,
                reason: correctErr.message || updateErr.message
              });
            } else {
              // Also update holding average_cost
              await db
                .from('holdings')
                .update({
                  average_cost: derivedAverageCost,
                  updated_at: new Date().toISOString()
                })
                .eq('profile_id', baseline.profile_id)
                .eq('asset_id', baseline.asset_id)
                .eq('opening_position_id', baseline.id)
                .is('average_cost', null);

              result.enrichedCount += 1;
              applySuccess();
              result.baselines.push({
                id: baseline.id,
                assetId: baseline.asset_id,
                status: 'ENRICHED',
                rate: fx.rate,
                openingAverageCost: derivedAverageCost,
                observedAt: fx.sourceObservedAt,
                reason: null
              });
            }
          }
        } else {
          result.skippedCount += 1;
          const reason = fx?.reason || 'FX_UNAVAILABLE';
          allSkippedReason = allSkippedReason || reason;
          result.baselines.push({
            id: baseline.id,
            assetId: baseline.asset_id,
            status: 'SKIPPED',
            rate: null,
            openingAverageCost: null,
            reason
          });
          if (reason === 'PROVIDER_RATE_LIMITED') {
            applyRateLimit('COINGECKO_429', fx?.retryAfterMs);
            break;
          }
        }
      } catch (err) {
        result.skippedCount += 1;
        const isRateLimited = err?.code === 'PROVIDER_RATE_LIMITED' || err?.message?.includes('429');
        const reason = isRateLimited ? 'PROVIDER_RATE_LIMITED' : (err?.code || err.message);
        allSkippedReason = allSkippedReason || reason;
        result.baselines.push({
          id: baseline.id,
          assetId: baseline.asset_id,
          status: 'FAILED',
          rate: null,
          openingAverageCost: null,
          reason
        });
        if (isRateLimited) {
          applyRateLimit('COINGECKO_429', err?.retryAfterMs);
          break;
        }
      }
    }
  }

  // 2. Query eligible BUY portfolio transactions
  const remainingLimit = rateLimited ? 0 : (maxItems - result.processedCount);
  if (remainingLimit > 0) {
    let txQuery = db
      .from('portfolio_transactions')
      .select('id, profile_id, asset_id, transaction_type, quantity, price, execution_unit_price, price_currency, settlement_mode, executed_at, fx_rate_to_vnd, is_reversal')
      .eq('transaction_type', 'BUY')
      .is('price', null)
      .gt('execution_unit_price', 0)
      .eq('price_currency', 'USDT')
      .order('executed_at', { ascending: true })
      .limit(remainingLimit);

    if (profileId) {
      txQuery = txQuery.eq('profile_id', profileId);
    }

    const { data: eligibleTx, error: txError } = await txQuery;
    if (txError) {
      result.errors.push(`Failed to query eligible transactions: ${txError.message}`);
    } else if (Array.isArray(eligibleTx)) {
      for (const tx of eligibleTx) {
        if (tx.is_reversal) continue;
        if (result.processedCount >= maxItems) break;
        result.processedCount += 1;
        lastProcessedBaselineId = tx.id;

        try {
          const fx = await resolveAcquisitionFxFn({
            baseCurrency: tx.price_currency || 'USDT',
            reportingCurrency: 'VND',
            executedAt: tx.executed_at
          }, options);

          if (
            fx?.availability === 'available'
            && typeof fx.rate === 'number'
            && Number.isFinite(fx.rate)
            && fx.rate > 0
          ) {
            const derivedPrice = tx.execution_unit_price * fx.rate;

            const { error: updateTxErr } = await db
              .from('portfolio_transactions')
              .update({
                price: derivedPrice,
                fx_rate_to_vnd: fx.rate,
                fx_provenance: fx.provenance || USDT_VND_ACCOUNTING_PROVENANCE,
                fx_observed_at: fx.sourceObservedAt
              })
              .eq('id', tx.id)
              .is('price', null);

            if (updateTxErr) {
              result.skippedCount += 1;
              allSkippedReason = allSkippedReason || updateTxErr.message;
              result.transactions.push({
                id: tx.id,
                assetId: tx.asset_id,
                status: 'FAILED',
                rate: fx.rate,
                price: null,
                reason: updateTxErr.message
              });
            } else {
              // Update holding average_cost if it was null
              await db
                .from('holdings')
                .update({
                  average_cost: derivedPrice,
                  updated_at: new Date().toISOString()
                })
                .eq('profile_id', tx.profile_id)
                .eq('asset_id', tx.asset_id)
                .is('average_cost', null);

              result.enrichedCount += 1;
              applySuccess();
              result.transactions.push({
                id: tx.id,
                assetId: tx.asset_id,
                status: 'ENRICHED',
                rate: fx.rate,
                price: derivedPrice,
                observedAt: fx.sourceObservedAt,
                reason: null
              });
            }
          } else {
            result.skippedCount += 1;
            const reason = fx?.reason || 'FX_UNAVAILABLE';
            allSkippedReason = allSkippedReason || reason;
            result.transactions.push({
              id: tx.id,
              assetId: tx.asset_id,
              status: 'SKIPPED',
              rate: null,
              price: null,
              reason
            });
            if (reason === 'PROVIDER_RATE_LIMITED') {
              applyRateLimit('COINGECKO_429', fx?.retryAfterMs);
              break;
            }
          }
        } catch (err) {
          result.skippedCount += 1;
          const isRateLimited = err?.code === 'PROVIDER_RATE_LIMITED' || err?.message?.includes('429');
          const reason = isRateLimited ? 'PROVIDER_RATE_LIMITED' : (err?.code || err.message);
          allSkippedReason = allSkippedReason || reason;
          result.transactions.push({
            id: tx.id,
            assetId: tx.asset_id,
            status: 'FAILED',
            rate: null,
            price: null,
            reason
          });
          if (isRateLimited) {
            applyRateLimit('COINGECKO_429', err?.retryAfterMs);
            break;
          }
        }
      }
    }
  }

  // 3. Determine overall status and reason
  const elapsedMs = Math.max(0, Date.now() - realStartMs);
  const finishedAt = new Date(startedAtMs + elapsedMs);
  const finishedAtMs = finishedAt.getTime();
  const durationMs = elapsedMs;

  let status = ACQUISITION_FX_STATUS.SUCCESS;
  let reason = 'SUCCESS';

  if (rateLimited) {
    status = ACQUISITION_FX_STATUS.PROVIDER_RATE_LIMITED;
    reason = rateLimitReason || 'COINGECKO_429';
  } else if (result.errors.length > 0 && result.enrichedCount === 0) {
    status = ACQUISITION_FX_STATUS.ERROR;
    reason = result.errors[0];
  } else if (result.processedCount === 0) {
    status = ACQUISITION_FX_STATUS.NO_ELIGIBLE_ROWS;
    reason = 'NO_UNRESOLVED_ROWS';
  } else if (result.enrichedCount > 0 && result.skippedCount > 0) {
    status = ACQUISITION_FX_STATUS.PARTIAL;
    reason = 'PARTIAL_ENRICHMENT';
  } else if (result.enrichedCount > 0 && result.skippedCount === 0) {
    status = ACQUISITION_FX_STATUS.SUCCESS;
    reason = 'SUCCESS';
    lastSuccessAt = finishedAt.toISOString();
  } else if (result.skippedCount > 0 && result.enrichedCount === 0) {
    if (allSkippedReason === 'PROVIDER_NOT_ENABLED') {
      status = ACQUISITION_FX_STATUS.PROVIDER_NOT_ENABLED;
      reason = 'PROVIDER_NOT_ENABLED';
    } else if (allSkippedReason === 'TIMEOUT' || allSkippedReason === 'COINGECKO_TIMEOUT') {
      status = ACQUISITION_FX_STATUS.TIMEOUT;
      reason = 'COINGECKO_TIMEOUT';
    } else {
      status = ACQUISITION_FX_STATUS.PARTIAL;
      reason = allSkippedReason || 'FX_UNAVAILABLE';
    }
  }

  // 4. Durably persist checkpoint
  const finalState = {
    sourceKey: ACQUISITION_FX_SOURCE_KEY,
    status,
    reason,
    triggerSource,
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    durationMs,
    processedCount: result.processedCount,
    enrichedCount: result.enrichedCount,
    skippedCount: result.skippedCount,
    lastProcessedBaselineId,
    backoffStep: currentBackoffStep,
    cooldownUntilMs,
    cooldownUntilIso: cooldownUntilMs > 0 ? new Date(cooldownUntilMs).toISOString() : null,
    lastRateLimitAt,
    lastSuccessAt,
    lastAttemptAt: startedAtIso
  };

  await saveAcquisitionFxCheckpoint(client, finalState);

  return {
    status,
    reason,
    triggerSource,
    processedCount: result.processedCount,
    enrichedCount: result.enrichedCount,
    skippedCount: result.skippedCount,
    lastProcessedBaselineId,
    backoffStep: currentBackoffStep,
    cooldownRemainingMs: Math.max(0, cooldownUntilMs - finishedAtMs),
    cooldownUntil: cooldownUntilMs > 0 ? new Date(cooldownUntilMs).toISOString() : null,
    baselines: result.baselines,
    transactions: result.transactions,
    errors: result.errors
  };
}

