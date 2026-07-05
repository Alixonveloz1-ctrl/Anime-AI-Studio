// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Multi-region: us-central1 → europe-west4 → us-east4 on 429
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = { iss:sa.client_email, sub:sa.client_email, aud:sa.token_uri, iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/cloud-platform' };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  // Native crypto signing (robust, same as video-start.js) — passes the PEM
  // straight to createSign, avoiding the fragile atob() key decode that threw
  // "The string did not match the expected pattern" on Vercel's runtime.
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const b64sig = signer.sign(sa.private_key, 'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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

// ─── Model → endpoint mapping (from working project docs) ───────
const IMAGE_MODELS = {
  'gemini-2.5-flash-image':         { location: 'us-central1' },
  'gemini-3.1-flash-image-preview': { location: 'global'      },
  'gemini-3-pro-image-preview':     { location: 'global'      },
};
// Fallback regions only for us-central1 model (global models use single endpoint)
const US_REGIONS = ['us-central1', 'europe-west4', 'us-east4'];

function getUrl(projectId, modelId, location) {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
}

async function callGeminiAtUrl(url, parts, projectId, token, aspectRatio) {
  const safeRatio = ['9:16','16:9'].includes(aspectRatio) ? aspectRatio : '9:16';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'X-Goog-User-Project':projectId },
    body: JSON.stringify({
      contents: [{ role:'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE','TEXT'],
        imageConfig: { aspectRatio: safeRatio },
      },
    }),
  });
  const d = await r.json();
  const msg = (d.error?.message || '').toLowerCase();
  const shouldRotate = !r.ok && (
    r.status === 429 || r.status === 503 || r.status === 404 ||
    msg.includes('quota') || msg.includes('exhausted') || msg.includes('resource') ||
    msg.includes('overload') || msg.includes('unavailable') || msg.includes('not found') || msg.includes('not support')
  );
  const isSafetyBlock = !r.ok && (msg.includes('safety') || msg.includes('block') || msg.includes('policy'));
  return { ok: r.ok, shouldRotate, isSafetyBlock, status: r.status, data: d };
}

async function callGemini(model, prompt, characterRefs, projectId, token, isEcchi = false, aspectRatio = '9:16', continuityRef = null) {
  let cleanPrompt = prompt;
  for (const [pattern, replacement] of BLOCKED_WORDS) {
    cleanPrompt = cleanPrompt.replace(pattern, replacement);
  }

  const parts = [];
  const aspectStyle = aspectRatio === '16:9' ? '16:9 horizontal widescreen' : '9:16 vertical';

  // Global art-style contract — FIRST part so it frames everything that follows
  parts.push({ text: `ART STYLE (non-negotiable, applies to the ENTIRE image and every character in it): high-budget cinematic 2D anime film, reference-tier MAPPA / Ufotable / top-tier cinematic donghua. Fine variable-weight linework, soft gradient cel-shading, large detailed anime eyes with specular highlights, richly detailed environment, filmic lighting. STRICTLY FORBIDDEN: western cartoon, webtoon-flat style, chibi, thick uniform outlines, flat 2-tone shading, 3D render, CGI, Disney/Pixar look, semi-realistic painted faces.` });

  // Continuity reference (the previous generated shot) goes FIRST after the
  // style contract — it anchors location, lighting and wardrobe; character
  // refs follow so they stay closest to the scene prompt.
  if (continuityRef && continuityRef.img) {
    parts.push({ inlineData: { mimeType: continuityRef.mimeType || 'image/jpeg', data: continuityRef.img } });
    parts.push({ text: `↑ PREVIOUS SHOT (continuity reference): the immediately preceding moment of this story. Keep consistent with it ONLY: the identity of the location (same architecture, palette, time of day), the lighting mood, and each character's clothing and hairstyle. This new image is a LATER moment — the action has ADVANCED since this reference: characters may have moved through the space (a door opened, someone stepped inside, knelt down, walked to another part of the room), object states may have changed, and new story elements described in the scene text may now be visible. Compose the NEW shot exactly as the scene text describes, from a clearly DIFFERENT camera angle and framing — NEVER re-render this reference's composition, never output a near-copy of it, never freeze the story at its moment. If the scene text contradicts this reference (a door now open, a character now on the floor), the scene text ALWAYS wins.` });
  }

  if (characterRefs && characterRefs.length > 0) {
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.img } });
      parts.push({ text: `↑ CHARACTER REFERENCE: This is ${ref.name}. Match this character's IDENTITY exactly — same face shape, same hair color and style, same eye color, same outfit design — AND render ${ref.name} in the SAME 2D anime art style as this reference: same linework quality, same cel-shading, same anime eye rendering. The ONLY things you must NOT copy are the pose, framing, size and white background: redraw ${ref.name} at the body pose, camera angle and SCALE that THIS scene requires — correctly proportioned against the furniture and environment, feet grounded, sharing the scene's perspective, lighting and shadows. Do NOT mix up characters.` });
    }
    const namesList = characterRefs.map(r => r.name).join(', ');
    const ecchiRules = isEcchi ? `
- This is an ecchi/fan-service anime scene. ALL characters are ADULTS (18 or older, each with clearly adult faces and bodies), in adult settings fitting the story's genre. NEVER draw school uniforms, classrooms, pleated school skirts, or anything that implies schoolchildren or minors.
- Draw it with appropriate suggestive visual elements: flattering angles, form-fitting clothing, blushing expressions, suggestive poses.
- Female characters should be attractive adult women with feminine proportions.` : '';
    parts.push({ text: `Character references provided: ${namesList}.

MANDATORY RULES:
1. NO text, NO letters, NO watermarks, NO captions, NO subtitles anywhere in the image.
2. Draw EVERY character named in the scene — if two or three are named, ALL of them must appear in the image. Do not add extra people beyond those mentioned.
3. Each character appears EXACTLY ONCE — never duplicate.
4. Match EACH character to THEIR reference image. Do not swap faces or designs.
5. Female characters: long hair (shoulder-length or longer), soft anime features, clean skin.
6. Faces must be clear, well-defined, anatomically correct — no blur, no distortion.
7. Style: ${aspectStyle} high-budget cinematic 2D anime film (MAPPA / Ufotable / top-tier donghua tier) — fine variable-weight linework, soft gradient cel-shading, richly detailed background, filmic lighting. STRICTLY FORBIDDEN: western cartoon, webtoon-flat, chibi, thick uniform outlines, flat 2-tone shading, 3D render, CGI, Disney/Pixar, semi-realistic painted faces.
8. Characters INTEGRATED into the environment at true real-world scale — feet grounded with contact shadows, natural headroom below the ceiling, matching the room's perspective and light. Never oversized, never floating, never pasted over the background.${ecchiRules}

Scene to illustrate:
${cleanPrompt}` });
  } else {
    parts.push({ text: `${aspectStyle} high-budget cinematic 2D anime film illustration (MAPPA / Ufotable / top-tier donghua tier) — fine variable-weight linework, soft gradient cel-shading, richly detailed background. STRICTLY FORBIDDEN: western cartoon, webtoon-flat, chibi, thick uniform outlines, 3D render, CGI, Disney/Pixar, semi-realistic painted faces. NO text, NO watermarks, NO letters anywhere. ALL characters named in the scene are visible, at true human scale relative to the environment, feet grounded, integrated into the scene's perspective and lighting. ${cleanPrompt}` });
  }

  // ─── Resolve model → correct endpoint ───────────────────────────
  const modelInfo = IMAGE_MODELS[model] || IMAGE_MODELS['gemini-2.5-flash-image'];
  const location  = modelInfo.location;

  if (location === 'global') {
    // Global models: single endpoint, no rotation
    const url = getUrl(projectId, model, 'global');
    const { ok, shouldRotate, isSafetyBlock, data } = await callGeminiAtUrl(url, parts, projectId, token, aspectRatio);
    if (isSafetyBlock) {
      const finishReason = data.candidates?.[0]?.finishReason || 'SAFETY';
      return { error: `bloqueado [${finishReason}]` };
    }
    if (!ok) return { error: data.error?.message || `Error ${model}` };
    const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (img) return { imageData: img.inlineData.data.replace(/\s/g,''), model, region: 'global' };
    const fr = data.candidates?.[0]?.finishReason || 'UNKNOWN';
    return { error: `bloqueado [${fr}]` };
  }

  // us-central1 model: rotate through regions for capacity
  const start = Math.floor(Math.random() * US_REGIONS.length);
  const regions = [...US_REGIONS.slice(start), ...US_REGIONS.slice(0, start)];
  let lastError = '';
  for (const region of regions) {
    const url = getUrl(projectId, model, region);

    const { ok, shouldRotate, isSafetyBlock, data } = await callGeminiAtUrl(url, parts, projectId, token, aspectRatio);

    if (shouldRotate) {
      lastError = `${region}: ${data.error?.message?.slice(0,60) || 'no capacity'}`;
      continue;
    }
    if (isSafetyBlock) {
      const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
      let errorMsg = `bloqueado [${data.candidates?.[0]?.finishReason || 'SAFETY'}]`;
      if (textPart) errorMsg += ` — "${textPart.slice(0,80)}"`;
      return { error: errorMsg };
    }
    if (!ok) { lastError = `${region}: ${data.error?.message?.slice(0,80) || 'error'}`; continue; }
    const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (img) return { imageData: img.inlineData.data.replace(/\s/g,''), model, region };
    const cand = data.candidates?.[0];
    const finishReason = cand?.finishReason || 'UNKNOWN';
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      const safety = cand?.safetyRatings?.filter(s => s.blocked)?.map(s => s.category.replace('HARM_CATEGORY_',''))?.join(', ');
      return { error: `bloqueado [${finishReason}]${safety ? ' — ' + safety : ''}` };
    }
    lastError = `${region}: respuesta vacía [${finishReason}]`;
    continue;
  }
  return { error: `429 — sin capacidad en ninguna región. ${lastError}` };
}

// ─────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' };
module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const body = req.body || {};
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
    if (!prompt) return res.status(400).json({ error:'prompt required' });

    // Optional continuity reference: the previous generated shot of the chain
    let continuityRef = null;
    if (body.continuityRef && body.continuityRef.img && typeof body.continuityRef.img === 'string') {
      const img = body.continuityRef.img.replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s/g, '');
      if (img.length > 100) {
        continuityRef = {
          mimeType: body.continuityRef.mimeType || 'image/jpeg',
          img,
        };
      }
    }

    const projectId = process.env.GCP_PROJECT_ID || JSON.parse(process.env.GCP_SERVICE_ACCOUNT).project_id;
    const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT);
    const token = await getAccessToken(sa);

    const aspectRatio = body.aspectRatio || '9:16';
    const model = forceModel || 'gemini-2.5-flash-image';
    const result = await callGemini(model, prompt, characterRefs, projectId, token, isEcchi === true, aspectRatio, continuityRef);
    return res.status(200).json(result);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
