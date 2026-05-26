// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI (Gemini 3.1 + Imagen 4.0)
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

// ───────── OAuth: Service Account → Access Token ─────────
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = { iss:sa.client_email, sub:sa.client_email, aud:sa.token_uri, iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/cloud-platform' };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const r = await fetch(sa.token_uri, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('OAuth: '+JSON.stringify(d));
  return d.access_token;
}

// ───────── Gemini 3.1 (acepta imagen de referencia) ─────────
async function callGemini(model, prompt, refImg, projectId, token) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
  const parts = [];
  if (refImg) {
    parts.push({ inlineData: { mimeType:'image/png', data: refImg } });
    parts.push({ text: `IMPORTANT: Use the character shown in the reference image above. Generate a new 9:16 vertical anime 2D scene image keeping the EXACT same character — same face, same hair color, same hair style, same eye color, same outfit style. Only the pose, expression, action and environment should change. New scene: ${prompt}` });
  } else {
    parts.push({ text: `9:16 vertical anime 2D illustration. ${prompt}` });
  }
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'X-Goog-User-Project':projectId },
    body: JSON.stringify({
      contents:[{ role:'user', parts }],
      generationConfig:{ responseModalities:['IMAGE','TEXT'] },
    }),
  });
  const d = await r.json();
  if (!r.ok) return { error: `${model}: ${d.error?.message || r.status}` };
  const img = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (img) return { imageData: img.inlineData.data, model };
  return { error: `${model}: no image returned` };
}

// ───────── Imagen 4.0 / 3.0 (fallback, sin referencia) ─────────
async function callImagen(model, prompt, projectId, token) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:predict`;
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'X-Goog-User-Project':projectId },
    body: JSON.stringify({
      instances:[{ prompt }],
      parameters:{ sampleCount:1, aspectRatio:'9:16', safetySetting:'block_only_high' },
    }),
  });
  const d = await r.json();
  if (!r.ok) return { error: `${model}: ${d.error?.message || r.status}` };
  const b64 = d.predictions?.[0]?.bytesBase64Encoded || d.predictions?.[0]?.image?.bytesBase64Encoded;
  if (b64) return { imageData: b64, model };
  if (d.predictions?.[0]?.raiFilteredReason) return { error: `${model}: safety block` };
  return { error: `${model}: no bytes` };
}

// ───────── Pipeline definitions ─────────
const GEMINI_MODELS = new Set(['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview']);
const IMAGEN_MODELS = new Set(['imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001', 'imagen-3.0-generate-002']);

async function tryModel(model, prompt, refImg, projectId, token) {
  if (GEMINI_MODELS.has(model)) return await callGemini(model, prompt, refImg, projectId, token);
  if (IMAGEN_MODELS.has(model)) return await callImagen(model, prompt, projectId, token);
  return { error: `Unknown model: ${model}` };
}

// ───────── Handler ─────────
export default async function handler(req) {
  const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers:{ ...CORS, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status:405 });

  try {
    const { prompt, refImageBase64, model: forceModel } = await req.json();
    if (!prompt) return new Response(JSON.stringify({ error:'prompt required' }), { status:400, headers:CORS });

    const saJson = process.env.GCP_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ error:'GCP_SERVICE_ACCOUNT missing in Vercel env' }), { status:500, headers:CORS });
    const sa = JSON.parse(saJson);
    const projectId = sa.project_id;
    const token = await getAccessToken(sa);

    // If a specific model is forced, try just that one
    if (forceModel) {
      const result = await tryModel(forceModel, prompt, refImageBase64, projectId, token);
      if (result.imageData) return new Response(JSON.stringify(result), { status:200, headers:CORS });
      return new Response(JSON.stringify({ error: result.error || 'Model failed' }), { status:500, headers:CORS });
    }

    // Auto mode: pipeline of fallbacks
    const pipeline = [
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite-preview',
      'imagen-4.0-generate-001',
      'imagen-4.0-fast-generate-001',
      'imagen-3.0-generate-002',
    ];

    let lastError = null;
    for (const m of pipeline) {
      const result = await tryModel(m, prompt, refImageBase64, projectId, token);
      if (result.imageData) return new Response(JSON.stringify(result), { status:200, headers:CORS });
      lastError = result.error;
    }
    return new Response(JSON.stringify({ error: lastError || 'All models failed' }), { status:500, headers:CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
