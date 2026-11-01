// No credentials, API requests, user content or arbitrary URLs enter this cache.
const CACHE_PREFIX = 'mirror-shell-';
const CACHE = CACHE_PREFIX + '0.3.3';
const SHELL = ['/', '/style.css?v=0.3.3', '/app.js?v=0.3.3', '/manifest.webmanifest',
 '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const ALLOWED = new Set(SHELL);
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
 // Let the old worker finish open conversations before taking over an update.
});
self.addEventListener('activate', event => {
 event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch', event => {
 const request = event.request;
 const url = new URL(request.url);
 if (request.method !== 'GET' || request.headers.has('Authorization') || url.origin !== self.location.origin) return;
 const key = url.pathname + url.search;
 if (!ALLOWED.has(key)) return; // In particular, NEVER handle /api/* or input queries.
 event.respondWith((async () => {
  try {
   // Use the public URL, never copy arbitrary caller headers into Cache Storage.
   const response = await fetch(key, {cache:'no-cache',credentials:'omit',redirect:'error'});
   if (response.ok && !response.redirected && response.type !== 'opaque') {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
   }
   return response;
  } catch {
   return await (await caches.open(CACHE)).match(key) || new Response('Offline',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
 })());
});
