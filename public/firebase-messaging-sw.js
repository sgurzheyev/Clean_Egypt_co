/* global importScripts, firebase */
/**
 * Fallback FCM / Web Push service worker (placeholders).
 * Prefer /firebase-messaging-sw.generated.js after Vite injects .env values.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

try {
  firebase.initializeApp({
    apiKey: '__VITE_FIREBASE_API_KEY__',
    authDomain: '__VITE_FIREBASE_AUTH_DOMAIN__',
    projectId: '__VITE_FIREBASE_PROJECT_ID__',
    messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
    appId: '__VITE_FIREBASE_APP_ID__',
  });
  firebase.messaging();
} catch (err) {
  console.warn('[push-sw] Firebase init skipped (configure VITE_FIREBASE_* and rebuild)', err);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const missionId = event.notification?.data?.mission_id;
  const url = missionId ? `/?mission=${encodeURIComponent(String(missionId))}` : '/';
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
