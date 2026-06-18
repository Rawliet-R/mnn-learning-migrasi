# MNN Learning — みんなの日本語

Japanese learning PWA (Minna no Nihongo Buku I & II) by **Rawliet.ID**.

Static, dependency-free frontend (vanilla HTML/CSS/JS) with a Firebase
Authentication + Firestore backend, an offline-ready service worker, and a
single serverless endpoint (`/api/ai-proxy`) that proxies "AI Sensei" chat
requests to OpenRouter without exposing the API key to the client.

## Hosting

This repo deploys unmodified to either platform:

| Platform | Config file | Function format |
|---|---|---|
| Netlify (legacy) | `netlify.toml`, `_redirects` | `netlify/functions/ai-proxy.js` |
| Vercel (primary) | `vercel.json` | `api/ai-proxy.js` |

Both functions implement identical logic against the same
`OPENROUTER_API_KEY` environment variable — set it in each platform's
dashboard.

See the full deployment guide for step-by-step setup, environment variables,
custom domain wiring, and the PWA/service-worker safety notes.

## Local structure

```
index.html, app.js, features.js, data.js, styles.css   → core app
verb_engine.js, grammar_validator.js, sentence_engine.js → learning engines
jft_simulation/                                          → JFT exam simulator module
api/ai-proxy.js            → Vercel serverless function
netlify/functions/ai-proxy.js → Netlify serverless function
migration-notice.js        → optional "new version available" banner
manifest.json, sw.js, icons/ → PWA
```
