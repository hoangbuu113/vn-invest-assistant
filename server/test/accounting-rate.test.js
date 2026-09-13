import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';

import { createApp } from '../index.js';
import {
  CURRENT_ACCOUNTING_RATE_MAX_AGE_MS,
  HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS,
  USDT_VND_ACCOUNTING_PROVENANCE,
  getAccountingRate,
  isCoinGeckoAccountingRateEnabled
} from '../src/accountingRate.js';
import {
  getCoinGeckoCurrentUsdtVndObservation,
  getCoinGeckoHistoricalUsdtVndObservations
} from '../src/providers/coingecko.js';
import { createPortfolioTransaction } from '../src/transactions.js';
import {
  ACCOUNTING_RATE_UI_STATUS,
  buildUsdtVndAccountingRatePath,
  deriveUsdtVndAccountingPrice,
  getUsdtVndAccountingPresentation,
  normalizeUsdtVndAccountingRate,
  shouldResolveUsdtVndAccountingRate
} from '../../client/src/utils/accountingRate.js';
import {
  calculateNativeTransactionTotal,
  formatNativeTransactionTotal,
  freezeTransactionSubmissionIntent
} from '../../client/src/utils/transactionEntryDisplay.js';
import { ownerFetch } from './helpers/owner-auth.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data
  };
}

describe('Automatic direct USDT/VND accounting rate', () => {
  test('CoinGecko current adapter requests Tether quoted directly in VND', async () => {
    let requestedUrl = null;
    const observation = await getCoinGeckoCurrentUsdtVndObservation({
      fetchFn: async (url) => {
        requestedUrl = new URL(url);
        return okJson({
          tether: {
            vnd: 25321.125,
            last_updated_at: NOW.getTime() / 1000
          }
        });
      }
    });

    assert.equal(requestedUrl.pathname, '/api/v3/simple/price');
    assert.equal(requestedUrl.searchParams.get('ids'), 'tether');
    assert.equal(requestedUrl.searchParams.get('vs_currencies'), 'vnd');
    assert.equal(requestedUrl.search.includes('vs_currencies=usd'), false);
    assert.deepEqual(observation, {
      rate: 25321.125,
      observedAt: NOW.toISOString()
    });
  });

  test('CoinGecko historical adapter returns only actual Tether/VND observations', async () => {
    const first = Date.parse('2026-09-12T09:00:00.000Z');
    const second = Date.parse('2026-09-12T10:00:00.000Z');
    let requestedUrl = null;
    const observations = await getCoinGeckoHistoricalUsdtVndObservations({
      fromMs: first - 60_000,
      toMs: second + 60_000
    }, {
      fetchFn: async (url) => {
        requestedUrl = new URL(url);
        return okJson({ prices: [[second, 25340], ['invalid', 1], [first, 25320]] });
      }
    });

    assert.equal(requestedUrl.pathname, '/api/v3/coins/tether/market_chart/range');
    assert.equal(requestedUrl.searchParams.get('vs_currency'), 'vnd');
    assert.equal(requestedUrl.search.includes('vs_currency=usd'), false);
    assert.deepEqual(observations, [
      { rate: 25320, observedAt: new Date(first).toISOString() },
      { rate: 25340, observedAt: new Date(second).toISOString() }
    ]);
  });

  test('current policy accepts at ten minutes and rejects older or malformed observations', async () => {
    const atBoundary = await getAccountingRate({
      baseCurrency: 'usdt',
      quoteCurrency: 'vnd'
    }, {
      enabled: true,
      now: NOW,
      getCurrentObservationFn: async () => ({
        rate: 25300,
        observedAt: new Date(NOW.getTime() - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS).toISOString()
      })
    });
    assert.equal(atBoundary.availability, 'available');
    assert.equal(atBoundary.rate, 25300);
    assert.equal(atBoundary.observationDeltaMs, CURRENT_ACCOUNTING_RATE_MAX_AGE_MS);
    assert.equal(atBoundary.provenance, USDT_VND_ACCOUNTING_PROVENANCE);

    const stale = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND'
    }, {
      enabled: true,
      now: NOW,
      getCurrentObservationFn: async () => ({
        rate: 25300,
        observedAt: new Date(NOW.getTime() - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS - 1).toISOString()
      })
    });
    assert.equal(stale.availability, 'stale');
    assert.equal(stale.rate, null);
    assert.equal(stale.reason, 'OBSERVATION_STALE');

    const malformed = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND'
    }, {
      enabled: true,
      now: NOW,
      getCurrentObservationFn: async () => ({ rate: 0, observedAt: NOW.toISOString() })
    });
    assert.equal(malformed.availability, 'unavailable');
    assert.equal(malformed.rate, null);
    assert.equal(malformed.reason, 'MALFORMED_PROVIDER_RESPONSE');
  });

  test('historical policy selects the nearest actual point within 60 minutes without interpolation', async () => {
    const requestedAt = new Date('2026-09-12T10:00:00.000Z');
    let requestedRange = null;
    let currentCalls = 0;
    const result = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: requestedAt.toISOString()
    }, {
      enabled: true,
      now: NOW,
      getCurrentObservationFn: async () => {
        currentCalls += 1;
        return { rate: 99999, observedAt: NOW.toISOString() };
      },
      getHistoricalObservationsFn: async (range) => {
        requestedRange = range;
        return [
          { rate: 25290, observedAt: '2026-09-12T09:40:00.000Z' },
          { rate: 25310, observedAt: '2026-09-12T10:20:00.000Z' }
        ];
      }
    });

    assert.equal(currentCalls, 0);
    assert.deepEqual(requestedRange, {
      fromMs: requestedAt.getTime() - (2 * 60 * 60 * 1000),
      toMs: requestedAt.getTime() + (2 * 60 * 60 * 1000)
    });
    assert.equal(result.availability, 'available');
    assert.equal(result.mode, 'HISTORICAL');
    assert.equal(result.rate, 25290, 'equal-distance ties select the earlier actual point');
    assert.equal(result.observedAt, '2026-09-12T09:40:00.000Z');
    assert.equal(result.observationDeltaMs, 20 * 60 * 1000);
  });

  test('historical policy accepts an actual observation at exactly 60 minutes', async () => {
    const requestedAt = new Date('2026-09-12T10:00:00.000Z');
    const result = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: requestedAt.toISOString()
    }, {
      enabled: true,
      now: NOW,
      getHistoricalObservationsFn: async () => [{
        rate: 25300,
        observedAt: new Date(
          requestedAt.getTime() - HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS
        ).toISOString()
      }]
    });

    assert.equal(result.availability, 'available');
    assert.equal(result.rate, 25300);
    assert.equal(result.observationDeltaMs, HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS);
  });

  test('historical policy never substitutes current data or a point over 60 minutes away', async () => {
    let currentCalls = 0;
    const tooDistant = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: '2026-09-12T10:00:00.000Z'
    }, {
      enabled: true,
      now: NOW,
      getCurrentObservationFn: async () => {
        currentCalls += 1;
        return { rate: 25300, observedAt: NOW.toISOString() };
      },
      getHistoricalObservationsFn: async () => [{
        rate: 25200,
        observedAt: new Date(Date.parse('2026-09-12T10:00:00.000Z')
          - HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS - 1).toISOString()
      }]
    });
    assert.equal(tooDistant.availability, 'unavailable');
    assert.equal(tooDistant.rate, null);
    assert.equal(tooDistant.reason, 'OBSERVATION_TOO_DISTANT');
    assert.equal(currentCalls, 0);

    const missing = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: '2026-09-12T10:00:00.000Z'
    }, {
      enabled: true,
      now: NOW,
      getHistoricalObservationsFn: async () => []
    });
    assert.equal(missing.availability, 'unavailable');
    assert.equal(missing.rate, null);
    assert.equal(missing.reason, 'NO_HISTORICAL_OBSERVATION');
  });

  test('provider access and historical plan failures remain explicit unavailable states', async () => {
    const denied = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: '2026-09-12T10:00:00.000Z'
    }, {
      enabled: true,
      now: NOW,
      fetchFn: async () => ({ ok: false, status: 403 })
    });
    assert.equal(denied.availability, 'unavailable');
    assert.equal(denied.rate, null);
    assert.equal(denied.reason, 'PROVIDER_ACCESS_DENIED');

    const unavailableHistory = await getAccountingRate({
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      at: '2026-09-12T10:00:00.000Z'
    }, {
      enabled: true,
      now: NOW,
      fetchFn: async () => ({ ok: false, status: 404 })
    });
    assert.equal(unavailableHistory.availability, 'unavailable');
    assert.equal(unavailableHistory.reason, 'HISTORICAL_DATA_UNAVAILABLE');
  });

  test('licensing gate defaults fail closed and unsupported pairs stay unavailable', async () => {
    const originalEnabled = process.env.COINGECKO_ACCOUNTING_RATE_ENABLED;
    delete process.env.COINGECKO_ACCOUNTING_RATE_ENABLED;
    try {
      assert.equal(isCoinGeckoAccountingRateEnabled(), false);
      assert.equal(isCoinGeckoAccountingRateEnabled('false'), false);
      assert.equal(isCoinGeckoAccountingRateEnabled('true'), true);
    } finally {
      if (originalEnabled === undefined) {
        delete process.env.COINGECKO_ACCOUNTING_RATE_ENABLED;
      } else {
        process.env.COINGECKO_ACCOUNTING_RATE_ENABLED = originalEnabled;
      }
    }

    const disabled = await getAccountingRate({ baseCurrency: 'USDT', quoteCurrency: 'VND' }, {
      enabled: false,
      now: NOW
    });
    assert.equal(disabled.availability, 'unavailable');
    assert.equal(disabled.reason, 'PROVIDER_NOT_ENABLED');
    assert.equal(disabled.rate, null);

    const unsupported = await getAccountingRate({ baseCurrency: 'USD', quoteCurrency: 'VND' }, {
      enabled: true,
      now: NOW
    });
    assert.equal(unsupported.availability, 'unavailable');
    assert.equal(unsupported.reason, 'PAIR_UNSUPPORTED');
    assert.equal(unsupported.provider, null);
  });

  test('authenticated GET route forwards current and historical requests and rejects invalid timestamps', async () => {
    const calls = [];
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAccountingRateFn: async (request) => {
        calls.push(request);
        return {
          availability: 'available',
          baseCurrency: request.baseCurrency,
          quoteCurrency: request.quoteCurrency,
          rate: 25300,
          provider: 'CoinGecko',
          provenance: USDT_VND_ACCOUNTING_PROVENANCE,
          observedAt: NOW.toISOString(),
          requestedAt: request.at || NOW.toISOString(),
          observationDeltaMs: 0,
          mode: request.at ? 'HISTORICAL' : 'CURRENT',
          reason: null
        };
      }
    });
    const { server, baseUrl } = await listen(app);

    try {
      const unauthenticated = await fetch(`${baseUrl}/api/accounting-rate?base=USDT&quote=VND`);
      assert.equal(unauthenticated.status, 401);

      const current = await ownerFetch(`${baseUrl}/api/accounting-rate?base=usdt&quote=vnd`);
      assert.equal(current.status, 200);
      assert.equal(current.headers.get('Cache-Control'), 'no-store');
      const currentBody = await current.json();
      assert.equal(currentBody.data.rate, 25300);
      assert.deepEqual(calls[0], {
        baseCurrency: 'USDT',
        quoteCurrency: 'VND',
        at: undefined
      });

      const historical = await ownerFetch(
        `${baseUrl}/api/accounting-rate?base=USDT&quote=VND&at=2026-09-12T17%3A00%3A00%2B07%3A00`
      );
      assert.equal(historical.status, 200);
      assert.equal(calls[1].at, '2026-09-12T10:00:00.000Z');

      const invalid = await ownerFetch(
        `${baseUrl}/api/accounting-rate?base=USDT&quote=VND&at=2026-09-12T10%3A00%3A00`
      );
      assert.equal(invalid.status, 400);
      const invalidBody = await invalid.json();
      assert.match(invalidBody.errors[0], /explicit Z or UTC offset/);
      assert.equal(calls.length, 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('transaction route accepts canonical provenance string and rejects object provenance', async () => {
    const transactions = [];
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async () => ({
        id: 'asset-ondo',
        symbol: 'ONDO',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createPortfolioTransactionFn: async (payload) => {
        transactions.push(payload);
        return { transaction: { id: 'tx-ondo', ...payload }, replayed: false };
      },
      accountingRateEnabled: true
    });
    const { server, baseUrl } = await listen(app);
    const body = {
      symbol: 'ONDO',
      transactionType: 'BUY',
      quantity: 225.86,
      price: 9218.82,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      fxRateToVnd: 25325,
      fxProvenance: 'coingecko_usdt_vnd',
      fxObservedAt: NOW.toISOString()
    };

    try {
      const accepted = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'ondo-auto-1' },
        body: JSON.stringify(body)
      });
      assert.equal(accepted.status, 201);
      assert.equal(transactions[0].fxProvenance, USDT_VND_ACCOUNTING_PROVENANCE);
      assert.equal(transactions[0].priceCurrency, 'USDT');

      const rejected = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'ondo-auto-2' },
        body: JSON.stringify({ ...body, fxProvenance: { provider: 'CoinGecko' } })
      });
      assert.equal(rejected.status, 400);
      assert.equal(transactions.length, 1);
      const rejectedBody = await rejected.json();
      assert.match(rejectedBody.errors[0], /non-empty string/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('transaction write boundary fails closed for disabled CoinGecko provenance without blocking manual fallback', async () => {
    const automaticBody = {
      symbol: 'ONDO',
      transactionType: 'BUY',
      quantity: 225.86,
      price: 0.36402 * 25325,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      settlementMode: 'EXTERNAL_SETTLEMENT',
      settlementCurrency: null,
      fxRateToVnd: 25325,
      fxProvenance: USDT_VND_ACCOUNTING_PROVENANCE,
      fxObservedAt: NOW.toISOString()
    };
    const acceptedWrites = [];
    const services = {
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async () => ({
        id: 'asset-ondo',
        symbol: 'ONDO',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      createPortfolioTransactionFn: async (payload) => {
        acceptedWrites.push(payload);
        return { transaction: { id: `tx-${acceptedWrites.length}`, ...payload }, replayed: false };
      }
    };

    const disabled = await listen(createApp({ ...services, accountingRateEnabled: false }));
    try {
      const rejectedAutomatic = await ownerFetch(`${disabled.baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'auto-disabled-1' },
        body: JSON.stringify(automaticBody)
      });
      assert.equal(rejectedAutomatic.status, 400);
      assert.equal(acceptedWrites.length, 0);
      const rejectedBody = await rejectedAutomatic.json();
      assert.match(rejectedBody.errors.join(' '), /automatic accounting rates are disabled/);

      const acceptedManual = await ownerFetch(`${disabled.baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'manual-disabled-1' },
        body: JSON.stringify({
          ...automaticBody,
          price: 9500,
          fxRateToVnd: undefined,
          fxObservedAt: undefined,
          fxProvenance: 'USER_SUPPLIED_VND_BASIS'
        })
      });
      assert.equal(acceptedManual.status, 201);
      assert.equal(acceptedWrites[0].fxProvenance, 'USER_SUPPLIED_VND_BASIS');
    } finally {
      await new Promise((resolve) => disabled.server.close(resolve));
    }

    const enabled = await listen(createApp({ ...services, accountingRateEnabled: true }));
    try {
      const acceptedAutomatic = await ownerFetch(`${enabled.baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'auto-enabled-1' },
        body: JSON.stringify(automaticBody)
      });
      assert.equal(acceptedAutomatic.status, 201);
      assert.equal(acceptedWrites[1].fxProvenance, USDT_VND_ACCOUNTING_PROVENANCE);
      assert.equal(acceptedWrites[1].price, automaticBody.executionUnitPrice * automaticBody.fxRateToVnd);

      const rejectedMalformedAutomatic = await ownerFetch(`${enabled.baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'auto-enabled-invalid-1' },
        body: JSON.stringify({ ...automaticBody, price: automaticBody.price + 100 })
      });
      assert.equal(rejectedMalformedAutomatic.status, 400);
      assert.equal(acceptedWrites.length, 2);
      const malformedBody = await rejectedMalformedAutomatic.json();
      assert.match(malformedBody.errors.join(' '), /price must match executionUnitPrice multiplied by fxRateToVnd/);
    } finally {
      await new Promise((resolve) => enabled.server.close(resolve));
    }
  });

  test('transaction service boundary does not preserve a competing provenance object shape', async () => {
    let rpcCalled = false;
    await assert.rejects(
      createPortfolioTransaction({
        symbol: 'ONDO',
        transactionType: 'BUY',
        quantity: 1,
        price: 9000,
        fxProvenance: { method: USDT_VND_ACCOUNTING_PROVENANCE }
      }, {
        rpc: async () => {
          rpcCalled = true;
          return { data: null, error: null };
        }
      }),
      /fxProvenance must be a non-empty string/
    );
    assert.equal(rpcCalled, false);
  });

  test('UI derives VND basis from direct USDT/VND while native total remains exact USDT', () => {
    assert.equal(shouldResolveUsdtVndAccountingRate({
      isCrypto: true,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      priceCurrency: 'USDT'
    }), true);
    assert.equal(shouldResolveUsdtVndAccountingRate({
      isCrypto: true,
      settlementMode: 'EXTERNAL_SETTLEMENT',
      priceCurrency: 'USD'
    }), false);
    assert.equal(shouldResolveUsdtVndAccountingRate({
      isCrypto: false,
      settlementMode: 'INTERNAL_VND_CASH',
      priceCurrency: 'VND'
    }), false);

    const state = normalizeUsdtVndAccountingRate({
      availability: 'available',
      baseCurrency: 'USDT',
      quoteCurrency: 'VND',
      rate: 25325,
      provider: 'CoinGecko',
      provenance: USDT_VND_ACCOUNTING_PROVENANCE,
      observedAt: NOW.toISOString(),
      requestedAt: NOW.toISOString(),
      observationDeltaMs: 0,
      mode: 'CURRENT'
    });
    assert.equal(state.status, ACCOUNTING_RATE_UI_STATUS.AVAILABLE);
    assert.equal(deriveUsdtVndAccountingPrice(0.36402, state), 0.36402 * 25325);
    assert.equal(calculateNativeTransactionTotal(225.86, 0.36402), 82.2175572);
    assert.equal(formatNativeTransactionTotal(225.86, 0.36402, 'USDT'), '82,2175572 USDT');
    assert.equal(state.quote.provenance, USDT_VND_ACCOUNTING_PROVENANCE);

    const fakeUsd = normalizeUsdtVndAccountingRate({
      availability: 'available',
      baseCurrency: 'USD',
      quoteCurrency: 'VND',
      rate: 25325,
      provider: 'CoinGecko',
      provenance: USDT_VND_ACCOUNTING_PROVENANCE,
      observedAt: NOW.toISOString()
    });
    assert.equal(fakeUsd.status, ACCOUNTING_RATE_UI_STATUS.UNAVAILABLE);
    assert.equal(deriveUsdtVndAccountingPrice(0.36402, fakeUsd), null);
  });

  test('UI presentation hides manual VND on automatic success and exposes it on unavailable or stale', () => {
    const loading = getUsdtVndAccountingPresentation({
      isAutomatic: true,
      isSimplifiedCryptoExternal: true,
      status: ACCOUNTING_RATE_UI_STATUS.LOADING
    });
    assert.deepEqual(loading, {
      isPending: true,
      showAutomatic: true,
      showManual: false
    });

    const available = getUsdtVndAccountingPresentation({
      isAutomatic: true,
      isSimplifiedCryptoExternal: true,
      status: ACCOUNTING_RATE_UI_STATUS.AVAILABLE
    });
    assert.deepEqual(available, {
      isPending: false,
      showAutomatic: true,
      showManual: false
    });

    for (const status of [ACCOUNTING_RATE_UI_STATUS.UNAVAILABLE, ACCOUNTING_RATE_UI_STATUS.STALE]) {
      assert.deepEqual(getUsdtVndAccountingPresentation({
        isAutomatic: true,
        isSimplifiedCryptoExternal: true,
        status
      }), {
        isPending: false,
        showAutomatic: false,
        showManual: true
      });
    }
  });

  test('changed executedAt produces a distinct historical request and current request has no timestamp', () => {
    const currentPath = buildUsdtVndAccountingRatePath();
    const firstHistorical = buildUsdtVndAccountingRatePath('2026-09-12T09:00:00.000Z');
    const secondHistorical = buildUsdtVndAccountingRatePath('2026-09-12T10:00:00.000Z');

    assert.equal(currentPath, '/api/accounting-rate?base=USDT&quote=VND');
    assert.notEqual(firstHistorical, secondHistorical);
    assert.match(firstHistorical, /at=2026-09-12T09%3A00%3A00\.000Z/);
    assert.match(secondHistorical, /at=2026-09-12T10%3A00%3A00\.000Z/);
  });

  test('same intended write freezes key, rate, provenance, observed time, and price across retries', () => {
    let generated = 0;
    const createIdempotencyKey = () => `generated-key-${++generated}`;
    const candidate = {
      symbol: 'ONDO',
      quantity: 225.86,
      executionUnitPrice: 0.36402,
      priceCurrency: 'USDT',
      price: 0.36402 * 25325,
      fxRateToVnd: 25325,
      fxProvenance: USDT_VND_ACCOUNTING_PROVENANCE,
      fxObservedAt: NOW.toISOString()
    };
    const first = freezeTransactionSubmissionIntent({
      previousIntent: null,
      candidatePayload: candidate,
      idempotencyKey: 'initial-key',
      createIdempotencyKey
    });
    const retry = freezeTransactionSubmissionIntent({
      previousIntent: first,
      candidatePayload: { ...candidate },
      idempotencyKey: 'ignored-key',
      createIdempotencyKey
    });

    assert.strictEqual(retry, first);
    assert.equal(retry.idempotencyKey, 'initial-key');
    assert.equal(retry.payload.fxRateToVnd, 25325);
    assert.equal(retry.payload.fxProvenance, USDT_VND_ACCOUNTING_PROVENANCE);
    assert.equal(retry.payload.fxObservedAt, NOW.toISOString());
    assert.equal(retry.payload.price, candidate.price);

    const changed = freezeTransactionSubmissionIntent({
      previousIntent: retry,
      candidatePayload: { ...candidate, executionUnitPrice: 0.4, price: 0.4 * 25325 },
      idempotencyKey: retry.idempotencyKey,
      createIdempotencyKey
    });
    assert.equal(changed.idempotencyKey, 'generated-key-1');
    assert.notEqual(changed.signature, retry.signature);
  });
});
