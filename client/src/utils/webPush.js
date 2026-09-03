import { apiFetch } from './api.js';

/**
 * Feature 12D: Converts URL-safe base64 VAPID public key into a Uint8Array
 * required by PushManager.subscribe({ applicationServerKey }).
 */
export function urlBase64ToUint8Array(base64String) {
  if (typeof base64String !== 'string' || !base64String.trim()) {
    throw new Error('VAPID public key must be a non-empty string');
  }

  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Feature 12D: Detects whether the current browser environment supports Web Push.
 */
export function isWebPushSupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasServiceWorker = Boolean(navigator && 'serviceWorker' in navigator && navigator.serviceWorker);
  const hasPushManager = Boolean((window && 'PushManager' in window && window.PushManager) || (typeof PushManager !== 'undefined' && PushManager));
  const hasNotification = Boolean((window && 'Notification' in window && window.Notification) || (typeof Notification !== 'undefined' && Notification));
  return Boolean(hasServiceWorker && hasPushManager && hasNotification);
}

/**
 * Feature 12D: Detects if current device is iOS/iPadOS.
 */
export function isIosDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  );
}

/**
 * Feature 12D: Detects if running as standalone PWA (added to Home Screen).
 */
export function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  const nav = typeof navigator !== 'undefined' ? navigator : window.navigator;
  return Boolean(
    nav?.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches === true)
  );
}

/**
 * Feature 12D: Comprehensive capability state for Web Push.
 */
export function getWebPushCapability() {
  const supported = isWebPushSupported();
  const isIos = isIosDevice();
  const isStandalone = isStandaloneMode();
  const requiresIosHomeScreen = isIos && !isStandalone;
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  return {
    supported,
    isIos,
    isStandalone,
    requiresIosHomeScreen,
    permission
  };
}

/**
 * Feature 12D: Read-only inspection of existing PushSubscription on this device.
 * Never requests permission or mutates subscription state.
 */
export async function getExistingPushSubscription() {
  if (!isWebPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.pushManager) return null;
    return await reg.pushManager.getSubscription();
  } catch (_err) {
    return null;
  }
}

/**
 * Feature 12D: Fetches public VAPID configuration from backend.
 * Protected endpoint; returns { supported, configured, vapidPublicKey }.
 */
export async function getPushConfig() {
  const res = await apiFetch('/api/push/config');
  const json = await res.json();
  if (!res.ok || json.status !== 'ok') {
    throw new Error(json.message || 'Không thể lấy cấu hình thông báo');
  }
  return json.data || {};
}

/**
 * Feature 12D: Enables Web Push notifications on current device upon explicit user action.
 * Strict sequencing:
 * 1. Capability check
 * 2. iOS Home Screen check
 * 3. GET /api/push/config (if configured=false, abort without requesting permission)
 * 4. Request Notification.permission (if not granted, stop safely)
 * 5. Register /sw.js
 * 6. Subscribe via PushManager
 * 7. POST subscription JSON to /api/push/subscriptions
 * 8. If POST fails after new subscription created, rollback local subscription.
 */
export async function enableWebPushNotifications() {
  if (!isWebPushSupported()) {
    throw new Error('Trình duyệt không hỗ trợ Web Push');
  }

  const capability = getWebPushCapability();
  if (capability.requiresIosHomeScreen) {
    throw new Error('IOS_REQUIRES_HOME_SCREEN');
  }

  // 1. Fetch server VAPID configuration first
  const config = await getPushConfig();
  if (!config.configured || !config.vapidPublicKey) {
    throw new Error('VAPID_NOT_CONFIGURED');
  }

  // 2. Request Notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      enabled: false,
      permission,
      reason: 'PERMISSION_DENIED'
    };
  }

  // 3. Register or get Service Worker
  const reg = await navigator.serviceWorker.register('/sw.js');
  if (navigator.serviceWorker.ready) {
    await navigator.serviceWorker.ready;
  }

  const pm = reg?.pushManager || (typeof navigator.serviceWorker.getRegistration === 'function' ? (await navigator.serviceWorker.getRegistration())?.pushManager : null);
  if (!pm) {
    throw new Error('PushManager không khả dụng');
  }

  // 4. Get or create browser PushSubscription
  let sub = await pm.getSubscription();
  let isNewSubscription = false;

  if (!sub) {
    const applicationServerKey = urlBase64ToUint8Array(config.vapidPublicKey);
    sub = await pm.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    isNewSubscription = true;
  }

  // 5. Persist subscription to backend
  try {
    const res = await apiFetch('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof sub.toJSON === 'function' ? sub.toJSON() : sub)
    });
    const json = await res.json();
    if (!res.ok || json.status !== 'ok') {
      throw new Error(json.message || 'Lưu đăng ký thiết bị thất bại');
    }
  } catch (postErr) {
    // If a brand new browser subscription was created and backend fails, roll back locally
    if (isNewSubscription && sub && typeof sub.unsubscribe === 'function') {
      try {
        await sub.unsubscribe();
      } catch (_rollbackErr) {
        // Suppress rollback error
      }
    }
    throw postErr;
  }

  return {
    enabled: true,
    permission: 'granted',
    subscription: sub
  };
}

/**
 * Feature 12D: Disables Web Push notifications on current device upon explicit user action.
 * Strict sequencing:
 * 1. Capture current endpoint
 * 2. DELETE /api/push/subscriptions with endpoint
 * 3. Only after backend deletion succeeds, unsubscribe locally.
 */
export async function disableWebPushNotifications() {
  const sub = await getExistingPushSubscription();
  if (!sub) {
    return { disabled: true };
  }

  const endpoint = sub.endpoint;

  // 1. Delete from backend first (cascading deliveries in PostgreSQL)
  const res = await apiFetch('/api/push/subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint })
  });
  const json = await res.json();
  if (!res.ok || json.status !== 'ok') {
    throw new Error(json.message || 'Hủy đăng ký trên máy chủ thất bại');
  }

  // 2. Unsubscribe browser PushManager
  let localUnsubscribed = true;
  try {
    localUnsubscribed = await sub.unsubscribe();
  } catch (_unsubErr) {
    localUnsubscribed = false;
  }

  if (!localUnsubscribed) {
    throw new Error('BROWSER_UNSUBSCRIBE_FAILED');
  }

  return { disabled: true };
}
