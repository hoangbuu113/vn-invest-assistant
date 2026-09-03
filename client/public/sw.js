/**
 * VN Invest Assistant — Service Worker (Feature 12D)
 *
 * Dedicated strictly to Web Push notification receipt and navigation clicks.
 * Does NOT perform offline asset caching or financial data caching.
 */

self.addEventListener('install', function(_event) {
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  // Claim all active client windows immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_jsonErr) {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch (_textErr) {
      payload = {};
    }
  }

  const title = payload.title || 'Cảnh báo giá — VN Invest Assistant';
  const options = {
    body: payload.body || 'Giá thị trường đã đạt ngưỡng theo dõi.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: {
      url: payload.data?.url || '/#alerts'
    },
    tag: 'vn-invest-price-alert'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const rawUrl = event.notification?.data?.url || '/#alerts';
  let targetUrl = self.location.origin + '/#alerts';

  try {
    const parsed = new URL(rawUrl, self.location.origin);
    // Security: allow ONLY same-origin targets
    if (parsed.origin === self.location.origin) {
      targetUrl = parsed.href;
    }
  } catch (_urlErr) {
    targetUrl = self.location.origin + '/#alerts';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(targetUrl).then(function(focusedClient) {
              return focusedClient ? focusedClient.focus() : client.focus();
            });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
