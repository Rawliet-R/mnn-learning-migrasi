// ═══════════════════════════════════════════════════════════
//  MNN Learning — AI Sensei Proxy (Vercel build)
//  Vercel Function: /api/ai-proxy  (file-system routing, zero config)
//
//  This is the Vercel-runtime twin of netlify/functions/ai-proxy.js.
//  Netlify Functions use `exports.handler = async (event) => {...}`,
//  which Vercel does NOT execute — Vercel Node.js Functions use the
//  plain (req, res) signature instead. Logic, payload contract, and
//  environment variable name are kept 100% identical to the Netlify
//  version so behavior never diverges between hosts.
//
//  Environment variable yang WAJIB diset di Vercel Dashboard:
//    OPENROUTER_API_KEY   = sk-or-v1-xxxxxxxxxxxx
//    FIREBASE_WEB_API_KEY = AIzaSy... (dari Firebase Console → Project Settings)
//
//  [FIX KM-1] Setiap request WAJIB membawa Firebase ID Token
//  di header: Authorization: Bearer <idToken>
//  Token diverifikasi via Google Identity Toolkit REST API.
//  Request tanpa token atau dengan token tidak valid → HTTP 401.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// TOKEN VERIFIER — Google Identity Toolkit REST API
// Tidak memerlukan firebase-admin / service account.
// Cukup FIREBASE_WEB_API_KEY (sudah public di client code).
// ─────────────────────────────────────────────────────────
async function _verifyFirebaseToken(idToken) {
  if (!idToken) return null;

  const webApiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) {
    console.error('[AI_PROXY] FIREBASE_WEB_API_KEY tidak dikonfigurasi!');
    return null;
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const user = data.users?.[0];
    if (!user) return null;

    return { uid: user.localId, email: user.email || '' };
  } catch (e) {
    console.error('[AI_PROXY] Token verify error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  // Hanya terima POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // [FIX KM-1] Verifikasi Firebase ID Token dari header Authorization
  const authHeader = req.headers.authorization || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!idToken) {
    res.status(401).json({ error: 'Unauthorized: token tidak ditemukan.' });
    return;
  }

  const verifiedUser = await _verifyFirebaseToken(idToken);
  if (!verifiedUser) {
    res.status(401).json({ error: 'Unauthorized: token tidak valid atau sudah kadaluarsa.' });
    return;
  }

  console.log('[AI_PROXY] Request terautentikasi — uid:', verifiedUser.uid);

  // Ambil API key dari environment Vercel (TIDAK pernah ke client)
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server: API key belum dikonfigurasi.' });
    return;
  }

  // Vercel sudah mem-parse JSON body otomatis ke req.body,
  // tapi tetap ditangani manual untuk jaga-jaga (string body).
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const { messages, model = 'google/gemini-2.0-flash-001' } = payload || {};
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Field "messages" diperlukan.' });
    return;
  }

  try {
    // Dynamic referer — never hardcoded to a single hosting domain.
    const referer =
      req.headers.referer ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://mnn-learning.app');

    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': referer,
        'X-Title': 'MNN Learning - AI Sensei',
      },
      body: JSON.stringify({ model, max_tokens: 900, messages }),
    });

    const data = await orRes.json();

    if (data.error) {
      res.status(orRes.status).json({ error: data.error.message || 'OpenRouter error' });
      return;
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Terjadi kesalahan server.' });
  }
};
