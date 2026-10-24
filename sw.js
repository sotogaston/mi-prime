/* Mi Prime — service worker
   Estrategia: stale-while-revalidate. La app abre al instante desde el caché
   y se actualiza en segundo plano; el próximo arranque ya trae los cambios.
   Subí CACHE_VERSION cada vez que cambies index.html para forzar la limpieza. */

const CACHE_VERSION = "mi-prime-v16";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll falla entero si un recurso falla; addAll por partes es más tolerante
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   // no tocamos pedidos externos

  // Navegación: caché primero para que abra sin conexión, con refresco en segundo plano
  if(req.mode === "navigate"){
    event.respondWith(
      caches.match("./index.html").then(hit => {
        const net = fetch(req)
          .then(res => {
            if(res && res.ok) caches.open(CACHE_VERSION).then(c => c.put("./index.html", res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if(res && res.ok) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
