// Service worker: makes the app load and run offline.
// - App files: network first (always fresh when online, 3 s timeout), cached copy when offline.
// - Firebase SDK from gstatic (versioned, immutable): cache first.
// - Firestore / Auth API calls are never touched here.
const VERSION = 'v1';
const SHELL = `lingo-shell-${VERSION}`;
const SDK_CACHE = `lingo-sdk-${VERSION}`;

const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/csv.js', 'js/similarity.js', 'js/difficulty.js', 'js/merge.js',
  'js/storage.js', 'js/sound.js', 'js/speech.js', 'js/ui.js', 'js/starter.js',
  'js/sync.js', 'js/users.js', 'js/firebase-config.js',
  'js/views/practice.js', 'js/views/progress.js', 'js/views/admin.js', 'js/views/admin-deck.js',
  'js/views/admin-languages.js', 'js/views/admin-users.js', 'js/views/profile.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(request) {
  return new Promise((resolve) => {
    const fallback = () => caches.match(request, { ignoreSearch: true })
      .then((hit) => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined))
      .then((hit) => resolve(hit || Response.error()));
    const timer = setTimeout(fallback, 3000);
    fetch(request).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(request, copy)); }
      resolve(res);
    }).catch(() => { clearTimeout(timer); fallback(); });
  });
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then((cache) => cache.match(request).then((hit) => hit ||
    fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(request, SDK_CACHE));
  }
});
