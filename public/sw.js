const CACHE_PREFIX = "retailflow-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_ROUTES = new Set(["/scanner"]);
const MAX_CACHED_ASSETS = 180;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.add("/manifest.webmanifest");
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAppAsset(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/_build/") ||
    pathname.startsWith("/build/")
  );
}

async function trimAssetCache(cache) {
  const requests = await cache.keys();
  const assetRequests = requests.filter((request) => isAppAsset(new URL(request.url).pathname));
  await Promise.all(
    assetRequests
      .slice(0, Math.max(0, assetRequests.length - MAX_CACHED_ASSETS))
      .map((request) => cache.delete(request)),
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (request.mode === "navigate" && SHELL_ROUTES.has(pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = new Request(`${url.origin}${pathname}`);
        try {
          const response = await fetch(request);
          if (response.ok && response.type !== "opaque")
            await cache.put(cacheKey, response.clone());
          return response;
        } catch {
          const cached = await cache.match(cacheKey);
          if (cached) return cached;
          return new Response(
            "<main><h1>Scanner is not available offline yet</h1><p>Open RetailFlow Scanner once while online, then retry this page.</p></main>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  if (!isAppAsset(pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(request, response.clone());
        await trimAssetCache(cache);
      }
      return response;
    })(),
  );
});
