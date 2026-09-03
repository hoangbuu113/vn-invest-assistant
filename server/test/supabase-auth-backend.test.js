import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../index.js';
import {
  createOwnerSessionManager,
  isJwtCandidate,
  OWNER_SESSION_COOKIE_NAME,
  serializeOwnerSessionCookie
} from '../src/auth.js';

const OWNER_TOKEN = 'test-legacy-owner-token-secure-entropy-key-123';
const SCHEDULER_TOKEN = 'test-alert-scheduler-token-secret-456';

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

describe('Feature 13C — Supabase User Auth Backend & Legacy Profile Claim', () => {
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

  // Reset state helper
  function resetDb() {
    profiles = [
      {
        id: 'legacy-profile-id',
        user_id: null,
        cash_available: 20000000,
        risk_tolerance: 'moderate',
        investment_horizon: 'long',
        created_at: '2026-01-01T00:00:00Z'
      }
    ];
    holdings = [
      { id: 'holding-legacy', profile_id: 'legacy-profile-id', asset_id: 'asset-fpt', symbol: 'FPT', quantity: 100, average_cost: 110000 }
    ];
    transactions = [];
    cashLedger = [
      { id: 'cash-legacy', profile_id: 'legacy-profile-id', entry_type: 'INITIAL', amount: 20000000 }
    ];
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
      ownerAccessToken: OWNER_TOKEN,
      alertSchedulerToken: SCHEDULER_TOKEN,
      ownerSessionSecure: false,
      supabaseAuthClient: mockSupabaseAuthClient,

      // Profile resolution functions
      getInvestorProfileFn: async () => profiles[0] || null,
      getLegacyOwnerProfileFn: async () => profiles.find(p => p.user_id === null) || null,
      getProfileByIdFn: async (id) => profiles.find(p => p.id === id) || null,
      getProfileByUserIdFn: async (userId) => profiles.find(p => p.user_id === userId) || null,
      hasUnclaimedLegacyProfileFn: async () => profiles.some(p => p.user_id === null),

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

      claimLegacyProfileFn: async (userId) => {
        const userHasProfile = profiles.some(p => p.user_id === userId);
        if (userHasProfile) {
          const err = new Error('User already has a profile');
          err.code = 'IP005';
          throw err;
        }
        const legacyIndex = profiles.findIndex(p => p.user_id === null);
        if (legacyIndex === -1) {
          const err = new Error('Legacy profile already claimed');
          err.code = 'IP006';
          throw err;
        }
        profiles[legacyIndex].user_id = userId;
        return profiles[legacyIndex];
      },

      // Financial & user-scoped services
      getHoldingsFn: async (client, options = {}) => {
        const targetProfileId = options?.profileId;
        if (!targetProfileId) return [];
        return holdings.filter(h => h.profile_id === targetProfileId);
      },

      getCashOverviewFn: async (client, options = {}) => {
        const targetProfileId = options?.profileId;
        const profile = profiles.find(p => p.id === targetProfileId);
        return {
          currentCash: profile ? profile.cash_available : 0,
          currency: 'VND'
        };
      },

      getCashLedgerFn: async (client, options = {}) => {
        const targetProfileId = options?.profileId;
        return cashLedger.filter(e => e.profile_id === targetProfileId);
      },

      createCashMovementFn: async (input, client, options = {}) => {
        const profileId = options?.profileId;
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) throw new Error('Profile not found');
        const entry = {
          id: `cash-entry-${Date.now()}`,
          profile_id: profileId,
          entry_type: input.entryType,
          amount: input.amount,
          created_at: new Date().toISOString()
        };
        cashLedger.push(entry);
        profile.cash_available += (input.entryType === 'DEPOSIT' ? input.amount : -input.amount);
        return { entry, currentCash: profile.cash_available };
      },

      getPortfolioTransactionsFn: async (query, client, options = {}) => {
        const targetProfileId = options?.profileId || query?.profileId;
        return transactions.filter(t => t.profile_id === targetProfileId);
      },

      createPortfolioTransactionFn: async (payload, client, options = {}) => {
        const profileId = options?.profileId;
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) throw new Error('Profile not found');
        const tx = {
          id: `tx-${Date.now()}`,
          profile_id: profileId,
          ...payload,
          created_at: new Date().toISOString()
        };
        transactions.push(tx);
        return { transaction: tx, holding: null, currentCash: profile.cash_available };
      },

      getPortfolioOverviewFn: async (options = {}) => {
        const targetProfileId = options?.profileId;
        const profile = profiles.find(p => p.id === targetProfileId);
        return {
          profileId: targetProfileId,
          totalValue: profile ? profile.cash_available : 0,
          cash: profile ? profile.cash_available : 0
        };
      },

      getPortfolioCompositionFn: async (options = {}) => ({
        allocations: []
      }),

      getPortfolioPerformanceFn: async (options = {}) => ({
        range: options.range || '1M',
        twr: 0,
        mwr: 0
      }),

      getWatchlistFn: async (client, options = {}) => {
        const profileId = options?.profileId;
        return watchlists.filter(w => w.profile_id === profileId);
      },

      addToWatchlistFn: async (item) => {
        const newWatchlistItem = { id: `watch-${Date.now()}`, ...item };
        watchlists.push(newWatchlistItem);
        return newWatchlistItem;
      },

      removeFromWatchlistFn: async (assetId, options = {}) => {
        const profileId = options?.profileId;
        const idx = watchlists.findIndex(w => w.profile_id === profileId && (w.symbol === assetId || w.asset_id === assetId));
        if (idx !== -1) watchlists.splice(idx, 1);
        return { removed: idx !== -1 };
      },

      getAlertsFn: async (client, options = {}) => {
        const profileId = options?.profileId;
        return alerts.filter(a => a.profile_id === profileId);
      },

      createAlertFn: async (item) => {
        const newAlert = { id: `alert-${Date.now()}`, ...item, status: 'ACTIVE' };
        alerts.push(newAlert);
        return newAlert;
      },

      deleteAlertFn: async (id, options = {}) => {
        const profileId = options?.profileId;
        const idx = alerts.findIndex(a => a.id === id && a.profile_id === profileId);
        if (idx !== -1) alerts.splice(idx, 1);
        return { deleted: idx !== -1 };
      },

      evaluateAndPersistAlertsFn: async () => ({
        evaluatedCount: 0,
        triggeredCount: 0,
        unavailableCount: 0,
        staleCount: 0
      }),

      dispatchPendingWebPushDeliveriesFn: async () => ({
        deliveryClaimedCount: 0,
        deliverySentCount: 0,
        deliveryRetryableFailureCount: 0,
        deliveryPermanentFailureCount: 0,
        deliveryExpiredSubscriptionCount: 0
      }),

      upsertPushSubscriptionFn: async (sub) => {
        const existingIdx = pushSubscriptions.findIndex(s => s.profile_id === sub.profileId && s.endpoint === sub.endpoint);
        const record = { id: `sub-${Date.now()}`, profile_id: sub.profileId, ...sub };
        if (existingIdx !== -1) {
          pushSubscriptions[existingIdx] = record;
        } else {
          pushSubscriptions.push(record);
        }
        return record;
      },

      deletePushSubscriptionByEndpointFn: async (endpoint, profileId) => {
        const idx = pushSubscriptions.findIndex(s => s.profile_id === profileId && s.endpoint === endpoint);
        if (idx !== -1) {
          pushSubscriptions.splice(idx, 1);
          return true;
        }
        return false;
      }
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // =========================================================================
  // 1. JWT VALIDATION & AUTH ERROR CONTRACT
  // =========================================================================
  describe('1. Supabase JWT Validation & Auth Error Contract', () => {
    test('missing credentials on private route returns 401 OWNER_AUTH_REQUIRED', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile');
      assert.equal(res.response.status, 401);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.code, 'OWNER_AUTH_REQUIRED');
    });

    test('malformed authorization header (Basic) returns 401 AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' }
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.code, 'AUTH_INVALID');
    });

    test('empty bearer token returns 401 AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        headers: { Authorization: 'Bearer   ' }
      });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.code, 'AUTH_INVALID');
    });

    test('invalid or expired Supabase JWT returns 401 AUTH_INVALID without leaking details', async () => {
      const expiredJwt = 'header.payload_with_expired.signature';
      const res = await request(baseUrl, 'GET', '/api/profile', { token: expiredJwt });
      assert.equal(res.response.status, 401);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.code, 'AUTH_INVALID');
      assert.equal(res.body.message, 'Invalid or expired authentication token');
      // Token must not be leaked
      assert.equal(JSON.stringify(res.body).includes(expiredJwt), false);
    });

    test('wrong non-JWT credential returns 403 OWNER_AUTH_INVALID', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', { token: 'wrong-single-token-value' });
      assert.equal(res.response.status, 403);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.code, 'OWNER_AUTH_INVALID');
    });

    test('valid Supabase JWT authenticates successfully', async () => {
      const jwt = makeMockJwt('user-auth-1', 'user1@example.com');
      // User 1 does not have a profile yet; GET /api/profile returns 403 PROFILE_REQUIRED
      const res = await request(baseUrl, 'GET', '/api/profile', { token: jwt });
      assert.equal(res.response.status, 403);
      assert.equal(res.body.code, 'PROFILE_REQUIRED');
    });
  });

  // =========================================================================
  // 2. PROFILE RESOLUTION & FALLBACK REMOVAL CONTRACT
  // =========================================================================
  describe('2. Profile Resolution & Fallback Removal Contract', () => {
    test('authenticated user without profile receives 403 PROFILE_REQUIRED on financial endpoints', async () => {
      const jwt = makeMockJwt('user-unassigned', 'unassigned@example.com');

      // Holdings
      const holdingsRes = await request(baseUrl, 'GET', '/api/holdings', { token: jwt });
      assert.equal(holdingsRes.response.status, 403);
      assert.equal(holdingsRes.body.code, 'PROFILE_REQUIRED');

      // Cash overview
      const cashRes = await request(baseUrl, 'GET', '/api/cash/overview', { token: jwt });
      assert.equal(cashRes.response.status, 403);
      assert.equal(cashRes.body.code, 'PROFILE_REQUIRED');

      // Portfolio overview
      const portRes = await request(baseUrl, 'GET', '/api/portfolio/overview', { token: jwt });
      assert.equal(portRes.response.status, 403);
      assert.equal(portRes.body.code, 'PROFILE_REQUIRED');

      // Transactions
      const txRes = await request(baseUrl, 'GET', '/api/transactions', { token: jwt });
      assert.equal(txRes.response.status, 403);
      assert.equal(txRes.body.code, 'PROFILE_REQUIRED');

      // Never arbitrarily defaulted to legacy profile!
      assert.notEqual(holdingsRes.body.data?.[0]?.profile_id, 'legacy-profile-id');
    });

    test('POST /api/profile creates a new empty investor profile for the user', async () => {
      const jwt = makeMockJwt('user-new-investor', 'new@example.com');
      const createRes = await request(baseUrl, 'POST', '/api/profile', {
        token: jwt,
        body: { risk_tolerance: 'growth', investment_horizon: 'long' }
      });
      assert.equal(createRes.response.status, 201);
      assert.equal(createRes.body.status, 'ok');
      assert.equal(createRes.body.data.user_id, 'user-new-investor');
      assert.equal(createRes.body.data.cash_available, 0);

      // Subsequent GET /api/profile returns the newly created profile
      const getRes = await request(baseUrl, 'GET', '/api/profile', { token: jwt });
      assert.equal(getRes.response.status, 200);
      assert.equal(getRes.body.data.id, 'profile-user-new-investor');
      assert.equal(getRes.body.data.user_id, 'user-new-investor');
    });

    test('POST /api/profile is idempotent when called again for the same user', async () => {
      const jwt = makeMockJwt('user-new-investor', 'new@example.com');
      const createRes = await request(baseUrl, 'POST', '/api/profile', {
        token: jwt,
        body: { risk_tolerance: 'conservative' }
      });
      assert.equal(createRes.response.status, 200);
      assert.equal(createRes.body.data.id, 'profile-user-new-investor');
      assert.equal(createRes.body.data.user_id, 'user-new-investor');
    });
  });

  // =========================================================================
  // 3. MULTI-USER DATA ISOLATION & OWNERSHIP SCOPING
  // =========================================================================
  describe('3. Multi-User Data Isolation & Ownership Scoping', () => {
    const userAJwt = makeMockJwt('user-alpha', 'alpha@example.com');
    const userBJwt = makeMockJwt('user-bravo', 'bravo@example.com');

    before(async () => {
      // Create profile for User A
      await request(baseUrl, 'POST', '/api/profile', { token: userAJwt });
      // Create profile for User B
      await request(baseUrl, 'POST', '/api/profile', { token: userBJwt });
    });

    test('cash movements are isolated between users', async () => {
      // User A deposits 1,000,000 VND
      const depA = await request(baseUrl, 'POST', '/api/cash/deposit', {
        token: userAJwt,
        body: { amount: 1000000 }
      });
      assert.equal(depA.response.status, 201);
      assert.equal(depA.body.data.currentCash, 1000000);

      // User B deposits 500,000 VND
      const depB = await request(baseUrl, 'POST', '/api/cash/deposit', {
        token: userBJwt,
        body: { amount: 500000 }
      });
      assert.equal(depB.response.status, 201);
      assert.equal(depB.body.data.currentCash, 500000);

      // User A checks cash overview: sees only 1,000,000
      const cashA = await request(baseUrl, 'GET', '/api/cash/overview', { token: userAJwt });
      assert.equal(cashA.body.data.currentCash, 1000000);

      // User B checks cash overview: sees only 500,000
      const cashB = await request(baseUrl, 'GET', '/api/cash/overview', { token: userBJwt });
      assert.equal(cashB.body.data.currentCash, 500000);
    });

    test('spoofed profileId in body is ignored and strictly scoped to authenticated user', async () => {
      // User A attempts to deposit into User B's profile by injecting profileId
      const spoofedDep = await request(baseUrl, 'POST', '/api/cash/deposit', {
        token: userAJwt,
        body: { amount: 200000, profileId: 'profile-user-bravo' }
      });
      assert.equal(spoofedDep.response.status, 201);

      // Verify User B's cash did NOT change (still 500,000)
      const cashB = await request(baseUrl, 'GET', '/api/cash/overview', { token: userBJwt });
      assert.equal(cashB.body.data.currentCash, 500000);

      // User A's cash increased to 1,200,000
      const cashA = await request(baseUrl, 'GET', '/api/cash/overview', { token: userAJwt });
      assert.equal(cashA.body.data.currentCash, 1200000);
    });

    test('transactions and holdings are strictly isolated between users', async () => {
      // User A creates a transaction
      const txA = await request(baseUrl, 'POST', '/api/transactions', {
        token: userAJwt,
        body: { symbol: 'FPT', transactionType: 'BUY', quantity: 50, price: 120000 }
      });
      assert.equal(txA.response.status, 201);

      // User B lists transactions: does not see User A's transaction
      const listB = await request(baseUrl, 'GET', '/api/transactions', { token: userBJwt });
      assert.equal(listB.response.status, 200);
      assert.equal(listB.body.count, 0);

      // User A lists transactions: sees 1 transaction
      const listA = await request(baseUrl, 'GET', '/api/transactions', { token: userAJwt });
      assert.equal(listA.response.status, 200);
      assert.equal(listA.body.count, 1);
    });

    test('watchlist and price alerts are strictly isolated between users', async () => {
      // User A adds symbol to watchlist
      const watchA = await request(baseUrl, 'POST', '/api/watchlist', {
        token: userAJwt,
        body: { symbol: 'VNM' }
      });
      assert.equal(watchA.response.status, 201);

      // User B lists watchlist: empty
      const listWatchB = await request(baseUrl, 'GET', '/api/watchlist', { token: userBJwt });
      assert.equal(listWatchB.body.count, 0);

      // User A creates price alert
      const alertA = await request(baseUrl, 'POST', '/api/alerts', {
        token: userAJwt,
        body: { symbol: 'VNM', direction: 'above', target_price: 80000 }
      });
      assert.equal(alertA.response.status, 201);

      // User B lists alerts: empty
      const listAlertB = await request(baseUrl, 'GET', '/api/alerts', { token: userBJwt });
      assert.equal(listAlertB.body.count, 0);
    });
  });

  // =========================================================================
  // 4. LEGACY PROFILE CLAIM CONTRACT
  // =========================================================================
  describe('4. Legacy Profile Claim Contract', () => {
    test('legacy claim status discovery returns available without leaking profile data', async () => {
      const res = await request(baseUrl, 'GET', '/api/auth/legacy-claim-status');
      assert.equal(res.response.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.data.legacyClaimAvailable, true);
      // Zero financial balances or profile identifiers leaked
      assert.equal(res.body.data.cash_available, undefined);
      assert.equal(res.body.data.id, undefined);
      assert.equal(res.body.data.profileId, undefined);
    });

    test('claim legacy profile requires valid Supabase authentication', async () => {
      const res = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        body: { legacyOwnerToken: OWNER_TOKEN }
      });
      assert.equal(res.response.status, 401);
    });

    test('claim legacy profile rejects missing or wrong legacy owner token with 403', async () => {
      const jwt = makeMockJwt('user-claimant-1', 'claimant1@example.com');
      // Missing token proof
      const resMissing = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: jwt,
        body: {}
      });
      assert.equal(resMissing.response.status, 403);
      assert.equal(resMissing.body.code, 'OWNER_AUTH_INVALID');

      // Wrong token proof
      const resWrong = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: jwt,
        body: { legacyOwnerToken: 'wrong-legacy-key' }
      });
      assert.equal(resWrong.response.status, 403);
      assert.equal(resWrong.body.code, 'OWNER_AUTH_INVALID');
    });

    test('claim legacy profile rejects user who already has a profile with 409', async () => {
      const jwt = makeMockJwt('user-alpha', 'alpha@example.com'); // user-alpha already has a profile
      const res = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: jwt,
        body: { legacyOwnerToken: OWNER_TOKEN }
      });
      assert.equal(res.response.status, 409);
      assert.equal(res.body.code, 'USER_ALREADY_HAS_PROFILE');
    });

    test('claim legacy profile succeeds for authenticated user with valid proof', async () => {
      const claimantJwt = makeMockJwt('user-real-owner', 'owner@example.com');
      const claimRes = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: claimantJwt,
        body: { legacyOwnerToken: OWNER_TOKEN }
      });
      assert.equal(claimRes.response.status, 200);
      assert.equal(claimRes.body.status, 'ok');
      assert.equal(claimRes.body.data.claimed, true);
      assert.equal(claimRes.body.data.profile.id, 'legacy-profile-id');
      // Preserved legacy cash balance exactly (20,000,000 VND)
      assert.equal(claimRes.body.data.profile.cashAvailable, 20000000);

      // Now user-real-owner can access the legacy holdings and cash
      const holdingsRes = await request(baseUrl, 'GET', '/api/holdings', { token: claimantJwt });
      assert.equal(holdingsRes.response.status, 200);
      assert.equal(holdingsRes.body.count, 1);
      assert.equal(holdingsRes.body.data[0].symbol, 'FPT');
    });

    test('second claim attempt after legacy profile is claimed returns 410 LEGACY_PROFILE_UNAVAILABLE', async () => {
      const secondClaimantJwt = makeMockJwt('user-claimant-2', 'claimant2@example.com');
      const claimRes = await request(baseUrl, 'POST', '/api/auth/claim-legacy-profile', {
        token: secondClaimantJwt,
        body: { legacyOwnerToken: OWNER_TOKEN }
      });
      assert.equal(claimRes.response.status, 410);
      assert.equal(claimRes.body.code, 'LEGACY_PROFILE_UNAVAILABLE');

      // Status discovery now reports false
      const statusRes = await request(baseUrl, 'GET', '/api/auth/legacy-claim-status');
      assert.equal(statusRes.body.data.legacyClaimAvailable, false);
    });
  });

  // =========================================================================
  // 5. TRANSITIONAL LEGACY OWNER AUTH COEXISTENCE
  // =========================================================================
  describe('5. Transitional Legacy Owner Auth Coexistence', () => {
    before(() => {
      resetDb();
    });

    test('legacy OWNER_ACCESS_TOKEN bearer continues to authenticate successfully', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', { token: OWNER_TOKEN });
      assert.equal(res.response.status, 200);
      assert.equal(res.body.status, 'ok');
      // Maps to legacy owner profile
      assert.equal(res.body.data.id, 'legacy-profile-id');
    });

    test('legacy trusted owner cookie session continues to authenticate successfully', async () => {
      const sessionMgr = createOwnerSessionManager({ ownerAccessToken: OWNER_TOKEN });
      const issued = sessionMgr.issue();
      const cookie = serializeOwnerSessionCookie(issued.token, { secure: false });

      const res = await request(baseUrl, 'GET', '/api/profile', { cookie });
      assert.equal(res.response.status, 200);
      assert.equal(res.body.data.id, 'legacy-profile-id');
    });

    test('ALERT_SCHEDULER_TOKEN continues to authenticate internal evaluate endpoint', async () => {
      const res = await request(baseUrl, 'POST', '/api/internal/alerts/evaluate', {
        headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
      });
      assert.equal(res.response.status, 200);
      assert.equal(res.body.status, 'ok');
    });

    test('ALERT_SCHEDULER_TOKEN is rejected on standard user routes', async () => {
      const res = await request(baseUrl, 'GET', '/api/profile', {
        headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
      });
      // Scheduler token is not an owner token and not a JWT -> 403 OWNER_AUTH_INVALID
      assert.equal(res.response.status, 403);
    });
  });
});
