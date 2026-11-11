// SKA Lesson Planner service worker: makes the app installable and lets it open with bad signal.
// Plans always live in the Google Sheet; only the app's own files are cached here.
// Bump the version when you change files so phones pick up the update.
const CACHE = 'ska-lesson-planner-v24';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './favicon-64.png', './logo-96.png', './apple-touch-icon.png', './badge-96.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's own cache so the newest files are stored
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first for the app's own files, falling back to the saved copy offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});

// Notifications (sent by the push/ Worker): {title, body, url, tag}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'SKA Lesson Planner', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SKA Lesson Planner', {
    body: d.body || '', icon: './icon-192.png', badge: './badge-96.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || './' },
  }));
});

// Tapping a notification opens that class: reuse an open app window if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ open: url }); return win.focus(); }
    return self.clients.openWindow(url);
  }));
});
