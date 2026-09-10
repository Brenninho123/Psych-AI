const CACHE_VERSION = "v3";
const STATIC_CACHE = "psych-ai-static-" + CACHE_VERSION;
const RUNTIME_CACHE = "psych-ai-runtime-" + CACHE_VERSION;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/source/Main.js",
  "/source/psychlua/LuaCode.js",
  "/manifest.json",
  "/offline.html"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== STATIC_CACHE && key !== RUNTIME_CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return STATIC_ASSETS.indexOf(url.pathname) !== -1;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const fallback = await caches.match("/offline.html");
    if (fallback) return fallback;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then(function(response) {
    if (response.ok) {
      caches.open(RUNTIME_CACHE).then(function(cache) {
        cache.put(request, response.clone());
      });
    }
    return response;
  }).catch(function() {
    return cached;
  });

  return cached || networkPromise;
}

self.addEventListener("fetch", function(event) {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", function(event) {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
