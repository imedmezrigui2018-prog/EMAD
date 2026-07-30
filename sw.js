const CACHE_NAME = 'brett-bau-v2';
const assetsToCache = [
  '/',
  '/style.css',
  '/icon-192.png',
  '/icon-512.png'
];

// Événement d'installation : mise en cache des fichiers essentiels (icônes, styles)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assetsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Nettoie TOUS les anciens caches pour éviter de rester bloqué sur l'ancienne version CSS/HTML/Icônes
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Intercepte les requêtes pour servir les icônes ou les fichiers mis en cache si besoin, ou laisse passer vers le serveur
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});