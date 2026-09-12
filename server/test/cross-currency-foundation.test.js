import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createPortfolioTransaction,
  normalizeTransaction,
  SETTLEMENT_MODES,
  TRANSACTION_METHODOLOGY
} from '../src/transactions.js';
import {
  createOpeningPosition,
  normalizeOpeningPosition
} from '../src/positions.js';

const SINGLETON_PROFILE_ID = '11111111-1111-4111-8111-111111111111';

const FPT_ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BTC_ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USDT_ASSET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const XAU_ASSET_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function createFakeCrossCurrencyDatabase({
  holdings = [],
  cashAvailable = 100000000,
  baselines = []
} = {}) {
  const assets = [
    { id: FPT_ASSET_ID, symbol: 'FPT', name: 'FPT Corporation', asset_type: 'stock', quote_currency: 'VND' },
    { id: BTC_ASSET_ID, symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', quote_currency: 'USD' },
    { id: USDT_ASSET_ID, symbol: 'USDT', name: 'Tether USD', asset_type: 'crypto', quote_currency: 'USDT' },
    { id: XAU_ASSET_ID, symbol: 'XAU/USD', name: 'Gold Spot / US Dollar', asset_type: 'gold', quote_currency: 'USD' }
  ];

  const state = {
    holdings: cloneRows(holdings),
    transactions: [],
    cashLedger: [],
    cashAvailable,
    baselines: cloneRows(baselines),
    rpcCalls: []
  };

  let sequence = 0;

  function rpcError(code, message) {
    return { data: null, error: { code, message } };
  }

  async function rpc(name, args) {
    state.rpcCalls.push({ name, args: { ...args } });

    if (name === 'list_portfolio_transactions') {
      const symbol = args.p_symbol ? args.p_symbol.toUpperCase() : null;
      const data = state.transactions
        .filter((row) => row.profile_id === SINGLETON_PROFILE_ID)
        .filter((row) => !symbol || assets.find((a) => a.id === row.asset_id)?.symbol === symbol)
        .map((row) => {
          const asset = assets.find((a) => a.id === row.asset_id);
          return {
            ...row,
            symbol: asset.symbol,
            asset_name: asset.name,
            asset_type: asset.asset_type
          };
        });
      return { data, error: null };
    }

    if (name === 'create_portfolio_transaction') {
      const {
        p_symbol: symbol,
        p_asset_id: assetId,
        p_transaction_type: transactionType,
        p_quantity: quantity,
        p_price: price,
        p_executed_at: executedAt,
        p_execution_unit_price: executionUnitPrice,
        p_price_currency: priceCurrency = 'VND',
        p_settlement_mode: settlementMode = 'INTERNAL_VND_CASH',
        p_settlement_currency: settlementCurrency,
        p_fx_rate_to_vnd: fxRateToVnd,
        p_fx_provenance: fxProvenance,
        p_fx_observed_at: fxObservedAt
      } = args;

      if (!['BUY', 'SELL'].includes(transactionType)) {
        return rpcError('PT004', 'transactionType must be BUY or SELL');
      }
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        return rpcError('PT004', 'quantity must be a finite number greater than 0');
      }
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return rpcError('PT004', 'price must be a finite number greater than 0');
      }

      const asset = assetId
        ? assets.find((a) => a.id === assetId)
        : assets.find((a) => a.symbol === symbol);
      if (!asset) return rpcError('PT001', 'asset not found');

      const normalizedPriceCurrency = (priceCurrency || 'VND').toUpperCase();
      const normalizedSettlementMode = (settlementMode || 'INTERNAL_VND_CASH').toUpperCase();

      if (!['INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT'].includes(normalizedSettlementMode)) {
        return rpcError('PT004', 'settlement_mode must be INTERNAL_VND_CASH or EXTERNAL_SETTLEMENT');
      }

      let normalizedSettlementCurrency = null;
      if (normalizedSettlementMode === 'INTERNAL_VND_CASH') {
        if (settlementCurrency && settlementCurrency.trim() && settlementCurrency.trim().toUpperCase() !== 'VND') {
          return rpcError('PT004', 'INTERNAL_VND_CASH settlement requires settlement_currency VND');
        }
        normalizedSettlementCurrency = 'VND';
      } else {
        if (settlementCurrency && settlementCurrency.trim()) {
          normalizedSettlementCurrency = settlementCurrency.trim().toUpperCase();
        } else {
          normalizedSettlementCurrency = null; // Omitted external settlement currency must be NULL
        }
      }

      // Currency & FX Validation
      if (normalizedPriceCurrency === 'VND') {
        if (executionUnitPrice !== null && executionUnitPrice !== undefined && executionUnitPrice !== price) {
          return rpcError('PT004', 'VND transaction execution_unit_price must equal effective price');
        }
      } else {
        if (!executionUnitPrice || executionUnitPrice <= 0) {
          return rpcError('PT004', 'non-VND transaction requires execution_unit_price greater than 0');
        }

        if (normalizedPriceCurrency === 'USDT') {
          if (!fxProvenance || ['TWELVE_DATA_USD_VND', 'USD_VND_DIRECT'].includes(fxProvenance)) {
            return rpcError('PT005', 'USDT transactions require explicit USDT provenance or user-supplied VND basis');
          }
        }

        if (fxProvenance === 'USER_SUPPLIED_VND_BASIS') {
          if (!price || price <= 0) {
            return rpcError('PT004', 'USER_SUPPLIED_VND_BASIS requires explicit effective VND price');
          }
        } else if (fxRateToVnd && fxRateToVnd > 0) {
          if (!fxProvenance) {
            return rpcError('PT004', 'verified FX conversion requires fx_provenance');
          }
          const expectedVnd = executionUnitPrice * fxRateToVnd;
          if (Math.abs(price - expectedVnd) > 0.05 && (Math.abs(price - expectedVnd) / expectedVnd) > 0.0001) {
            return rpcError('PT004', 'VND price does not match execution_unit_price * fx_rate_to_vnd');
          }
        } else {
          return rpcError('PT005', 'non-VND transaction requires verified fx_rate_to_vnd or USER_SUPPLIED_VND_BASIS');
        }
      }

      const stagedHoldings = cloneRows(state.holdings);
      const existingIndex = stagedHoldings.findIndex(
        (row) => row.profile_id === SINGLETON_PROFILE_ID && row.asset_id === asset.id
      );
      const existing = existingIndex >= 0 ? stagedHoldings[existingIndex] : null;

      let newQuantity;
      let newAverageCost;
      let realizedPnL = null;
      let holdingRemoved = false;
      const cashAmount = quantity * price;

      if (transactionType === 'BUY') {
        if (normalizedSettlementMode === 'INTERNAL_VND_CASH') {
          if (cashAmount > state.cashAvailable) {
            return rpcError('CL001', 'insufficient current cash for BUY transaction');
          }
          state.cashAvailable -= cashAmount;
        }

        if (existing) {
          newQuantity = existing.quantity + quantity;
          newAverageCost = ((existing.quantity * existing.average_cost) + (quantity * price)) / newQuantity;
          stagedHoldings[existingIndex] = {
            ...existing,
            quantity: newQuantity,
            average_cost: newAverageCost,
            updated_at: new Date().toISOString()
          };
        } else {
          newQuantity = quantity;
          newAverageCost = price;
          stagedHoldings.push({
            id: `holding-${++sequence}`,
            profile_id: SINGLETON_PROFILE_ID,
            asset_id: asset.id,
            quantity: newQuantity,
            average_cost: newAverageCost,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      } else {
        if (!existing) {
          return rpcError('PT002', 'cannot SELL an asset without an existing holding');
        }
        if (quantity > existing.quantity) {
          return rpcError('PT003', 'sell quantity exceeds current holding quantity');
        }

        newQuantity = existing.quantity - quantity;
        newAverageCost = existing.average_cost;
        realizedPnL = (price - existing.average_cost) * quantity;
        holdingRemoved = newQuantity === 0;

        if (normalizedSettlementMode === 'INTERNAL_VND_CASH') {
          state.cashAvailable += cashAmount;
        }

        if (holdingRemoved) {
          stagedHoldings.splice(existingIndex, 1);
        } else {
          stagedHoldings[existingIndex] = {
            ...existing,
            quantity: newQuantity,
            updated_at: new Date().toISOString()
          };
        }
      }

      state.holdings = stagedHoldings;

      const transaction = {
        id: `tx-${++sequence}`,
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: asset.id,
        symbol: asset.symbol,
        asset_name: asset.name,
        asset_type: asset.asset_type,
        transaction_type: transactionType,
        quantity,
        price,
        realized_pnl: realizedPnL,
        execution_unit_price: executionUnitPrice ?? (normalizedPriceCurrency === 'VND' ? price : null),
        price_currency: normalizedPriceCurrency,
        settlement_mode: normalizedSettlementMode,
        settlement_currency: normalizedSettlementCurrency,
        fx_rate_to_vnd: fxRateToVnd ?? null,
        fx_provenance: fxProvenance ?? null,
        fx_observed_at: fxObservedAt ?? null,
        executed_at: executedAt || new Date().toISOString(),
        created_at: new Date().toISOString(),
        asset: {
          symbol: asset.symbol,
          name: asset.name,
          asset_type: asset.asset_type
        }
      };

      state.transactions.push(transaction);

      let cashEntry = null;
      if (normalizedSettlementMode === 'INTERNAL_VND_CASH') {
        cashEntry = {
          id: `cash-${++sequence}`,
          profile_id: SINGLETON_PROFILE_ID,
          entry_type: transactionType,
          amount: transactionType === 'BUY' ? -cashAmount : cashAmount,
          balance_after: state.cashAvailable,
          description: `${transactionType} ${quantity} ${asset.symbol}`,
          transaction_id: transaction.id,
          created_at: new Date().toISOString()
        };
        state.cashLedger.push(cashEntry);
      }

      const resultHolding = holdingRemoved
        ? null
        : stagedHoldings.find((h) => h.profile_id === SINGLETON_PROFILE_ID && h.asset_id === asset.id);

      return {
        data: {
          transaction,
          holding: resultHolding,
          holdingRemoved,
          cashEntry,
          currentCash: state.cashAvailable
        },
        error: null
      };
    }

    if (name === 'create_opening_position') {
      const {
        p_asset_id: assetId,
        p_quantity: quantity,
        p_average_cost: averageCost,
        p_execution_unit_price: executionUnitPrice,
        p_price_currency: priceCurrency = 'VND',
        p_fx_rate_to_vnd: fxRateToVnd,
        p_fx_provenance: fxProvenance,
        p_fx_observed_at: fxObservedAt
      } = args;

      const asset = assets.find((a) => a.id === assetId);
      if (!asset) return rpcError('OP001', 'asset not found');

      let effectiveAvgCost = averageCost;
      const normalizedPriceCurrency = (priceCurrency || 'VND').toUpperCase();

      if (asset.quote_currency !== 'VND') {
        if (effectiveAvgCost === null || effectiveAvgCost === undefined || effectiveAvgCost < 0) {
          if (executionUnitPrice && executionUnitPrice >= 0 && fxRateToVnd && fxRateToVnd > 0) {
            effectiveAvgCost = executionUnitPrice * fxRateToVnd;
          } else {
            return rpcError('OP003', 'non-VND opening positions require valid VND average cost or verified execution price and FX rate');
          }
        }

        if (normalizedPriceCurrency === 'USDT') {
          if (!fxProvenance || ['TWELVE_DATA_USD_VND', 'USD_VND_DIRECT'].includes(fxProvenance)) {
            return rpcError('OP003', 'USDT opening positions require explicit USDT provenance or user-supplied VND basis');
          }
        }
      } else {
        if (typeof effectiveAvgCost !== 'number' || effectiveAvgCost < 0) {
          return rpcError('OP004', 'averageCost must be a non-negative finite number');
        }
      }

      const baseline = {
        id: `op-${++sequence}`,
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: asset.id,
        opening_quantity: quantity,
        opening_average_cost: effectiveAvgCost,
        execution_unit_price: executionUnitPrice ?? effectiveAvgCost,
        price_currency: normalizedPriceCurrency,
        fx_rate_to_vnd: fxRateToVnd ?? null,
        fx_provenance: fxProvenance ?? null,
        fx_observed_at: fxObservedAt ?? null,
        accounting_cutoff_at: new Date().toISOString(),
        provenance_type: 'USER_RECORDED',
        locked_at: null,
        cancelled_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      state.baselines.push(baseline);

      const holding = {
        id: `holding-${++sequence}`,
        profile_id: SINGLETON_PROFILE_ID,
        asset_id: asset.id,
        opening_position_id: baseline.id,
        quantity,
        average_cost: effectiveAvgCost,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      state.holdings.push(holding);

      return {
        data: {
          openingPosition: baseline,
          holding
        },
        error: null
      };
    }

    return rpcError('42883', `Unknown RPC ${name}`);
  }

  return {
    state,
    rpc,
    from: () => {
      throw new Error('Direct table DML is prohibited; use RPCs');
    }
  };
}

describe('V1.1 Improvement 07C — Cross-Currency Accounting Foundation', () => {
  test('TRANSACTION_METHODOLOGY declares dual settlement modes and VND reporting currency', () => {
    assert.equal(TRANSACTION_METHODOLOGY.reportingCurrency, 'VND');
    assert.deepEqual(SETTLEMENT_MODES, ['INTERNAL_VND_CASH', 'EXTERNAL_SETTLEMENT']);
    assert.equal(TRANSACTION_METHODOLOGY.settlementModes.includes('INTERNAL_VND_CASH'), true);
    assert.equal(TRANSACTION_METHODOLOGY.settlementModes.includes('EXTERNAL_SETTLEMENT'), true);
  });

  test('normalizeTransaction accurately extracts execution metadata and handles settlement currency per mode', () => {
    // 1. Internal VND transaction with omitted settlement currency => defaults to VND
    const rawVnd = {
      id: 'tx-1',
      profile_id: SINGLETON_PROFILE_ID,
      asset_id: FPT_ASSET_ID,
      transaction_type: 'BUY',
      quantity: 10,
      price: 135000,
      realized_pnl: null,
      executed_at: '2026-09-01T10:00:00.000Z',
      created_at: '2026-09-01T10:00:00.000Z'
    };
    const normalizedVnd = normalizeTransaction(rawVnd);
    assert.equal(normalizedVnd.priceCurrency, 'VND');
    assert.equal(normalizedVnd.settlementMode, 'INTERNAL_VND_CASH');
    assert.equal(normalizedVnd.settlementCurrency, 'VND');
    assert.equal(normalizedVnd.executionUnitPrice, null);
    assert.equal(normalizedVnd.fxRateToVnd, null);

    // 2. External crypto transaction with omitted settlement currency => NULL (never defaults to VND or priceCurrency)
    const rawExternalOmitted = {
      id: 'tx-2',
      profile_id: SINGLETON_PROFILE_ID,
      asset_id: BTC_ASSET_ID,
      transaction_type: 'BUY',
      quantity: 0.5,
      price: 1500000000,
      realized_pnl: null,
      execution_unit_price: 60000,
      price_currency: 'USD',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: null,
      fx_rate_to_vnd: 25000,
      fx_provenance: 'TWELVE_DATA_USD_VND',
      executed_at: '2026-09-01T10:00:00.000Z',
      created_at: '2026-09-01T10:00:00.000Z'
    };
    const normalizedExternalOmitted = normalizeTransaction(rawExternalOmitted);
    assert.equal(normalizedExternalOmitted.settlementMode, 'EXTERNAL_SETTLEMENT');
    assert.equal(normalizedExternalOmitted.settlementCurrency, null);
    assert.equal(normalizedExternalOmitted.priceCurrency, 'USD');

    // 3. External crypto transaction with explicit settlement currency => preserved exactly
    const rawExternalExplicit = {
      id: 'tx-3',
      profile_id: SINGLETON_PROFILE_ID,
      asset_id: BTC_ASSET_ID,
      transaction_type: 'BUY',
      quantity: 0.5,
      price: 1500000000,
      realized_pnl: null,
      execution_unit_price: 60000,
      price_currency: 'USD',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USD',
      fx_rate_to_vnd: 25000,
      fx_provenance: 'TWELVE_DATA_USD_VND',
      executed_at: '2026-09-01T10:00:00.000Z',
      created_at: '2026-09-01T10:00:00.000Z'
    };
    const normalizedExternalExplicit = normalizeTransaction(rawExternalExplicit);
    assert.equal(normalizedExternalExplicit.settlementMode, 'EXTERNAL_SETTLEMENT');
    assert.equal(normalizedExternalExplicit.settlementCurrency, 'USD');
    assert.equal(normalizedExternalExplicit.priceCurrency, 'USD');
  });

  test('INTERNAL_VND_CASH: rejects non-VND settlement currency', async () => {
    const fake = createFakeCrossCurrencyDatabase();
    await assert.rejects(
      createPortfolioTransaction({
        assetId: FPT_ASSET_ID,
        transactionType: 'BUY',
        quantity: 10,
        price: 135000,
        settlementMode: 'INTERNAL_VND_CASH',
        settlementCurrency: 'USD'
      }, fake),
      (err) => {
        assert.equal(err.code, 'PT004');
        assert.match(err.message, /INTERNAL_VND_CASH settlement requires settlement_currency VND/);
        return true;
      }
    );
  });

  test('EXTERNAL BTC BUY: omitted settlement currency persists NULL, holdings increase, cash ledger and profile cash unchanged', async () => {
    const fake = createFakeCrossCurrencyDatabase({ cashAvailable: 50000000 });
    const result = await createPortfolioTransaction({
      assetId: BTC_ASSET_ID,
      transactionType: 'BUY',
      quantity: 0.25,
      price: 1625000000,
      executionUnitPrice: 65000,
      priceCurrency: 'USD',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      fxRateToVnd: 25000,
      fxProvenance: 'TWELVE_DATA_USD_VND'
    }, fake);

    assert.equal(result.transaction.settlementMode, 'EXTERNAL_SETTLEMENT');
    assert.equal(result.transaction.settlementCurrency, null); // omitted external settlement currency is NULL
    assert.equal(result.transaction.priceCurrency, 'USD');
    assert.equal(result.transaction.price, 1625000000);
    assert.equal(result.transaction.executionUnitPrice, 65000);
    assert.equal(result.transaction.fxRateToVnd, 25000);

    // Holding projection updated in VND
    assert.equal(result.holding.quantity, 0.25);
    assert.equal(result.holding.averageCost, 1625000000);

    // Cash balance completely untouched
    assert.equal(result.cashEntry, null);
    assert.equal(result.currentCash, 50000000);
    assert.equal(fake.state.cashLedger.length, 0);
    assert.equal(fake.state.cashAvailable, 50000000);
  });

  test('EXTERNAL BTC SELL: holdings decrease, VND realized P&L calculated correctly, cash unchanged', async () => {
    const initialHolding = {
      id: 'holding-btc-1',
      profile_id: SINGLETON_PROFILE_ID,
      asset_id: BTC_ASSET_ID,
      quantity: 1.0,
      average_cost: 1500000000, // bought at 60k USD * 25k FX
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z'
    };
    const fake = createFakeCrossCurrencyDatabase({
      holdings: [initialHolding],
      cashAvailable: 20000000
    });

    // Sell 0.4 BTC at 70k USD * 25.5k FX = 1,785,000,000 VND / BTC with explicit settlementCurrency = 'USD'
    const result = await createPortfolioTransaction({
      assetId: BTC_ASSET_ID,
      transactionType: 'SELL',
      quantity: 0.4,
      price: 1785000000,
      executionUnitPrice: 70000,
      priceCurrency: 'USD',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: 'USD',
      fxRateToVnd: 25500,
      fxProvenance: 'TWELVE_DATA_USD_VND'
    }, fake);

    assert.equal(result.transaction.settlementCurrency, 'USD');
    assert.equal(result.holding.quantity, 0.6);
    assert.equal(result.holding.averageCost, 1500000000); // average cost preserved on SELL

    // Realized PnL in VND = (1,785,000,000 - 1,500,000,000) * 0.4 = 285,000,000 * 0.4 = 114,000,000 VND
    assert.equal(result.transaction.realizedPnL, 114000000);

    // No cash entry generated, profile cash unchanged
    assert.equal(result.cashEntry, null);
    assert.equal(result.currentCash, 20000000);
    assert.equal(fake.state.cashLedger.length, 0);
  });

  test('USD verified FX: verified FX conversion price check validates price = executionUnitPrice * fxRateToVnd', async () => {
    const fake = createFakeCrossCurrencyDatabase();
    // Valid conversion
    const valid = await createPortfolioTransaction({
      assetId: BTC_ASSET_ID,
      transactionType: 'BUY',
      quantity: 0.1,
      price: 254500000,
      executionUnitPrice: 10000,
      priceCurrency: 'USD',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      fxRateToVnd: 25450,
      fxProvenance: 'TWELVE_DATA_USD_VND'
    }, fake);
    assert.equal(valid.transaction.price, 254500000);

    // Invalid conversion (mismatched price)
    await assert.rejects(
      createPortfolioTransaction({
        assetId: BTC_ASSET_ID,
        transactionType: 'BUY',
        quantity: 0.1,
        price: 999999999, // incorrect price
        executionUnitPrice: 10000,
        priceCurrency: 'USD',
        settlementMode: 'EXTERNAL_SETTLEMENT',
        fxRateToVnd: 25450,
        fxProvenance: 'TWELVE_DATA_USD_VND'
      }, fake),
      (err) => {
        assert.equal(err.code, 'PT004');
        assert.match(err.message, /VND price does not match/);
        return true;
      }
    );
  });

  test('USDT: rejects implicit USD conversion, requires explicit USDT provenance or user-supplied VND basis', async () => {
    const fake = createFakeCrossCurrencyDatabase();

    // Reject USDT with USD provenance
    await assert.rejects(
      createPortfolioTransaction({
        assetId: USDT_ASSET_ID,
        transactionType: 'BUY',
        quantity: 1000,
        price: 25450,
        executionUnitPrice: 1,
        priceCurrency: 'USDT',
        settlementMode: 'EXTERNAL_SETTLEMENT',
        fxRateToVnd: 25450,
        fxProvenance: 'TWELVE_DATA_USD_VND'
      }, fake),
      (err) => {
        assert.equal(err.code, 'PT005');
        assert.match(err.message, /USDT transactions require explicit USDT provenance/);
        return true;
      }
    );

    // Accept USDT with user-supplied VND basis
    const acceptedUserBasis = await createPortfolioTransaction({
      assetId: USDT_ASSET_ID,
      transactionType: 'BUY',
      quantity: 1000,
      price: 25400,
      executionUnitPrice: 1,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      fxProvenance: 'USER_SUPPLIED_VND_BASIS'
    }, fake);
    assert.equal(acceptedUserBasis.transaction.priceCurrency, 'USDT');
    assert.equal(acceptedUserBasis.transaction.fxProvenance, 'USER_SUPPLIED_VND_BASIS');
    assert.equal(acceptedUserBasis.holding.averageCost, 25400);

    // Accept USDT with explicit USDT provenance
    const acceptedExplicit = await createPortfolioTransaction({
      assetId: USDT_ASSET_ID,
      transactionType: 'BUY',
      quantity: 500,
      price: 25500,
      executionUnitPrice: 1,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: 'USDT',
      fxRateToVnd: 25500,
      fxProvenance: 'BINANCE_P2P_USDT_VND'
    }, fake);
    assert.equal(acceptedExplicit.transaction.fxProvenance, 'BINANCE_P2P_USDT_VND');
    assert.equal(acceptedExplicit.transaction.settlementCurrency, 'USDT');

    // Accept a direct provider-output CoinGecko Tether/VND observation.
    const acceptedCoinGecko = await createPortfolioTransaction({
      assetId: USDT_ASSET_ID,
      transactionType: 'BUY',
      quantity: 225.86,
      price: 0.36402 * 25325,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: 'USDT',
      fxRateToVnd: 25325,
      fxProvenance: 'coingecko_usdt_vnd',
      fxObservedAt: '2026-09-12T10:00:00.000Z'
    }, fake);
    assert.equal(acceptedCoinGecko.transaction.fxProvenance, 'COINGECKO_USDT_VND');
    assert.equal(acceptedCoinGecko.transaction.priceCurrency, 'USDT');
    assert.equal(acceptedCoinGecko.transaction.price, 0.36402 * 25325);
  });

  test('Gold XAU/USD: cross-currency accounting contract handles asset identity safely without domestic bullion confusion', async () => {
    const fake = createFakeCrossCurrencyDatabase();
    const result = await createPortfolioTransaction({
      assetId: XAU_ASSET_ID,
      transactionType: 'BUY',
      quantity: 2.5,
      price: 63750000, // 2500 USD * 25500 FX
      executionUnitPrice: 2500,
      priceCurrency: 'USD',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: 'USD',
      fxRateToVnd: 25500,
      fxProvenance: 'TWELVE_DATA_USD_VND'
    }, fake);

    assert.equal(result.transaction.symbol, 'XAU/USD');
    assert.equal(result.transaction.priceCurrency, 'USD');
    assert.equal(result.holding.quantity, 2.5);
    assert.equal(result.holding.averageCost, 63750000);
  });

  test('Opening Position Foundation: non-VND opening baseline persists execution metadata cash-neutrally', async () => {
    const fake = createFakeCrossCurrencyDatabase({ cashAvailable: 100000000 });
    const result = await createOpeningPosition({
      assetId: BTC_ASSET_ID,
      quantity: 0.5,
      averageCost: 1250000000,
      executionUnitPrice: 50000,
      priceCurrency: 'USD',
      fxRateToVnd: 25000,
      fxProvenance: 'USER_SUPPLIED_VND_BASIS'
    }, fake);

    assert.equal(result.openingPosition.openingQuantity, 0.5);
    assert.equal(result.openingPosition.openingAverageCost, 1250000000);
    assert.equal(result.openingPosition.executionUnitPrice, 50000);
    assert.equal(result.openingPosition.priceCurrency, 'USD');
    assert.equal(result.holding.averageCost, 1250000000);
    assert.equal(fake.state.cashAvailable, 100000000); // cash neutral
    assert.equal(fake.state.cashLedger.length, 0);
  });

  test('Migration validation: additive migration preserves security model and schema invariants', () => {
    const migrationPath = fileURLToPath(new URL(
      '../../supabase/migrations/20260901010000_v1_1_cross_currency_accounting_foundation.sql',
      import.meta.url
    ));
    const sql = readFileSync(migrationPath, 'utf8');

    // Schema extensions
    assert.match(sql, /ADD COLUMN IF NOT EXISTS execution_unit_price/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS price_currency/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS settlement_mode/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS settlement_currency/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS fx_rate_to_vnd/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS fx_provenance/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS fx_observed_at/);

    // Negative invariant checks: NO native average cost on holdings, NO foreign cash table
    assert.doesNotMatch(sql, /ALTER TABLE public\.holdings\s+ADD COLUMN\s+average_cost_native/i);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.foreign_cash/i);

    // Security permissions
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_portfolio_transaction[\s\S]*FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_portfolio_transaction[\s\S]*TO service_role/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_opening_position[\s\S]*FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_opening_position[\s\S]*TO service_role/);
  });
});
