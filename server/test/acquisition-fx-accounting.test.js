import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  USDT_VND_ACCOUNTING_PROVENANCE
} from '../src/accountingRate.js';
import { createOpeningPosition } from '../src/positions.js';
import { createPortfolioTransaction } from '../src/transactions.js';
import { enrichMissingAcquisitionFx } from '../src/acquisitionFx.js';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

describe('Automatic Acquisition FX Accounting', () => {
  test('Opening position: auto-resolves VND unit cost and total basis while preserving native facts', async () => {
    let capturedRpcArgs = null;
    const mockClient = {
      rpc: async (fnName, args) => {
        if (fnName === 'create_opening_position') {
          capturedRpcArgs = args;
          return {
            data: {
              openingPosition: {
                id: 'op-1',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                opening_quantity: args.p_quantity,
                opening_average_cost: args.p_average_cost,
                execution_unit_price: args.p_execution_unit_price,
                price_currency: args.p_price_currency,
                fx_rate_to_vnd: args.p_fx_rate_to_vnd,
                fx_provenance: args.p_fx_provenance,
                fx_observed_at: args.p_fx_observed_at,
                accounting_cutoff_at: '2026-09-21T10:00:00.000Z',
                provenance_type: 'USER_RECORDED',
                created_at: '2026-09-21T10:00:00.000Z',
                updated_at: '2026-09-21T10:00:00.000Z'
              },
              holding: {
                id: 'h-1',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                opening_position_id: 'op-1',
                quantity: args.p_quantity,
                average_cost: args.p_average_cost,
                created_at: '2026-09-21T10:00:00.000Z',
                updated_at: '2026-09-21T10:00:00.000Z'
              }
            },
            error: null
          };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      }
    };

    const mockResolver = async () => ({
      availability: 'available',
      rate: 26000,
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      source: 'CoinGecko',
      sourceObservedAt: '2026-09-21T09:55:00.000Z',
      requestedAt: '2026-09-21T10:00:00.000Z',
      distanceFromExecution: 300000,
      observationDeltaMs: 300000,
      provenance: USDT_VND_ACCOUNTING_PROVENANCE,
      mode: 'CURRENT',
      reason: null
    });

    const result = await createOpeningPosition({
      profileId: PROFILE_ID,
      assetId: ASSET_ID,
      quantity: 100,
      executionUnitPrice: 0.5,
      priceCurrency: 'USDT'
    }, mockClient, {
      resolveAcquisitionFxFn: mockResolver
    });

    // Verify RPC arguments
    assert.equal(capturedRpcArgs.p_quantity, 100);
    assert.equal(capturedRpcArgs.p_execution_unit_price, 0.5);
    assert.equal(capturedRpcArgs.p_price_currency, 'USDT');
    assert.equal(capturedRpcArgs.p_fx_rate_to_vnd, 26000);
    assert.equal(capturedRpcArgs.p_average_cost, 13000); // 0.5 * 26000
    assert.equal(capturedRpcArgs.p_fx_provenance, USDT_VND_ACCOUNTING_PROVENANCE);

    // Verify returned normalized opening position
    const op = result.openingPosition;
    assert.equal(op.openingQuantity, 100);
    assert.equal(op.executionUnitPrice, 0.5);
    assert.equal(op.priceCurrency, 'USDT');
    assert.equal(op.nativeAverageCost, 0.5);
    assert.equal(op.nativeCostCurrency, 'USDT');
    assert.equal(op.openingAverageCost, 13000);
    assert.equal(op.fxRateToVnd, 26000);
    assert.equal(op.fxProvenance, USDT_VND_ACCOUNTING_PROVENANCE);

    // Total VND basis: quantity * openingAverageCost
    const totalBasis = op.openingQuantity * op.openingAverageCost;
    assert.equal(totalBasis, 1300000);
  });

  test('Opening position: provider unavailable => succeeds with native facts and null VND basis', async () => {
    let capturedRpcArgs = null;
    const mockClient = {
      rpc: async (fnName, args) => {
        if (fnName === 'create_opening_position') {
          capturedRpcArgs = args;
          return {
            data: {
              openingPosition: {
                id: 'op-2',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                opening_quantity: args.p_quantity,
                opening_average_cost: args.p_average_cost,
                execution_unit_price: args.p_execution_unit_price,
                price_currency: args.p_price_currency,
                fx_rate_to_vnd: args.p_fx_rate_to_vnd,
                accounting_cutoff_at: '2026-09-21T10:00:00.000Z',
                provenance_type: 'USER_RECORDED',
                created_at: '2026-09-21T10:00:00.000Z',
                updated_at: '2026-09-21T10:00:00.000Z'
              },
              holding: {
                id: 'h-2',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                opening_position_id: 'op-2',
                quantity: args.p_quantity,
                average_cost: args.p_average_cost,
                created_at: '2026-09-21T10:00:00.000Z',
                updated_at: '2026-09-21T10:00:00.000Z'
              }
            },
            error: null
          };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      }
    };

    const mockUnavailableResolver = async () => ({
      availability: 'unavailable',
      rate: null,
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      source: 'CoinGecko',
      sourceObservedAt: null,
      requestedAt: '2026-09-21T10:00:00.000Z',
      distanceFromExecution: null,
      observationDeltaMs: null,
      provenance: null,
      mode: 'CURRENT',
      reason: 'PROVIDER_RATE_LIMITED'
    });

    const result = await createOpeningPosition({
      profileId: PROFILE_ID,
      assetId: ASSET_ID,
      quantity: 100,
      executionUnitPrice: 0.5,
      priceCurrency: 'USDT'
    }, mockClient, {
      resolveAcquisitionFxFn: mockUnavailableResolver
    });

    assert.equal(capturedRpcArgs.p_average_cost, null);
    assert.equal(capturedRpcArgs.p_fx_rate_to_vnd, null);
    assert.equal(capturedRpcArgs.p_execution_unit_price, 0.5);
    assert.equal(result.openingPosition.openingAverageCost, null);
    assert.equal(result.openingPosition.nativeAverageCost, 0.5);
    assert.equal(result.openingPosition.nativeCostCurrency, 'USDT');
  });

  test('BUY transaction: auto-resolves VND accounting price from native execution price and acquisition FX', async () => {
    let capturedRpcArgs = null;
    const mockClient = {
      rpc: async (fnName, args) => {
        if (fnName === 'create_portfolio_transaction') {
          capturedRpcArgs = args;
          return {
            data: {
              transaction: {
                id: 'tx-1',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                transaction_type: 'BUY',
                quantity: args.p_quantity,
                price: args.p_price,
                execution_unit_price: args.p_execution_unit_price,
                price_currency: args.p_price_currency,
                settlement_mode: args.p_settlement_mode,
                settlement_currency: args.p_settlement_currency,
                fx_rate_to_vnd: args.p_fx_rate_to_vnd,
                fx_provenance: args.p_fx_provenance,
                fx_observed_at: args.p_fx_observed_at,
                executed_at: args.p_executed_at || '2026-09-21T10:00:00.000Z',
                created_at: '2026-09-21T10:00:00.000Z'
              },
              holding: {
                id: 'h-1',
                profile_id: args.p_profile_id,
                asset_id: args.p_asset_id,
                quantity: args.p_quantity,
                average_cost: args.p_price,
                created_at: '2026-09-21T10:00:00.000Z',
                updated_at: '2026-09-21T10:00:00.000Z'
              },
              currentCash: 10000000
            },
            error: null
          };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      }
    };

    const mockResolver = async () => ({
      availability: 'available',
      rate: 26000,
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      source: 'CoinGecko',
      sourceObservedAt: '2026-09-21T10:00:00.000Z',
      requestedAt: '2026-09-21T10:00:00.000Z',
      distanceFromExecution: 0,
      observationDeltaMs: 0,
      provenance: USDT_VND_ACCOUNTING_PROVENANCE,
      mode: 'HISTORICAL',
      reason: null
    });

    const result = await createPortfolioTransaction({
      symbol: 'ONDO',
      assetId: ASSET_ID,
      transactionType: 'BUY',
      quantity: 50,
      executionUnitPrice: 2,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      executedAt: '2026-09-21T10:00:00.000Z'
    }, mockClient, {
      profileId: PROFILE_ID,
      resolveAcquisitionFxFn: mockResolver
    });

    // VND price: 2 * 26000 = 52,000 VND
    assert.equal(capturedRpcArgs.p_price, 52000);
    assert.equal(capturedRpcArgs.p_fx_rate_to_vnd, 26000);
    assert.equal(capturedRpcArgs.p_execution_unit_price, 2);
    assert.equal(result.transaction.price, 52000);
    assert.equal(result.transaction.executionUnitPrice, 2);
    assert.equal(result.transaction.priceCurrency, 'USDT');
    assert.equal(result.accountingStatus, 'AVAILABLE');
  });

  test('enrichMissingAcquisitionFx: enriches eligible baselines and transactions idempotently', async () => {
    const mockBaselines = [
      {
        id: 'op-ondo',
        profile_id: PROFILE_ID,
        asset_id: 'asset-ondo',
        opening_quantity: 226,
        opening_average_cost: null,
        execution_unit_price: 0.36402,
        price_currency: 'USDT',
        accounting_cutoff_at: '2026-09-19T14:24:12.000Z',
        created_at: '2026-09-19T14:24:12.000Z'
      }
    ];

    const mockTransactions = [
      {
        id: 'tx-ena',
        profile_id: PROFILE_ID,
        asset_id: 'asset-ena',
        transaction_type: 'BUY',
        quantity: 100,
        price: null,
        execution_unit_price: 0.25,
        price_currency: 'USDT',
        settlement_mode: 'EXTERNAL_SETTLEMENT',
        executed_at: '2026-09-20T08:00:00.000Z',
        is_reversal: false
      }
    ];

    const updatedBaselines = [];
    const updatedTransactions = [];

    const createMockBuilder = (table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        update: (values) => {
          if (table === 'position_opening_baselines') updatedBaselines.push(values);
          if (table === 'portfolio_transactions') updatedTransactions.push(values);
          return builder;
        },
        then: (resolve) => {
          let data = [];
          if (table === 'position_opening_baselines') data = mockBaselines;
          if (table === 'portfolio_transactions') data = mockTransactions;
          resolve({ data, error: null });
        }
      };
      return builder;
    };

    const mockClient = {
      from: (table) => createMockBuilder(table),
      rpc: async (fnName, args) => {
        if (fnName === 'correct_opening_position') {
          updatedBaselines.push(args);
          return {
            data: {
              openingPosition: { id: args.p_opening_position_id },
              holding: { id: 'h-ondo' }
            },
            error: null
          };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      }
    };

    const mockResolver = async ({ executedAt }) => ({
      availability: 'available',
      rate: 26015,
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      source: 'CoinGecko',
      sourceObservedAt: executedAt,
      requestedAt: executedAt,
      distanceFromExecution: 0,
      observationDeltaMs: 0,
      provenance: USDT_VND_ACCOUNTING_PROVENANCE,
      mode: 'HISTORICAL',
      reason: null
    });

    const summary = await enrichMissingAcquisitionFx({
      client: mockClient,
      limit: 5,
      resolveAcquisitionFxFn: mockResolver
    });

    assert.equal(summary.processedCount, 2);
    assert.equal(summary.enrichedCount, 2);
    assert.equal(summary.skippedCount, 0);
    assert.equal(summary.baselines.length, 1);
    assert.equal(summary.baselines[0].status, 'ENRICHED');
    assert.equal(summary.transactions.length, 1);
    assert.equal(summary.transactions[0].status, 'ENRICHED');
  });
});
