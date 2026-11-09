const CACHE_NAME = "retailflow-shell-v2";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/retailflow.svg",
  "/assets/pdf.worker.min.mjs",
  "/assets/tesseract/worker.min.js",
  "/assets/tesseract/tesseract-core-simd-lstm.wasm.js",
  "/assets/tesseract/tesseract-core-simd-lstm.wasm",
  "/assets/tesseract/lang-data/eng.traineddata.gz",
  "/assets/tesseract/lang-data/hin.traineddata.gz",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("retailflow-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put("/", response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) ?? (await caches.match("/"))));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});
