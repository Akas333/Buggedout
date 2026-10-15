// Vercel serverless function: forwards Gemma 4 requests to the Gemini API with the key kept server-side.
// Set GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables. The browser never sees it.
// Only Gemma 4 models, only generateContent, request size capped.
const MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
const MAX_BYTES = 8 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(501).json({ error: { message: 'Server key not configured' } }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !Array.isArray(body.contents)) { res.status(400).json({ error: { message: 'Expected { contents: [...] }' } }); return; }
  const payload = JSON.stringify({
    contents: body.contents,
    generationConfig: { temperature: 0.1, maxOutputTokens: Math.min(4096, +(body.generationConfig || {}).maxOutputTokens || 4096) },
  });
  if (payload.length > MAX_BYTES) { res.status(413).json({ error: { message: 'Request too large' } }); return; }

  let last = { status: 502, json: { error: { message: 'Gemma 4 unavailable' } } };
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: payload,
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) { res.status(200).json(json); return; }
    last = { status: r.status, json };
    if (r.status !== 404) break;
  }
  res.status(last.status).json(last.json);
};
