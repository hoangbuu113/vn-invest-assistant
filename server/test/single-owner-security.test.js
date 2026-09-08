import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../index.js';
import {
  isPrivateApiPath,
  ownerTokensMatch,
  PRIVATE_API_PREFIXES,
  readBearerToken,
  timingSafeTokenMatch
} from '../src/auth.js';
import { APP_API_BASE_URL, proxyApiRequest } from '../../client/server/index.js';
import { resolvePrivilegedSupabaseKey } from '../src/supabase.js';

const VALID_USER_JWT = 'header.payload.signature_valid_jwt';
const RETIRED_OWNER_TOKEN = 'test-owner-token-with-high-entropy-placeholder';

async function request(baseUrl, method, path, { token, cookie, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
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

describe('Public Multi-User HTTP & Security Boundary', () => {
  let server;
  let baseUrl;
  const calls = [];

  const mockSupabaseAuthClient = {
    auth: {
      getUser: async (token) => {
        if (token === VALID_USER_JWT) {
          return {
            data: { user: { id: 'user-1', email: 'user1@example.com' } },
            error: null
          };
        }
        return { data: { user: null }, error: new Error('Invalid token') };
      }
    }
  };

  before(async () => {
    const app = createApp({
      supabaseAuthClient: mockSupabaseAuthClient,
      getProfileByUserIdFn: async (userId) => ({
        id: `profile-${userId}`,
        user_id: userId,
        cash_available: 100,
        risk_tolerance: 'moderate',
        investment_horizon: 'medium'
      }),
      getProfileByIdFn: async (id) => ({
        id,
        user_id: 'user-1',
        cash_available: 100,
        risk_tolerance: 'moderate',
        investment_horizon: 'medium'
      }),
      getInvestorProfileFn: async () => ({
        id: 'profile-user-1',
        user_id: 'user-1',
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
      getAssetByIdFn: async (id) => ({
        id,
        symbol: id,
        asset_type: 'stock',
        quote_currency: 'VND',
        is_active: true,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      }),
      getAssetBySymbolFn: async (symbol) => ({
        id: symbol,
        symbol,
        asset_type: 'stock',
        quote_currency: 'VND',
        is_active: true,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      }),
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
    assert.equal(readBearerToken('Bearer some-token'), 'some-token');
    assert.equal(timingSafeTokenMatch('same', 'same'), true);
    assert.equal(timingSafeTokenMatch('wrong', 'same'), false);
    assert.equal(timingSafeTokenMatch('', 'same'), false);
    assert.equal(ownerTokensMatch('same', 'same'), true);
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
    assert.equal(isPrivateApiPath('/api/market-strategist', 'GET'), false);
    assert.equal(isPrivateApiPath('/api/market-strategist', 'POST'), true);
  });

  test('every actual personal route denies missing credentials with 401 AUTH_REQUIRED', async () => {
    const privateRoutes = [
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
      ['POST', '/api/market-strategist'],
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
      ['POST', '/api/alerts/alert-1/reactivate'],
      ['GET', '/api/push/config'],
      ['POST', '/api/push/subscriptions'],
      ['DELETE', '/api/push/subscriptions']
    ];

    for (const [method, path] of privateRoutes) {
      const { response, body } = await request(baseUrl, method, path);
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(body.code, 'AUTH_REQUIRED', `${method} ${path}`);
    }
    assert.equal(calls.length, 0);
  });

  test('retired legacy owner credentials return 401 AUTH_INVALID', async () => {
    const { response, body } = await request(baseUrl, 'GET', '/api/profile', { token: RETIRED_OWNER_TOKEN });
    assert.equal(response.status, 401);
    assert.equal(body.code, 'AUTH_INVALID');
  });

  test('retired owner session endpoints return 404', async () => {
    const postRes = await request(baseUrl, 'POST', '/api/owner/session', { body: { ownerCredential: RETIRED_OWNER_TOKEN } });
    assert.equal(postRes.response.status, 404);

    const getRes = await request(baseUrl, 'GET', '/api/owner/session');
    assert.equal(getRes.response.status, 404);

    const deleteRes = await request(baseUrl, 'DELETE', '/api/owner/session');
    assert.equal(deleteRes.response.status, 404);
  });

  test('valid Supabase JWT permits private reads and preserves mutation inputs', async () => {
    const profile = await request(baseUrl, 'GET', '/api/profile', { token: VALID_USER_JWT });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.body.data.id, 'profile-user-1');

    const transaction = await request(baseUrl, 'POST', '/api/transactions', {
      token: VALID_USER_JWT,
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
      token: VALID_USER_JWT,
      body: { amount: 10.25 }
    });
    assert.equal(cash.response.status, 201);
    assert.deepEqual(calls[1], ['cash', { entryType: 'DEPOSIT', amount: 10.25 }]);
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

describe('Database permission and client separation contract', () => {
  test('modern Supabase secret keys take precedence while legacy keys remain a fail-closed fallback', () => {
    const modernKey = 'sb_secret_modern-server-key';
    const legacyKey = 'legacy-service-role-key';

    assert.equal(resolvePrivilegedSupabaseKey({
      SUPABASE_SECRET_KEY: modernKey,
      SUPABASE_SERVICE_ROLE_KEY: legacyKey
    }), modernKey);
    assert.equal(resolvePrivilegedSupabaseKey({
      SUPABASE_SERVICE_ROLE_KEY: legacyKey
    }), legacyKey);
    assert.equal(resolvePrivilegedSupabaseKey({}), null);
    assert.equal(resolvePrivilegedSupabaseKey({
      SUPABASE_SECRET_KEY: 'your-supabase-secret-key',
      SUPABASE_SERVICE_ROLE_KEY: 'your-supabase-service-role-key'
    }), null);
  });

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
    assert.match(source, /resolvePrivilegedSupabaseKey/);
    assert.match(source, /getAssets\(client = supabase\)/);
    assert.match(source, /getInvestorProfile\(client = privateSupabase\)/);
    assert.match(source, /getHoldings\(client = privateSupabase\)/);
    assert.match(source, /getWatchlist\(client = privateSupabase\)/);
    assert.match(source, /getAlerts\(client = privateSupabase\)/);
  });
});

describe('Public auth frontend boundary & retired UI', () => {
  test('browser requests attach JWT and dispatch AUTH_INVALID_EVENT on 401', async () => {
    const dispatchedEvents = [];
    globalThis.window = {
      dispatchEvent: (event) => dispatchedEvents.push(event.type)
    };
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ status: 'error' }), {
        status: url === '/api/profile' ? 401 : 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    try {
      const api = await import(`../../client/src/utils/api.js?security-test=${Date.now()}`);
      await api.apiFetch('/api/profile');
      await api.apiFetch('/api/market/FPT');
      assert.equal(requests[0].url, '/api/profile');
      assert.deepEqual(dispatchedEvents, [api.AUTH_INVALID_EVENT]);
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.window;
    }
  });

  test('legacy OwnerGate and LegacyClaimModal UI are completely retired', async () => {
    const ownerGateExists = await access(
      new URL('../../client/src/components/OwnerGate.jsx', import.meta.url)
    ).then(() => true).catch(() => false);
    assert.equal(ownerGateExists, false, 'OwnerGate.jsx must be deleted and retired');

    const legacyClaimExists = await access(
      new URL('../../client/src/components/LegacyClaimModal.jsx', import.meta.url)
    ).then(() => true).catch(() => false);
    assert.equal(legacyClaimExists, false, 'LegacyClaimModal.jsx must be deleted and retired');

    const api = await readFile(new URL('../../client/src/utils/api.js', import.meta.url), 'utf8');
    assert.doesNotMatch(api, /OWNER_SESSION_INVALID_EVENT/);
    assert.doesNotMatch(api, /OWNER_ACCESS_TOKEN/);
  });

  test('Cloudflare worker proxies API requests correctly', async () => {
    let proxiedRequest;
    const response = await proxyApiRequest(new Request(
      'https://vn-invest-assistant.vn-invest-assistant.workers.dev/api/profile?view=compact',
      { headers: { Authorization: `Bearer ${VALID_USER_JWT}` } }
    ), async (request) => {
      proxiedRequest = request;
      return new Response('{"status":"ok"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    assert.equal(proxiedRequest.url, `${APP_API_BASE_URL}/api/profile?view=compact`);
    assert.equal(proxiedRequest.headers.get('authorization'), `Bearer ${VALID_USER_JWT}`);
    assert.equal(response.status, 200);
  });
});
