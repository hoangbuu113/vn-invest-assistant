import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  ACCOUNTING_RATE_UI_STATUS,
  CURRENT_ACCOUNTING_RATE_MAX_AGE_MS,
  HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS,
  buildUsdtVndAccountingRateIntentKey,
  isUsdtVndAccountingQuoteFreshAtSubmission
} from '../../client/src/utils/accountingRate.js';
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

  test('modal keeps native crypto inputs primary and shows manual VND only as governed fallback', async () => {
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
    assert.match(source, /data-testid="automatic-usdt-vnd-accounting"/);
    assert.match(source, /Giá hạch toán VND được tự động tính theo dữ liệu CoinGecko/);
    assert.match(source, /Nguồn: \{accountingRateState\.quote\.provider\}/);
    assert.match(source, /shouldShowManualAccounting \? \(/);
    assert.match(advancedSection, /<details/);
    assert.match(advancedSection, /open=\{isAdvancedAccountingOpen\}/);
    assert.match(advancedSection, /data-testid="automatic-accounting-fallback"/);
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

  test('automatic or fallback VND basis remains current price and submission intent is frozen', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /price: numPrice/);
    assert.match(source, /payload\.executionUnitPrice = numExecUnitPrice/);
    assert.match(source, /payload\.priceCurrency = priceCurrency/);
    assert.match(source, /payload\.fxRateToVnd = selectedAutomaticQuote\.rate/);
    assert.match(source, /payload\.fxProvenance = selectedAutomaticQuote\.provenance/);
    assert.match(source, /payload\.fxObservedAt = selectedAutomaticQuote\.observedAt/);
    assert.match(source, /freezeTransactionSubmissionIntent/);
    assert.match(source, /body: JSON\.stringify\(intent\.payload\)/);
    assert.match(source, /'Idempotency-Key': intent\.idempotencyKey/);
  });

  test('stable accounting intent identity invalidates asset, execution, quote, settlement, and timestamp changes', async () => {
    const baseIntent = {
      assetId: 'asset-ondo',
      assetSymbol: 'ONDO',
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      executionUnitPrice: '0.36402',
      isCustomTime: false,
      executedAt: ''
    };
    const ondo = buildUsdtVndAccountingRateIntentKey(baseIntent);

    assert.equal(ondo, buildUsdtVndAccountingRateIntentKey({ ...baseIntent }));
    assert.notEqual(ondo, buildUsdtVndAccountingRateIntentKey({ ...baseIntent, assetId: 'asset-btc', assetSymbol: 'BTC' }));
    assert.notEqual(ondo, buildUsdtVndAccountingRateIntentKey({ ...baseIntent, executionUnitPrice: '0.4' }));
    assert.notEqual(ondo, buildUsdtVndAccountingRateIntentKey({ ...baseIntent, priceCurrency: 'USD' }));
    assert.notEqual(ondo, buildUsdtVndAccountingRateIntentKey({ ...baseIntent, settlementMode: 'INTERNAL_VND_CASH' }));
    assert.notEqual(ondo, buildUsdtVndAccountingRateIntentKey({
      ...baseIntent,
      isCustomTime: true,
      executedAt: '2026-09-12T10:00'
    }));

    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    assert.match(source, /isAutomaticUsdtAccounting,\s+accountingRateIntentKey,\s+accountingRateRefreshVersion/);
    assert.match(source, /previousKey !== null && previousKey !== accountingRateIntentKey/);
    assert.doesNotMatch(source, /\}, \[selectedAssetObject\]\);/);
  });

  test('current quote expiry blocks first dispatch and triggers refresh while historical validity uses observation delta', async () => {
    const nowMs = Date.parse('2026-09-12T12:00:00.000Z');
    const currentState = (ageMs) => ({
      status: ACCOUNTING_RATE_UI_STATUS.AVAILABLE,
      quote: {
        mode: 'CURRENT',
        observedAt: new Date(nowMs - ageMs).toISOString()
      }
    });

    assert.equal(
      isUsdtVndAccountingQuoteFreshAtSubmission(
        currentState(CURRENT_ACCOUNTING_RATE_MAX_AGE_MS),
        nowMs
      ),
      true
    );
    assert.equal(
      isUsdtVndAccountingQuoteFreshAtSubmission(
        currentState(CURRENT_ACCOUNTING_RATE_MAX_AGE_MS + 1),
        nowMs
      ),
      false
    );
    assert.equal(isUsdtVndAccountingQuoteFreshAtSubmission({
      status: ACCOUNTING_RATE_UI_STATUS.AVAILABLE,
      quote: {
        mode: 'HISTORICAL',
        observedAt: '2020-01-01T00:00:00.000Z',
        observationDeltaMs: HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS
      }
    }, nowMs), true);

    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    const submitStart = source.indexOf('const handleSubmit');
    const expiryCheck = source.indexOf('if (!isUsdtVndAccountingQuoteFreshAtSubmission', submitStart);
    const freezeStart = source.indexOf('freezeTransactionSubmissionIntent', submitStart);
    assert.ok(expiryCheck > submitStart && expiryCheck < freezeStart);
    assert.match(source.slice(expiryCheck, freezeStart), /setAccountingRateRefreshVersion\(\(version\) => version \+ 1\)/);
  });

  test('a dispatched timeout retry bypasses active quote rebuilding and reuses the frozen attempt', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    const submitStart = source.indexOf('const handleSubmit');
    const frozenRetry = source.indexOf('if (pendingSubmissionIntentRef.current)', submitStart);
    const validations = source.indexOf('// Strict client validations', submitStart);
    assert.ok(frozenRetry > submitStart && frozenRetry < validations);
    assert.match(
      source.slice(frozenRetry, validations),
      /dispatchFrozenSubmission\(pendingSubmissionIntentRef\.current\)/
    );
    assert.match(source, /body: JSON\.stringify\(intent\.payload\)/);
  });

  test('custom transaction time invalidates and refetches the historical USDT/VND observation', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /buildUsdtVndAccountingRatePath\(requestedAt\)/);
    assert.match(source, /executedAt: customDateTime/);
    assert.match(source, /isAutomaticUsdtAccounting,\s+accountingRateIntentKey/);
    assert.doesNotMatch(source, /priceCurrency === 'USDT'[^}]*currentUsdVndRate/);
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

  test('existing current USD prefill stays authoritative and historical USD stays manual', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /apiFetch\('\/api\/market\/USD%2FVND'\)/);
    assert.match(source, /priceCurrency === 'USD' && !isCustomTime && currentUsdVndRate/);
    assert.match(source, /priceCurrency === 'USD' && isFxPrefillConfirmed && currentUsdVndRate && !isCustomTime/);
    assert.match(source, /payload\.fxProvenance = 'TWELVE_DATA_USD_VND'/);
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
