/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging / Web Push service worker (scaffold).
 *
 * Copy Firebase web config into the placeholders below OR inject via build.
 * For FCM background messages, also set messagingSenderId matching your project.
 *
 * Deployed at site root: /firebase-messaging-sw.js
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let title = 'CleanEgypt';
  let body = 'You have a new notification';
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    title = parsed.notification?.title || parsed.title || title;
    body = parsed.notification?.body || parsed.message || parsed.body || body;
    data = parsed.data || parsed;
  } catch {
    try {
      body = event.data ? event.data.text() : body;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const missionId = event.notification?.data?.mission_id;
  const url = missionId
    ? `/?mission=${encodeURIComponent(String(missionId))}`
    : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Optional FCM background handler — uncomment after adding firebase scripts:
// importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
// importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
// firebase.initializeApp({ apiKey: '...', projectId: '...', messagingSenderId: '...', appId: '...' });
// firebase.messaging().onBackgroundMessage((payload) => { ... });
