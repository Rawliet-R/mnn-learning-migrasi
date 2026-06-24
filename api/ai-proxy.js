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
//    OPENROUTER_API_KEY = sk-or-v1-xxxxxxxxxxxx
// ═══════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  // Hanya terima POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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

  const { messages, model = 'google/gemini-2.0-flash-001', max_tokens = 900 } = payload || {};
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
      // max_tokens defaultnya 900 (perilaku AI Sensei TIDAK berubah —
      // AI Sensei tidak pernah mengirim field ini). Field ini ditambahkan
      // agar fitur lain (mis. 🤖 AI JFT Simulation) bisa minta output JSON
      // yang lebih panjang tanpa menyentuh AI Sensei sama sekali.
      body: JSON.stringify({ model, max_tokens, messages }),
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
