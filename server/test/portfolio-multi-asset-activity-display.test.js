import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTransaction } from '../src/transactions.js';
import {
  buildPortfolioRecentActivity,
  buildPortfolioTransactionDisplay
} from '../../client/src/utils/portfolioSnapshotDisplay.js';

function transactionRow(overrides = {}) {
  return {
    id: 'tx-1',
    profile_id: 'profile-1',
    asset_id: 'asset-1',
    transaction_type: 'BUY',
    quantity: 1,
    price: 100_000,
    realized_pnl: null,
    execution_unit_price: 100_000,
    price_currency: 'VND',
    settlement_mode: 'INTERNAL_VND_CASH',
    settlement_currency: 'VND',
    executed_at: '2026-09-12T01:00:00.000Z',
    created_at: '2026-09-12T01:00:00.000Z',
    symbol: 'FPT',
    asset_name: 'FPT Corporation',
    asset_type: 'stock',
    reversal_of_id: null,
    is_reversal: false,
    is_reversed: false,
    ...overrides
  };
}

function recentTransaction(transaction) {
  return buildPortfolioRecentActivity({ transactions: [transaction] })[0];
}

describe('Portfolio P1C — Multi-Asset Activity Display', () => {
  test('server normalization preserves the authoritative accounting and native execution fields', () => {
    const normalized = normalizeTransaction(transactionRow({
      symbol: 'BTC',
      asset_type: 'crypto',
      quantity: 0.5,
      price: 1_500_000_000,
      execution_unit_price: 60_000,
      price_currency: 'USD',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USD',
      fx_rate_to_vnd: 25_000
    }));

    assert.equal(normalized.price, 1_500_000_000);
    assert.equal(normalized.executionUnitPrice, 60_000);
    assert.equal(normalized.priceCurrency, 'USD');
    assert.equal(normalized.settlementCurrency, 'USD');
    assert.equal(normalized.fxRateToVnd, 25_000);
  });

  test('VND BUY and SELL render their native execution price and total without duplicate accounting labels', () => {
    for (const transactionType of ['BUY', 'SELL']) {
      const transaction = normalizeTransaction(transactionRow({
        id: `vnd-${transactionType}`,
        transaction_type: transactionType,
        quantity: 10,
        price: 135_000,
        execution_unit_price: 135_000,
        price_currency: 'VND',
        realized_pnl: transactionType === 'SELL' ? 50_000 : null
      }));
      const display = buildPortfolioTransactionDisplay(transaction);
      const activity = recentTransaction(transaction);

      assert.equal(display.executionPriceLabel, '135.000 VND');
      assert.equal(display.executionTotalLabel, '1.350.000 VND');
      assert.equal(display.showAccountingBasis, false);
      assert.match(activity.detail, /135\.000 VND/);
    }
  });

  test('USD transaction renders native execution values and keeps VND accounting values separately labelled', () => {
    const transaction = normalizeTransaction(transactionRow({
      id: 'usd-buy',
      symbol: 'BTC',
      asset_type: 'crypto',
      quantity: 0.5,
      price: 1_500_000_000,
      execution_unit_price: 60_000,
      price_currency: 'USD',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USD'
    }));
    const display = buildPortfolioTransactionDisplay(transaction);
    const activity = recentTransaction(transaction);

    assert.equal(display.executionPriceLabel, '60.000 USD');
    assert.equal(display.executionTotalLabel, '30.000 USD');
    assert.equal(display.accountingUnitPriceLabel, '1.500.000.000 ₫');
    assert.equal(display.accountingTotalLabel, '750.000.000 ₫');
    assert.equal(display.showAccountingBasis, true);
    assert.match(activity.detail, /60\.000 USD/);
    assert.doesNotMatch(activity.detail, /1\.500\.000\.000|₫|VND/);
  });

  test('USDT transaction remains USDT and is never relabelled or treated as USD', () => {
    const transaction = normalizeTransaction(transactionRow({
      id: 'usdt-sell',
      transaction_type: 'SELL',
      symbol: 'ONDO',
      asset_type: 'crypto',
      quantity: 1_000,
      price: 20_000,
      execution_unit_price: 0.82,
      price_currency: 'USDT',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USDT',
      realized_pnl: 1_000_000
    }));
    const display = buildPortfolioTransactionDisplay(transaction);
    const activity = recentTransaction(transaction);

    assert.equal(display.executionCurrency, 'USDT');
    assert.equal(display.executionPriceLabel, '0,82 USDT');
    assert.equal(display.executionTotalLabel, '820 USDT');
    assert.match(activity.detail, /0,82 USDT/);
    assert.doesNotMatch(activity.detail, /USD(?!T)/);
  });

  test('native-only USDT transaction shows unavailable VND accounting without a fake zero', () => {
    const transaction = normalizeTransaction(transactionRow({
      id: 'usdt-native-only',
      symbol: 'ONDO',
      asset_type: 'crypto',
      quantity: 226,
      price: null,
      execution_unit_price: 0.36402,
      price_currency: 'USDT',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USDT'
    }));
    const display = buildPortfolioTransactionDisplay(transaction);
    const activity = recentTransaction(transaction);

    assert.equal(transaction.accountingStatus, 'UNAVAILABLE');
    assert.equal(display.accountingStatus, 'UNAVAILABLE');
    assert.equal(display.accountingUnitPriceVnd, null);
    assert.equal(display.accountingUnitPriceLabel, 'Chưa có tỷ giá quy đổi VND');
    assert.equal(display.showAccountingBasis, true);
    assert.match(activity.detail, /0,36402 USDT/);
    assert.match(activity.detail, /Hạch toán VND: Chưa có tỷ giá quy đổi VND/);
    assert.doesNotMatch(activity.detail, /USD(?!T)|\b0 VND\b/);
  });

  test('BUY_REVERSAL and SELL_REVERSAL preserve and render the inherited native execution pair', () => {
    const cases = [
      { transactionType: 'BUY_REVERSAL', currency: 'USD', executionPrice: 60_000, expected: '60.000 USD' },
      { transactionType: 'SELL_REVERSAL', currency: 'USDT', executionPrice: 0.82, expected: '0,82 USDT' }
    ];

    for (const item of cases) {
      const transaction = normalizeTransaction(transactionRow({
        id: item.transactionType,
        transaction_type: item.transactionType,
        symbol: 'BTC',
        asset_type: 'crypto',
        price: 1_500_000_000,
        execution_unit_price: item.executionPrice,
        price_currency: item.currency,
        settlement_mode: 'EXTERNAL_SETTLEMENT',
        settlement_currency: item.currency,
        reversal_of_id: 'original-transaction',
        is_reversal: true,
        realized_pnl: item.transactionType === 'SELL_REVERSAL' ? -10_000 : null
      }));
      const activity = recentTransaction(transaction);

      assert.equal(activity.isReversal, true);
      assert.match(activity.action, /Hoàn tác/);
      assert.match(activity.detail, new RegExp(item.expected.replace('.', '\\.')));
    }
  });

  test('missing native execution metadata renders unavailable and never substitutes VND accounting price', () => {
    const transaction = normalizeTransaction(transactionRow({
      id: 'missing-native',
      symbol: 'BTC',
      asset_type: 'crypto',
      quantity: 0.5,
      price: 1_500_000_000,
      execution_unit_price: null,
      price_currency: 'USD',
      settlement_mode: 'EXTERNAL_SETTLEMENT',
      settlement_currency: 'USD'
    }));
    const display = buildPortfolioTransactionDisplay(transaction);
    const activity = recentTransaction(transaction);

    assert.equal(display.hasNativeExecutionPrice, false);
    assert.equal(display.executionPriceLabel, '—');
    assert.equal(display.executionTotalLabel, '—');
    assert.equal(display.accountingUnitPriceLabel, '1.500.000.000 ₫');
    assert.equal(display.showAccountingBasis, true);
    assert.match(activity.detail, /Giá thực hiện: —/);
    assert.doesNotMatch(activity.detail, /1\.500\.000\.000|₫|VND/);
  });

  test('manual cash movements remain signed VND cash amounts and are not rendered as trade prices', () => {
    const events = buildPortfolioRecentActivity({
      cashLedger: [
        { id: 'deposit', entryType: 'DEPOSIT', amount: 1_000_000, effectiveAt: '2026-09-12T03:00:00.000Z' },
        { id: 'withdrawal', entryType: 'WITHDRAWAL', amount: 250_000, effectiveAt: '2026-09-12T02:00:00.000Z' },
        { id: 'deposit-reversal', entryType: 'WITHDRAWAL', amount: 1_000_000, isReversal: true, effectiveAt: '2026-09-12T04:00:00.000Z' }
      ]
    });

    assert.equal(events[0].action, 'Hoàn tác nạp tiền');
    assert.equal(events[0].detail, '−1.000.000 ₫');
    assert.equal(events[1].detail, '+1.000.000 ₫');
    assert.equal(events[2].detail, '−250.000 ₫');
    assert.doesNotMatch(events.map((event) => event.detail).join(' '), /Giá thực hiện/);
  });

  test('expanded transaction history consumes the shared display projection instead of tx.price as execution price', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionHistorySection.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /buildPortfolioTransactionDisplay\(tx\)/);
    assert.match(source, /Giá thực hiện: \{transactionDisplay\.executionPriceLabel\}/);
    assert.match(source, /Hạch toán: \{transactionDisplay\.accountingUnitPriceLabel\}/);
    assert.doesNotMatch(source, /Number\(tx\.price\)/);
  });
});
