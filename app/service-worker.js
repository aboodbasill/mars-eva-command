/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Versioned offline cache. "Offline ready" is reported only after every listed asset is in the cache. */
importScripts('precache.js');
const CACHE = 'mec-' + self.MEC_BUILD;
const ASSETS = self.MEC_ASSETS.concat(['precache.js', 'service-worker.js']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const a of ASSETS) {
      const res = await fetch(a, { cache: 'reload' });
      if (!res.ok) throw new Error(`failed to cache ${a}: ${res.status}`);   // never claim a partial cache
      await cache.put(a, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);   // coherent invalidation of stale builds
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request, { ignoreSearch: true });
    return hit || fetch(event.request);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'status') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let cached = 0;
    for (const a of ASSETS) if (await cache.match(a)) cached++;
    event.source.postMessage({ type: 'status', build: self.MEC_BUILD, total: ASSETS.length, cached, ready: cached === ASSETS.length });
  })());
});
