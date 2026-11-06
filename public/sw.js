// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER FOR BACKGROUND NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Click notification → bring chat window to front or open it
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a chat tab is open, focus it
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open the site
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

// Allow app to trigger notifications through service worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    self.registration.showNotification(title, options);
  }
});
