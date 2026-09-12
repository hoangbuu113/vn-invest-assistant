import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  calculateNativeTransactionTotal,
  formatNativeTransactionTotal,
  getTransactionEntryDefaults,
  isSimplifiedCryptoExternalEntry,
  validateRequiredVndAccountingPrice
} from '../../client/src/utils/transactionEntryDisplay.js';
import { buildPortfolioRecentActivity } from '../../client/src/utils/portfolioSnapshotDisplay.js';

const cryptoAsset = {
  id: 'asset-ondo',
  symbol: 'ONDO',
  asset_type: 'crypto',
  quote_currency: 'USD'
};

describe('Crypto transaction form UX', () => {
  test('crypto external entry defaults to USDT without treating it as USD', () => {
    const defaults = getTransactionEntryDefaults(cryptoAsset);

    assert.deepEqual(defaults, {
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT'
    });
    assert.equal(isSimplifiedCryptoExternalEntry(cryptoAsset, defaults.settlementMode), true);
    assert.notEqual(defaults.priceCurrency, 'USD');
  });

  test('ONDO quantity and execution price produce a precise read-only USDT total', () => {
    const total = calculateNativeTransactionTotal(225, 0.36402);

    assert.ok(Math.abs(total - 81.9045) < Number.EPSILON * 100);
    assert.equal(formatNativeTransactionTotal(225, 0.36402, 'USDT'), '81,9045 USDT');
  });

  test('native total formatting preserves the explicit USD or USDT quote currency', () => {
    assert.equal(formatNativeTransactionTotal(2, 1.25, 'USDT'), '2,5 USDT');
    assert.equal(formatNativeTransactionTotal(2, 1.25, 'USD'), '2,5 USD');
    assert.equal(formatNativeTransactionTotal('', 1.25, 'USDT'), '—');
  });

  test('required VND basis validation blocks missing/invalid values without fabricating zero', () => {
    const missing = validateRequiredVndAccountingPrice('');
    const invalid = validateRequiredVndAccountingPrice('0');
    const valid = validateRequiredVndAccountingPrice('9500');

    assert.equal(missing.valid, false);
    assert.equal(missing.price, null);
    assert.equal(missing.expandAdvancedAccounting, true);
    assert.match(missing.message, /bắt buộc/);
    assert.equal(invalid.valid, false);
    assert.equal(invalid.price, null);
    assert.equal(valid.valid, true);
    assert.equal(valid.price, 9500);
  });

  test('modal keeps native crypto inputs primary and the required VND basis collapsed by default', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    const advancedStart = source.indexOf('Required VND accounting price: advanced only');
    const settlementStart = source.indexOf('Non-VND Settlement Options', advancedStart);
    const advancedSection = source.slice(advancedStart, settlementStart);

    assert.match(source, /isSimplifiedCryptoExternal \? 'Giá thực hiện'/);
    assert.match(source, /isSimplifiedCryptoExternal \? 'Đồng giá'/);
    assert.match(source, /data-testid="crypto-native-total"/);
    assert.match(source, /Tổng giá trị giao dịch/);
    assert.match(advancedSection, /<details/);
    assert.match(advancedSection, /open=\{isAdvancedAccountingOpen\}/);
    assert.match(advancedSection, /Thông tin hạch toán nâng cao/);
    assert.match(advancedSection, /Giá hạch toán VND \(₫\/đơn vị\)/);
    assert.match(advancedSection, /Ứng dụng hiện cần giá trị VND để tính giá vốn, lãi\/lỗ và lịch sử danh mục/);
  });

  test('missing VND basis expands, focuses, and blocks before payload submission', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /setIsAdvancedAccountingOpen\(true\)/);
    assert.match(source, /priceInputRef\.current\?\.focus\(\)/);
    assert.match(source, /if \(!accountingValidation\.valid\) \{\s+revealAccountingPriceError\(accountingValidation\.message\);\s+return;/);
  });

  test('entered VND basis remains current price and idempotency remains unchanged', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /price: numPrice/);
    assert.match(source, /payload\.executionUnitPrice = numExecUnitPrice/);
    assert.match(source, /payload\.priceCurrency = priceCurrency/);
    assert.match(source, /payload\.idempotencyKey = idempotencyKey/);
    assert.match(source, /'Idempotency-Key': idempotencyKey/);
  });

  test('internal VND transaction defaults and payload semantics remain unchanged', () => {
    const defaults = getTransactionEntryDefaults({
      symbol: 'FPT',
      asset_type: 'stock',
      quote_currency: 'VND'
    });

    assert.deepEqual(defaults, {
      priceCurrency: 'VND',
      settlementMode: 'INTERNAL_VND_CASH'
    });
    assert.equal(isSimplifiedCryptoExternalEntry({ asset_type: 'stock' }, defaults.settlementMode), false);
  });

  test('P1C Activity continues to render the native USDT execution price', () => {
    const [activity] = buildPortfolioRecentActivity({
      transactions: [{
        id: 'tx-ondo',
        transactionType: 'BUY',
        symbol: 'ONDO',
        assetType: 'crypto',
        quantity: 225,
        price: 9500,
        executionUnitPrice: 0.36402,
        priceCurrency: 'USDT',
        settlementMode: 'EXTERNAL_SETTLEMENT',
        executedAt: '2026-09-12T10:00:00.000Z'
      }]
    });

    assert.match(activity.detail, /0,364 USDT/);
    assert.doesNotMatch(activity.detail, /USD(?!T)|9\.500|₫/);
  });
});
