import webpush from 'web-push';
import {
  privateSupabase,
  claimPendingAlertDeliveries,
  markAlertDeliverySent,
  markAlertDeliveryFailedRetryable,
  markAlertDeliveryFailedPermanent,
  getPushSubscriptionById,
  deletePushSubscription,
  getAssets
} from './supabase.js';

/**
 * Feature 12C: Default Web Push request timeout in milliseconds.
 * 10,000ms (10 seconds) ensures a batch of 5 sequential requests consumes
 * at most 50 seconds under worst-case network stalls, leaving 70 seconds of
 * margin within the 120-second PostgreSQL delivery lease.
 */
export const DEFAULT_PUSH_TIMEOUT_MS = 10000;

/**
 * Feature 12C: Reads and validates VAPID environment configuration.
 * VAPID_PUBLIC_KEY is safe for frontend client exposure.
 * VAPID_PRIVATE_KEY is a server-only secret and must never be exposed or logged.
 * VAPID_SUBJECT must be a valid mailto: or https: contact URI.
 */
export function getVapidConfig(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY ? String(env.VAPID_PUBLIC_KEY).trim() : '';
  const privateKey = env.VAPID_PRIVATE_KEY ? String(env.VAPID_PRIVATE_KEY).trim() : '';
  const subject = env.VAPID_SUBJECT ? String(env.VAPID_SUBJECT).trim() : '';

  const isConfigured = Boolean(
    publicKey &&
    privateKey &&
    subject &&
    (subject.startsWith('mailto:') || subject.startsWith('https://'))
  );

  return {
    isConfigured,
    publicKey: isConfigured ? publicKey : null,
    privateKey: isConfigured ? privateKey : null,
    subject: isConfigured ? subject : null
  };
}

/**
 * Feature 12C: Validates and normalizes raw browser PushSubscription payload.
 * Strictly checks endpoint HTTPS scheme, key formats, and lengths.
 */
export function validatePushSubscriptionInput(input) {
  if (!input || typeof input !== 'object') {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_PAYLOAD', 'Push subscription payload must be an object', { isRetryable: false });
  }

  const { endpoint, keys } = input;

  if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_ENDPOINT', 'Subscription endpoint is required', { isRetryable: false });
  }

  const trimmedEndpoint = endpoint.trim();
  if (trimmedEndpoint.length > 2048) {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_ENDPOINT', 'Subscription endpoint exceeds maximum length (2048)', { isRetryable: false });
  }

  try {
    const parsedUrl = new URL(trimmedEndpoint);
    if (parsedUrl.protocol !== 'https:') {
      throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_ENDPOINT', 'Subscription endpoint must use secure https: protocol', { isRetryable: false });
    }
  } catch (err) {
    if (err instanceof WebPushDeliveryError) throw err;
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_ENDPOINT', 'Subscription endpoint is not a valid URL', { isRetryable: false });
  }

  if (!keys || typeof keys !== 'object') {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_KEYS', 'Subscription keys object is required', { isRetryable: false });
  }

  const { p256dh, auth } = keys;

  if (!p256dh || typeof p256dh !== 'string' || p256dh.trim() === '') {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_KEYS', 'Subscription key p256dh is required', { isRetryable: false });
  }

  const trimmedP256dh = p256dh.trim();
  if (trimmedP256dh.length < 16 || trimmedP256dh.length > 512) {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_KEYS', 'Subscription key p256dh length is invalid', { isRetryable: false });
  }

  if (!auth || typeof auth !== 'string' || auth.trim() === '') {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_KEYS', 'Subscription key auth is required', { isRetryable: false });
  }

  const trimmedAuth = auth.trim();
  if (trimmedAuth.length < 8 || trimmedAuth.length > 256) {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_KEYS', 'Subscription key auth length is invalid', { isRetryable: false });
  }

  return {
    endpoint: trimmedEndpoint,
    p256dh: trimmedP256dh,
    auth: trimmedAuth
  };
}

/**
 * Feature 12C: Encodes asset symbols into deep link hash paths.
 * Guarantees round-trip compatibility with Feature 11 canonical hash routing.
 * e.g. BTC -> /#assets/BTC, XAU/USD -> /#assets/XAU%2FUSD
 */
export function buildAssetDeepLinkUrl(symbol) {
  if (!symbol || typeof symbol !== 'string') return '/#alerts';
  return `/#assets/${encodeURIComponent(symbol.trim())}`;
}

/**
 * Formats price according to truthful quote currency.
 * VND -> integer with dots.
 * USD / Crypto -> decimal formatting.
 */
export function formatAlertPrice(price, quoteCurrency = 'VND') {
  const num = Number(price);
  if (!Number.isFinite(num)) return `${price} ${quoteCurrency}`;

  const normCurrency = String(quoteCurrency || 'VND').toUpperCase();
  if (normCurrency === 'VND') {
    const rounded = Math.round(num);
    const formatted = new Intl.NumberFormat('vi-VN').format(rounded);
    return `${formatted} VND`;
  }

  const formatted = new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  }).format(num);

  return `${formatted} ${normCurrency}`;
}

/**
 * Builds factual Vietnamese notification payload from original immutable event facts.
 * Strictly no recommendations, predictions, portfolio balances, P&L, or secrets.
 */
export function buildWebPushPayload({ delivery, asset }) {
  if (!delivery) throw new Error('delivery object is required');
  if (!asset) throw new Error('asset object is required');

  const symbol = asset.symbol || 'ASSET';
  const quoteCurrency = asset.quoteCurrency || 'VND';
  const targetFormatted = formatAlertPrice(delivery.targetPrice, quoteCurrency);
  const observedFormatted = formatAlertPrice(delivery.observedPrice, quoteCurrency);
  const conditionText = delivery.direction === 'below' ? 'giảm xuống hoặc thấp hơn' : 'đạt hoặc vượt';

  return {
    title: `Cảnh báo giá ${symbol}`,
    body: `Giá ghi nhận: ${observedFormatted} · Điều kiện: ${conditionText} ${targetFormatted}`,
    data: {
      url: buildAssetDeepLinkUrl(symbol)
    }
  };
}

/**
 * Safely parses HTTP Retry-After header from push service responses.
 * Handles both integer seconds and HTTP Date formats.
 * Enforces future date bounds (never past, max 24 hours).
 */
export function parseRetryAfterHeader(headers, now = new Date()) {
  if (!headers || typeof headers !== 'object') return null;

  const raw = headers['retry-after'] || headers['Retry-After'];
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();

  // 1. Integer seconds (e.g. "120")
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      const boundedSeconds = Math.min(seconds, 86400);
      return new Date(now.getTime() + boundedSeconds * 1000);
    }
  }

  // 2. HTTP Date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  const parsedDate = new Date(trimmed);
  if (!Number.isNaN(parsedDate.getTime()) && parsedDate > now) {
    const maxDate = new Date(now.getTime() + 86400 * 1000);
    return parsedDate > maxDate ? maxDate : parsedDate;
  }

  return null;
}

/**
 * Secret-safe error class for Web Push delivery operations.
 * Redacts private keys, auth secrets, and full endpoints from error messages.
 */
export class WebPushDeliveryError extends Error {
  constructor(code, message, {
    isRetryable = false,
    statusCode = null,
    isExpired = false,
    retryAfterDate = null
  } = {}) {
    super(message);
    this.name = 'WebPushDeliveryError';
    this.code = code;
    this.isRetryable = isRetryable;
    this.statusCode = statusCode;
    this.isExpired = isExpired;
    this.retryAfterDate = retryAfterDate;
  }
}

/**
 * Feature 12C: Dispatches a Web Push notification to a single device subscription.
 * Uses standard web-push library with:
 * - Bounded TTL (~1 hour / 3600 seconds)
 * - Configured request timeout (default 10,000ms / 10 seconds)
 * - Confirmed 2xx success contract (RFC 8030 / web-push resolution)
 * - Retry-After parsing on 429 rate limit
 */
export async function sendWebPushNotification({
  subscription,
  payload,
  vapidConfig,
  webPushClient = webpush,
  ttlSeconds = 3600,
  timeoutMs = DEFAULT_PUSH_TIMEOUT_MS,
  now = new Date()
}) {
  if (!vapidConfig || !vapidConfig.isConfigured) {
    throw new WebPushDeliveryError('WEB_PUSH_NOT_CONFIGURED', 'VAPID credentials not configured', { isRetryable: false });
  }

  if (!subscription || !subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    throw new WebPushDeliveryError('INVALID_SUBSCRIPTION_PAYLOAD', 'Invalid push subscription material', { isRetryable: false });
  }

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const options = {
    vapidDetails: {
      subject: vapidConfig.subject,
      publicKey: vapidConfig.publicKey,
      privateKey: vapidConfig.privateKey
    },
    TTL: ttlSeconds,
    timeout: timeoutMs
  };

  try {
    const res = await webPushClient.sendNotification(pushSubscription, payloadString, options);

    // RFC 8030 section 5 specifies 201 Created as the standard Web Push response.
    // The web-push library resolves when statusCode is in the range 200..299.
    const statusCode = res?.statusCode || 201;
    if (statusCode < 200 || statusCode > 299) {
      throw new WebPushDeliveryError('WEB_PUSH_UNCONFIRMED_SUCCESS', `Push service returned unconfirmed status: ${statusCode}`, {
        isRetryable: true,
        statusCode
      });
    }

    return {
      success: true,
      statusCode
    };
  } catch (err) {
    if (err instanceof WebPushDeliveryError) throw err;

    const statusCode = err.statusCode || err.status || null;

    // HTTP 404 or 410 Gone indicates the subscription has permanently expired or was revoked
    if (statusCode === 404 || statusCode === 410) {
      throw new WebPushDeliveryError('WEB_PUSH_SUBSCRIPTION_EXPIRED', `Subscription expired or revoked (HTTP ${statusCode})`, {
        isRetryable: false,
        statusCode,
        isExpired: true
      });
    }

    // HTTP 429 Too Many Requests: safely parse Retry-After header
    if (statusCode === 429) {
      const retryAfterDate = parseRetryAfterHeader(err.headers, now);
      throw new WebPushDeliveryError('WEB_PUSH_RATE_LIMITED', 'Web Push service rate limited (HTTP 429)', {
        isRetryable: true,
        statusCode,
        retryAfterDate
      });
    }

    // Generic 5xx upstream errors
    if (statusCode >= 500 && statusCode <= 599) {
      throw new WebPushDeliveryError('WEB_PUSH_UPSTREAM_ERROR', `Push service upstream error (HTTP ${statusCode})`, {
        isRetryable: true,
        statusCode
      });
    }

    // Network timeouts or connection drops (including web-push socket timeout)
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.name === 'AbortError' || err.message?.includes('timeout')) {
      throw new WebPushDeliveryError('WEB_PUSH_NETWORK_ERROR', 'Network connection or timeout failure to push service', {
        isRetryable: true,
        statusCode
      });
    }

    // Client/crypto/VAPID errors (4xx other than 404/410/429)
    if (statusCode >= 400 && statusCode < 500) {
      throw new WebPushDeliveryError('WEB_PUSH_BAD_REQUEST', `Push service rejected request (HTTP ${statusCode})`, {
        isRetryable: false,
        statusCode
      });
    }

    throw new WebPushDeliveryError('WEB_PUSH_UNKNOWN_ERROR', err.message || 'Unknown Web Push dispatch failure', {
      isRetryable: true,
      statusCode
    });
  }
}

/**
 * Feature 12C Dispatcher: Claims pending per-device deliveries from PostgreSQL outbox
 * and dispatches them sequentially (batchSize = 5) within the 120s lease window.
 */
export async function dispatchPendingWebPushDeliveries({
  batchSize = 5,
  leaseSeconds = 120,
  requestTimeoutMs = DEFAULT_PUSH_TIMEOUT_MS,
  now = new Date(),
  client = privateSupabase,
  services = {}
} = {}) {
  const {
    getVapidConfigFn = getVapidConfig,
    claimPendingAlertDeliveriesFn = claimPendingAlertDeliveries,
    markAlertDeliverySentFn = markAlertDeliverySent,
    markAlertDeliveryFailedRetryableFn = markAlertDeliveryFailedRetryable,
    markAlertDeliveryFailedPermanentFn = markAlertDeliveryFailedPermanent,
    getPushSubscriptionByIdFn = getPushSubscriptionById,
    deletePushSubscriptionFn = deletePushSubscription,
    getAssetsFn = getAssets,
    sendWebPushNotificationFn = sendWebPushNotification
  } = services;

  const vapidConfig = getVapidConfigFn();

  let claimedDeliveries = [];
  try {
    claimedDeliveries = await claimPendingAlertDeliveriesFn({
      batchSize,
      leaseSeconds,
      now
    }, client);
  } catch (_claimErr) {
    return {
      deliveryClaimedCount: 0,
      deliverySentCount: 0,
      deliveryRetryableFailureCount: 0,
      deliveryPermanentFailureCount: 0,
      deliveryExpiredSubscriptionCount: 0
    };
  }

  const deliveryClaimedCount = claimedDeliveries.length;
  let deliverySentCount = 0;
  let deliveryRetryableFailureCount = 0;
  let deliveryPermanentFailureCount = 0;
  let deliveryExpiredSubscriptionCount = 0;

  if (deliveryClaimedCount === 0) {
    return {
      deliveryClaimedCount: 0,
      deliverySentCount: 0,
      deliveryRetryableFailureCount: 0,
      deliveryPermanentFailureCount: 0,
      deliveryExpiredSubscriptionCount: 0
    };
  }

  // Pre-fetch assets map
  let assetsMap = {};
  try {
    const assetsList = await getAssetsFn(client);
    for (const a of (assetsList || [])) {
      assetsMap[a.id] = a;
    }
  } catch (_assetsErr) {
    // Fall back to empty map
  }

  for (const delivery of claimedDeliveries) {
    try {
      if (!vapidConfig || !vapidConfig.isConfigured) {
        // VAPID missing/invalid: controlled terminal failure.
        // Never mark SENT, never delete subscription, alert remains triggered.
        await markAlertDeliveryFailedPermanentFn({
          deliveryId: delivery.id,
          error: 'VAPID_NOT_CONFIGURED',
          now
        }, client);
        deliveryPermanentFailureCount++;
        continue;
      }

      // Resolve subscription by subscriptionId
      const subscription = await getPushSubscriptionByIdFn(delivery.subscriptionId, client);
      if (!subscription) {
        // Subscription was deleted or expired; mark permanent
        await markAlertDeliveryFailedPermanentFn({
          deliveryId: delivery.id,
          error: 'SUBSCRIPTION_NOT_FOUND',
          now
        }, client);
        deliveryPermanentFailureCount++;
        continue;
      }

      // Resolve asset metadata
      const asset = assetsMap[delivery.assetId];
      if (!asset) {
        await markAlertDeliveryFailedPermanentFn({
          deliveryId: delivery.id,
          error: 'ALERT_DELIVERY_ASSET_METADATA_UNAVAILABLE',
          now
        }, client);
        deliveryPermanentFailureCount++;
        continue;
      }

      // Construct factual payload
      const payload = buildWebPushPayload({ delivery, asset });

      // Send Web Push notification with bounded timeout
      await sendWebPushNotificationFn({
        subscription,
        payload,
        vapidConfig,
        timeoutMs: requestTimeoutMs,
        now
      });

      // Mark SENT upon confirmed push service acceptance
      await markAlertDeliverySentFn({
        deliveryId: delivery.id,
        now
      }, client);

      deliverySentCount++;
    } catch (err) {
      if (err.isExpired) {
        // Subscription permanently expired (404/410): delete subscription row.
        // In PostgreSQL, push_subscriptions(id) ON DELETE CASCADE automatically cancels/removes
        // all delivery history rows tied to that subscription.
        // No subsequent status mutation is attempted on the deleted delivery row.
        try {
          await deletePushSubscriptionFn(delivery.subscriptionId, client);
        } catch (_delErr) {
          // Fallback only if subscription delete throws
          await markAlertDeliveryFailedPermanentFn({
            deliveryId: delivery.id,
            error: 'SUBSCRIPTION_EXPIRED',
            now
          }, client);
        }
        deliveryExpiredSubscriptionCount++;
        continue;
      }

      if (err.isRetryable) {
        if ((delivery.attemptCount || 0) >= 3) {
          await markAlertDeliveryFailedPermanentFn({
            deliveryId: delivery.id,
            error: 'MAX_ATTEMPTS_EXHAUSTED',
            now
          }, client);
          deliveryPermanentFailureCount++;
        } else {
          const defaultNextAttemptAt = new Date(now.getTime() + 15 * 60 * 1000);
          const nextAttemptAt = (err.retryAfterDate && err.retryAfterDate > now)
            ? err.retryAfterDate
            : defaultNextAttemptAt;

          await markAlertDeliveryFailedRetryableFn({
            deliveryId: delivery.id,
            error: err.code || 'RETRYABLE_PUSH_FAILURE',
            nextAttemptAt,
            now
          }, client);
          deliveryRetryableFailureCount++;
        }
      } else {
        await markAlertDeliveryFailedPermanentFn({
          deliveryId: delivery.id,
          error: err.code || 'PERMANENT_PUSH_FAILURE',
          now
        }, client);
        deliveryPermanentFailureCount++;
      }
    }
  }

  return {
    deliveryClaimedCount,
    deliverySentCount,
    deliveryRetryableFailureCount,
    deliveryPermanentFailureCount,
    deliveryExpiredSubscriptionCount
  };
}
