import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiFetch,
  parseRetryAfterMs,
  clearInFlightRequests,
  AUTH_INVALID_EVENT
} from '../../client/src/utils/api.js';

describe('Startup Resilience & Transient Rate Limit Handling', () => {
  let originalFetch;
  let originalWindow;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearInFlightRequests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWindow !== undefined) {
      global.window = originalWindow;
    } else {
      delete global.window;
    }
    clearInFlightRequests();
  });

  describe('parseRetryAfterMs', () => {
    test('parses integer seconds correctly', () => {
      assert.equal(parseRetryAfterMs('5'), 5000);
      assert.equal(parseRetryAfterMs('0'), 0);
      assert.equal(parseRetryAfterMs('  12  '), 12000);
      assert.equal(parseRetryAfterMs(3), 3000);
    });

    test('parses HTTP-date format correctly', () => {
      const futureDate = new Date(Date.now() + 15000).toUTCString();
      const parsed = parseRetryAfterMs(futureDate);
      assert.ok(parsed !== null);
      assert.ok(parsed >= 13000 && parsed <= 16000, `Expected ~15000ms, got ${parsed}`);
    });

    test('returns null for missing, invalid, or negative values', () => {
      assert.equal(parseRetryAfterMs(null), null);
      assert.equal(parseRetryAfterMs(undefined), null);
      assert.equal(parseRetryAfterMs(''), null);
      assert.equal(parseRetryAfterMs('invalid-header'), null);
      assert.equal(parseRetryAfterMs('-5'), null);
    });
  });

  describe('In-Flight Request Deduplication', () => {
    test('deduplicates concurrent identical GET requests and allows all consumers to read body', async () => {
      let networkCallCount = 0;

      global.fetch = async (url) => {
        networkCallCount++;
        // Small delay to ensure concurrent calls overlap
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(JSON.stringify({ status: 'ok', symbol: 'FPT', price: 135000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      // Fire 3 concurrent GET requests for the same URL
      const [res1, res2, res3] = await Promise.all([
        apiFetch('/api/market/FPT'),
        apiFetch('/api/market/FPT'),
        apiFetch('/api/market/FPT')
      ]);

      // Verify only 1 network fetch was dispatched
      assert.equal(networkCallCount, 1, 'Expected exactly 1 network fetch for 3 concurrent GETs');

      // Verify all 3 responses can have their JSON body consumed independently
      const json1 = await res1.json();
      const json2 = await res2.json();
      const json3 = await res3.json();

      assert.equal(json1.symbol, 'FPT');
      assert.equal(json2.symbol, 'FPT');
      assert.equal(json3.symbol, 'FPT');

      // A subsequent request after resolution should dispatch a new fetch
      await apiFetch('/api/market/FPT');
      assert.equal(networkCallCount, 2, 'Subsequent request after settlement should dispatch a new fetch');
    });

    test('does not deduplicate non-GET requests', async () => {
      let networkCallCount = 0;

      global.fetch = async () => {
        networkCallCount++;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      await Promise.all([
        apiFetch('/api/profile', { method: 'POST', body: JSON.stringify({}) }),
        apiFetch('/api/profile', { method: 'POST', body: JSON.stringify({}) })
      ]);

      assert.equal(networkCallCount, 2, 'POST requests must never be deduplicated');
    });

    test('different URLs or query parameters are not incorrectly deduped', async () => {
      const requestedUrls = [];

      global.fetch = async (url) => {
        requestedUrls.push(url);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      await Promise.all([
        apiFetch('/api/market/FPT'),
        apiFetch('/api/market/VCB'),
        apiFetch('/api/watchlist?page=1'),
        apiFetch('/api/watchlist?page=2')
      ]);

      assert.equal(requestedUrls.length, 4, 'All 4 distinct URLs must result in independent network calls');
      assert.deepEqual(requestedUrls, [
        '/api/market/FPT',
        '/api/market/VCB',
        '/api/watchlist?page=1',
        '/api/watchlist?page=2'
      ]);
    });

    test('failed requests are removed from in-flight map and do not leave stale promises', async () => {
      let attempt = 0;

      global.fetch = async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('Network connection reset');
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      // First call fails across all retries
      await assert.rejects(
        () => apiFetch('/api/market/HPG', { retry: { maxAttempts: 1 } }),
        { message: 'Network connection reset' }
      );

      // Second call must NOT be stuck on the previous failed promise
      const secondRes = await apiFetch('/api/market/HPG', { retry: { maxAttempts: 1 } });
      assert.equal(secondRes.status, 200);
      assert.equal(attempt, 2, 'Second call must make a fresh network request');
    });
  });

  describe('Bounded Retry & Backoff on HTTP 429 / 503', () => {
    test('recovers from transient HTTP 429 when retry succeeds', async () => {
      let callCount = 0;
      const retryEvents = [];

      global.fetch = async () => {
        callCount++;
        if (callCount < 3) {
          return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
            status: 429,
            headers: { 'Retry-After': '0' } // 0 seconds to keep test fast
          });
        }
        return new Response(JSON.stringify({ status: 'ok', data: { id: 'prof-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const res = await apiFetch('/api/profile', {
        retry: {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 50
        },
        onRetry: (info) => retryEvents.push(info)
      });

      assert.equal(callCount, 3, 'Should have made 3 attempts before succeeding');
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.data.id, 'prof-1');
      assert.equal(retryEvents.length, 2, 'Should have emitted 2 onRetry callbacks');
      assert.equal(retryEvents[0].status, 429);
      assert.equal(retryEvents[1].status, 429);
    });

    test('recovers from cold-start HTTP 503 when retry succeeds', async () => {
      let callCount = 0;

      global.fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Backend Starting', { status: 503 });
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };

      const res = await apiFetch('/api/profile', {
        retry: {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 50
        }
      });

      assert.equal(callCount, 2);
      assert.equal(res.status, 200);
    });

    test('respects maxAttempts boundary and terminates cleanly without retry storms', async () => {
      let callCount = 0;

      global.fetch = async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Retry-After': '0' }
        });
      };

      const res = await apiFetch('/api/profile', {
        retry: {
          maxAttempts: 3,
          initialDelayMs: 5,
          maxDelayMs: 20
        }
      });

      // Must stop exactly after maxAttempts (3 attempts total)
      assert.equal(callCount, 3, 'Must not exceed maxAttempts');
      assert.equal(res.status, 429, 'Returns final 429 response after retries exhausted');
    });

    test('HTTP 429 never triggers AUTH_INVALID_EVENT or logs out user', async () => {
      let authInvalidDispatched = false;

      // Mock window event dispatching
      originalWindow = global.window;
      global.window = {
        dispatchEvent: (event) => {
          if (event?.type === AUTH_INVALID_EVENT) {
            authInvalidDispatched = true;
          }
        }
      };
      global.Event = class Event {
        constructor(type) {
          this.type = type;
        }
      };

      global.fetch = async () => {
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429
        });
      };

      const res = await apiFetch('/api/profile', {
        retry: { maxAttempts: 1 } // single attempt to test 429 directly
      });

      assert.equal(res.status, 429);
      assert.equal(authInvalidDispatched, false, 'HTTP 429 must never dispatch AUTH_INVALID_EVENT');

      // Now verify that HTTP 401 DOES dispatch AUTH_INVALID_EVENT
      global.fetch = async () => {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      };

      const res401 = await apiFetch('/api/profile', { retry: { maxAttempts: 1 } });
      assert.equal(res401.status, 401);
      assert.equal(authInvalidDispatched, true, 'HTTP 401 must dispatch AUTH_INVALID_EVENT');
    });

    test('HTTP 401 and 403 are never retried automatically', async () => {
      let callCount401 = 0;
      let callCount403 = 0;

      global.fetch = async (url) => {
        if (url === '/api/profile-401') {
          callCount401++;
          return new Response('Unauthorized', { status: 401 });
        }
        if (url === '/api/profile-403') {
          callCount403++;
          return new Response('Forbidden', { status: 403 });
        }
        return new Response('OK', { status: 200 });
      };

      const res401 = await apiFetch('/api/profile-401');
      assert.equal(res401.status, 401);
      assert.equal(callCount401, 1, 'HTTP 401 must never be retried');

      const res403 = await apiFetch('/api/profile-403');
      assert.equal(res403.status, 403);
      assert.equal(callCount403, 1, 'HTTP 403 must never be retried');
    });

    test('does not retry non-idempotent mutations on 429 by default', async () => {
      let callCount = 0;

      global.fetch = async () => {
        callCount++;
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), { status: 429 });
      };

      const res = await apiFetch('/api/profile', {
        method: 'POST',
        body: JSON.stringify({})
      });

      assert.equal(callCount, 1, 'POST requests must not be retried by default on 429');
      assert.equal(res.status, 429);
    });
  });
});

