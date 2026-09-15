import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  ACCOUNTING_RATE_SUBMISSION_ACTION,
  ACCOUNTING_RATE_UI_STATUS,
  CURRENT_ACCOUNTING_RATE_MAX_AGE_MS,
  HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS,
  buildUsdtVndAccountingRateIntentKey,
  normalizeUsdtVndAccountingRate,
  planUsdtVndAccountingIntentTransition,
  planUsdtVndAccountingSubmission
} from '../../client/src/utils/accountingRate.js';
import {
  buildTransactionConfirmationSummary,
  calculateNativeTransactionTotal,
  formatNativeTransactionTotal,
  freezeTransactionSubmissionIntent,
  getTransactionEntryDefaults,
  getTransactionEntryUnitLabels,
  isSimplifiedCryptoExternalEntry
} from '../../client/src/utils/transactionEntryDisplay.js';
import { buildPortfolioRecentActivity } from '../../client/src/utils/portfolioSnapshotDisplay.js';

const cryptoAsset = {
  id: 'asset-ondo',
  symbol: 'ONDO',
  asset_type: 'crypto',
  quote_currency: 'USD'
};

function availableQuoteState({
  rate = 25325,
  observedAt = '2026-09-12T12:00:00.000Z',
  requestedAt = '2026-09-12T12:00:00.000Z',
  mode = 'CURRENT',
  quoteProof = 'server-proof-a'
} = {}) {
  return normalizeUsdtVndAccountingRate({
    availability: 'available',
    baseCurrency: 'USDT',
    quoteCurrency: 'VND',
    rate,
    provider: 'CoinGecko',
    provenance: 'COINGECKO_USDT_VND',
    observedAt,
    requestedAt,
    observationDeltaMs: Math.abs(Date.parse(observedAt) - Date.parse(requestedAt)),
    mode,
    quoteProof
  });
}

function automaticIntent(overrides = {}) {
  return {
    assetId: 'asset-ondo',
    assetSymbol: 'ONDO',
    priceCurrency: 'USDT',
    settlementMode: 'EXTERNAL_SETTLEMENT',
    executionUnitPrice: '0.36402',
    isCustomTime: false,
    executedAt: '',
    ...overrides
  };
}

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
    const total = calculateNativeTransactionTotal(226, 0.36402);

    assert.ok(Math.abs(total - 82.26852) < Number.EPSILON * 100);
    assert.equal(formatNativeTransactionTotal(226, 0.36402, 'USDT'), '82,26852 USDT');
  });

  test('quantity and execution-price units make the asset/quote direction explicit', () => {
    assert.deepEqual(getTransactionEntryUnitLabels('ONDO', 'USDT'), {
      quantityUnit: 'ONDO',
      executionPriceUnit: 'USDT / ONDO'
    });
    assert.deepEqual(getTransactionEntryUnitLabels('ONDO', 'USD'), {
      quantityUnit: 'ONDO',
      executionPriceUnit: 'USD / ONDO'
    });
  });

  test('confirmation keeps ONDO native execution values separate from VND accounting values', () => {
    const accountingPriceVnd = 0.36402 * 25325;
    const summary = buildTransactionConfirmationSummary({
      symbol: 'ONDO',
      transactionType: 'BUY',
      quantity: 225.86,
      price: accountingPriceVnd,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: 'USDT'
    }, {
      transactionTimeLabel: '14/09/2026, 22:30'
    });

    assert.equal(summary.actionLabel, 'MUA (BUY)');
    assert.equal(summary.assetSymbol, 'ONDO');
    assert.equal(summary.quantityLabel, '225,86 ONDO');
    assert.equal(summary.executionPriceLabel, '0,36402 USDT / ONDO');
    assert.ok(Math.abs(summary.nativeTotal - 82.2175572) < Number.EPSILON * 100);
    assert.equal(summary.nativeTotalLabel, '82,2175572 USDT');
    assert.equal(summary.nativeCurrency, 'USDT');
    assert.equal(summary.accountingUnitPriceVnd, accountingPriceVnd);
    assert.match(summary.accountingUnitPriceLabel, /VND \/ ONDO$/);
    assert.match(summary.accountingTotalLabel, /VND$/);
    assert.doesNotMatch(summary.nativeTotalLabel, /USD(?!T)|VND/);
    assert.doesNotMatch(summary.accountingTotalLabel, /USDT|USD/);
    assert.equal(summary.settlementModeLabel, 'Ví / sàn bên ngoài');
    assert.equal(summary.transactionTimeLabel, '14/09/2026, 22:30');

    const sellSummary = buildTransactionConfirmationSummary({
      symbol: 'ONDO',
      transactionType: 'SELL',
      quantity: 1,
      price: 9000,
      executionUnitPrice: 0.35,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT'
    });
    assert.equal(sellSummary.actionLabel, 'BÁN (SELL)');
  });

  test('native total formatting preserves the explicit USD or USDT quote currency', () => {
    assert.equal(formatNativeTransactionTotal(2, 1.25, 'USDT'), '2,5 USDT');
    assert.equal(formatNativeTransactionTotal(2, 1.25, 'USD'), '2,5 USD');
    assert.equal(formatNativeTransactionTotal('', 1.25, 'USDT'), '—');
  });

  test('missing VND enrichment is explicit and never fabricated as zero', () => {
    const summary = buildTransactionConfirmationSummary({
      symbol: 'ONDO',
      transactionType: 'BUY',
      quantity: 226,
      price: null,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT'
    });

    assert.equal(summary.nativeTotal, 82.26852);
    assert.equal(summary.accountingStatus, 'UNAVAILABLE');
    assert.equal(summary.accountingUnitPriceVnd, null);
    assert.equal(summary.accountingTotalVnd, null);
    assert.equal(summary.accountingUnitPriceLabel, 'Chưa có tỷ giá quy đổi VND');
  });

  test('modal keeps native crypto inputs primary and never asks for manual VND accounting', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    assert.match(source, /data-testid="transaction-quantity-unit"/);
    assert.match(source, /data-testid="transaction-execution-price-unit"/);
    assert.match(source, /transactionEntryUnits\.executionPriceUnit/);
    assert.match(source, /isSimplifiedCryptoExternal \? 'Đồng giá'/);
    assert.match(source, /data-testid="crypto-native-total"/);
    assert.match(source, /Tổng giá trị giao dịch/);
    assert.match(source, /data-testid="automatic-usdt-vnd-accounting"/);
    assert.match(source, /Giá hạch toán VND được tự động tính theo dữ liệu CoinGecko/);
    assert.match(source, /Nguồn: \{accountingRateState\.quote\.provider\}/);
    assert.match(source, /data-testid="automatic-accounting-unavailable"/);
    assert.match(source, /Chưa có tỷ giá quy đổi VND/);
    assert.match(source, /requiresVndAccountingInput/);
    assert.doesNotMatch(source, /Thông tin hạch toán nâng cao/);
    assert.doesNotMatch(source, /USER_SUPPLIED_VND_BASIS/);
  });

  test('provider unavailability keeps a null VND price and allows confirmation', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /let numPrice = null/);
    assert.match(source, /price: numPrice/);
    assert.doesNotMatch(source, /revealAccountingPriceError/);
    const unavailablePlan = planUsdtVndAccountingSubmission({
      frozenSubmission: null,
      isAutomatic: true,
      rateState: { status: ACCOUNTING_RATE_UI_STATUS.UNAVAILABLE, quote: null },
      nowMs: Date.now()
    });
    assert.equal(unavailablePlan.action, ACCOUNTING_RATE_SUBMISSION_ACTION.BUILD_NEW);
  });

  test('first submit shows a complete review while only confirmation can freeze and dispatch', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    const previewStart = source.indexOf('const handleSubmit = (event) =>');
    const confirmStart = source.indexOf('const handleConfirmSubmission = async () =>');
    const confirmEnd = source.indexOf('\n  return (', confirmStart);
    const previewSection = source.slice(previewStart, confirmStart);
    const confirmationSection = source.slice(confirmStart, confirmEnd);

    assert.match(source, /data-testid="transaction-confirmation-summary"/);
    assert.match(source, /data-testid="transaction-confirmation-native"/);
    assert.match(source, /data-testid="transaction-confirmation-accounting"/);
    assert.match(source, /Giá thực hiện/);
    assert.match(source, /Tổng giá trị giao dịch/);
    assert.match(source, /Giá hạch toán VND/);
    assert.match(source, /Tổng giá trị hạch toán/);
    assert.match(source, /Thanh toán/);
    assert.match(source, /Thời gian giao dịch/);
    assert.match(previewSection, /setPendingConfirmation\(candidate\)/);
    assert.doesNotMatch(previewSection, /dispatchFrozenSubmission|freezeTransactionSubmissionIntent/);
    assert.match(confirmationSection, /planUsdtVndAccountingSubmission/);
    assert.match(confirmationSection, /freezeTransactionSubmissionIntent/);
    assert.match(confirmationSection, /await dispatchFrozenSubmission\(intent\)/);
    assert.ok(
      confirmationSection.indexOf('planUsdtVndAccountingSubmission')
        < confirmationSection.indexOf('freezeTransactionSubmissionIntent')
    );
  });

  test('expired automatic quote discards the preview and requires refreshed confirmation', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );
    const confirmStart = source.indexOf('const handleConfirmSubmission = async () =>');
    const confirmEnd = source.indexOf('\n  return (', confirmStart);
    const confirmationSection = source.slice(confirmStart, confirmEnd);

    assert.match(confirmationSection, /submissionPlan\.reason === 'QUOTE_EXPIRED'/);
    assert.match(confirmationSection, /setPendingConfirmation\(null\)/);
    assert.match(confirmationSection, /setAccountingRateRefreshVersion\(\(version\) => version \+ 1\)/);
    assert.match(confirmationSection, /Vui lòng kiểm tra rồi xác nhận lại/);
  });

  test('automatic VND enrichment remains current price while native-only intent is frozen exactly', async () => {
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
    assert.match(source, /payload\.quoteProof = selectedAutomaticQuote\.quoteProof/);
    assert.match(source, /freezeTransactionSubmissionIntent/);
    assert.match(source, /body: JSON\.stringify\(intent\.payload\)/);
    assert.match(source, /'Idempotency-Key': intent\.idempotencyKey/);
  });

  test('asset switch invalidates quote/proof/frozen body and requires a second resolution', () => {
    const quoteA = availableQuoteState();
    const frozenA = {
      idempotencyKey: 'key-a',
      payload: { symbol: 'ONDO', quoteProof: quoteA.quote.quoteProof }
    };
    const ondoKey = buildUsdtVndAccountingRateIntentKey(automaticIntent());
    const btcKey = buildUsdtVndAccountingRateIntentKey(automaticIntent({
      assetId: 'asset-btc',
      assetSymbol: 'BTC'
    }));
    let generatedKeys = 0;
    let resolverCalls = 1;

    const switched = planUsdtVndAccountingIntentTransition({
      previousIntentKey: ondoKey,
      nextIntentKey: btcKey,
      isAutomatic: true,
      currentRateState: quoteA,
      frozenSubmission: frozenA,
      idempotencyKey: frozenA.idempotencyKey,
      createIdempotencyKey: () => `key-${++generatedKeys}-btc`
    });
    if (switched.resolverRequired) resolverCalls += 1;

    assert.equal(switched.intentChanged, true);
    assert.equal(switched.rateState.status, ACCOUNTING_RATE_UI_STATUS.LOADING);
    assert.equal(switched.rateState.quote, null);
    assert.equal(switched.frozenSubmission, null);
    assert.equal(switched.idempotencyKey, 'key-1-btc');
    assert.equal(resolverCalls, 2);

    const quoteB = availableQuoteState({ rate: 25400, quoteProof: 'server-proof-b' });
    assert.equal(quoteB.status, ACCOUNTING_RATE_UI_STATUS.AVAILABLE);
    assert.equal(quoteB.quote.rate, 25400);
    assert.equal(quoteB.quote.quoteProof, 'server-proof-b');
    assert.notEqual(quoteB.quote.quoteProof, quoteA.quote.quoteProof);
  });

  test('price, currency, settlement, and time changes require a new automatic intent', () => {
    const baseIntent = automaticIntent();
    const baseKey = buildUsdtVndAccountingRateIntentKey(baseIntent);
    const quote = availableQuoteState();
    const frozen = { idempotencyKey: 'key-a', payload: { quoteProof: 'server-proof-a' } };
    const changes = [
      { executionUnitPrice: '0.4' },
      { priceCurrency: 'USD' },
      { settlementMode: 'INTERNAL_VND_CASH' },
      { isCustomTime: true, executedAt: '2026-09-12T10:00' },
      { isCustomTime: true, executedAt: '2026-09-12T11:00' }
    ];

    changes.forEach((change, index) => {
      const nextIntent = automaticIntent(change);
      const nextKey = buildUsdtVndAccountingRateIntentKey(nextIntent);
      const remainsAutomatic = nextIntent.priceCurrency === 'USDT'
        && nextIntent.settlementMode === 'EXTERNAL_SETTLEMENT';
      const transition = planUsdtVndAccountingIntentTransition({
        previousIntentKey: baseKey,
        nextIntentKey: nextKey,
        isAutomatic: remainsAutomatic,
        currentRateState: quote,
        frozenSubmission: frozen,
        idempotencyKey: frozen.idempotencyKey,
        createIdempotencyKey: () => `key-change-${index}`
      });

      assert.equal(transition.intentChanged, true);
      assert.equal(transition.rateState.quote, null);
      assert.equal(transition.frozenSubmission, null);
      assert.equal(transition.idempotencyKey, `key-change-${index}`);
      assert.equal(transition.resolverRequired, remainsAutomatic);
    });
  });

  test('current-to-historical and historical-time changes remove the prior proof', () => {
    const currentIntent = automaticIntent();
    const historicalA = automaticIntent({
      isCustomTime: true,
      executedAt: '2026-09-12T10:00'
    });
    const historicalB = automaticIntent({
      isCustomTime: true,
      executedAt: '2026-09-12T11:00'
    });
    const currentQuote = availableQuoteState();
    const historicalQuoteA = availableQuoteState({
      mode: 'HISTORICAL',
      requestedAt: '2026-09-12T10:00:00.000Z',
      observedAt: '2026-09-12T09:45:00.000Z',
      quoteProof: 'historical-proof-a'
    });

    const toHistorical = planUsdtVndAccountingIntentTransition({
      previousIntentKey: buildUsdtVndAccountingRateIntentKey(currentIntent),
      nextIntentKey: buildUsdtVndAccountingRateIntentKey(historicalA),
      isAutomatic: true,
      currentRateState: currentQuote,
      frozenSubmission: null,
      idempotencyKey: 'key-current',
      createIdempotencyKey: () => 'key-historical-a'
    });
    assert.equal(toHistorical.rateState.status, ACCOUNTING_RATE_UI_STATUS.LOADING);
    assert.equal(toHistorical.rateState.quote, null);
    assert.equal(toHistorical.resolverRequired, true);

    const toHistoricalB = planUsdtVndAccountingIntentTransition({
      previousIntentKey: buildUsdtVndAccountingRateIntentKey(historicalA),
      nextIntentKey: buildUsdtVndAccountingRateIntentKey(historicalB),
      isAutomatic: true,
      currentRateState: historicalQuoteA,
      frozenSubmission: null,
      idempotencyKey: 'key-historical-a',
      createIdempotencyKey: () => 'key-historical-b'
    });
    assert.equal(toHistoricalB.rateState.quote, null);
    assert.equal(toHistoricalB.idempotencyKey, 'key-historical-b');
    assert.equal(toHistoricalB.resolverRequired, true);
  });

  test('current quote expiry blocks dispatch, removes proof, and requests refresh', () => {
    const nowMs = Date.parse('2026-09-12T12:00:00.000Z');
    const boundary = planUsdtVndAccountingSubmission({
      frozenSubmission: null,
      isAutomatic: true,
      rateState: availableQuoteState({
        observedAt: new Date(nowMs - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS).toISOString()
      }),
      nowMs
    });
    assert.equal(boundary.action, ACCOUNTING_RATE_SUBMISSION_ACTION.BUILD_NEW);

    const expired = planUsdtVndAccountingSubmission({
      frozenSubmission: null,
      isAutomatic: true,
      rateState: availableQuoteState({
        observedAt: new Date(nowMs - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS - 1).toISOString()
      }),
      nowMs
    });
    assert.equal(expired.action, ACCOUNTING_RATE_SUBMISSION_ACTION.BLOCK);
    assert.equal(expired.intent, null);
    assert.equal(expired.reason, 'QUOTE_EXPIRED');
    assert.equal(expired.rateState.status, ACCOUNTING_RATE_UI_STATUS.LOADING);
    assert.equal(expired.rateState.quote, null);
    assert.equal(expired.resolverRequired, true);

    const historical = planUsdtVndAccountingSubmission({
      frozenSubmission: null,
      isAutomatic: true,
      rateState: availableQuoteState({
        mode: 'HISTORICAL',
        observedAt: '2020-01-01T00:00:00.000Z',
        requestedAt: new Date(
          Date.parse('2020-01-01T00:00:00.000Z') + HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS
        ).toISOString(),
        quoteProof: 'historical-proof'
      }),
      nowMs
    });
    assert.equal(historical.action, ACCOUNTING_RATE_SUBMISSION_ACTION.BUILD_NEW);
  });

  test('timeout retry dispatches the exact frozen body and proof without resolver refresh', () => {
    const quote = availableQuoteState();
    const candidatePayload = {
      symbol: 'ONDO',
      transactionType: 'BUY',
      quantity: 225,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      fxRateToVnd: quote.quote.rate,
      fxProvenance: quote.quote.provenance,
      fxObservedAt: quote.quote.observedAt,
      quoteProof: quote.quote.quoteProof,
      price: 0.36402 * quote.quote.rate
    };
    const firstDecision = planUsdtVndAccountingSubmission({
      frozenSubmission: null,
      isAutomatic: true,
      rateState: quote,
      nowMs: Date.parse(quote.quote.observedAt)
    });
    assert.equal(firstDecision.action, ACCOUNTING_RATE_SUBMISSION_ACTION.BUILD_NEW);

    const frozen = freezeTransactionSubmissionIntent({
      previousIntent: null,
      candidatePayload,
      idempotencyKey: 'timeout-key',
      createIdempotencyKey: () => 'unused-key'
    });
    const capturedRequest = JSON.stringify({
      idempotencyKey: frozen.idempotencyKey,
      body: frozen.payload
    });

    // A simulated unknown-commit timeout leaves the frozen attempt intact.
    const rerenderedQuote = availableQuoteState({
      rate: 26000,
      observedAt: '2026-09-12T12:01:00.000Z',
      quoteProof: 'server-proof-rerender'
    });
    const retryDecision = planUsdtVndAccountingSubmission({
      frozenSubmission: frozen,
      isAutomatic: true,
      rateState: rerenderedQuote,
      nowMs: Date.parse('2026-09-12T12:01:00.000Z')
    });
    const retriedRequest = JSON.stringify({
      idempotencyKey: retryDecision.intent.idempotencyKey,
      body: retryDecision.intent.payload
    });

    assert.equal(retryDecision.action, ACCOUNTING_RATE_SUBMISSION_ACTION.RETRY_FROZEN);
    assert.equal(retryDecision.resolverRequired, false);
    assert.equal(retriedRequest, capturedRequest);
    assert.deepEqual(retryDecision.intent.payload, {
      ...candidatePayload,
      idempotencyKey: 'timeout-key'
    });
  });

  test('equivalent rerender intent preserves quote, proof, frozen body, and resolver count', () => {
    const firstIntent = automaticIntent();
    const equivalentIntent = { ...firstIntent };
    const intentKey = buildUsdtVndAccountingRateIntentKey(firstIntent);
    const equivalentKey = buildUsdtVndAccountingRateIntentKey(equivalentIntent);
    const quote = availableQuoteState();
    const frozen = { idempotencyKey: 'same-key', payload: { quoteProof: quote.quote.quoteProof } };
    let generatedKeys = 0;

    const transition = planUsdtVndAccountingIntentTransition({
      previousIntentKey: intentKey,
      nextIntentKey: equivalentKey,
      isAutomatic: true,
      currentRateState: quote,
      frozenSubmission: frozen,
      idempotencyKey: frozen.idempotencyKey,
      createIdempotencyKey: () => {
        generatedKeys += 1;
        return 'unexpected-key';
      }
    });

    assert.equal(transition.intentChanged, false);
    assert.strictEqual(transition.rateState, quote);
    assert.strictEqual(transition.frozenSubmission, frozen);
    assert.equal(transition.idempotencyKey, 'same-key');
    assert.equal(transition.resolverRequired, false);
    assert.equal(generatedKeys, 0);
  });

  test('TransactionModal delegates real intent and submission behavior to the tested planners', async () => {
    const source = await readFile(
      new URL('../../client/src/components/TransactionModal.jsx', import.meta.url),
      'utf8'
    );

    assert.match(source, /const transition = planUsdtVndAccountingIntentTransition\(/);
    assert.match(source, /isAutomaticUsdtAccounting,\s+accountingRateIntentKey,\s+accountingRateRefreshVersion/);
    assert.match(source, /const submissionPlan = planUsdtVndAccountingSubmission\(/);
    assert.match(source, /submissionPlan\.action === ACCOUNTING_RATE_SUBMISSION_ACTION\.RETRY_FROZEN/);
    assert.match(source, /submissionPlan\.action === ACCOUNTING_RATE_SUBMISSION_ACTION\.BLOCK/);
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

    assert.match(activity.detail, /0,36402 USDT/);
    assert.doesNotMatch(activity.detail, /USD(?!T)|9\.500|₫/);
  });
});
