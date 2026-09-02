import { describe, test, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../index.js';
import {
  getVapidConfig,
  validatePushSubscriptionInput,
  buildAssetDeepLinkUrl,
  formatAlertPrice,
  buildWebPushPayload,
  parseRetryAfterHeader,
  DEFAULT_PUSH_TIMEOUT_MS,
  WebPushDeliveryError,
  sendWebPushNotification,
  dispatchPendingWebPushDeliveries
} from '../src/web-push-alerts.js';

const VALID_VAPID = {
  VAPID_PUBLIC_KEY: 'BI8o2b3t-public-key-test-value-for-vapid-testing-only-12345',
  VAPID_PRIVATE_KEY: 'secret-private-key-test-value-67890',
  VAPID_SUBJECT: 'mailto:admin@example.com'
};

const OWNER_TOKEN = 'test-owner-token-min-32-chars-length-1234567890';
const SCHEDULER_TOKEN = 'test-scheduler-token-min-32-chars-length-1234567890';

async function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        server
      });
    });
  });
}

describe('Feature 12C — Web Push Subscription API & VAPID Delivery Engine', () => {

  // ============================================================================
  // 1. VAPID Configuration Contract
  // ============================================================================
  describe('1. VAPID Configuration Contract', () => {
    test('detects valid configuration when public, private, and subject are present', () => {
      const cfg = getVapidConfig(VALID_VAPID);
      assert.equal(cfg.isConfigured, true);
      assert.equal(cfg.publicKey, VALID_VAPID.VAPID_PUBLIC_KEY);
      assert.equal(cfg.privateKey, VALID_VAPID.VAPID_PRIVATE_KEY);
      assert.equal(cfg.subject, VALID_VAPID.VAPID_SUBJECT);
    });

    test('detects unconfigured when private key is missing', () => {
      const cfg = getVapidConfig({
        VAPID_PUBLIC_KEY: VALID_VAPID.VAPID_PUBLIC_KEY,
        VAPID_SUBJECT: VALID_VAPID.VAPID_SUBJECT
      });
      assert.equal(cfg.isConfigured, false);
      assert.equal(cfg.publicKey, null);
      assert.equal(cfg.privateKey, null);
    });

    test('detects unconfigured when subject is invalid', () => {
      const cfg = getVapidConfig({
        ...VALID_VAPID,
        VAPID_SUBJECT: 'not-a-mailto-or-https'
      });
      assert.equal(cfg.isConfigured, false);
    });
  });

  // ============================================================================
  // 2. Subscription Input Validation & Normalization
  // ============================================================================
  describe('2. Subscription Input Validation & Normalization', () => {
    test('valid browser PushSubscription is accepted and normalized', () => {
      const input = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-token-123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A4If_ZqPPn5DP6V8rReWhOjhKPTvKj8MnFLT_Tymmg=',
          auth: 'tBHItJI5svbpez7KI4CCXg=='
        }
      };

      const validated = validatePushSubscriptionInput(input);
      assert.equal(validated.endpoint, input.endpoint);
      assert.equal(validated.p256dh, input.keys.p256dh);
      assert.equal(validated.auth, input.keys.auth);
    });

    test('rejects insecure HTTP endpoints', () => {
      assert.throws(
        () => validatePushSubscriptionInput({
          endpoint: 'http://insecure.example.com/push',
          keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK', auth: 'tBHItJI5svbpez7' }
        }),
        (err) => err.code === 'INVALID_SUBSCRIPTION_ENDPOINT'
      );
    });

    test('rejects javascript: and data: pseudo-URLs', () => {
      assert.throws(
        () => validatePushSubscriptionInput({
          endpoint: 'javascript:alert(1)',
          keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK', auth: 'tBHItJI5svbpez7' }
        }),
        (err) => err.code === 'INVALID_SUBSCRIPTION_ENDPOINT'
      );
    });

    test('rejects missing or empty keys', () => {
      assert.throws(
        () => validatePushSubscriptionInput({
          endpoint: 'https://fcm.googleapis.com/fcm/send/1',
          keys: { p256dh: '', auth: 'tBHItJI5svbpez7' }
        }),
        (err) => err.code === 'INVALID_SUBSCRIPTION_KEYS'
      );

      assert.throws(
        () => validatePushSubscriptionInput({
          endpoint: 'https://fcm.googleapis.com/fcm/send/1',
          keys: null
        }),
        (err) => err.code === 'INVALID_SUBSCRIPTION_KEYS'
      );
    });
  });

  // ============================================================================
  // 3. Message Source, Formatting & Deep Link Contract
  // ============================================================================
  describe('3. Message Source, Formatting & Deep Link Contract', () => {
    test('canonical asset deep link encoder formats BTC and XAU/USD correctly', () => {
      assert.equal(buildAssetDeepLinkUrl('BTC'), '/#assets/BTC');
      assert.equal(buildAssetDeepLinkUrl('FPT'), '/#assets/FPT');
      assert.equal(buildAssetDeepLinkUrl('XAU/USD'), '/#assets/XAU%2FUSD');
      assert.equal(decodeURIComponent('XAU%2FUSD'), 'XAU/USD');
    });

    test('price formatting respects Vietnamese integer rules for VND and decimals for USD', () => {
      assert.equal(formatAlertPrice(130000, 'VND'), '130.000 VND');
      assert.equal(formatAlertPrice(95120, 'USD'), '95.120 USD');
      assert.equal(formatAlertPrice(2505.5, 'USD'), '2.505,5 USD');
    });

    test('builds factual notification for ABOVE crossing with deep link', () => {
      const payload = buildWebPushPayload({
        delivery: {
          direction: 'above',
          targetPrice: 95000,
          observedPrice: 95120
        },
        asset: {
          symbol: 'BTC',
          quoteCurrency: 'USD'
        }
      });

      assert.equal(payload.title, 'Cảnh báo giá BTC');
      assert.equal(payload.body, 'Giá ghi nhận: 95.120 USD · Điều kiện: đạt hoặc vượt 95.000 USD');
      assert.equal(payload.data.url, '/#assets/BTC');
    });

    test('builds factual notification for Gold (XAU/USD) with encoded slash deep link', () => {
      const payload = buildWebPushPayload({
        delivery: {
          direction: 'below',
          targetPrice: 2500,
          observedPrice: 2490
        },
        asset: {
          symbol: 'XAU/USD',
          quoteCurrency: 'USD'
        }
      });

      assert.equal(payload.title, 'Cảnh báo giá XAU/USD');
      assert.equal(payload.body, 'Giá ghi nhận: 2.490 USD · Điều kiện: giảm xuống hoặc thấp hơn 2.500 USD');
      assert.equal(payload.data.url, '/#assets/XAU%2FUSD');
    });
  });

  // ============================================================================
  // 4. Web Push Request Timeout & Success Contract
  // ============================================================================
  describe('4. Web Push Request Timeout & Success Contract', () => {
    test('passes configured timeout (default 10,000ms) to webPush.sendNotification', async () => {
      let passedOptions = null;
      const mockClient = {
        async sendNotification(sub, payload, options) {
          passedOptions = options;
          return { statusCode: 201 };
        }
      };

      const res = await sendWebPushNotification({
        subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k1', auth: 'a1' },
        payload: { title: 'Test' },
        vapidConfig: getVapidConfig(VALID_VAPID),
        webPushClient: mockClient
      });

      assert.equal(res.success, true);
      assert.equal(passedOptions.timeout, DEFAULT_PUSH_TIMEOUT_MS);
      assert.equal(passedOptions.timeout, 10000);
      assert.equal(passedOptions.TTL, 3600);
    });

    test('custom request timeout is passed through correctly', async () => {
      let passedOptions = null;
      const mockClient = {
        async sendNotification(sub, payload, options) {
          passedOptions = options;
          return { statusCode: 201 };
        }
      };

      await sendWebPushNotification({
        subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k1', auth: 'a1' },
        payload: { title: 'Test' },
        vapidConfig: getVapidConfig(VALID_VAPID),
        webPushClient: mockClient,
        timeoutMs: 15000
      });

      assert.equal(passedOptions.timeout, 15000);
    });

    test('socket timeout error classifies as retryable WEB_PUSH_NETWORK_ERROR', async () => {
      const mockClient = {
        async sendNotification() {
          const err = new Error('Socket timeout');
          err.code = 'ETIMEDOUT';
          throw err;
        }
      };

      await assert.rejects(
        () => sendWebPushNotification({
          subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k1', auth: 'a1' },
          payload: { title: 'Test' },
          vapidConfig: getVapidConfig(VALID_VAPID),
          webPushClient: mockClient
        }),
        (err) => {
          assert.equal(err.code, 'WEB_PUSH_NETWORK_ERROR');
          assert.equal(err.isRetryable, true);
          return true;
        }
      );
    });

    test('confirmed 2xx success contract: handles 200, 201, 202, 204 as confirmed success', async () => {
      for (const statusCode of [200, 201, 202, 204]) {
        const mockClient = {
          async sendNotification() {
            return { statusCode };
          }
        };

        const res = await sendWebPushNotification({
          subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k1', auth: 'a1' },
          payload: { title: 'Test' },
          vapidConfig: getVapidConfig(VALID_VAPID),
          webPushClient: mockClient
        });

        assert.equal(res.success, true);
        assert.equal(res.statusCode, statusCode);
      }
    });

    test('unconfirmed status outside 200..299 rejects with WEB_PUSH_UNCONFIRMED_SUCCESS', async () => {
      const mockClient = {
        async sendNotification() {
          return { statusCode: 100 };
        }
      };

      await assert.rejects(
        () => sendWebPushNotification({
          subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k1', auth: 'a1' },
          payload: { title: 'Test' },
          vapidConfig: getVapidConfig(VALID_VAPID),
          webPushClient: mockClient
        }),
        (err) => {
          assert.equal(err.code, 'WEB_PUSH_UNCONFIRMED_SUCCESS');
          assert.equal(err.isRetryable, true);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // 5. HTTP 429 Retry-After Contract
  // ============================================================================
  describe('5. HTTP 429 Retry-After Contract', () => {
    test('parseRetryAfterHeader: parses integer seconds and schedules in future', () => {
      const now = new Date('2026-09-03T12:00:00Z');
      const headers = { 'retry-after': '300' };
      const parsed = parseRetryAfterHeader(headers, now);

      assert.ok(parsed instanceof Date);
      assert.equal(parsed.toISOString(), '2026-09-03T12:05:00.000Z');
    });

    test('parseRetryAfterHeader: parses valid future HTTP Date', () => {
      const now = new Date('2026-09-03T12:00:00Z');
      const futureDate = 'Wed, 03 Sep 2026 12:10:00 GMT';
      const headers = { 'Retry-After': futureDate };
      const parsed = parseRetryAfterHeader(headers, now);

      assert.ok(parsed instanceof Date);
      assert.equal(parsed.toISOString(), '2026-09-03T12:10:00.000Z');
    });

    test('parseRetryAfterHeader: ignores past HTTP Date and returns null', () => {
      const now = new Date('2026-09-03T12:00:00Z');
      const pastDate = 'Wed, 03 Sep 2026 11:00:00 GMT';
      const headers = { 'retry-after': pastDate };
      const parsed = parseRetryAfterHeader(headers, now);

      assert.equal(parsed, null);
    });

    test('parseRetryAfterHeader: returns null on missing, empty, or invalid header', () => {
      assert.equal(parseRetryAfterHeader(null), null);
      assert.equal(parseRetryAfterHeader({}), null);
      assert.equal(parseRetryAfterHeader({ 'retry-after': 'invalid-date' }), null);
      assert.equal(parseRetryAfterHeader({ 'retry-after': '-50' }), null);
    });

    test('dispatcher applies Retry-After header on HTTP 429 to next_attempt_at', async () => {
      const retryableDeliveries = [];
      const now = new Date('2026-09-03T12:00:00Z');

      const mockDeliveries = [
        { id: 'd-1', subscriptionId: 'sub-1', assetId: 'asset-btc', attemptCount: 1, targetPrice: 90000, observedPrice: 95000, direction: 'above' }
      ];

      const services = {
        getVapidConfigFn: () => getVapidConfig(VALID_VAPID),
        claimPendingAlertDeliveriesFn: async () => mockDeliveries,
        getPushSubscriptionByIdFn: async (id) => ({ id, endpoint: 'https://fcm/1', p256dh: 'k', auth: 'a' }),
        getAssetsFn: async () => [{ id: 'asset-btc', symbol: 'BTC', quoteCurrency: 'USD' }],
        sendWebPushNotificationFn: async () => {
          const err = new Error('Too Many Requests');
          err.statusCode = 429;
          err.code = 'WEB_PUSH_RATE_LIMITED';
          err.isRetryable = true;
          err.retryAfterDate = new Date('2026-09-03T12:05:00Z'); // 300s later
          throw err;
        },
        markAlertDeliveryFailedRetryableFn: async ({ deliveryId, error, nextAttemptAt }) => {
          retryableDeliveries.push({ deliveryId, error, nextAttemptAt });
        }
      };

      const result = await dispatchPendingWebPushDeliveries({ now, services });

      assert.equal(result.deliveryRetryableFailureCount, 1);
      assert.equal(retryableDeliveries.length, 1);
      assert.equal(retryableDeliveries[0].nextAttemptAt.toISOString(), '2026-09-03T12:05:00.000Z');
    });

    test('dispatcher falls back to default 15m retry if 429 has no Retry-After', async () => {
      const retryableDeliveries = [];
      const now = new Date('2026-09-03T12:00:00Z');

      const mockDeliveries = [
        { id: 'd-1', subscriptionId: 'sub-1', assetId: 'asset-btc', attemptCount: 1, targetPrice: 90000, observedPrice: 95000, direction: 'above' }
      ];

      const services = {
        getVapidConfigFn: () => getVapidConfig(VALID_VAPID),
        claimPendingAlertDeliveriesFn: async () => mockDeliveries,
        getPushSubscriptionByIdFn: async (id) => ({ id, endpoint: 'https://fcm/1', p256dh: 'k', auth: 'a' }),
        getAssetsFn: async () => [{ id: 'asset-btc', symbol: 'BTC', quoteCurrency: 'USD' }],
        sendWebPushNotificationFn: async () => {
          const err = new Error('Too Many Requests');
          err.statusCode = 429;
          err.code = 'WEB_PUSH_RATE_LIMITED';
          err.isRetryable = true;
          err.retryAfterDate = null;
          throw err;
        },
        markAlertDeliveryFailedRetryableFn: async ({ deliveryId, error, nextAttemptAt }) => {
          retryableDeliveries.push({ deliveryId, error, nextAttemptAt });
        }
      };

      const result = await dispatchPendingWebPushDeliveries({ now, services });

      assert.equal(result.deliveryRetryableFailureCount, 1);
      assert.equal(retryableDeliveries[0].nextAttemptAt.toISOString(), '2026-09-03T12:15:00.000Z');
    });
  });

  // ============================================================================
  // 6. VAPID Not Configured / Controlled Failure
  // ============================================================================
  describe('6. VAPID Not Configured / Controlled Failure', () => {
    test('claimed delivery with unconfigured VAPID: marked failed_permanent, subscription NOT deleted, alert remains triggered', async () => {
      let markedPermanent = null;
      let deleteCalled = false;

      const mockDeliveries = [
        { id: 'd-1', subscriptionId: 'sub-1', assetId: 'asset-btc', attemptCount: 1, targetPrice: 90000, observedPrice: 95000, direction: 'above' }
      ];

      const services = {
        getVapidConfigFn: () => ({ isConfigured: false, publicKey: null, privateKey: null, subject: null }),
        claimPendingAlertDeliveriesFn: async () => mockDeliveries,
        deletePushSubscriptionFn: async () => {
          deleteCalled = true;
        },
        markAlertDeliveryFailedPermanentFn: async (args) => {
          markedPermanent = args;
        }
      };

      const result = await dispatchPendingWebPushDeliveries({ services });

      assert.equal(result.deliveryPermanentFailureCount, 1);
      assert.equal(result.deliverySentCount, 0);
      assert.equal(result.deliveryExpiredSubscriptionCount, 0);
      assert.equal(deleteCalled, false, 'Subscription must NOT be deleted when server VAPID is unconfigured');
      assert.equal(markedPermanent.deliveryId, 'd-1');
      assert.equal(markedPermanent.error, 'VAPID_NOT_CONFIGURED');
    });
  });

  // ============================================================================
  // 7. 404 / 410 Expired Subscription Cascade Path
  // ============================================================================
  describe('7. 404 / 410 Expired Subscription Cascade Path', () => {
    test('HTTP 404 and HTTP 410: delete only matching subscription, no post-delete mutation, other devices intact', async () => {
      for (const expiredStatusCode of [404, 410]) {
        let deletedSubId = null;
        let deliveryMutated = false;
        const sentDeliveries = [];

        const mockDeliveries = [
          { id: 'd-1', subscriptionId: 'sub-laptop', assetId: 'asset-btc', attemptCount: 1, targetPrice: 90000, observedPrice: 95000, direction: 'above' },
          { id: 'd-2', subscriptionId: 'sub-expired-phone', assetId: 'asset-btc', attemptCount: 1, targetPrice: 90000, observedPrice: 95000, direction: 'above' }
        ];

        const services = {
          getVapidConfigFn: () => getVapidConfig(VALID_VAPID),
          claimPendingAlertDeliveriesFn: async () => mockDeliveries,
          getPushSubscriptionByIdFn: async (id) => ({
            id,
            endpoint: `https://fcm/${id}`,
            p256dh: 'k',
            auth: 'a'
          }),
          deletePushSubscriptionFn: async (subId) => {
            deletedSubId = subId;
          },
          getAssetsFn: async () => [{ id: 'asset-btc', symbol: 'BTC', quoteCurrency: 'USD' }],
          sendWebPushNotificationFn: async ({ subscription }) => {
            if (subscription.id === 'sub-expired-phone') {
              const err = new Error(`HTTP ${expiredStatusCode}`);
              err.statusCode = expiredStatusCode;
              err.code = 'WEB_PUSH_SUBSCRIPTION_EXPIRED';
              err.isExpired = true;
              throw err;
            }
            return { success: true, statusCode: 201 };
          },
          markAlertDeliverySentFn: async ({ deliveryId }) => {
            sentDeliveries.push(deliveryId);
          },
          markAlertDeliveryFailedPermanentFn: async () => {
            deliveryMutated = true;
          },
          markAlertDeliveryFailedRetryableFn: async () => {
            deliveryMutated = true;
          }
        };

        const result = await dispatchPendingWebPushDeliveries({ services });

        assert.equal(result.deliverySentCount, 1);
        assert.equal(result.deliveryExpiredSubscriptionCount, 1);
        assert.equal(deletedSubId, 'sub-expired-phone');
        assert.equal(deliveryMutated, false, 'Do not mutate delivery row after ON DELETE CASCADE deletion');
        assert.deepEqual(sentDeliveries, ['d-1'], 'Other device delivery succeeds independently');
      }
    });
  });

  // ============================================================================
  // 8. Protected Subscription API
  // ============================================================================
  describe('8. Protected Subscription API', () => {
    let mockSubscriptions = [];

    const services = {
      ownerAccessToken: OWNER_TOKEN,
      getInvestorProfileFn: async () => ({ id: 'prof-singleton' }),
      getVapidConfigFn: () => getVapidConfig(VALID_VAPID),
      upsertPushSubscriptionFn: async ({ profileId, endpoint, p256dh, auth, userAgent }) => {
        const existingIdx = mockSubscriptions.findIndex(s => s.endpoint === endpoint);
        const record = {
          id: existingIdx >= 0 ? mockSubscriptions[existingIdx].id : 'sub-' + (mockSubscriptions.length + 1),
          profileId,
          endpoint,
          p256dh,
          auth,
          userAgent,
          created_at: new Date().toISOString()
        };
        if (existingIdx >= 0) mockSubscriptions[existingIdx] = record;
        else mockSubscriptions.push(record);
        return record;
      },
      deletePushSubscriptionByEndpointFn: async (endpoint, profileId) => {
        const idx = mockSubscriptions.findIndex(s => s.endpoint === endpoint && s.profileId === profileId);
        if (idx >= 0) {
          return mockSubscriptions.splice(idx, 1)[0];
        }
        return null;
      }
    };

    beforeEach(() => {
      mockSubscriptions = [];
    });

    test('GET /api/push/config: unauthenticated returns 401', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/push/config`);
        assert.equal(res.status, 401);
      } finally {
        server.close();
      }
    });

    test('GET /api/push/config: authenticated returns public key and never leaks private key', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/push/config`, {
          headers: { Authorization: `Bearer ${OWNER_TOKEN}` }
        });
        const payload = await res.json();
        assert.equal(res.status, 200);
        assert.equal(payload.data.supported, true);
        assert.equal(payload.data.configured, true);
        assert.equal(payload.data.vapidPublicKey, VALID_VAPID.VAPID_PUBLIC_KEY);
        assert.equal(JSON.stringify(payload).includes(VALID_VAPID.VAPID_PRIVATE_KEY), false);
      } finally {
        server.close();
      }
    });

    test('POST /api/push/subscriptions: accepts valid subscription and creates record', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OWNER_TOKEN}`,
            'User-Agent': 'Mozilla/5.0 TestBrowser'
          },
          body: JSON.stringify({
            endpoint: 'https://fcm.googleapis.com/fcm/send/device-laptop',
            keys: {
              p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A4If_ZqPPn5DP6V8rReWhOjhKPTvKj8MnFLT_Tymmg=',
              auth: 'tBHItJI5svbpez7KI4CCXg=='
            }
          })
        });

        const payload = await res.json();
        assert.equal(res.status, 201);
        assert.ok(payload.data.id);
        assert.equal(mockSubscriptions.length, 1);
        assert.equal(mockSubscriptions[0].userAgent, 'Mozilla/5.0 TestBrowser');
        assert.equal(JSON.stringify(payload).includes('p256dh'), false, 'Never echo crypto keys in API response');
      } finally {
        server.close();
      }
    });

    test('POST /api/push/subscriptions: same endpoint upserts without creating duplicates', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        const body = {
          endpoint: 'https://fcm.googleapis.com/fcm/send/device-laptop',
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A4If_ZqPPn5DP6V8rReWhOjhKPTvKj8MnFLT_Tymmg=',
            auth: 'tBHItJI5svbpez7KI4CCXg=='
          }
        };

        // First call
        await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
          body: JSON.stringify(body)
        });

        // Second call with updated key
        await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
          body: JSON.stringify({
            ...body,
            keys: { ...body.keys, auth: 'new-auth-key-value==' }
          })
        });

        assert.equal(mockSubscriptions.length, 1, 'Endpoint uniqueness prevents duplicate device rows');
        assert.equal(mockSubscriptions[0].auth, 'new-auth-key-value==');
      } finally {
        server.close();
      }
    });

    test('POST /api/push/subscriptions: second device creates independent second row', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        // Device 1
        await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
          body: JSON.stringify({
            endpoint: 'https://fcm.googleapis.com/fcm/send/laptop',
            keys: { p256dh: 'key1-minimum-16-chars-len', auth: 'auth1-min-8' }
          })
        });

        // Device 2
        await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
          body: JSON.stringify({
            endpoint: 'https://fcm.googleapis.com/fcm/send/phone',
            keys: { p256dh: 'key2-minimum-16-chars-len', auth: 'auth2-min-8' }
          })
        });

        assert.equal(mockSubscriptions.length, 2);
      } finally {
        server.close();
      }
    });

    test('DELETE /api/push/subscriptions: removes only requested endpoint', async () => {
      const { baseUrl, server } = await listen(createApp(services));
      try {
        mockSubscriptions = [
          { id: 'sub-1', profileId: 'prof-singleton', endpoint: 'https://fcm/laptop' },
          { id: 'sub-2', profileId: 'prof-singleton', endpoint: 'https://fcm/phone' }
        ];

        const res = await fetch(`${baseUrl}/api/push/subscriptions`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OWNER_TOKEN}` },
          body: JSON.stringify({ endpoint: 'https://fcm/laptop' })
        });

        const payload = await res.json();
        assert.equal(res.status, 200);
        assert.equal(payload.data.removed, true);
        assert.equal(mockSubscriptions.length, 1);
        assert.equal(mockSubscriptions[0].endpoint, 'https://fcm/phone');
      } finally {
        server.close();
      }
    });
  });

  // ============================================================================
  // 9. Internal Scheduler Integration Contract
  // ============================================================================
  describe('9. Internal Scheduler Integration Contract', () => {
    test('scheduler executes alert evaluation and dispatches outbox in same invocation', async () => {
      let evalCalled = false;
      let dispatchCalled = false;

      const services = {
        ownerAccessToken: OWNER_TOKEN,
        alertSchedulerToken: SCHEDULER_TOKEN,
        evaluateAndPersistAlertsFn: async () => {
          evalCalled = true;
          return { evaluatedCount: 3, triggeredCount: 1, unavailableCount: 0, staleCount: 0 };
        },
        dispatchPendingWebPushDeliveriesFn: async () => {
          dispatchCalled = true;
          return {
            deliveryClaimedCount: 1,
            deliverySentCount: 1,
            deliveryRetryableFailureCount: 0,
            deliveryPermanentFailureCount: 0,
            deliveryExpiredSubscriptionCount: 0
          };
        }
      };

      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
        });

        const payload = await res.json();
        assert.equal(res.status, 200);
        assert.equal(evalCalled, true);
        assert.equal(dispatchCalled, true);
        assert.deepEqual(payload.data, {
          evaluatedCount: 3,
          triggeredCount: 1,
          unavailableCount: 0,
          staleCount: 0,
          deliveryClaimedCount: 1,
          deliverySentCount: 1,
          deliveryRetryableFailureCount: 0,
          deliveryPermanentFailureCount: 0,
          deliveryExpiredSubscriptionCount: 0
        });
      } finally {
        server.close();
      }
    });

    test('dispatcher failure in scheduler does not roll back or fail alert evaluation outcome', async () => {
      const services = {
        ownerAccessToken: OWNER_TOKEN,
        alertSchedulerToken: SCHEDULER_TOKEN,
        evaluateAndPersistAlertsFn: async () => {
          return { evaluatedCount: 3, triggeredCount: 1, unavailableCount: 0, staleCount: 0 };
        },
        dispatchPendingWebPushDeliveriesFn: async () => {
          throw new Error('Database connection failed during dispatch');
        }
      };

      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
        });

        const payload = await res.json();
        assert.equal(res.status, 200);
        assert.equal(payload.data.triggeredCount, 1);
        assert.equal(payload.data.deliveryClaimedCount, 0);
      } finally {
        server.close();
      }
    });

    test('scheduler response never leaks VAPID keys, endpoints, or subscription materials', async () => {
      const services = {
        ownerAccessToken: OWNER_TOKEN,
        alertSchedulerToken: SCHEDULER_TOKEN,
        evaluateAndPersistAlertsFn: async () => ({
          evaluatedCount: 1,
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
        })
      };

      const { baseUrl, server } = await listen(createApp(services));
      try {
        const res = await fetch(`${baseUrl}/api/internal/alerts/evaluate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SCHEDULER_TOKEN}` }
        });
        const rawText = await res.text();
        assert.doesNotMatch(rawText, /VAPID|privateKey|publicKey|p256dh|auth|endpoint/i);
      } finally {
        server.close();
      }
    });
  });
});
