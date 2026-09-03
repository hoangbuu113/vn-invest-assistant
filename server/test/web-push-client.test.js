import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  urlBase64ToUint8Array,
  isWebPushSupported,
  isIosDevice,
  isStandaloneMode,
  getWebPushCapability,
  getExistingPushSubscription,
  enableWebPushNotifications,
  disableWebPushNotifications
} from '../../client/src/utils/webPush.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Standard 65-byte uncompressed P-256 public key (all 0x04 bytes)
const VALID_VAPID_KEY_65 = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  });
}

function mockBrowserEnvironment({
  hasServiceWorker = true,
  hasPushManager = true,
  hasNotification = true,
  permission = 'default',
  requestPermissionFn = null,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  platform = 'Win32',
  maxTouchPoints = 0,
  standalone = false,
  registration = null,
  fetchFn = null
} = {}) {
  const PushManagerClass = hasPushManager ? class PushManager {} : undefined;
  const NotificationClass = hasNotification ? {
    permission,
    requestPermission: requestPermissionFn || (async () => permission)
  } : undefined;

  const swMock = hasServiceWorker ? {
    register: async () => registration || {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({
          endpoint: 'https://fcm/default',
          toJSON: () => ({ endpoint: 'https://fcm/default' })
        })
      }
    },
    getRegistration: async () => registration,
    ready: Promise.resolve(registration)
  } : undefined;

  const navMock = {
    userAgent,
    platform,
    maxTouchPoints,
    standalone
  };
  if (hasServiceWorker) {
    navMock.serviceWorker = swMock;
  }

  const winMock = {
    navigator: navMock,
    matchMedia: (query) => ({
      matches: query.includes('standalone') && standalone
    })
  };
  if (hasPushManager) {
    winMock.PushManager = PushManagerClass;
  }
  if (hasNotification) {
    winMock.Notification = NotificationClass;
  }
  winMock.window = winMock;

  setGlobal('window', winMock);
  setGlobal('navigator', navMock);
  setGlobal('PushManager', PushManagerClass);
  setGlobal('Notification', NotificationClass);
  if (fetchFn) {
    setGlobal('fetch', fetchFn);
  }
}

describe('Feature 12D — Web Push Client Implementation Contract', () => {

  // ============================================================================
  // 1. VAPID Public Key Conversion (urlBase64ToUint8Array)
  // ============================================================================
  describe('1. VAPID Public Key Conversion', () => {
    test('converts standard URL-safe base64 string to Uint8Array', () => {
      const uint8 = urlBase64ToUint8Array(VALID_VAPID_KEY_65);

      assert.ok(uint8 instanceof Uint8Array);
      assert.equal(uint8.length, 65);
      assert.equal(uint8[0], 0x04);
      assert.equal(uint8[64], 0x04);
    });

    test('rejects empty or non-string inputs', () => {
      assert.throws(() => urlBase64ToUint8Array(''), /non-empty string/);
      assert.throws(() => urlBase64ToUint8Array(null), /non-empty string/);
      assert.throws(() => urlBase64ToUint8Array(123), /non-empty string/);
    });
  });

  // ============================================================================
  // 2. Capability & iOS Detection
  // ============================================================================
  describe('2. Capability & iOS Detection', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    const originalNotification = globalThis.Notification;
    const originalPushManager = globalThis.PushManager;

    afterEach(() => {
      setGlobal('window', originalWindow);
      setGlobal('navigator', originalNavigator);
      setGlobal('Notification', originalNotification);
      setGlobal('PushManager', originalPushManager);
    });

    test('isWebPushSupported detects full support when all native APIs exist', () => {
      mockBrowserEnvironment();
      assert.equal(isWebPushSupported(), true);
    });

    test('isWebPushSupported returns false if serviceWorker is missing', () => {
      mockBrowserEnvironment({ hasServiceWorker: false });
      assert.equal(isWebPushSupported(), false);
    });

    test('isWebPushSupported returns false if PushManager is missing', () => {
      mockBrowserEnvironment({ hasPushManager: false });
      assert.equal(isWebPushSupported(), false);
    });

    test('isWebPushSupported returns false if Notification is missing', () => {
      mockBrowserEnvironment({ hasNotification: false });
      assert.equal(isWebPushSupported(), false);
    });

    test('isIosDevice detects iPhone user agent', () => {
      mockBrowserEnvironment({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      });
      assert.equal(isIosDevice(), true);
    });

    test('isIosDevice detects iPadOS with touch points', () => {
      mockBrowserEnvironment({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5
      });
      assert.equal(isIosDevice(), true);
    });

    test('isStandaloneMode detects standalone PWA', () => {
      mockBrowserEnvironment({ standalone: true });
      assert.equal(isStandaloneMode(), true);
    });

    test('getWebPushCapability returns requiresIosHomeScreen=true on non-standalone iOS', () => {
      mockBrowserEnvironment({
        userAgent: 'iPhone',
        standalone: false,
        permission: 'default'
      });

      const cap = getWebPushCapability();
      assert.equal(cap.supported, true);
      assert.equal(cap.isIos, true);
      assert.equal(cap.isStandalone, false);
      assert.equal(cap.requiresIosHomeScreen, true);
      assert.equal(cap.permission, 'default');
    });

    test('getWebPushCapability returns requiresIosHomeScreen=false when iOS is standalone', () => {
      mockBrowserEnvironment({
        userAgent: 'iPhone',
        standalone: true,
        permission: 'default'
      });

      const cap = getWebPushCapability();
      assert.equal(cap.requiresIosHomeScreen, false);
    });
  });

  // ============================================================================
  // 3. Read-Only Initial State Contract
  // ============================================================================
  describe('3. Read-Only Initial State Contract', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    const originalNotification = globalThis.Notification;
    const originalPushManager = globalThis.PushManager;

    afterEach(() => {
      setGlobal('window', originalWindow);
      setGlobal('navigator', originalNavigator);
      setGlobal('Notification', originalNotification);
      setGlobal('PushManager', originalPushManager);
    });

    test('getExistingPushSubscription inspects existing subscription without requesting permission', async () => {
      let permissionRequested = false;
      const fakeSub = { endpoint: 'https://fcm/existing' };

      mockBrowserEnvironment({
        registration: {
          pushManager: {
            getSubscription: async () => fakeSub
          }
        },
        requestPermissionFn: async () => {
          permissionRequested = true;
          return 'granted';
        }
      });

      const sub = await getExistingPushSubscription();
      assert.equal(sub.endpoint, 'https://fcm/existing');
      assert.equal(permissionRequested, false, 'Inspection on mount must NEVER request browser permission');
    });
  });

  // ============================================================================
  // 4. Enable Flow Sequencing & Safety
  // ============================================================================
  describe('4. Enable Flow Sequencing & Safety', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    const originalNotification = globalThis.Notification;
    const originalPushManager = globalThis.PushManager;
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      setGlobal('window', originalWindow);
      setGlobal('navigator', originalNavigator);
      setGlobal('Notification', originalNotification);
      setGlobal('PushManager', originalPushManager);
      setGlobal('fetch', originalFetch);
    });

    test('configured=false from server aborts without requesting browser notification permission', async () => {
      let permissionRequested = false;

      mockBrowserEnvironment({
        requestPermissionFn: async () => {
          permissionRequested = true;
          return 'granted';
        },
        fetchFn: async (url) => {
          if (url.includes('/api/push/config')) {
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { supported: true, configured: false, vapidPublicKey: null } })
            };
          }
          throw new Error(`Unexpected fetch ${url}`);
        }
      });

      await assert.rejects(
        () => enableWebPushNotifications(),
        (err) => err.message === 'VAPID_NOT_CONFIGURED'
      );

      assert.equal(permissionRequested, false, 'Must never request permission when server VAPID is unconfigured');
    });

    test('iOS non-standalone aborts with guidance before requesting permission', async () => {
      let permissionRequested = false;

      mockBrowserEnvironment({
        userAgent: 'iPhone',
        standalone: false,
        requestPermissionFn: async () => {
          permissionRequested = true;
          return 'granted';
        }
      });

      await assert.rejects(
        () => enableWebPushNotifications(),
        (err) => err.message === 'IOS_REQUIRES_HOME_SCREEN'
      );

      assert.equal(permissionRequested, false, 'Must never request permission on iOS non-standalone');
    });

    test('denied permission stops safely without subscribing or calling backend', async () => {
      let subscribed = false;
      let backendCalled = false;

      mockBrowserEnvironment({
        permission: 'default',
        requestPermissionFn: async () => 'denied',
        registration: {
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => {
              subscribed = true;
              return {};
            }
          }
        },
        fetchFn: async (url) => {
          if (url.includes('/api/push/config')) {
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { supported: true, configured: true, vapidPublicKey: VALID_VAPID_KEY_65 } })
            };
          }
          if (url.includes('/api/push/subscriptions')) {
            backendCalled = true;
          }
        }
      });

      const result = await enableWebPushNotifications();

      assert.equal(result.enabled, false);
      assert.equal(result.permission, 'denied');
      assert.equal(result.reason, 'PERMISSION_DENIED');
      assert.equal(subscribed, false);
      assert.equal(backendCalled, false);
    });

    test('existing browser subscription is reused without re-subscribing', async () => {
      let subscribeCalled = false;
      let postedBody = null;

      const existingSub = {
        endpoint: 'https://fcm/existing-laptop',
        toJSON: () => ({ endpoint: 'https://fcm/existing-laptop' })
      };

      mockBrowserEnvironment({
        requestPermissionFn: async () => 'granted',
        registration: {
          pushManager: {
            getSubscription: async () => existingSub,
            subscribe: async () => {
              subscribeCalled = true;
              return existingSub;
            }
          }
        },
        fetchFn: async (url, options) => {
          if (url.includes('/api/push/config')) {
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { supported: true, configured: true, vapidPublicKey: VALID_VAPID_KEY_65 } })
            };
          }
          if (url.includes('/api/push/subscriptions')) {
            postedBody = JSON.parse(options.body);
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { id: 'sub-1' } })
            };
          }
        }
      });

      const res = await enableWebPushNotifications();

      assert.equal(res.enabled, true);
      assert.equal(subscribeCalled, false, 'Must reuse existing browser PushSubscription');
      assert.equal(postedBody.endpoint, 'https://fcm/existing-laptop');
    });

    test('backend POST failure on new subscription triggers local unsubscribe rollback', async () => {
      let rollbackCalled = false;
      const fakeSubscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/fake-sub-1',
        toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake-sub-1' }),
        unsubscribe: async () => {
          rollbackCalled = true;
          return true;
        }
      };

      mockBrowserEnvironment({
        requestPermissionFn: async () => 'granted',
        registration: {
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => fakeSubscription
          }
        },
        fetchFn: async (url) => {
          if (url.includes('/api/push/config')) {
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { supported: true, configured: true, vapidPublicKey: VALID_VAPID_KEY_65 } })
            };
          }
          if (url.includes('/api/push/subscriptions')) {
            return {
              ok: false,
              status: 500,
              json: async () => ({ status: 'error', message: 'Database connection failed' })
            };
          }
        }
      });

      await assert.rejects(
        () => enableWebPushNotifications(),
        /Database connection failed/
      );

      assert.equal(rollbackCalled, true, 'Local subscription must be rolled back if backend POST fails');
    });
  });

  // ============================================================================
  // 5. Disable Flow Sequencing & Safety
  // ============================================================================
  describe('5. Disable Flow Sequencing & Safety', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    const originalNotification = globalThis.Notification;
    const originalPushManager = globalThis.PushManager;
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      setGlobal('window', originalWindow);
      setGlobal('navigator', originalNavigator);
      setGlobal('Notification', originalNotification);
      setGlobal('PushManager', originalPushManager);
      setGlobal('fetch', originalFetch);
    });

    test('backend DELETE is executed before local unsubscribe()', async () => {
      const callSequence = [];
      const fakeSubscription = {
        endpoint: 'https://fcm/laptop-endpoint',
        unsubscribe: async () => {
          callSequence.push('local_unsubscribe');
          return true;
        }
      };

      mockBrowserEnvironment({
        registration: {
          pushManager: {
            getSubscription: async () => fakeSubscription
          }
        },
        fetchFn: async (url, options) => {
          if (url.includes('/api/push/subscriptions') && options.method === 'DELETE') {
            callSequence.push('backend_delete');
            const body = JSON.parse(options.body);
            assert.equal(body.endpoint, 'https://fcm/laptop-endpoint');
            return {
              ok: true,
              json: async () => ({ status: 'ok', data: { removed: true } })
            };
          }
        }
      });

      const res = await disableWebPushNotifications();

      assert.equal(res.disabled, true);
      assert.deepEqual(callSequence, ['backend_delete', 'local_unsubscribe']);
    });

    test('backend delete failure aborts without local unsubscribe (no silent unsync)', async () => {
      let localUnsubscribed = false;
      const fakeSubscription = {
        endpoint: 'https://fcm/laptop-endpoint',
        unsubscribe: async () => {
          localUnsubscribed = true;
          return true;
        }
      };

      mockBrowserEnvironment({
        registration: {
          pushManager: {
            getSubscription: async () => fakeSubscription
          }
        },
        fetchFn: async (url, options) => {
          if (url.includes('/api/push/subscriptions') && options.method === 'DELETE') {
            return {
              ok: false,
              status: 500,
              json: async () => ({ status: 'error', message: 'Server delete failed' })
            };
          }
        }
      });

      await assert.rejects(
        () => disableWebPushNotifications(),
        /Server delete failed/
      );

      assert.equal(localUnsubscribed, false, 'Must NOT unsubscribe locally if backend deletion fails');
    });
  });

  // ============================================================================
  // 6. Service Worker Script Integrity & Same-Origin Navigation Safety
  // ============================================================================
  describe('6. Service Worker Script Integrity & Same-Origin Safety', () => {
    test('sw.js exists and implements push and notificationclick events', () => {
      const swPath = path.join(REPO_ROOT, 'client/public/sw.js');
      assert.equal(fs.existsSync(swPath), true, 'client/public/sw.js must exist');

      const swContent = fs.readFileSync(swPath, 'utf8');
      assert.match(swContent, /self\.addEventListener\('push'/);
      assert.match(swContent, /self\.addEventListener\('notificationclick'/);
      assert.match(swContent, /showNotification/);
      assert.match(swContent, /notification\.close\(\)/);
    });

    test('sw.js enforces strict same-origin check on notification click URL', () => {
      const swPath = path.join(REPO_ROOT, 'client/public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');

      assert.match(swContent, /parsed\.origin === self\.location\.origin/);
      assert.match(swContent, /targetUrl = self\.location\.origin \+ '\/#alerts'/);
    });

    test('sw.js handles canonical deep links including XAU%2FUSD without mutation', () => {
      const swPath = path.join(REPO_ROOT, 'client/public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');

      assert.match(swContent, /new URL\(rawUrl, self\.location\.origin\)/);
    });

    test('sw.js contains no offline caching, IndexedDB, or financial logic', () => {
      const swPath = path.join(REPO_ROOT, 'client/public/sw.js');
      const swContent = fs.readFileSync(swPath, 'utf8');

      assert.equal(/caches\.open/i.test(swContent), false);
      assert.equal(/indexedDB/i.test(swContent), false);
      assert.equal(/portfolio/i.test(swContent), false);
      assert.equal(/transaction/i.test(swContent), false);
      assert.equal(/cash/i.test(swContent), false);
    });
  });

  // ============================================================================
  // 7. Web App Manifest & iOS Home Screen Contract
  // ============================================================================
  describe('7. Web App Manifest & iOS Home Screen Contract', () => {
    test('client/public/manifest.webmanifest exists with standalone display and root scope', () => {
      const manifestPath = path.join(REPO_ROOT, 'client/public/manifest.webmanifest');
      assert.equal(fs.existsSync(manifestPath), true, 'manifest.webmanifest must exist in client/public');

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.name, 'VN Invest Assistant');
      assert.equal(manifest.short_name, 'VN Invest');
      assert.equal(manifest.start_url, '/');
      assert.equal(manifest.scope, '/');
      assert.equal(manifest.display, 'standalone');
    });

    test('client/index.html links to manifest and defines apple-mobile-web-app metadata', () => {
      const indexPath = path.join(REPO_ROOT, 'client/index.html');
      const indexContent = fs.readFileSync(indexPath, 'utf8');

      assert.match(indexContent, /<link rel="manifest" href="\/manifest\.webmanifest"/);
      assert.match(indexContent, /<meta name="apple-mobile-web-app-capable" content="yes"/);
      assert.match(indexContent, /<meta name="apple-mobile-web-app-title" content="VN Invest"/);
    });

    test('DeviceAlertNotificationControl enforces non-guaranteed wording and iOS guidance', () => {
      const controlPath = path.join(REPO_ROOT, 'client/src/components/DeviceAlertNotificationControl.jsx');
      const controlContent = fs.readFileSync(controlPath, 'utf8');

      // Initial read-only loaded state (unverified in this session)
      assert.match(controlContent, /Thông báo đang được bật trên trình duyệt này\./);

      // Session verified state (after explicit enable)
      assert.match(controlContent, /Thông báo đã bật trên thiết bị này\./);

      // Zero guaranteed-delivery claims
      assert.equal(/đảm bảo/i.test(controlContent), false, 'Must not claim guaranteed delivery');

      // iOS Home screen guidance
      assert.match(controlContent, /Trên iPhone\/iPad:/);
      assert.match(controlContent, /thêm VN Invest Assistant vào Màn hình chính/);
    });
  });
});
