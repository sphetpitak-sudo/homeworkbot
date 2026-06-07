const CACHE_NAME = "homework-bot-v2";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.error("Service worker install failed:", err);
        throw err;
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => {
          return caches.delete(n).catch((err) => {
            console.error("Failed to delete cache:", n, err);
          });
        })
      );
    }).catch((err) => {
      console.error("Service worker activate failed:", err);
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request)).catch(() => {
        console.error("Service worker fetch failed for:", e.request.url);
        return new Response("Offline", { status: 503 });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, clone).catch((err) => {
                console.error("Failed to cache:", e.request.url, err);
              });
            });
          }
          return response;
        })
        .catch((err) => {
          console.error("Fetch failed for:", e.request.url, err);
          return cached;
        });
      return cached || fetched;
    }).catch((err) => {
      console.error("Service worker cache match failed:", err);
      return fetch(e.request).catch(() => new Response("Offline", { status: 503 }));
    })
  );
});
