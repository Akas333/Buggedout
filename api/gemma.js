// Vercel serverless function: runs Gemma 4 for the app with the keys kept server-side. The browser never sees them.
// Tries each provider that has a key set, in order, and moves on when one is rate-limited or down:
//   GEMINI_API_KEY                              Google AI Studio (Gemini API)
//   OPENROUTER_API_KEY                          OpenRouter, free Gemma 4 variants
//   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN Cloudflare Workers AI
//   NVIDIA_API_KEY                              NVIDIA NIM
// Set them in Vercel → Project → Settings → Environment Variables. Every provider runs Gemma 4 and reads images.
// The reply is always in the Gemini shape ({ candidates: [...] }) plus `via`, so the browser code has one format.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 45000;
// Pages on other origins (GitHub Pages, local dev) that may call this proxy.
const ORIGINS = [/^https:\/\/akas333\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const env = process.env;
const PROVIDERS = [
  { name: 'Google', kind: 'gemini', key: env.GEMINI_API_KEY, models: ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'] },
  { name: 'OpenRouter', kind: 'openai', key: env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free'] },
  { name: 'Cloudflare', kind: 'openai', key: env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN,
    url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
    models: ['@cf/google/gemma-4-26b-a4b-it'] },
  { name: 'NVIDIA', kind: 'openai', key: env.NVIDIA_API_KEY, url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: ['google/gemma-4-31b-it'] },
];
const label = (model) => (/31b/.test(model) ? 'Gemma 4 31B' : 'Gemma 4 26B');

// Gemini parts → one OpenAI-style user message. Images go first (NVIDIA recommends it; the others don't mind).
function toOpenAI(parts) {
  const images = parts.filter((p) => p.inline_data).map((p) => ({
    type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` },
  }));
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
  return [{ role: 'user', content: images.length ? [...images, { type: 'text', text }] : text }];
}

async function callGemini(p, model, parts, maxTokens) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await r.json().catch(() => ({}));
  const out = ((json.candidates || [])[0] || {}).content || {};
  const text = (out.parts || []).filter((x) => !x.thought && x.text).map((x) => x.text).join('\n');
  return { ok: r.ok && !!text, status: r.status, text, error: json.error && json.error.message };
}

async function callOpenAI(p, model, parts, maxTokens) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.name === 'Cloudflare' ? env.CLOUDFLARE_API_TOKEN : p.key}` };
  if (p.name === 'OpenRouter') Object.assign(headers, { 'HTTP-Referer': 'https://akas333.github.io/Buggedout/', 'X-Title': 'Buggedout' });
  const r = await fetch(p.url, {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages: toOpenAI(parts), temperature: 0.1, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await r.json().catch(() => ({}));
  const msg = ((json.choices || [])[0] || {}).message || {};
  const text = typeof msg.content === 'string' ? msg.content : '';
  const err = json.error && (json.error.message || json.error);
  return { ok: r.ok && !!text, status: r.status, text, error: err || (json.errors && json.errors[0] && json.errors[0].message) };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ORIGINS.some((re) => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }

  const ready = PROVIDERS.filter((p) => p.key);
  if (!ready.length) { res.status(501).json({ error: { message: 'No Gemma 4 provider keys configured on the server' } }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const parts = body && Array.isArray(body.contents) && body.contents[0] && body.contents[0].parts;
  if (!Array.isArray(parts)) { res.status(400).json({ error: { message: 'Expected { contents: [{ parts: [...] }] }' } }); return; }
  // Only text and images pass through.
  const clean = parts.map((p) => (typeof p.text === 'string' ? { text: p.text }
    : p.inline_data && /^image\//.test(p.inline_data.mime_type) && typeof p.inline_data.data === 'string'
      ? { inline_data: { mime_type: p.inline_data.mime_type, data: p.inline_data.data } } : null)).filter(Boolean);
  if (JSON.stringify(clean).length > MAX_BYTES) { res.status(413).json({ error: { message: 'Request too large' } }); return; }
  const maxTokens = Math.min(4096, +(body.generationConfig || {}).maxOutputTokens || 4096);

  const tried = [];
  for (const p of ready) {
    for (const model of p.models) {
      let r;
      try { r = await (p.kind === 'gemini' ? callGemini : callOpenAI)(p, model, clean, maxTokens); }
      catch (e) { r = { ok: false, status: 504, error: e.name === 'TimeoutError' ? 'timed out' : e.message }; }
      if (r.ok) {
        res.status(200).json({ candidates: [{ content: { parts: [{ text: r.text }] } }], via: `${label(model)} · ${p.name}` });
        return;
      }
      tried.push(`${p.name} ${model}: ${r.status}${r.error ? ` ${String(r.error).slice(0, 120)}` : ''}`);
      console.warn('[gemma] fallback after', tried[tried.length - 1]);
    }
  }
  res.status(502).json({ error: { message: 'Every Gemma 4 provider is busy right now. Try again in a minute', tried } });
};
