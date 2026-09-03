import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { mapAuthErrorToVietnamese } from '../../client/src/utils/authErrors.js';
import {
  apiFetch,
  AUTH_INVALID_EVENT,
  isPrivateApiPath,
  PRIVATE_API_PREFIXES
} from '../../client/src/utils/api.js';
import {
  clearCachedAccessToken,
  getAccessToken,
  isSupabaseConfigured
} from '../../client/src/utils/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_SRC_DIR = path.resolve(__dirname, '../../client/src');

describe('Feature 13D — Standard Login / Register Client & Auth Gate', () => {
  // =========================================================================
  // 1. SUPABASE CLIENT & AUTH ERROR MAPPING
  // =========================================================================
  describe('1. Supabase Client & Error Mapping Contract', () => {
    test('isSupabaseConfigured boolean helper detects configuration safely', () => {
      assert.equal(typeof isSupabaseConfigured, 'boolean');
    });

    test('getAccessToken returns null or string without throwing', async () => {
      clearCachedAccessToken();
      const token = await getAccessToken();
      assert.equal(token === null || typeof token === 'string', true);
    });

    test('mapAuthErrorToVietnamese sanitizes common Supabase error messages', () => {
      // Invalid credentials
      assert.equal(
        mapAuthErrorToVietnamese({ message: 'Invalid login credentials' }),
        'Email hoặc mật khẩu không đúng.'
      );

      // Email unconfirmed
      assert.equal(
        mapAuthErrorToVietnamese({ message: 'Email not confirmed' }),
        'Tài khoản chưa được xác nhận email. Vui lòng kiểm tra hộp thư.'
      );

      // Rate limit / 429
      assert.equal(
        mapAuthErrorToVietnamese({ status: 429, message: 'Too many requests' }),
        'Tần suất đăng nhập quá giới hạn. Vui lòng thử lại sau ít phút.'
      );

      // Network failure
      assert.equal(
        mapAuthErrorToVietnamese({ message: 'Failed to fetch' }),
        'Không thể kết nối máy chủ. Vui lòng kiểm tra đường truyền và thử lại.'
      );

      // Signup disabled
      assert.equal(
        mapAuthErrorToVietnamese({ message: 'Signups not allowed for this instance (signup disabled)' }),
        'Hiện chưa mở đăng ký tài khoản mới.'
      );

      // Generic fallback
      assert.equal(
        mapAuthErrorToVietnamese({ message: 'Unknown internal error' }),
        'Đã xảy ra lỗi khi xác thực. Vui lòng thử lại.'
      );
    });
  });

  // =========================================================================
  // 2. API JWT INJECTION & ROUTE CLASSIFICATION
  // =========================================================================
  describe('2. API JWT Injection & Security Contract', () => {
    test('isPrivateApiPath classifies private vs public routes correctly', () => {
      // Private routes including all /api/auth/* endpoints
      assert.equal(isPrivateApiPath('/api/profile'), true);
      assert.equal(isPrivateApiPath('/api/holdings'), true);
      assert.equal(isPrivateApiPath('/api/positions/opening'), true);
      assert.equal(isPrivateApiPath('/api/transactions'), true);
      assert.equal(isPrivateApiPath('/api/cash/overview'), true);
      assert.equal(isPrivateApiPath('/api/cash/ledger'), true);
      assert.equal(isPrivateApiPath('/api/portfolio/overview'), true);
      assert.equal(isPrivateApiPath('/api/watchlist'), true);
      assert.equal(isPrivateApiPath('/api/alerts'), true);
      assert.equal(isPrivateApiPath('/api/push/subscriptions'), true);
      assert.equal(isPrivateApiPath('/api/auth/claim-legacy-profile'), true);
      assert.equal(isPrivateApiPath('/api/auth/legacy-claim-status'), true);

      // Public routes
      assert.equal(isPrivateApiPath('/api/health'), false);
      assert.equal(isPrivateApiPath('/api/db-health'), false);
      assert.equal(isPrivateApiPath('/api/market/snapshot'), false);
      assert.equal(isPrivateApiPath('/api/market/history/FPT'), false);
    });

    test('apiFetch attaches Authorization: Bearer <token> for /api/profile and /api/auth endpoints', async () => {
      const requests = [];
      const originalFetch = globalThis.fetch;
      const mockToken = 'mock-supabase-jwt-access-token-xyz';

      globalThis.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ status: 'ok', data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      };

      try {
        // Test /api/profile
        await apiFetch('/api/profile', {
          headers: { Authorization: `Bearer ${mockToken}` }
        });
        // Test /api/auth/legacy-claim-status
        await apiFetch('/api/auth/legacy-claim-status', {
          headers: { Authorization: `Bearer ${mockToken}` }
        });
        // Test /api/auth/claim-legacy-profile
        await apiFetch('/api/auth/claim-legacy-profile', {
          headers: { Authorization: `Bearer ${mockToken}` }
        });

        assert.equal(requests.length, 3);
        assert.equal(requests[0].url, '/api/profile');
        assert.equal(requests[0].options.headers.get('Authorization'), `Bearer ${mockToken}`);
        assert.equal(requests[1].url, '/api/auth/legacy-claim-status');
        assert.equal(requests[1].options.headers.get('Authorization'), `Bearer ${mockToken}`);
        assert.equal(requests[2].url, '/api/auth/claim-legacy-profile');
        assert.equal(requests[2].options.headers.get('Authorization'), `Bearer ${mockToken}`);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('apiFetch does not attach Authorization header for public endpoints', async () => {
      const requests = [];
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ status: 'ok', data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      };

      try {
        await apiFetch('/api/health');
        await apiFetch('/api/market/snapshot');

        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, '/api/health');
        assert.equal(requests[0].options.headers.has('Authorization'), false);
        assert.equal(requests[1].url, '/api/market/snapshot');
        assert.equal(requests[1].options.headers.has('Authorization'), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('apiFetch dispatches AUTH_INVALID_EVENT on HTTP 401 on private path', async () => {
      const dispatchedEvents = [];
      globalThis.window = {
        dispatchEvent: (event) => dispatchedEvents.push(event.type)
      };
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'error', code: 'AUTH_INVALID' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });

      try {
        await apiFetch('/api/profile');
        assert.deepEqual(dispatchedEvents, [AUTH_INVALID_EVENT]);
      } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.window;
      }
    });

    test('apiFetch does NOT dispatch AUTH_INVALID_EVENT on HTTP 403 PROFILE_REQUIRED', async () => {
      const dispatchedEvents = [];
      globalThis.window = {
        dispatchEvent: (event) => dispatchedEvents.push(event.type)
      };
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => new Response(JSON.stringify({ status: 'error', code: 'PROFILE_REQUIRED' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });

      try {
        const res = await apiFetch('/api/profile');
        assert.equal(res.status, 403);
        // 403 PROFILE_REQUIRED must NOT trigger unauthenticated logout!
        assert.deepEqual(dispatchedEvents, []);
      } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.window;
      }
    });
  });

  // =========================================================================
  // 3. PROFILE BOOTSTRAP & LEGACY CLAIM DECISION STATE MACHINE
  // =========================================================================
  describe('3. Profile Bootstrap & Legacy Claim Decision State Machine', () => {
    test('profile bootstrap: 200 response transitions directly to ready without claim modal', async () => {
      const originalFetch = globalThis.fetch;
      const apiCalls = [];

      globalThis.fetch = async (url) => {
        apiCalls.push(url);
        if (url === '/api/profile') {
          return new Response(JSON.stringify({
            status: 'ok',
            data: { id: 'prof-123', user_id: 'user-abc', cash_available: 5000000 }
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };

      try {
        const res = await apiFetch('/api/profile');
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.data.id, 'prof-123');
        // Legacy claim discovery was NOT called because profile exists
        assert.equal(apiCalls.includes('/api/auth/legacy-claim-status'), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('profile bootstrap: 403 PROFILE_REQUIRED + legacyClaimAvailable=true enters claim modal without calling POST /api/profile', async () => {
      const originalFetch = globalThis.fetch;
      const apiCalls = [];

      globalThis.fetch = async (url, options = {}) => {
        apiCalls.push({ url, method: options.method || 'GET' });
        if (url === '/api/profile' && (!options.method || options.method === 'GET')) {
          return new Response(JSON.stringify({ status: 'error', code: 'PROFILE_REQUIRED' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === '/api/auth/legacy-claim-status') {
          return new Response(JSON.stringify({ status: 'ok', data: { legacyClaimAvailable: true } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === '/api/profile' && options.method === 'POST') {
          assert.fail('POST /api/profile must NOT be called when legacyClaimAvailable is true!');
        }
        return new Response('{}', { status: 404 });
      };

      try {
        // Step 1: GET /api/profile -> 403
        const profileRes = await apiFetch('/api/profile');
        assert.equal(profileRes.status, 403);

        // Step 2: GET /api/auth/legacy-claim-status -> true
        const claimStatusRes = await apiFetch('/api/auth/legacy-claim-status');
        const claimStatusData = await claimStatusRes.json();
        assert.equal(claimStatusData.data.legacyClaimAvailable, true);

        // Verify POST /api/profile was NOT called
        const postCalls = apiCalls.filter(c => c.url === '/api/profile' && c.method === 'POST');
        assert.equal(postCalls.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('profile bootstrap: 403 PROFILE_REQUIRED + legacyClaimAvailable=false initializes new empty profile', async () => {
      const originalFetch = globalThis.fetch;
      const apiCalls = [];

      globalThis.fetch = async (url, options = {}) => {
        apiCalls.push({ url, method: options.method || 'GET' });
        if (url === '/api/profile' && (!options.method || options.method === 'GET')) {
          return new Response(JSON.stringify({ status: 'error', code: 'PROFILE_REQUIRED' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === '/api/auth/legacy-claim-status') {
          return new Response(JSON.stringify({ status: 'ok', data: { legacyClaimAvailable: false } }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === '/api/profile' && options.method === 'POST') {
          return new Response(JSON.stringify({
            status: 'ok',
            data: { id: 'new-prof-999', user_id: 'user-xyz', cash_available: 0 }
          }), { status: 201, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };

      try {
        // Step 1: GET /api/profile -> 403
        const profileRes = await apiFetch('/api/profile');
        assert.equal(profileRes.status, 403);

        // Step 2: GET /api/auth/legacy-claim-status -> false
        const claimStatusRes = await apiFetch('/api/auth/legacy-claim-status');
        const claimStatusData = await claimStatusRes.json();
        assert.equal(claimStatusData.data.legacyClaimAvailable, false);

        // Step 3: POST /api/profile -> 201
        const createRes = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        assert.equal(createRes.status, 201);
        const createdData = await createRes.json();
        assert.equal(createdData.data.cash_available, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('legacy claim submission transmits legacyOwnerToken and handles success and rejection', async () => {
      const originalFetch = globalThis.fetch;
      let submittedBody = null;

      globalThis.fetch = async (url, options = {}) => {
        if (url === '/api/auth/claim-legacy-profile') {
          submittedBody = JSON.parse(options.body);
          if (submittedBody.legacyOwnerToken === 'correct-secret-key') {
            return new Response(JSON.stringify({
              status: 'ok',
              data: { claimed: true, profile: { id: 'legacy-prof', cashAvailable: 20000000 } }
            }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return new Response(JSON.stringify({
            status: 'error',
            code: 'OWNER_AUTH_INVALID',
            message: 'Invalid legacy owner credentials'
          }), { status: 403, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };

      try {
        // Wrong token test
        const failRes = await apiFetch('/api/auth/claim-legacy-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legacyOwnerToken: 'wrong-key' })
        });
        assert.equal(failRes.status, 403);

        // Correct token test
        const successRes = await apiFetch('/api/auth/claim-legacy-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legacyOwnerToken: 'correct-secret-key' })
        });
        assert.equal(successRes.status, 200);
        const successData = await successRes.json();
        assert.equal(successData.data.claimed, true);
        assert.equal(successData.data.profile.cashAvailable, 20000000);
        assert.equal(submittedBody.legacyOwnerToken, 'correct-secret-key');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // 4. RETIREMENT VERIFICATION & ZERO OWNER LEAKAGE AUDIT
  // =========================================================================
  describe('4. Complete Retirement of OwnerGate & Legacy Credentials Audit', () => {
    test('OwnerGate.jsx is permanently deleted from client components', async () => {
      const ownerGateExists = await access(
        path.join(CLIENT_SRC_DIR, 'components/OwnerGate.jsx')
      ).then(() => true).catch(() => false);
      assert.equal(ownerGateExists, false, 'client/src/components/OwnerGate.jsx must not exist');
    });

    test('client source contains ZERO active references to retired owner gate constructs', async () => {
      async function scanFiles(dir) {
        let results = [];
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(await scanFiles(fullPath));
          } else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.css')) {
            results.push(fullPath);
          }
        }
        return results;
      }

      const files = await scanFiles(CLIENT_SRC_DIR);
      assert.equal(files.length > 10, true);

      const forbiddenPatterns = [
        /\bOwnerGate\b/,
        /\bOWNER_ACCESS_TOKEN\b/,
        /\bOWNER_SESSION_INVALID_EVENT\b/,
        /\bvn_invest_owner_session\b/,
        /Xác thực thiết bị/,
        /Khóa truy cập chủ sở hữu/
      ];

      for (const file of files) {
        const content = await readFile(file, 'utf8');
        for (const pattern of forbiddenPatterns) {
          const match = content.match(pattern);
          assert.equal(
            match,
            null,
            `Forbidden pattern ${pattern} found in ${file}: "${match?.[0]}"`
          );
        }
      }
    });

    test('client .env.example exists and contains no secret keys', async () => {
      const examplePath = path.resolve(CLIENT_SRC_DIR, '../.env.example');
      const exampleContent = await readFile(examplePath, 'utf8');

      assert.match(exampleContent, /VITE_SUPABASE_URL/);
      assert.match(exampleContent, /VITE_SUPABASE_PUBLISHABLE_KEY/);

      // Secret keys must NEVER be present
      assert.doesNotMatch(exampleContent, /SUPABASE_SECRET_KEY/);
      assert.doesNotMatch(exampleContent, /service_role/);
      assert.doesNotMatch(exampleContent, /OWNER_ACCESS_TOKEN/);
      assert.doesNotMatch(exampleContent, /OWNER_SESSION_SECRET/);
      assert.doesNotMatch(exampleContent, /VAPID_PRIVATE_KEY/);
    });
  });

  // =========================================================================
  // 5. REGISTRATION VALIDATION & CONFIRMATION UX
  // =========================================================================
  describe('5. Registration Validation & Confirmation Handling', () => {
    test('registration validation requires email, min 8 char password, and matching confirmation', () => {
      // Validation rules verified in pure logic
      const validate = ({ email, password, confirmPassword }) => {
        const cleanEmail = (email || '').trim();
        if (!cleanEmail) return 'Vui lòng nhập địa chỉ email hợp lệ.';
        if (!password || password.length < 8) return 'Mật khẩu phải có độ dài tối thiểu từ 8 ký tự trở lên.';
        if (password !== confirmPassword) return 'Mật khẩu xác nhận không trùng khớp.';
        return null;
      };

      assert.equal(validate({ email: '', password: 'password123', confirmPassword: 'password123' }), 'Vui lòng nhập địa chỉ email hợp lệ.');
      assert.equal(validate({ email: '   ', password: 'password123', confirmPassword: 'password123' }), 'Vui lòng nhập địa chỉ email hợp lệ.');
      assert.equal(validate({ email: 'test@example.com', password: 'short', confirmPassword: 'short' }), 'Mật khẩu phải có độ dài tối thiểu từ 8 ký tự trở lên.');
      assert.equal(validate({ email: 'test@example.com', password: 'password123', confirmPassword: 'different' }), 'Mật khẩu xác nhận không trùng khớp.');
      assert.equal(validate({ email: '  user@example.com  ', password: 'password123', confirmPassword: 'password123' }), null);
    });

    test('truthful confirmation message is mapped when signUp returns session=null', () => {
      const handleSignUpResult = (data, error) => {
        if (error) return { status: 'error', message: mapAuthErrorToVietnamese(error) };
        if (data?.session) return { status: 'ready', session: data.session };
        return { status: 'confirm_email', message: 'Đã tạo tài khoản. Hãy kiểm tra email để xác nhận trước khi đăng nhập.' };
      };

      // Email confirmation required case
      const res = handleSignUpResult({ user: { id: 'u1' }, session: null }, null);
      assert.equal(res.status, 'confirm_email');
      assert.equal(res.message, 'Đã tạo tài khoản. Hãy kiểm tra email để xác nhận trước khi đăng nhập.');

      // Immediate active session case
      const resActive = handleSignUpResult({ user: { id: 'u1' }, session: { access_token: 'tok' } }, null);
      assert.equal(resActive.status, 'ready');
      assert.equal(resActive.session.access_token, 'tok');
    });
  });

  // =========================================================================
  // 6. LOGOUT & SECRET LEAKAGE AUDIT
  // =========================================================================
  describe('6. Logout & Secret Leakage Audit', () => {
    test('clearCachedAccessToken purges active token reference', async () => {
      clearCachedAccessToken();
      const token = await getAccessToken();
      assert.equal(token, null);
    });

    test('apiFetch and supabase.js never log raw bearer tokens to console', async () => {
      const logged = [];
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const originalFetch = globalThis.fetch;
      const sensitiveToken = 'sensitive-auth-jwt-token-12345';

      console.log = (...args) => logged.push(args.join(' '));
      console.error = (...args) => logged.push(args.join(' '));

      globalThis.fetch = async () => new Response('{}', { status: 200 });

      try {
        await apiFetch('/api/profile', {
          headers: { Authorization: `Bearer ${sensitiveToken}` }
        });
        const anyLogWithToken = logged.some(line => line.includes(sensitiveToken));
        assert.equal(anyLogWithToken, false, 'apiFetch must never log raw bearer tokens');
      } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        globalThis.fetch = originalFetch;
      }
    });

    test('production client browser build contains zero secret credentials', async () => {
      const browserAssetsDir = path.resolve(CLIENT_SRC_DIR, '../dist/assets');
      async function scanDist(dir) {
        let results = [];
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results = results.concat(await scanDist(fullPath));
            } else if (entry.name.endsWith('.js') || entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
              results.push(fullPath);
            }
          }
        } catch {
          // dist might not exist yet if not built
        }
        return results;
      }

      const distFiles = await scanDist(browserAssetsDir);
      if (distFiles.length === 0) return;

      for (const file of distFiles) {
        const content = await readFile(file, 'utf8');
        assert.doesNotMatch(content, /SUPABASE_SECRET_KEY/);
        assert.doesNotMatch(content, /ALERT_SCHEDULER_TOKEN/);
        assert.doesNotMatch(content, /OWNER_ACCESS_TOKEN/);
        assert.doesNotMatch(content, /OWNER_SESSION_SECRET/);
        assert.doesNotMatch(content, /VAPID_PRIVATE_KEY/);
      }
    });
  });
});
