/* Only application caches are managed here. IndexedDB is never touched. */
const PREFIX = `field-trip-notebook-${self.registration.scope}-shell-`;
const CACHE = `${PREFIX}v1`;
const SHELL = ['./', './index.html', './styles.css', './app.js', './zip.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  // Updates wait until the old app is closed, keeping each session on one version.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(event.request);
    return (await cache.match(event.request, {ignoreSearch: true})) || fetch(event.request);
  })());
});
