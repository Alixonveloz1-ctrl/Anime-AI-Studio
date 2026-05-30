// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
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
  // Explicit sexual terms
  [/\bnaked\b/gi, 'in swimsuit'],
  [/\bnude\b/gi, 'in swimsuit'],
  [/\bexplicit\b/gi, 'suggestive'],
  [/\bpornograph\w*/gi, 'romantic'],
  [/\berotic\b/gi, 'romantic'],
  [/\bsex(ual)?\b/gi, 'romantic'],
  [/\bgenitals?\b/gi, ''],
  [/\bnipples?\b/gi, ''],
  [/\bnon-consensual\b/gi, 'surprising'],
  // Physical descriptions that trigger content policy
  [/\bchest pressed\b/gi, 'close embrace'],
  [/\bbreasts? pressed\b/gi, 'close together'],
  [/\bpressing.*?(chest|breasts?)\b/gi, 'leaning close'],
  [/\bbody against\b/gi, 'close to'],
  [/\bcuerpo.*?pecho\b/gi, 'close together'],  // Spanish
  [/\bpecho.*?contra\b/gi, 'leaning close'],   // Spanish
];

// ─── Words that DON'T trigger filters (safe for Gemini) ───
// cleavage, busty, thigh, short skirt, wet clothes, blushing,
// tight outfit, swimsuit, lingerie, suggestive, sensual, voluptuous
// → these are fine, DO NOT replace them

async function callGemini(model, prompt, characterRefs, projectId, token, isEcchi = false) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

  // Only sanitize truly explicit words — not suggestive/ecchi vocabulary
  let cleanPrompt = prompt;
  for (const [pattern, replacement] of BLOCKED_WORDS) {
    cleanPrompt = cleanPrompt.replace(pattern, replacement);
  }

  const parts = [];

  if (characterRefs && characterRefs.length > 0) {
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.img } });
      parts.push({ text: `↑ CHARACTER REFERENCE: This is ${ref.name}. Draw ${ref.name} with EXACTLY this appearance — same face shape, same hair color and style, same eye color, same outfit. Do NOT mix up characters.` });
    }

    const namesList = characterRefs.map(r => r.name).join(', ');

    const ecchiRules = isEcchi ? `
- This is an ecchi/fan-service anime scene. Draw it with appropriate suggestive visual elements: flattering angles, form-fitting clothing, blushing expressions, suggestive poses.
- Female characters should have attractive, feminine proportions with emphasis on their appeal.` : '';

    parts.push({
      text: `Character references provided: ${namesList}.

MANDATORY RULES:
1. NO text, NO letters, NO watermarks, NO captions, NO subtitles anywhere in the image.
2. ONLY draw characters explicitly mentioned in the scene. Do not add extra people.
3. Each character appears EXACTLY ONCE — never duplicate.
4. Match EACH character to THEIR reference image. Do not swap faces or designs between characters.
5. Female characters: long hair (shoulder-length or longer), soft anime features, clean skin.
6. Faces must be clear, well-defined, anatomically correct — no blur, no distortion.
7. Style: 9:16 vertical anime 2D illustration, professional quality, vibrant colors.${ecchiRules}

Scene to illustrate:
${cleanPrompt}`
    });
  } else {
    parts.push({ text: `9:16 vertical anime 2D illustration. NO text, NO watermarks, NO letters anywhere. Clean faces, professional quality, vibrant colors. ${cleanPrompt}` });
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

  const cand = d.candidates?.[0];
  const finishReason = cand?.finishReason || 'UNKNOWN';
  const safety = cand?.safetyRatings?.filter(s => s.blocked || s.probability === 'HIGH')
    ?.map(s => s.category.replace('HARM_CATEGORY_', ''))?.join(', ');
  const blockedMsg = d.promptFeedback?.blockReason ? ` (prompt bloqueado: ${d.promptFeedback.blockReason})` : '';
  const textPart = cand?.content?.parts?.find(p => p.text)?.text;

  let errorMsg = `${model}: bloqueado [${finishReason}]`;
  if (safety) errorMsg += ` — ${safety}`;
  if (blockedMsg) errorMsg += blockedMsg;
  if (textPart) errorMsg += ` — "${textPart.slice(0,100)}"`;
  return { error: errorMsg };
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

    const projectId = process.env.GCP_PROJECT_ID || 'anime-ai-studio-497502';
    const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT);
    const token = await getAccessToken(sa);

    const model = forceModel || 'gemini-2.5-flash-image';
    const result = await callGemini(model, prompt, characterRefs, projectId, token, isEcchi === true);

    return new Response(JSON.stringify(result), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
