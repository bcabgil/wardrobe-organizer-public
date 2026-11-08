/**
 * sw.js - Offline-First Service Worker for Wardrobe Organizer PWA
 * - Cache-First strategy for all static App Shell assets (HTML, CSS, JS, icons, JSZip)
 * - Network-First with timeout fallback for external APIs (Gemini & Open-Meteo)
 * Works 100% autonomously on iPhone and Android when the user's PC is switched off.
 */

const CACHE_NAME = 'wardrobe-organizer-v31';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/placeholder.svg',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
  './src/app.js',
  './src/router.js',
  './src/db/wardrobeDb.js',
  './src/utils/eventBus.js',
  './src/utils/mediaUtils.js',
  './src/utils/domUtils.js',
  './src/vendor/jszip.min.js',
  './src/services/backup/BackupProvider.js',
  './src/services/backup/LocalArchiveBackupProvider.js',
  './src/services/backup/GoogleDriveBackupProvider.js',
  './src/services/backup/BackupManager.js',
  './src/services/ai/imageOptimizer.js',
  './src/services/ai/offlineStylist.js',
  './src/services/ai/geminiService.js',
  './src/services/weather/weatherService.js',
  './src/components/BottomNav.js',
  './src/components/GarmentCard.js',
  './src/components/GarmentModal.js',
  './src/components/WearOutfitModal.js',
  './src/components/Toast.js',
  './src/components/LoadingOverlay.js',
  './src/views/GalleryView.js',
  './src/views/AddGarmentView.js',
  './src/views/TomorrowStylistView.js',
  './src/views/LaundryView.js',
  './src/views/BackupSettingsView.js',
  './src/styles/safe-areas.css',
  './src/styles/main.css',
  './src/styles/components.css',
  './src/styles/views.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_SHELL_ASSETS.map((url) =>
            fetch(new Request(url, { cache: 'reload' })).then((res) => {
              if (res && res.ok) {
                return cache.put(url, res);
              }
              return null;
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // External APIs (Open-Meteo, Gemini): Network-First with graceful offline rejection
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Same-origin App Shell: Network-First (bypassing stale HTTP disk cache) so updates appear immediately when online,
  // with instant fallback to CacheStorage when offline (Airplane mode / PC off)
  event.respondWith(
    fetch(request.url, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => cachedResponse || caches.match('./index.html'))
      )
  );
});
