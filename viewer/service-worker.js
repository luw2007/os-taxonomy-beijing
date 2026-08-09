const VERSION = 'bst-cache-v3';
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;
const DATA_PATHS = new Set([
  '/api/dimensions',
  '/api/summary',
  '/api/topics',
  '/api/clusters',
  '/api/standards',
  '/api/subjects',
  '/api/path-data',
  '/api/textbook-gaps',
]);

const sameOrigin = request => new URL(request.url).origin === self.location.origin;
const isStatic = url => url.pathname.startsWith('/static/');
const isReadApi = url => DATA_PATHS.has(url.pathname) || /^\/api\/topic\/[^/]+$/.test(url.pathname);
const cacheable = response => response?.ok;

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async response => {
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    void refresh.catch(() => {});
    return cached;
  }
  return refresh;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('bst-cache-') && !name.startsWith(VERSION)).map(name => caches.delete(name)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !sameOrigin(request)) return;
  const url = new URL(request.url);
  if (isStatic(url)) event.respondWith(cacheFirst(request));
  else if (isReadApi(url)) event.respondWith(staleWhileRevalidate(request));
});
