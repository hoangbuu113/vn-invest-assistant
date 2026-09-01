import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../index.js';
import {
  isPrivateApiPath,
  MIN_OWNER_ACCESS_TOKEN_LENGTH,
  ownerTokensMatch,
  PRIVATE_API_PREFIXES,
  readBearerToken
} from '../src/auth.js';

const OWNER_TOKEN = 'test-owner-token-with-high-entropy-placeholder';

async function request(baseUrl, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    response,
    body: await response.json().catch(() => null)
  };
}

describe('Feature 30B1 — single-owner HTTP boundary', () => {
  let server;
  let baseUrl;
  const calls = [];

  before(async () => {
    const app = createApp({
      ownerAccessToken: OWNER_TOKEN,
      getInvestorProfileFn: async () => ({
        id: 'profile-1',
        cash_available: 100,
        risk_tolerance: 'moderate',
        investment_horizon: 'medium'
      }),
      getHoldingsFn: async () => [],
      getPortfolioTransactionsFn: async () => [],
      getCashOverviewFn: async () => ({ currentCash: 100 }),
      getCashLedgerFn: async () => [],
      getWatchlistFn: async () => [],
      getAlertsFn: async () => [],
      getAssetsFn: async () => [],
      getAssetBySymbolFn: async (symbol) => ({ id: symbol, symbol }),
      getMarketSnapshotFn: async (symbol) => ({ symbol, price: 1 }),
      getMarketRealtimeFn: async (symbol) => ({ symbol, price: 1 }),
      getMarketHistoryFn: async (symbol, range) => ({ symbol, range, bars: [] }),
      getAssetAnalysisFn: async (symbol) => ({ symbol }),
      getAssetComparisonFn: async () => ({ assets: [] }),
      getNewsFeedFn: async () => [],
      getVietnamRegimeFn: async () => ({
        partial: true,
        fetchedAt: '2026-09-01T00:00:00.000Z',
        inflation: { status: 'available' },
        moneyMarket: { status: 'unavailable' }
      }),
      createPortfolioTransactionFn: async (input) => {
        calls.push(['transaction', input]);
        return { transaction: input, holding: null, currentCash: 90 };
      },
      createCashMovementFn: async (input) => {
        calls.push(['cash', input]);
        return { entry: input, currentCash: 110 };
      },
      createOpeningPositionFn: async (input) => {
        calls.push(['opening', input]);
        return { openingPosition: input, holding: input };
      }
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('constant-time credential helpers reject missing, malformed, and wrong credentials', () => {
    assert.equal(readBearerToken(undefined), null);
    assert.equal(readBearerToken('Basic value'), null);
    assert.equal(readBearerToken('Bearer value with spaces'), null);
    assert.equal(readBearerToken('Bearer owner-token'), 'owner-token');
    assert.equal(ownerTokensMatch('same', 'same'), true);
    assert.equal(ownerTokensMatch('wrong', 'same'), false);
    assert.equal(ownerTokensMatch('', 'same'), false);
    assert.equal(OWNER_TOKEN.length >= MIN_OWNER_ACCESS_TOKEN_LENGTH, true);
  });

  test('route classifier covers the locked private surface without absorbing public routes', () => {
    for (const prefix of PRIVATE_API_PREFIXES) {
      assert.equal(isPrivateApiPath(prefix), true, prefix);
      assert.equal(isPrivateApiPath(`${prefix}/child?x=1`), true, prefix);
    }
    for (const path of [
      '/api/health',
      '/api/db-health',
      '/api/assets',
      '/api/assets/FPT',
      '/api/market/FPT',
      '/api/market/FPT/realtime',
      '/api/market/FPT/history',
      '/api/news',
      '/api/regime/vietnam',
      '/api/analysis/FPT',
      '/api/comparison'
    ]) {
      assert.equal(isPrivateApiPath(path), false, path);
    }
  });

  test('every actual personal route denies a missing owner token before validation or service access', async () => {
    const privateRoutes = [
      ['GET', '/api/owner/session'],
      ['GET', '/api/profile'],
      ['PUT', '/api/profile'],
      ['GET', '/api/holdings'],
      ['POST', '/api/positions/opening'],
      ['PATCH', '/api/positions/opening/opening-1'],
      ['POST', '/api/positions/opening/opening-1/cancel'],
      ['GET', '/api/transactions'],
      ['POST', '/api/transactions'],
      ['GET', '/api/cash/overview'],
      ['GET', '/api/cash/ledger'],
      ['POST', '/api/cash/deposit'],
      ['POST', '/api/cash/withdraw'],
      ['GET', '/api/news/personalized'],
      ['GET', '/api/opportunities'],
      ['POST', '/api/investment-brief'],
      ['GET', '/api/portfolio/overview'],
      ['GET', '/api/portfolio/composition'],
      ['GET', '/api/portfolio/performance'],
      ['GET', '/api/portfolio/performance/benchmark'],
      ['GET', '/api/watchlist'],
      ['POST', '/api/watchlist'],
      ['DELETE', '/api/watchlist/asset-1'],
      ['GET', '/api/alerts'],
      ['POST', '/api/alerts'],
      ['DELETE', '/api/alerts/alert-1'],
      ['POST', '/api/alerts/evaluate'],
      ['POST', '/api/alerts/alert-1/reactivate']
    ];

    for (const [method, path] of privateRoutes) {
      const { response, body } = await request(baseUrl, method, path);
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(body.code, 'OWNER_AUTH_REQUIRED', `${method} ${path}`);
    }
    assert.equal(calls.length, 0);
  });

  test('wrong token is denied generically and never appears in the response', async () => {
    const wrongToken = 'definitely-not-the-owner-token';
    const { response, body } = await request(baseUrl, 'GET', '/api/profile', { token: wrongToken });
    assert.equal(response.status, 403);
    assert.equal(body.code, 'OWNER_AUTH_INVALID');
    assert.doesNotMatch(JSON.stringify(body), new RegExp(wrongToken));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(OWNER_TOKEN));
  });

  test('correct token permits private reads and preserves financial mutation inputs', async () => {
    const session = await request(baseUrl, 'GET', '/api/owner/session', { token: OWNER_TOKEN });
    assert.equal(session.response.status, 200);
    assert.equal(session.body.data.unlocked, true);

    const profile = await request(baseUrl, 'GET', '/api/profile', { token: OWNER_TOKEN });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.data.id, 'profile-1');

    const transaction = await request(baseUrl, 'POST', '/api/transactions', {
      token: OWNER_TOKEN,
      body: { symbol: 'FPT', transactionType: 'BUY', quantity: 2.5, price: 123.45 }
    });
    assert.equal(transaction.response.status, 201);
    assert.deepEqual(calls[0], ['transaction', {
      symbol: 'FPT',
      assetId: undefined,
      transactionType: 'BUY',
      quantity: 2.5,
      price: 123.45,
      executedAt: undefined
    }]);

    const cash = await request(baseUrl, 'POST', '/api/cash/deposit', {
      token: OWNER_TOKEN,
      body: { amount: 10.25 }
    });
    assert.equal(cash.response.status, 201);
    assert.deepEqual(calls[1], ['cash', { entryType: 'DEPOSIT', amount: 10.25 }]);

    const opening = await request(baseUrl, 'POST', '/api/positions/opening', {
      token: OWNER_TOKEN,
      body: { assetId: 'asset-1', quantity: 4.5, averageCost: 20.25 }
    });
    assert.equal(opening.response.status, 201);
    assert.deepEqual(calls[2], ['opening', { assetId: 'asset-1', quantity: 4.5, averageCost: 20.25 }]);
  });

  test('public market and information routes remain reachable without credentials', async () => {
    const publicRoutes = [
      '/api/health',
      '/api/assets',
      '/api/assets/FPT',
      '/api/market/FPT',
      '/api/market/FPT/realtime',
      '/api/market/FPT/history?range=1M',
      '/api/news',
      '/api/regime/vietnam',
      '/api/analysis/FPT',
      '/api/comparison?symbols=FPT,VCB'
    ];
    for (const path of publicRoutes) {
      const { response } = await request(baseUrl, 'GET', path);
      assert.notEqual(response.status, 401, path);
      assert.notEqual(response.status, 403, path);
    }
  });
});

describe('Feature 30B1 — database permission and client separation contract', () => {
  test('forward migration removes public policies and privileges from every private table', async () => {
    const migration = await readFile(
      new URL('../../supabase/migrations/20260901000000_feature_30b1_single_owner_security.sql', import.meta.url),
      'utf8'
    );
    const privateTables = [
      'investor_profile',
      'holdings',
      'watchlist_items',
      'price_alerts',
      'portfolio_transactions',
      'cash_ledger_activation',
      'cash_ledger_entries',
      'position_ledger_activation',
      'position_opening_baselines'
    ];
    for (const table of privateTables) assert.match(migration, new RegExp(`public\\.${table}`));
    assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated;/);
    assert.match(migration, /TO service_role;/);
    assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.(?:cash_ledger_entries|portfolio_transactions|holdings)\b/i);
  });

  test('anon and authenticated lose every sensitive RPC while service_role retains execution', async () => {
    const migration = await readFile(
      new URL('../../supabase/migrations/20260901000000_feature_30b1_single_owner_security.sql', import.meta.url),
      'utf8'
    );
    const functions = [
      'create_portfolio_transaction',
      'list_portfolio_transactions',
      'get_cash_overview',
      'list_cash_ledger_entries',
      'create_cash_movement',
      'update_investor_profile_preferences',
      'create_opening_position',
      'correct_opening_position',
      'cancel_opening_position'
    ];
    for (const name of functions) {
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO service_role;`));
    }
  });

  test('private data access defaults to the service-role client and public metadata does not', async () => {
    const source = await readFile(new URL('../src/supabase.js', import.meta.url), 'utf8');
    assert.match(source, /export const publicSupabase/);
    assert.match(source, /export const privateSupabase/);
    assert.match(source, /serviceRoleKey/);
    assert.match(source, /getAssets\(client = supabase\)/);
    assert.match(source, /getInvestorProfile\(client = privateSupabase\)/);
    assert.match(source, /getHoldings\(client = privateSupabase\)/);
    assert.match(source, /getWatchlist\(client = privateSupabase\)/);
    assert.match(source, /getAlerts\(client = privateSupabase\)/);
  });
});

describe('Feature 30B1 — frontend session-only credential handling', () => {
  test('private requests receive the session token, public requests do not, and lock clears it', async () => {
    const values = new Map();
    globalThis.window = {
      sessionStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key)
      }
    };
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    try {
      const api = await import(`../../client/src/utils/api.js?security-test=${Date.now()}`);
      api.setOwnerAccessToken(OWNER_TOKEN);
      assert.equal(values.get(api.OWNER_TOKEN_SESSION_KEY), OWNER_TOKEN);
      await api.apiFetch('/api/profile');
      await api.apiFetch('/api/market/FPT');
      assert.equal(requests[0].options.headers.get('Authorization'), `Bearer ${OWNER_TOKEN}`);
      assert.equal(requests[1].options.headers.has('Authorization'), false);
      api.clearOwnerAccessToken();
      assert.equal(values.has(api.OWNER_TOKEN_SESSION_KEY), false);
      assert.equal(api.getOwnerAccessToken(), null);
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.window;
    }
  });

  test('unlock UI is password-based and no frontend source uses localStorage', async () => {
    const gate = await readFile(new URL('../../client/src/components/OwnerGate.jsx', import.meta.url), 'utf8');
    const api = await readFile(new URL('../../client/src/utils/api.js', import.meta.url), 'utf8');
    assert.match(gate, /type="password"/);
    assert.match(gate, /clearOwnerAccessToken/);
    assert.match(api, /sessionStorage/);
    assert.doesNotMatch(`${gate}\n${api}`, /localStorage/);
  });
});
