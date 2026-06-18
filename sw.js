/**
 * Project   : MNN Learning — みんなの日本語
 * Brand     : Rawliet.ID / FrameProject
 * SW Version: v7  (feat: SWR for JS/CSS, Cache-First for images,
 *                        offline.html fallback, helper refactor)
 * Cache     : minna-v23
 *
 * Caching strategy matrix:
 *   HTML / navigation  → Network First  + offline.html fallback
 *   JS / CSS           → Stale While Revalidate
 *   Images / Fonts     → Cache First
 *   CDN (Firebase/etc) → Cache First
 *   Firebase API calls → Pass-through (never intercepted)
 */

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const CACHE       = 'minna-v23';
const OFFLINE_URL = './offline.html';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './offline.html',           // ← offline fallback page
  './styles.css',
  './data.js',
  './app.js',
  './features.js',
  './verb_engine.js',
  './grammar_validator.js',
  './sentence_engine.js',
  './manifest.json',
  './master_kotoba.json',
  './migration-notice.js',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // JFT Basic Full Simulation
  './jft_simulation.js',
  './jft_simulation/exam_engine_v9.js',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_kanji_kotoba.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_expression.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_choukai.json',
  './jft_simulation/exam_files/SSWPM_mnn_jft_data[inoyamanaka495@gmail.com][20260613]_v10_dokkai.json',
];

// CDN origins that get Cache-First treatment
const CDN_PREFIXES = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
  'https://unpkg.com/',
];

// Firebase API hostnames — ALWAYS pass-through, never cache
const FIREBASE_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

// ═══════════════════════════════════════════════════════════
// STRATEGY HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Network First — try network, fall back to cache then offline.html.
 * Used for: HTML / navigation requests.
 */
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('<h1>Offline</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/**
 * Stale While Revalidate — serve cached copy immediately,
 * simultaneously fetch fresh copy and update cache in background.
 * Used for: JS and CSS files.
 */
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(cache =>
    cache.match(req).then(cached => {
      // Background network fetch (always fired — updates cache silently)
      const networkFetch = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);

      // Return cached copy immediately; fall back to awaiting the network
      return cached || networkFetch;
    })
  );
}

/**
 * Cache First — serve from cache, fall back to network then cache result.
 * Used for: images, fonts, CDN assets.
 */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (_) {
    return new Response('', { status: 408 });
  }
}

// ═══════════════════════════════════════════════════════════
// LIFECYCLE
// ═══════════════════════════════════════════════════════════

// ── Install ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      // NOTE: skipWaiting() intentionally removed.
      // New SW waits until user confirms via the in-app update toast.
      // Main thread posts { type: 'SKIP_WAITING' } to trigger activation.
  );
});

// ── Activate ── clean up ALL old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all open tabs that the new SW is live
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED' }))
        );
      })
  );
});

// ── Message — controlled update ──
// Main thread sends { type: 'SKIP_WAITING' } only when user taps "Perbarui".
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════════════════════════════════
// FETCH — strategy dispatch
// ═══════════════════════════════════════════════════════════
self.addEventListener('fetch', e => {
  const req = e.request;

  // ── Guard: only handle GET ──
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ── Guard: skip chrome-extension ──
  if (url.protocol === 'chrome-extension:') return;

  // ── Guard: skip Firebase/Firestore API — pass straight to network ──
  if (FIREBASE_HOSTS.some(h => url.hostname.includes(h))) return;

  // ── CDN assets (Firebase SDK, Google Fonts, unpkg) → Cache First ──
  if (CDN_PREFIXES.some(p => req.url.startsWith(p))) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // ── Navigation / HTML pages → Network First + offline fallback ──
  if (req.destination === 'document' || req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }

  // ── Scripts & Stylesheets → Stale While Revalidate ──
  if (req.destination === 'script' || req.destination === 'style') {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // ── Images & Fonts → Cache First ──
  if (req.destination === 'image' || req.destination === 'font') {
    e.respondWith(cacheFirst(req));
    return;
  }

  // ── Everything else → pass-through (no SW interception) ──
  // Explicit non-respondWith here means browser falls back to network.
  // This prevents the SW silently swallowing unknown request types.
});
