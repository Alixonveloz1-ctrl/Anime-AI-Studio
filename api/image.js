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

  // Sanitize prompt: replace flagged terms with safe equivalents
  // This is a safety net - the LLM should already produce clean prompts
  const SAFE_REPLACEMENTS = [
    [/\bvoluptuous\b/gi, 'graceful'],
    [/\bbusty\b/gi, 'figure'],
    [/\bbig breasts?\b/gi, 'feminine figure'],
    [/\blarge breasts?\b/gi, 'feminine figure'],
    [/\bbreasts?\b/gi, 'chest area'],
    [/\bcleavage\b/gi, 'neckline'],
    [/\bchest pressed\b/gi, 'close hug'],
    [/\bpressing.*chest\b/gi, 'leaning close'],
    [/\bsensual\b/gi, 'graceful'],
    [/\bseductive\b/gi, 'charming'],
    [/\berotic\b/gi, 'romantic'],
    [/\bnaked\b/gi, 'in swimsuit'],
    [/\bnude\b/gi, 'in swimsuit'],
    [/\bexposed\b/gi, 'visible'],
    [/\bintimate\b/gi, 'close'],
    [/\bpanties\b/gi, 'undergarments'],
    [/\bsee-through\b/gi, 'wet'],
    [/\btransparent (clothes?|fabric|dress|shirt)\b/gi, 'wet $1'],
    [/\bgenerous (chest|bust|breasts?)\b/gi, 'feminine figure'],
  ];

  let cleanPrompt = prompt;
  for (const [pattern, replacement] of SAFE_REPLACEMENTS) {
    cleanPrompt = cleanPrompt.replace(pattern, replacement);
  }

  const parts = [];

  if (characterRefs && characterRefs.length > 0) {
    // Add each character reference image labeled with their name
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.img } });
      parts.push({ text: `↑ This is ${ref.name}${ref.role ? ' (' + ref.role + ')' : ''}. Use this EXACT design for ${ref.name} only.` });
    }

    const namesList = characterRefs.map(r => r.name).join(', ');

    parts.push({
      text: `Above are ${characterRefs.length} official character design${characterRefs.length > 1 ? 's' : ''}: ${namesList}.

STRICT COMPOSITION RULES:
- ONLY draw the characters whose names are EXPLICITLY MENTIONED in the scene description below.
- Each character must appear EXACTLY ONCE in the image. NEVER duplicate any character.
- NEVER add unnamed/extra characters. If the scene mentions only 2 characters, draw exactly 2.
- Match each named character to their reference image: same face, same hair color, same hair style, same eye color, same outfit details.
- Female characters: keep LONG hair (shoulder-length or longer), feminine figure, soft features, innocent expression.
- Faces must be CLEAR, anatomically correct, and well-defined — no distortion, no blur, no melted features.
- Style: 9:16 vertical anime 2D illustration, professional quality, clean lineart.

Scene to draw (read carefully which characters appear):
${cleanPrompt}`
    });
  } else {
    parts.push({ text: `9:16 vertical anime 2D illustration. Clean faces, anatomically correct, professional quality. ${cleanPrompt}` });
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

  // Detailed reason if no image
  const cand = d.candidates?.[0];
  const finishReason = cand?.finishReason || 'UNKNOWN';
  const safety = cand?.safetyRatings?.filter(s => s.blocked || s.probability === 'HIGH' || s.probability === 'MEDIUM')
    ?.map(s => s.category.replace('HARM_CATEGORY_', ''))?.join(', ');
  const blockedMsg = d.promptFeedback?.blockReason ? ` (prompt bloqueado: ${d.promptFeedback.blockReason})` : '';
  const textPart = cand?.content?.parts?.find(p => p.text)?.text;

  let errorMsg = `${model}: bloqueado por filtros [${finishReason}]`;
  if (safety) errorMsg += ` — categorías: ${safety}`;
  if (blockedMsg) errorMsg += blockedMsg;
  if (textPart) errorMsg += ` — modelo dijo: "${textPart.slice(0,150)}"`;

  return { error: errorMsg };
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

    // Clean refs: strip data: prefix, whitespace, validate
    if (characterRefs && Array.isArray(characterRefs)) {
      characterRefs = characterRefs
        .filter(r => r && r.img && typeof r.img === 'string')
        .map(r => ({
          name: String(r.name || 'character'),
          role: String(r.role || ''),
          mimeType: r.mimeType || 'image/png',
          img: r.img.replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s/g, ''),
        }))
        .filter(r => r.img.length > 100);
      if (!characterRefs.length) characterRefs = null;
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
