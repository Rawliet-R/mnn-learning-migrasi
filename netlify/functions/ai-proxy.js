// ═══════════════════════════════════════════════════════════
//  MNN Learning — AI Sensei Proxy
//  Netlify Function: /.netlify/functions/ai-proxy
//  (diakses via /api/ai-proxy setelah redirect di netlify.toml)
//
//  Environment variable yang WAJIB diset di Netlify Dashboard:
//    OPENROUTER_API_KEY = sk-or-v1-xxxxxxxxxxxx
// ═══════════════════════════════════════════════════════════

exports.handler = async function (event) {
  // Hanya terima POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Ambil API key dari environment Netlify (TIDAK pernah ke client)
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server: API key belum dikonfigurasi.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { messages, model = 'google/gemini-2.0-flash-001' } = payload;
  if (!messages || !Array.isArray(messages)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Field "messages" diperlukan.' }),
    };
  }

  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Dynamic referer — never hardcoded to a single hosting domain, so this
        // function keeps working unchanged on Netlify, Vercel, or any custom domain.
        'HTTP-Referer': event.headers.referer || (event.headers.host ? `https://${event.headers.host}` : 'https://mnn-learning.app'),
        'X-Title': 'MNN Learning – AI Sensei',
      },
      body: JSON.stringify({ model, max_tokens: 900, messages }),
    });

    const data = await orRes.json();

    if (data.error) {
      return {
        statusCode: orRes.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.error.message || 'OpenRouter error' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Terjadi kesalahan server.' }),
    };
  }
};
