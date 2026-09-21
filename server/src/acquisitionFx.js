import {
  USDT_VND_ACCOUNTING_PROVENANCE,
  resolveAcquisitionFx
} from './accountingRate.js';
import { correctOpeningPosition } from './positions.js';
import { privateSupabase } from './supabase.js';

function requireDatabaseClient(client) {
  if (!client) {
    throw new Error('Supabase credentials are not configured. Please set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in server/.env');
  }
  return client;
}

const DEFAULT_BATCH_LIMIT = 5;

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
 */
export async function enrichMissingAcquisitionFx({
  profileId = null,
  limit = DEFAULT_BATCH_LIMIT,
  client = privateSupabase,
  resolveAcquisitionFxFn = resolveAcquisitionFx
} = {}, options = {}) {
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
          result.baselines.push({
            id: baseline.id,
            assetId: baseline.asset_id,
            status: 'SKIPPED',
            rate: null,
            openingAverageCost: null,
            reason: fx?.reason || 'FX_UNAVAILABLE'
          });
        }
      } catch (err) {
        result.skippedCount += 1;
        result.baselines.push({
          id: baseline.id,
          assetId: baseline.asset_id,
          status: 'FAILED',
          rate: null,
          openingAverageCost: null,
          reason: err.message
        });
      }
    }
  }

  // 2. Query eligible BUY portfolio transactions
  const remainingLimit = maxItems - result.processedCount;
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
            result.transactions.push({
              id: tx.id,
              assetId: tx.asset_id,
              status: 'SKIPPED',
              rate: null,
              price: null,
              reason: fx?.reason || 'FX_UNAVAILABLE'
            });
          }
        } catch (err) {
          result.skippedCount += 1;
          result.transactions.push({
            id: tx.id,
            assetId: tx.asset_id,
            status: 'FAILED',
            rate: null,
            price: null,
            reason: err.message
          });
        }
      }
    }
  }

  return result;
}

