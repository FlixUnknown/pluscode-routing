const APP_CACHE = "lt-app-v3";
const TILE_CACHE = "lt-tiles-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./extras.js",
  "./app.js",
  "./manifest.json"
];

const CDN_ASSETS = [
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(
      CDN_ASSETS.map(async (url) => {
        const res = await fetch(url, { mode: "cors" });
        if (res && (res.status === 200 || res.type === "opaque")) {
          await cache.put(url, res);
        }
      })
    );
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname.includes("arcgisonline.com") || url.hostname.includes("openstreetmap.org")) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === "opaque")) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response("", { status: 408 });
      }
    })());
    return;
  }

  if (CDN_ASSETS.includes(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && (res.status === 200 || res.type === "opaque")) {
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await cache.match(req);
        return cached || (req.mode === "navigate" ? cache.match("./index.html") : Response.error());
      }
    })());
  }
});
