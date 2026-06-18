/**
 * Project Name : SSW PM / MNN
 * Account Tag  : [Animeme.id]
 * Email        : [Animememe.id2@gmail.com]
 * Date         : 2026-06-06
 * Version      : v6 (feat: controlled update flow — SKIP_WAITING via postMessage)
 */
// ══════════════════════════════════════════
// みんなの日本語 PWA — Service Worker v6
// ══════════════════════════════════════════
const CACHE = 'minna-v22';  // v3.0 — hosting portability pass: Vercel /api function, migration-notice.js added to cache

const LOCAL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './app.js',
  './features.js',
  './verb_engine.js',
  './grammar_validator.js',
  './manifest.json',
  './master_kotoba.json',
  './migration-notice.js',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // JFT Basic Full Simulation — integration layer + engine (verbatim)
  './jft_simulation.js',
  './jft_simulation/exam_engine_v9.js',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_kanji_kotoba.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_expression.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_choukai.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_dokkai.json',
];

const CDN_PREFIXES = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
  'https://unpkg.com/',
];

// ── Install ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache only local assets during install.
      // CDN assets (Firebase SDK, fonts) are cached on-demand in the fetch handler.
      await cache.addAll(LOCAL_ASSETS);
      // NOTE: skipWaiting() intentionally removed from install.
      // New SW waits in 'installed' state until user approves update via toast.
      // Main thread posts { type: 'SKIP_WAITING' } → triggers this SW to activate.
    })
  );
});

// ── Activate ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Broadcast SW_ACTIVATED so index.html knows the new SW is live.
        // Used to trigger a safe single reload after user approves update.
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED' }))
        );
      })
  );
});

// ── Message handler — controlled update ──
// Main thread sends { type: 'SKIP_WAITING' } only when user confirms update.
// This replaces the old self.skipWaiting() in install, preventing surprise reloads.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch ──
self.addEventListener('fetch', e => {
  const req = e.request;

  // Lewatkan non-GET, chrome-extension, dan Firebase/Firestore API calls
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:') return;

  // JANGAN intercept Firebase API calls — biarkan langsung ke network
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) return;

  // CDN & static assets → cache-first
  const isCDN    = CDN_PREFIXES.some(p => req.url.startsWith(p));
  const isStatic = ['image', 'font', 'script', 'style'].includes(req.destination);

  if (isCDN || isStatic) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(r => {
          if (!r || (!r.ok && r.type !== 'opaque')) return r;
          // ── FIX: clone() SEBELUM r dikonsumsi ──
          const toCache = r.clone();
          caches.open(CACHE).then(c => c.put(req, toCache));
          return r;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // HTML / navigation → network-first, fallback ke cache
  if (req.destination === 'document' || req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        if (!r || r.status !== 200) return r;
        // ── FIX: clone() SEBELUM r dikonsumsi ──
        const toCache = r.clone();
        caches.open(CACHE).then(c => c.put(req, toCache));
        return r;
      }).catch(() =>
        caches.match(req).then(cached =>
          cached || caches.match('./index.html')
        )
      )
    );
    return;
  }

  // Semua request lain → network only (tidak di-cache)
  // Explicit pass-through prevents SW from silently swallowing requests.
  // Without respondWith here, the browser falls back to network anyway — this is explicit.
});
