# MNN Learning — みんなの日本語

Japanese learning PWA (Minna no Nihongo Buku I & II) by **Rawliet.ID / FrameProject**.

Static, dependency-free frontend (vanilla HTML/CSS/JS) with Firebase Authentication + Firestore,
an offline-ready service worker, and a serverless `/api/ai-proxy` endpoint for AI Sensei.

---

## 🌐 Hosting

| Platform | Config | Function format | Status |
|---|---|---|---|
| **Vercel** (primary) | `vercel.json` | `api/ai-proxy.js` | ✅ Active — `rawliet-app.uk` |
| **Netlify** (legacy) | `netlify.toml`, `_redirects` | `netlify/functions/ai-proxy.js` | ⚠️ Legacy only |

Both function implementations use the same `OPENROUTER_API_KEY` environment variable.

---

## 📁 Project Structure

```
index.html, app.js, features.js, data.js, styles.css   → Core SPA
verb_engine.js, grammar_validator.js, sentence_engine.js → Learning engines
jft_simulation/                                          → JFT exam simulator
api/ai-proxy.js                                          → Vercel serverless function
netlify/functions/ai-proxy.js                            → Netlify serverless function (legacy)
download.html                                            → APK download page (/download)
offline.html                                             → Offline fallback page (served by SW)
migration-notice.js                                      → "Update available" card for Netlify users
manifest.json, sw.js, icons/                             → PWA assets
apk/mnn-learning-latest.apk                              → Latest Android APK (replace on update)
.well-known/assetlinks.json                              → TWA domain verification
```

---

## 🔥 Firebase Setup

Project ID: `mnn-learn`

**Required: Authorized Domains** (Firebase Console → Authentication → Settings → Authorized Domains)

| Domain | Status |
|---|---|
| `rawliet-app.uk` | ✅ Must be listed |
| `www.rawliet-app.uk` | ✅ Must be listed |
| `mnn-learn.firebaseapp.com` | ✅ Default (already listed) |
| `mnn-learn-rawlietid.netlify.app` | ✅ Legacy (keep for existing users) |

> **Action required**: Open Firebase Console → Authentication → Settings → Authorized Domains
> and verify `rawliet-app.uk` is listed. If not, add it before going live.

---

## 📱 APK Distribution

### Download page
Route: `https://rawliet-app.uk/download` → served from `download.html`

### APK file location
`/apk/mnn-learning-latest.apk` → served at `https://rawliet-app.uk/apk/mnn-learning-latest.apk`

### Update workflow (every release)
1. Build new APK via [PWABuilder](https://pwabuilder.com) pointing at `https://rawliet-app.uk`
2. Download the signed APK from PWABuilder
3. **Replace** `apk/mnn-learning-latest.apk` with the new file
4. Bump `version` in `package.json` → download page shows it automatically
5. Update `RELEASE_NOTES` array in `download.html` with changelog
6. Bump `CACHE` constant in `sw.js` (e.g. `minna-v23` → `minna-v24`)
7. Commit and push to GitHub → Vercel auto-deploys

### TWA / assetlinks.json
After building the new APK with PWABuilder:
1. Get the SHA256 keystore fingerprint from PWABuilder download package
2. Replace `"REPLACE_WITH_SHA256_FROM_PWABUILDER_SIGNING_KEYSTORE"` in
   `.well-known/assetlinks.json` with the actual fingerprint
3. Update `package_name` if different from `uk.rawliet_app.mnn_learning.twa`
4. Deploy → Android Chrome will verify TWA identity against this file

---

## ⚙️ Service Worker Strategy (sw.js v7)

| Request type | Strategy | Rationale |
|---|---|---|
| HTML / navigation | **Network First** + offline.html fallback | Always fresh; offline graceful |
| JS / CSS | **Stale While Revalidate** | Instant load + background update |
| Images / Fonts | **Cache First** | Rarely changes; bandwidth saving |
| CDN (Firebase, Google Fonts) | **Cache First** | External; version-pinned |
| Firebase API calls | **Pass-through** | Auth/Firestore must never be intercepted |

### Update flow (no surprise reloads)
1. New SW installs but stays **waiting** (does not `skipWaiting` on its own)
2. In-app toast "Update tersedia" appears
3. User taps **Perbarui** → main thread sends `{ type: 'SKIP_WAITING' }`
4. New SW activates → `controllerchange` fires → single page reload
5. Old cache deleted automatically in `activate` handler

---

## 🔄 Migration Notice

`migration-notice.js` shows a prominent bottom card **only** to users on the legacy Netlify domain.
- CTA: "Update Sekarang" → opens `https://rawliet-app.uk/download`
- Dismissal stored in `localStorage` (key: `mnn_migration_notice_seen_v2`)
- No auto-redirect ever

To retire: remove `<script src="migration-notice.js">` from `index.html`
and remove `'./migration-notice.js'` from `LOCAL_ASSETS` in `sw.js`.

---

## 🚀 Deployment (Vercel)

### Initial setup
```bash
npm i -g vercel
vercel login
vercel link
```

### Environment variable (required)
```
OPENROUTER_API_KEY=sk-or-...
```
Set in: Vercel Dashboard → Project → Settings → Environment Variables

### Deploy
```bash
git push origin main
# Vercel auto-deploys on push (if GitHub integration active)
# Or manually:
vercel --prod
```

### Routes (vercel.json)
| Incoming | Served as | Notes |
|---|---|---|
| `/download` | `download.html` | APK download page |
| `/apk/*.apk` | Static file | Direct APK serve |
| `/sw.js` | Static file | `no-cache` header |
| `/manifest.json` | Static file | `no-cache` header |
| `/*` (fallback) | `index.html` | SPA catch-all |
| `/api/*` | `api/ai-proxy.js` | Auto-detected by Vercel |

---

## 🛡️ PWA Audit Checklist

- [x] `manifest.json` — `id`, `start_url`, `display: standalone`, `orientation`
- [x] Icons — all sizes present (128, 144, 152, 192, 512), `any` + `maskable` separated
- [x] Service Worker — registered, install/activate/fetch handlers
- [x] HTTPS — Vercel enforces TLS automatically
- [x] Offline support — `offline.html` served by SW when both network and cache miss
- [x] Update flow — user-controlled, no surprise reloads
- [x] Cache cleanup — old caches deleted in SW `activate`
- [x] `sw.js` served with `no-cache` header — browser always checks for new SW
- [ ] Firebase authorized domains — verify in Firebase Console (see above)
- [ ] `assetlinks.json` SHA256 — update after building new APK with PWABuilder
- [ ] Lighthouse PWA score — run after deploying to verify ≥ 90

---

## 📊 Environment Variables

| Variable | Platform | Required | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Vercel + Netlify | Yes | AI Sensei chat proxy |

---

*Last updated: 2026-06-18 · Rawliet.ID / FrameProject*
