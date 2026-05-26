// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Solo modelos que soportan continuidad de personajes vía referencia
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

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

// ───────── Gemini Flash Image (acepta referencia de personaje) ─────────
async function callGemini(model, prompt, refImg, projectId, token) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
  const parts = [];
  if (refImg) {
    parts.push({ inlineData: { mimeType:'image/png', data: refImg } });
    parts.push({ text: `IMPORTANT: Use the EXACT character shown in the reference image above. Generate a new 9:16 vertical anime 2D scene image keeping the SAME character — same face, same hair color, same hair style, same eye color, same outfit. Only change pose, expression, action and environment. New scene: ${prompt}` });
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

const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-image',  // Nano Banana 2 — mejor calidad
  'gemini-2.5-flash-image',  // Nano Banana 1 — backup
]);

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

    if (forceModel && ALLOWED_MODELS.has(forceModel)) {
      const result = await callGemini(forceModel, prompt, refImageBase64, projectId, token);
      if (result.imageData) return new Response(JSON.stringify(result), { status:200, headers:CORS });
      return new Response(JSON.stringify({ error: result.error || 'Model failed' }), { status:500, headers:CORS });
    }

    // Auto: Nano Banana 2 → Nano Banana 1
    const pipeline = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

    let lastError = null;
    for (const m of pipeline) {
      const result = await callGemini(m, prompt, refImageBase64, projectId, token);
      if (result.imageData) return new Response(JSON.stringify(result), { status:200, headers:CORS });
      lastError = result.error;
    }
    return new Response(JSON.stringify({ error: lastError || 'All models failed' }), { status:500, headers:CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
