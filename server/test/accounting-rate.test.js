import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';

import { createApp } from '../index.js';
import {
  CURRENT_ACCOUNTING_RATE_MAX_AGE_MS,
  HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS,
  USDT_VND_ACCOUNTING_PROVENANCE,
  getAccountingRate,
  isCoinGeckoAccountingRateEnabled,
  issueAccountingRateQuoteProof,
  verifyAccountingRateQuoteProof
} from '../src/accountingRate.js';
import {
  getCoinGeckoCurrentUsdtVndObservation,
  getCoinGeckoHistoricalUsdtVndObservations
} from '../src/providers/coingecko.js';
import {
  createPortfolioTransaction,
  hasPortfolioIdempotencyRecord
} from '../src/transactions.js';
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
const QUOTE_SECRET = 'test-accounting-rate-quote-secret-at-least-32-bytes';

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

function accountingRateResult({
  rate = 25325,
  observedAt = NOW.toISOString(),
  mode = 'CURRENT',
  requestedAt = mode === 'HISTORICAL' ? NOW.toISOString() : NOW.toISOString()
} = {}) {
  const requestedMs = Date.parse(requestedAt);
  const observedMs = Date.parse(observedAt);
  return {
    availability: 'available',
    baseCurrency: 'USDT',
    quoteCurrency: 'VND',
    rate,
    provider: 'CoinGecko',
    provenance: USDT_VND_ACCOUNTING_PROVENANCE,
    observedAt,
    requestedAt,
    observationDeltaMs: Math.abs(observedMs - requestedMs),
    mode,
    reason: null
  };
}

function signedAccountingRate(result, { now = NOW } = {}) {
  const quoteProof = issueAccountingRateQuoteProof(result, {
    secret: QUOTE_SECRET,
    now
  });
  assert.equal(typeof quoteProof, 'string');
  return { ...result, quoteProof };
}

function automaticTransactionBody(quote, overrides = {}) {
  const executionUnitPrice = overrides.executionUnitPrice ?? 0.36402;
  const fxRateToVnd = overrides.fxRateToVnd ?? quote.rate;
  return {
    symbol: 'ONDO',
    transactionType: 'BUY',
    quantity: 225.86,
    price: executionUnitPrice * fxRateToVnd,
    executionUnitPrice,
    priceCurrency: 'USDT',
    settlementMode: 'EXTERNAL_SETTLEMENT',
    settlementCurrency: null,
    fxRateToVnd,
    fxProvenance: USDT_VND_ACCOUNTING_PROVENANCE,
    fxObservedAt: quote.observedAt,
    quoteProof: quote.quoteProof,
    ...overrides
  };
}

function tamperQuoteProofClaims(quoteProof, mutateClaims) {
  const [encodedClaims, signature] = quoteProof.split('.');
  const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
  mutateClaims(claims);
  return `${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${signature}`;
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
      },
      accountingRateEnabled: true,
      accountingRateQuoteSecret: QUOTE_SECRET,
      accountingRateNowFn: () => NOW
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
      assert.equal(typeof currentBody.data.quoteProof, 'string');
      const verifiedCurrent = verifyAccountingRateQuoteProof(currentBody.data.quoteProof, {
        secret: QUOTE_SECRET
      });
      assert.equal(verifiedCurrent.valid, true);
      assert.equal(verifiedCurrent.claims.rate, '25300');
      assert.equal(verifiedCurrent.claims.mode, 'CURRENT');
      assert.equal(verifiedCurrent.claims.requestedExecutedAt, null);
      assert.doesNotMatch(JSON.stringify(currentBody), new RegExp(QUOTE_SECRET));
      assert.deepEqual(calls[0], {
        baseCurrency: 'USDT',
        quoteCurrency: 'VND',
        at: undefined
      });

      const historical = await ownerFetch(
        `${baseUrl}/api/accounting-rate?base=USDT&quote=VND&at=2026-09-12T17%3A00%3A00%2B07%3A00`
      );
      assert.equal(historical.status, 200);
      const historicalBody = await historical.json();
      const verifiedHistorical = verifyAccountingRateQuoteProof(historicalBody.data.quoteProof, {
        secret: QUOTE_SECRET
      });
      assert.equal(verifiedHistorical.valid, true);
      assert.equal(verifiedHistorical.claims.mode, 'HISTORICAL');
      assert.equal(verifiedHistorical.claims.requestedExecutedAt, '2026-09-12T10:00:00.000Z');
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

  test('available accounting rate fails closed when the dedicated signing secret is missing', async () => {
    let writes = 0;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAccountingRateFn: async () => accountingRateResult(),
      createPortfolioTransactionFn: async () => {
        writes += 1;
        return { transaction: { id: 'unexpected-write' }, replayed: false };
      },
      accountingRateEnabled: true,
      accountingRateQuoteSecret: null,
      accountingRateNowFn: () => NOW
    });
    const { server, baseUrl } = await listen(app);

    try {
      const response = await ownerFetch(`${baseUrl}/api/accounting-rate?base=USDT&quote=VND`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.data.availability, 'unavailable');
      assert.equal(body.data.rate, null);
      assert.equal(body.data.provenance, null);
      assert.equal(body.data.quoteProof, null);
      assert.equal(body.data.reason, 'QUOTE_PROOF_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(body), new RegExp(QUOTE_SECRET));

      const signedQuote = signedAccountingRate(accountingRateResult());
      const rejectedWrite = await ownerFetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'missing-signing-secret'
        },
        body: JSON.stringify(automaticTransactionBody(signedQuote))
      });
      assert.equal(rejectedWrite.status, 400);
      assert.equal(writes, 0);
      const rejectedBody = await rejectedWrite.json();
      assert.match(rejectedBody.errors.join(' '), /quote signing is not configured/);
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
      hasPortfolioIdempotencyRecordFn: async () => false,
      accountingRateEnabled: true,
      accountingRateQuoteSecret: QUOTE_SECRET,
      accountingRateNowFn: () => NOW
    });
    const { server, baseUrl } = await listen(app);
    const quote = signedAccountingRate(accountingRateResult());
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
      fxObservedAt: NOW.toISOString(),
      quoteProof: quote.quoteProof
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

  test('transaction write boundary requires an untampered server proof and preserves manual fallback', async () => {
    const currentQuote = signedAccountingRate(accountingRateResult());
    const automaticBody = automaticTransactionBody(currentQuote);
    const acceptedWrites = [];
    let requestNumber = 0;
    let resolverCalls = 0;
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
      },
      getAccountingRateFn: async () => {
        resolverCalls += 1;
        throw new Error('POST must not resolve CoinGecko again');
      },
      hasPortfolioIdempotencyRecordFn: async () => false,
      accountingRateQuoteSecret: QUOTE_SECRET,
      accountingRateNowFn: () => NOW
    };

    const post = (baseUrl, body) => ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `accounting-authority-${++requestNumber}`
      },
      body: JSON.stringify(body)
    });

    const expectRejectedWithoutWrite = async (baseUrl, body, messagePattern) => {
      const writesBefore = acceptedWrites.length;
      const response = await post(baseUrl, body);
      assert.equal(response.status, 400);
      assert.equal(acceptedWrites.length, writesBefore);
      if (messagePattern) {
        const responseBody = await response.json();
        assert.match(responseBody.errors.join(' '), messagePattern);
      }
    };

    const disabled = await listen(createApp({
      ...services,
      accountingRateEnabled: false
    }));
    try {
      await expectRejectedWithoutWrite(
        disabled.baseUrl,
        automaticBody,
        /automatic accounting rates are disabled/
      );

      const acceptedManual = await post(disabled.baseUrl, {
          ...automaticBody,
          price: 9500,
          fxRateToVnd: undefined,
          fxObservedAt: undefined,
          fxProvenance: 'USER_SUPPLIED_VND_BASIS',
          quoteProof: undefined
      });
      assert.equal(acceptedManual.status, 201);
      assert.equal(acceptedWrites[0].fxProvenance, 'USER_SUPPLIED_VND_BASIS');
    } finally {
      await new Promise((resolve) => disabled.server.close(resolve));
    }

    const enabled = await listen(createApp({
      ...services,
      accountingRateEnabled: true
    }));
    try {
      await expectRejectedWithoutWrite(
        enabled.baseUrl,
        { ...automaticBody, quoteProof: undefined },
        /quoteProof is invalid/
      );

      const [claims, signature] = automaticBody.quoteProof.split('.');
      const forgedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
      await expectRejectedWithoutWrite(
        enabled.baseUrl,
        { ...automaticBody, quoteProof: `${claims}.${forgedSignature}` },
        /QUOTE_PROOF_SIGNATURE_INVALID/
      );

      const acceptedAutomatic = await post(enabled.baseUrl, automaticBody);
      assert.equal(acceptedAutomatic.status, 201);
      assert.equal(acceptedWrites[1].fxProvenance, USDT_VND_ACCOUNTING_PROVENANCE);
      assert.equal(acceptedWrites[1].price, automaticBody.executionUnitPrice * automaticBody.fxRateToVnd);
      assert.equal(Object.hasOwn(acceptedWrites[1], 'quoteProof'), false);

      await expectRejectedWithoutWrite(enabled.baseUrl, automaticTransactionBody(currentQuote, {
        fxRateToVnd: 26000,
        price: 0.36402 * 26000
      }), /quoteProof rate does not match/);

      await expectRejectedWithoutWrite(enabled.baseUrl, {
        ...automaticBody,
        fxObservedAt: '2026-09-12T11:59:59.000Z'
      }, /quoteProof observedAt does not match/);

      await expectRejectedWithoutWrite(enabled.baseUrl, {
        ...automaticBody,
        fxProvenance: 'USER_SUPPLIED_VND_BASIS'
      }, /quoteProof is only valid/);

      await expectRejectedWithoutWrite(enabled.baseUrl, {
        ...automaticBody,
        price: automaticBody.price + 100
      }, /price must match executionUnitPrice multiplied by fxRateToVnd/);

      await expectRejectedWithoutWrite(enabled.baseUrl, {
        ...automaticBody,
        quoteProof: tamperQuoteProofClaims(automaticBody.quoteProof, (proofClaims) => {
          proofClaims.mode = 'HISTORICAL';
          proofClaims.requestedExecutedAt = NOW.toISOString();
        })
      }, /QUOTE_PROOF_SIGNATURE_INVALID/);

      const exactCurrent = signedAccountingRate(accountingRateResult({
        observedAt: new Date(NOW.getTime() - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS).toISOString()
      }));
      const acceptedBoundary = await post(enabled.baseUrl, automaticTransactionBody(exactCurrent));
      assert.equal(acceptedBoundary.status, 201);

      const staleCurrent = signedAccountingRate(accountingRateResult({
        observedAt: new Date(NOW.getTime() - CURRENT_ACCOUNTING_RATE_MAX_AGE_MS - 1).toISOString()
      }));
      await expectRejectedWithoutWrite(
        enabled.baseUrl,
        automaticTransactionBody(staleCurrent),
        /CURRENT quoteProof observation is stale/
      );

      const historicalExecutedAt = '2026-09-12T10:00:00.000Z';
      const exactHistorical = signedAccountingRate(accountingRateResult({
        mode: 'HISTORICAL',
        requestedAt: historicalExecutedAt,
        observedAt: new Date(
          Date.parse(historicalExecutedAt) - HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS
        ).toISOString()
      }));
      const acceptedHistoricalBoundary = await post(enabled.baseUrl, automaticTransactionBody(
        exactHistorical,
        { executedAt: historicalExecutedAt }
      ));
      assert.equal(acceptedHistoricalBoundary.status, 201);

      const acceptedHistoricalEquivalent = await post(enabled.baseUrl, automaticTransactionBody(
        exactHistorical,
        { executedAt: '2026-09-12T17:00:00.000+07:00' }
      ));
      assert.equal(acceptedHistoricalEquivalent.status, 201);

      const distantHistorical = signedAccountingRate(accountingRateResult({
        mode: 'HISTORICAL',
        requestedAt: historicalExecutedAt,
        observedAt: new Date(
          Date.parse(historicalExecutedAt) - HISTORICAL_ACCOUNTING_RATE_MAX_DELTA_MS - 1
        ).toISOString()
      }));
      await expectRejectedWithoutWrite(
        enabled.baseUrl,
        automaticTransactionBody(distantHistorical, { executedAt: historicalExecutedAt }),
        /more than 60 minutes/
      );

      await expectRejectedWithoutWrite(enabled.baseUrl, automaticTransactionBody(
        exactHistorical,
        { executedAt: '2026-09-12T10:01:00.000Z' }
      ), /does not match submitted executedAt/);

      await expectRejectedWithoutWrite(enabled.baseUrl, {
        ...automaticTransactionBody(exactHistorical, { executedAt: historicalExecutedAt }),
        quoteProof: tamperQuoteProofClaims(exactHistorical.quoteProof, (proofClaims) => {
          proofClaims.requestedExecutedAt = '2026-09-12T10:01:00.000Z';
        })
      }, /QUOTE_PROOF_SIGNATURE_INVALID/);
      assert.equal(resolverCalls, 0);
    } finally {
      await new Promise((resolve) => enabled.server.close(resolve));
    }
  });

  test('malformed quote proofs fail at the API boundary without an idempotency lookup or financial write', async () => {
    const quote = signedAccountingRate(accountingRateResult());
    let idempotencyLookups = 0;
    let writes = 0;
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
      hasPortfolioIdempotencyRecordFn: async () => {
        idempotencyLookups += 1;
        return false;
      },
      createPortfolioTransactionFn: async () => {
        writes += 1;
        return { transaction: { id: 'unexpected-write' }, replayed: false };
      },
      accountingRateEnabled: true,
      accountingRateQuoteSecret: QUOTE_SECRET,
      accountingRateNowFn: () => NOW
    });
    const { server, baseUrl } = await listen(app);

    try {
      for (const [index, quoteProof] of ['not-a-token', 'abc.$$$'].entries()) {
        const response = await ownerFetch(`${baseUrl}/api/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `malformed-proof-${index}`
          },
          body: JSON.stringify(automaticTransactionBody(quote, { quoteProof }))
        });
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.match(body.errors.join(' '), /QUOTE_PROOF_MALFORMED/);
      }
      assert.equal(idempotencyLookups, 0);
      assert.equal(writes, 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('automatic accounting price uses only a bounded 0.05 VND absolute tolerance', async () => {
    const quote = signedAccountingRate(accountingRateResult());
    const writes = [];
    let requestNumber = 0;
    const app = createApp({
      getProfileByUserIdFn: async () => ({ id: PROFILE_ID }),
      getAssetBySymbolFn: async () => ({
        id: 'asset-btc',
        symbol: 'BTC',
        asset_type: 'crypto',
        quote_currency: 'USD',
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE',
        is_active: true
      }),
      hasPortfolioIdempotencyRecordFn: async () => false,
      createPortfolioTransactionFn: async (payload) => {
        writes.push(payload);
        return { transaction: { id: `tx-${writes.length}`, ...payload }, replayed: false };
      },
      accountingRateEnabled: true,
      accountingRateQuoteSecret: QUOTE_SECRET,
      accountingRateNowFn: () => NOW
    });
    const { server, baseUrl } = await listen(app);
    const executionUnitPrice = 100000;
    const expectedPrice = executionUnitPrice * quote.rate;

    const post = (price) => ownerFetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `bounded-price-${++requestNumber}`
      },
      body: JSON.stringify(automaticTransactionBody(quote, {
        symbol: 'BTC',
        quantity: 1,
        executionUnitPrice,
        price
      }))
    });

    try {
      assert.equal((await post(expectedPrice)).status, 201);
      assert.equal((await post(expectedPrice + 0.04)).status, 201);
      assert.equal(writes.length, 2);

      const outsideTolerance = await post(expectedPrice + 0.051);
      assert.equal(outsideTolerance.status, 400);
      assert.equal(writes.length, 2);

      const auditedHighValueTamper = await post(expectedPrice + 200000);
      assert.equal(auditedHighValueTamper.status, 400);
      assert.equal(writes.length, 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('idempotency precheck reads only existence scoped to authenticated profile and key', async () => {
    const calls = { table: null, columns: null, filters: [] };
    const query = {
      select(columns) {
        calls.columns = columns;
        return this;
      },
      eq(column, value) {
        calls.filters.push([column, value]);
        return this;
      },
      async maybeSingle() {
        return { data: { idempotency_key: 'retry-key' }, error: null };
      }
    };
    const exists = await hasPortfolioIdempotencyRecord({
      profileId: PROFILE_ID,
      idempotencyKey: ' retry-key '
    }, {
      from(table) {
        calls.table = table;
        return query;
      }
    });

    assert.equal(exists, true);
    assert.equal(calls.table, 'portfolio_idempotency_records');
    assert.equal(calls.columns, 'idempotency_key');
    assert.deepEqual(calls.filters, [
      ['profile_id', PROFILE_ID],
      ['idempotency_key', 'retry-key']
    ]);
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
      quoteProof: 'server-issued-proof',
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
    assert.equal(state.quote.quoteProof, 'server-issued-proof');

    const missingProof = normalizeUsdtVndAccountingRate({
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
    assert.equal(missingProof.status, ACCOUNTING_RATE_UI_STATUS.UNAVAILABLE);
    assert.equal(missingProof.quote, null);

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
      fxObservedAt: NOW.toISOString(),
      quoteProof: 'server-issued-proof'
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
    assert.equal(retry.payload.quoteProof, 'server-issued-proof');
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
