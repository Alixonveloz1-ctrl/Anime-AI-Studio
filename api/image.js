// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Soporta MÚLTIPLES imágenes de referencia para continuidad de personajes
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

// ───────── Gemini Flash Image — soporta múltiples referencias ─────────
async function callGemini(model, prompt, characterRefs, projectId, token) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

  const parts = [];

  if (characterRefs && characterRefs.length > 0) {
    // Add each character reference image with their name as label
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: 'image/png', data: ref.img } });
      parts.push({ text: `↑ This is ${ref.name} (${ref.role || 'character'})` });
    }

    const names = characterRefs.map(r => r.name).join(' and ');
    parts.push({
      text: `IMPORTANT INSTRUCTIONS:
- Use the EXACT characters shown in the reference images above (${names})
- Keep their SAME face, hair color, hair style, eye color and outfit style
- Each character must look IDENTICAL to their reference image
- Only change pose, expression, action and environment

Generate a 9:16 vertical anime 2D scene image with these characters.
Scene: ${prompt}`
    });
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

const ALLOWED_MODELS = new Set(['gemini-2.5-flash-image']);

export default async function handler(req) {
  const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers:{ ...CORS, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status:405 });

  try {
    const body = await req.json();
    const { prompt, model: forceModel } = body;

    // Backward compat: accept either characterRefs[] OR single refImageBase64
    let characterRefs = body.characterRefs;
    if (!characterRefs && body.refImageBase64) {
      characterRefs = [{ name: 'main character', role: '', img: body.refImageBase64 }];
    }

    if (!prompt) return new Response(JSON.stringify({ error:'prompt required' }), { status:400, headers:CORS });

    const saJson = process.env.GCP_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ error:'GCP_SERVICE_ACCOUNT missing in Vercel env' }), { status:500, headers:CORS });
    const sa = JSON.parse(saJson);
    const projectId = sa.project_id;
    const token = await getAccessToken(sa);

    const modelToUse = (forceModel && ALLOWED_MODELS.has(forceModel)) ? forceModel : 'gemini-2.5-flash-image';
    const result = await callGemini(modelToUse, prompt, characterRefs, projectId, token);
    if (result.imageData) return new Response(JSON.stringify(result), { status:200, headers:CORS });
    return new Response(JSON.stringify({ error: result.error || 'Failed' }), { status:500, headers:CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
