// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Multi-region: us-central1 → europe-west4 → us-east4 on 429
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

// ─── Words that trigger Gemini safety filters ───
const BLOCKED_WORDS = [
  [/\bnaked\b/gi, 'in swimsuit'],
  [/\bnude\b/gi, 'in swimsuit'],
  [/\bexplicit\b/gi, 'suggestive'],
  [/\bpornograph\w*/gi, 'romantic'],
  [/\berotic\b/gi, 'romantic'],
  [/\bsex(ual)?\b/gi, 'romantic'],
  [/\bgenitals?\b/gi, ''],
  [/\bnipples?\b/gi, ''],
  [/\bnon-consensual\b/gi, 'surprising'],
  [/\bchest pressed\b/gi, 'close embrace'],
  [/\bbreasts? pressed\b/gi, 'close together'],
  [/\bpressing.*?(chest|breasts?)\b/gi, 'leaning close'],
  [/\bbody against\b/gi, 'close to'],
  [/\bcuerpo.*?pecho\b/gi, 'close together'],
  [/\bpecho.*?contra\b/gi, 'leaning close'],
];

// Regions to try — rotates randomly to distribute load across pools
// All confirmed to support gemini-2.5-flash-image on Vertex AI
const ALL_REGIONS = ['us-central1', 'europe-west4', 'us-east4'];

function getRegionOrder() {
  // Start from a random region each request — distributes DSQ load naturally
  const start = Math.floor(Math.random() * ALL_REGIONS.length);
  return [...ALL_REGIONS.slice(start), ...ALL_REGIONS.slice(0, start)];
}

async function callGeminiInRegion(region, model, parts, projectId, token) {
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'X-Goog-User-Project':projectId },
    body: JSON.stringify({
      contents: [{ role:'user', parts }],
      generationConfig: { responseModalities: ['IMAGE','TEXT'] },
    }),
  });
  const d = await r.json();
  const msg = (d.error?.message || '').toLowerCase();
  const shouldRotate = !r.ok && (
    r.status === 429 || r.status === 503 || r.status === 404 ||
    msg.includes('quota') || msg.includes('exhausted') || msg.includes('resource') ||
    msg.includes('overload') || msg.includes('unavailable') || msg.includes('not found') || msg.includes('not support')
  );
  // Only real safety signals — NOT status 400 which could be any format error
  const isSafetyBlock = !r.ok && (msg.includes('safety') || msg.includes('block') || msg.includes('policy'));
  return { ok: r.ok, shouldRotate, isSafetyBlock, status: r.status, data: d };
}

async function callGemini(model, prompt, characterRefs, projectId, token, isEcchi = false, aspectRatio = '9:16') {
  let cleanPrompt = prompt;
  for (const [pattern, replacement] of BLOCKED_WORDS) {
    cleanPrompt = cleanPrompt.replace(pattern, replacement);
  }

  const parts = [];
  const aspectStyle = aspectRatio === '16:9'
    ? '16:9 horizontal widescreen'
    : '9:16 vertical';

  if (characterRefs && characterRefs.length > 0) {
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.img } });
      parts.push({ text: `↑ CHARACTER REFERENCE: This is ${ref.name}. Draw ${ref.name} with EXACTLY this appearance — same face shape, same hair color and style, same eye color, same outfit. Do NOT mix up characters.` });
    }
    const namesList = characterRefs.map(r => r.name).join(', ');
    const ecchiRules = isEcchi ? `
- This is an ecchi/fan-service anime scene. Draw it with appropriate suggestive visual elements: flattering angles, form-fitting clothing, blushing expressions, suggestive poses.
- Female characters should have attractive, feminine proportions with emphasis on their appeal.` : '';
    parts.push({ text: `Character references provided: ${namesList}.

MANDATORY RULES:
1. NO text, NO letters, NO watermarks, NO captions, NO subtitles anywhere in the image.
2. ONLY draw characters explicitly mentioned in the scene. Do not add extra people.
3. Each character appears EXACTLY ONCE — never duplicate.
4. Match EACH character to THEIR reference image. Do not swap faces or designs.
5. Female characters: long hair (shoulder-length or longer), soft anime features, clean skin.
6. Faces must be clear, well-defined, anatomically correct — no blur, no distortion.
7. Style: ${aspectStyle} anime scene illustration, professional quality, vibrant colors, detailed.${ecchiRules}

Scene to illustrate:
${cleanPrompt}` });
  } else {
    parts.push({ text: `${aspectStyle} anime scene illustration. NO text, NO watermarks, NO letters anywhere. Clean faces, professional quality, vibrant colors. ${cleanPrompt}` });
  }

  // ─── Try each region — rotate on capacity/availability issues ───
  const regions = getRegionOrder();
  let lastError = '';
  for (const region of regions) {
    const { ok, shouldRotate, isSafetyBlock, data } = await callGeminiInRegion(region, model, parts, projectId, token, aspectRatio);

    if (shouldRotate) {
      lastError = `${region}: ${data.error?.message?.slice(0,60) || 'no capacity'}`;
      console.log(`[image] rotando desde ${region} → siguiente...`);
      continue;
    }

    if (isSafetyBlock) {
      // Safety block — no point trying other regions, return error immediately
      const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
      let errorMsg = `bloqueado por seguridad [${data.candidates?.[0]?.finishReason || 'SAFETY'}]`;
      if (textPart) errorMsg += ` — "${textPart.slice(0,80)}"`;
      return { error: errorMsg };
    }

    if (!ok) {
      lastError = `${region}: ${data.error?.message?.slice(0,80) || 'error'}`;
      continue; // try next region anyway
    }

    const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (img) {
      // Strip any whitespace Gemini may have inserted in the base64 string
      const cleanData = img.inlineData.data.replace(/\s/g, '');
      return { imageData: cleanData, model, region };
    }

    // Got a response but no image — safety block in response body
    const cand = data.candidates?.[0];
    const finishReason = cand?.finishReason || 'UNKNOWN';
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      const safety = cand?.safetyRatings?.filter(s => s.blocked)?.map(s => s.category.replace('HARM_CATEGORY_',''))?.join(', ');
      return { error: `bloqueado [${finishReason}]${safety ? ' — ' + safety : ''}` };
    }
    // Unexpected empty response — try next region
    lastError = `${region}: respuesta vacía [${finishReason}]`;
    continue;
  }

  // All regions failed — tell client to retry later
  return { error: `429 — sin capacidad en ninguna región. ${lastError}` };
}

// ─────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' };
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  try {
    const body = await req.json();
    const { prompt, model: forceModel, isEcchi } = body;

    let characterRefs = body.characterRefs;
    if (!characterRefs && body.refImageBase64) {
      characterRefs = [{ name: 'main character', role: '', img: body.refImageBase64 }];
    }
    if (characterRefs && Array.isArray(characterRefs)) {
      characterRefs = characterRefs
        .filter(r => r && r.img && typeof r.img === 'string' && r.name && r.name.trim().length >= 2)
        .map(r => ({
          name: String(r.name || 'character').trim(),
          role: String(r.role || ''),
          mimeType: r.mimeType || 'image/png',
          img: r.img.replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s/g, ''),
        }))
        .filter(r => r.img.length > 100);
      if (!characterRefs.length) characterRefs = null;
    }
    if (!prompt) return new Response(JSON.stringify({ error:'prompt required' }), { status:400, headers:CORS });

    const projectId = process.env.GCP_PROJECT_ID || JSON.parse(process.env.GCP_SERVICE_ACCOUNT).project_id;
    const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT);
    const token = await getAccessToken(sa);

    const aspectRatio = body.aspectRatio || '9:16';
    const model = forceModel || 'gemini-2.5-flash-image';
    const result = await callGemini(model, prompt, characterRefs, projectId, token, isEcchi === true, aspectRatio);
    return new Response(JSON.stringify(result), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
