import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../index.js';
import { isJwtCandidate } from '../src/auth.js';

const SCHEDULER_TOKEN = 'test-alert-scheduler-token-secret-456';
const RETIRED_OWNER_TOKEN = 'test-legacy-owner-token-secure-entropy-key-123';

// Simulated JWT generator for testing
function makeMockJwt(userId, email = `${userId}@example.com`) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const sig = 'mock_valid_signature';
  return `${header}.${payload}.${sig}`;
}

async function request(baseUrl, method, path, { token, cookie, headers = {}, body } = {}) {
  const reqHeaders = { ...headers };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  if (cookie) reqHeaders.Cookie = cookie;
  if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: reqHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    response,
    body: await response.json().catch(() => null)
  };
}

describe('Public Multi-User Supabase Authentication Backend', () => {
  let server;
  let baseUrl;

  // In-memory mock database state
  let profiles = [];
  let holdings = [];
  let transactions = [];
  let cashLedger = [];
  let watchlists = [];
  let alerts = [];
  let pushSubscriptions = [];

  function resetDb() {
    profiles = [];
    holdings = [];
    transactions = [];
    cashLedger = [];
    watchlists = [];
    alerts = [];
    pushSubscriptions = [];
  }

  // Mock Supabase Auth client
  const mockSupabaseAuthClient = {
    auth: {
      getUser: async (jwtToken) => {
        if (!jwtToken || !isJwtCandidate(jwtToken)) {
          return { data: { user: null }, error: new Error('Invalid token format') };
        }
        if (jwtToken.includes('expired') || jwtToken.includes('malformed') || jwtToken.includes('invalid')) {
          return { data: { user: null }, error: new Error('Token is expired or invalid') };
        }
        try {
          const parts = jwtToken.split('.');
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          return {
            data: {
              user: {
                id: payload.sub,
                email: payload.email,
                aud: 'authenticated',
                role: 'authenticated'
              }
            },
            error: null
          };
        } catch (err) {
          return { data: { user: null }, error: err };
        }
      }
    }
  };

  before(async () => {
    resetDb();

    const app = createApp({
      alertSchedulerToken: SCHEDULER_TOKEN,
      supabaseAuthClient: mockSupabaseAuthClient,

      getAssetByIdFn: async (id) => ({
        id,
        symbol: id === 'asset-vcb' ? 'VCB' : 'FPT',
        asset_type: 'stock',
        quote_currency: 'VND',
        is_active: true,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      }),
      getAssetBySymbolFn: async (symbol) => ({
        id: `asset-${symbol.toLowerCase()}`,
        symbol,
        asset_type: 'stock',
        quote_currency: 'VND',
        is_active: true,
        portfolio_eligibility: 'PORTFOLIO_ELIGIBLE'
      }),

      getInvestorProfileFn: async () => profiles[0] || null,
      getProfileByIdFn: async (id) => profiles.find(p => p.id === id) || null,
      getProfileByUserIdFn: async (userId) => profiles.find(p => p.user_id === userId) || null,

      createProfileForUserFn: async (arg1, arg2) => {
        const userId = typeof arg1 === 'string' ? arg1 : (arg1?.userId || arg1?.user_id);
        const initialData = typeof arg1 === 'object' ? arg1 : (arg2 || {});
        const existing = profiles.find(p => p.user_id === userId);
        if (existing) return existing;
        const newProfile = {
          id: `profile-${userId}`,
          user_id: userId,
          cash_available: 0,
          risk_tolerance: initialData.risk_tolerance || initialData.riskTolerance || 'moderate',
          investment_horizon: initialData.investment_horizon || initialData.investmentHorizon || 'medium',
          created_at: new Date().toISOString()
        };
        profiles.push(newProfile);
        return newProfile;
      },

      getHoldingsFn: async (client, options = {}) => {
        const pid = options?.profileId;
        return holdings.filter(h => h.profile_id === pid);
      },

      getPortfolioTransactionsFn: async ({ profileId, symbol } = {}, client, options = {}) => {
        const pid = profileId || options?.profileId;
        return transactions.filter(t => t.profile_id === pid);
      },

      createPortfolioTransactionFn: async (input, client, options = {}) => {
        const pid = options?.profileId;
        const tx = { id: `tx-${Date.now()}`, profile_id: pid, ...input };
        transactions.push(tx);
        return tx;
      },

      getCashOverviewFn: async (client, options = {}) => {
        const pid = options?.profileId;
        const prof = profiles.find(p => p.id === pid);
        return { currentCash: prof ? prof.cash_available : 0 };
      },

      createCashMovementFn: async (input, client, options = {}) => {
        const pid = options?.profileId;
        const entry = { id: `cash-${Date.now()}`, profile_id: pid, ...input };
        cashLedger.push(entry);
        const prof = profiles.find(p => p.id === pid);
        if (prof) {
          if (input.entryType === 'DEPOSIT') prof.cash_available += input.amount;
          if (input.entryType === 'WITHDRAWAL') prof.cash_available -= input.amount;
        }
        return { entry, currentCash: prof ? prof.cash_available : 0 };
      },

      getWatchlistFn: async (client, options = {}) => {
        const pid = options?.profileId;
        return watchlists.filter(w => w.profile_id === pid);
      },

      addToWatchlistFn: async ({ profileId, asset_id, symbol } = {}) => {
        const item = { id: `w-${Date.now()}`, profile_id: profileId, asset_id, symbol };
        watchlists.push(item);
        return item;
      },

      getAlertsFn: async (client, options = {}) => {
        const pid = options?.profileId;
        return alerts.filter(a => a.profile_id === pid);
      },

      createAlertFn: async ({ profileId, asset_id, symbol, direction, target_price } = {}) => {
        const alert = { id: `alert-${Date.now()}`, profile_id: profileId, asset_id, symbol, direction, target_price, active: true };
        alerts.push(alert);
        return alert;
      },

      evaluateAndPersistAlertsFn: async () => {
        return { evaluated: alerts.length, triggered: 0 };
      },

      upsertPushSubscriptionFn: async (input) => {
        const sub = { id: `push-${Date.now()}`, ...input };
        pushSubscriptions.push(sub);
        return sub;
      }
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    resetDb();
  });

  // =========================================================================
  // 1. JWT VERIFICATION & FAILURE MODES
  // =========================================================================
  describe('1. JWT Verification & Failure Modes', () => {
    test('missing authorization header returns 401 AUTH_REQUIRED', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile');
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });

    test('malformed authorization header returns 401 AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        headers: { Authorization: 'NotABearerToken' }
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_INVALID');
    });

    test('expired or invalid JWT token returns 401 AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        token: 'eyJhbGciOiJIUzI1NiJ9.expired_payload.invalid_sig'
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_INVALID');
    });

    test('retired legacy OWNER_ACCESS_TOKEN is rejected with 401 AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        token: RETIRED_OWNER_TOKEN
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_INVALID');
    });

    test('retired legacy owner cookie is ignored and returns 401 AUTH_REQUIRED', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        cookie: 'vn_invest_owner_session=old-session-token'
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_REQUIRED');
    });
  });

  // =========================================================================
  // 2. AUTHENTICATED USER PROFILE RESOLUTION & CREATION
  // =========================================================================
  describe('2. Profile Resolution & Empty Isolated Profile Creation', () => {
    test('authenticated user without profile receives 403 PROFILE_REQUIRED on GET /api/profile', async () => {
      const jwt = makeMockJwt('user-new-1', 'user1@example.com');
      const res = await request(baseUrl, 'GET', '/api/profile', { token: jwt });
      assert.equal(res.response.status, 403);
      assert.equal(res.body.code, 'PROFILE_REQUIRED');
    });

    test('POST /api/profile initializes empty isolated profile with cash = 0', async () => {
      const jwt = makeMockJwt('user-new-1', 'user1@example.com');
      const createRes = await request(baseUrl, 'POST', '/api/profile', {
        token: jwt,
        body: {}
      });
      assert.equal(createRes.response.status, 201);
      assert.equal(createRes.body.status, 'ok');
      assert.equal(createRes.body.data.user_id, 'user-new-1');
      assert.equal(createRes.body.data.cash_available, 0);

      // Now GET /api/profile succeeds with 200
      const getRes = await request(baseUrl, 'GET', '/api/profile', { token: jwt });
      assert.equal(getRes.response.status, 200);
      assert.equal(getRes.body.data.id, 'profile-user-new-1');
      assert.equal(getRes.body.data.cash_available, 0);
    });

    test('duplicate POST /api/profile is idempotent and returns existing profile', async () => {
      const jwt = makeMockJwt('user-new-1', 'user1@example.com');
      await request(baseUrl, 'POST', '/api/profile', { token: jwt, body: {} });

      const dupRes = await request(baseUrl, 'POST', '/api/profile', { token: jwt, body: {} });
      assert.equal(dupRes.response.status, 200);
      assert.equal(dupRes.body.data.id, 'profile-user-new-1');
    });
  });

  // =========================================================================
  // 3. MULTI-USER ISOLATION ON PRIVATE RESOURCES
  // =========================================================================
  describe('3. Multi-User Isolation On Private Resources', () => {
    let userAJwt, userBJwt;

    beforeEach(async () => {
      userAJwt = makeMockJwt('user-a', 'a@example.com');
      userBJwt = makeMockJwt('user-b', 'b@example.com');

      await request(baseUrl, 'POST', '/api/profile', { token: userAJwt, body: {} });
      await request(baseUrl, 'POST', '/api/profile', { token: userBJwt, body: {} });
    });

    test('two users get strictly separate profiles', async () => {
      const resA = await request(baseUrl, 'GET', '/api/profile', { token: userAJwt });
      const resB = await request(baseUrl, 'GET', '/api/profile', { token: userBJwt });

      assert.equal(resA.body.data.id, 'profile-user-a');
      assert.equal(resB.body.data.id, 'profile-user-b');
      assert.notEqual(resA.body.data.id, resB.body.data.id);
    });

    test('cash movements by User A do not affect User B', async () => {
      await request(baseUrl, 'POST', '/api/cash/deposit', {
        token: userAJwt,
        body: { amount: 50000000 }
      });

      const cashA = await request(baseUrl, 'GET', '/api/cash/overview', { token: userAJwt });
      const cashB = await request(baseUrl, 'GET', '/api/cash/overview', { token: userBJwt });

      assert.equal(cashA.body.data.currentCash, 50000000);
      assert.equal(cashB.body.data.currentCash, 0);
    });

    test('transactions and holdings are strictly isolated between users', async () => {
      await request(baseUrl, 'POST', '/api/transactions', {
        token: userAJwt,
        body: { symbol: 'FPT', transactionType: 'BUY', quantity: 100, price: 110000 }
      });

      const txsA = await request(baseUrl, 'GET', '/api/transactions', { token: userAJwt });
      const txsB = await request(baseUrl, 'GET', '/api/transactions', { token: userBJwt });

      assert.equal(txsA.body.count, 1);
      assert.equal(txsB.body.count, 0);
    });

    test('watchlists are strictly isolated between users', async () => {
      await request(baseUrl, 'POST', '/api/watchlist', {
        token: userAJwt,
        body: { asset_id: 'asset-vcb' }
      });

      const watchA = await request(baseUrl, 'GET', '/api/watchlist', { token: userAJwt });
      const watchB = await request(baseUrl, 'GET', '/api/watchlist', { token: userBJwt });

      assert.equal(watchA.body.count, 1);
      assert.equal(watchB.body.count, 0);
    });

    test('price alerts are strictly isolated between users', async () => {
      await request(baseUrl, 'POST', '/api/alerts', {
        token: userAJwt,
        body: { asset_id: 'asset-fpt', direction: 'above', target_price: 150000 }
      });

      const alertsA = await request(baseUrl, 'GET', '/api/alerts', { token: userAJwt });
      const alertsB = await request(baseUrl, 'GET', '/api/alerts', { token: userBJwt });

      assert.equal(alertsA.body.count, 1);
      assert.equal(alertsB.body.count, 0);
    });
  });

  // =========================================================================
  // 4. RETIRED LEGACY CLAIM & OWNER ROUTES
  // =========================================================================
  describe('4. Retired Legacy Claim & Owner Endpoints Return 404', () => {
    test('legacy claim status endpoint is completely removed (404)', async () => {
      const userJwt = makeMockJwt('user-test', 'test@example.com');
      const res = await request(baseUrl, 'GET', '/api/auth/legacy-claim-status', { token: userJwt });
      assert.equal(res.response.status, 404);
    });

    test('legacy claim submission endpoint is completely removed (404)', async () => {
      const userJwt = makeMockJwt('user-test', 'test@example.com');
      const res = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: userJwt,
        body: { legacyOwnerToken: 'secret' }
      });
      assert.equal(res.response.status, 404);
    });

    test('owner session endpoints are completely removed (404)', async () => {
      const postRes = await request(baseUrl, 'POST', '/api/owner/session', { body: { ownerCredential: 'xyz' } });
      assert.equal(postRes.response.status, 404);

      const getRes = await request(baseUrl, 'GET', '/api/owner/session');
      assert.equal(getRes.response.status, 404);

      const deleteRes = await request(baseUrl, 'DELETE', '/api/owner/session');
      assert.equal(deleteRes.response.status, 404);
    });
  });

  // =========================================================================
  // 5. INTERNAL ALERT SCHEDULER AUTHORIZATION
  // =========================================================================
  describe('5. Internal Alert Scheduler Authorization', () => {
    test('ALERT_SCHEDULER_TOKEN authenticates internal evaluate endpoint', async () => {
      const res = await request(baseUrl, 'POST', '/api/internal/alerts/evaluate', {
        headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
      });
      assert.equal(res.response.status, 200);
      assert.equal(res.body.status, 'ok');
    });

    test('missing ALERT_SCHEDULER_TOKEN returns 401 ALERT_SCHEDULER_AUTH_REQUIRED', async () => {
      const res = await request(baseUrl, 'POST', '/api/internal/alerts/evaluate');
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'ALERT_SCHEDULER_AUTH_REQUIRED');
    });

    test('wrong ALERT_SCHEDULER_TOKEN returns 403 ALERT_SCHEDULER_AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'POST', '/api/internal/alerts/evaluate', {
        headers: { Authorization: 'Bearer wrong-scheduler-token-secret-12345678' }
      });
      assert.equal(res.response.status, 403);
      assert.equal(res.body.code, 'ALERT_SCHEDULER_AUTH_INVALID');
    });

    test('ALERT_SCHEDULER_TOKEN cannot be used as user auth on standard private routes', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.code, 'AUTH_INVALID');
    });
  });
});
