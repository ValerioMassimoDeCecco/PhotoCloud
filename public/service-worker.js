// Network-only: the encrypted vault requires a live server and session.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// ---------------------------------------------------------------------------
// v1.4.0 — Web Push: mostra una notifica quando il server invia un evento push
// (upload completato, archivio ZIP pronto, album condiviso, ecc.)
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = { title: 'PhotoCloud', body: 'Nuova notifica', url: '/', icon: '/pwa-192x192.png', tag: 'photocloud' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') data = { ...data, ...parsed };
    }
  } catch {
    if (event.data) data.body = String(event.data.text() || data.body);
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: data.tag || 'photocloud',
      renotify: true,
      data: { url: data.url || '/' },
    })
  );
});

// Click sulla notifica → porta in primo piano (o apre) la web app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          if ('navigate' in client) client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
