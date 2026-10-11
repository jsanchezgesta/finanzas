// Offline support: serve the app shell from cache, refresh it in the background.
const VERSION = 'finanzas-v8';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png',
  'js/main.js', 'js/util.js', 'js/store.js', 'js/defaults.js', 'js/parse.js', 'js/merchant.js', 'js/categorize.js',
  'js/analysis.js', 'js/tr.js', 'js/mcc.js', 'js/invest.js', 'js/trips.js', 'js/coach.js', 'js/importer.js', 'js/charts.js', 'js/ui.js', 'js/sample.js',
  'js/views/dashboard.js', 'js/views/transactions.js', 'js/views/review.js', 'js/views/plan.js', 'js/views/import.js', 'js/views/settings.js', 'js/views/invest.js', 'js/views/trips.js', 'js/views/coach.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Stale-while-revalidate for same-origin files and the Excel parser CDN.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin && url.hostname !== 'cdn.sheetjs.com') return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
