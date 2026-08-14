// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Multi-region: us-central1 → europe-west4 → us-east4 on 429
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
// ════════════════════════════════════════════════════════════════
const { cfg, auth, imageModelLocation, vertexUrl, begin, fail } = require('./_lib/gcp');

// Google's wording when a model id does not exist for this project. Kept so the
// region rotation does not treat it as a capacity problem: retrying the other
// regions is pointless and its wrapper truncates the message, hiding the cause.
function sinAcceso(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('was not found or your project does not have access')
      || (m.includes('publisher model') && m.includes('not found'));
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
  // No allowlist for the model is NOT a capacity problem: rotating regions
  // wastes two more calls and, worse, the rotation wrapper truncates the
  // message to 60 chars — cutting off the very words that identify the cause.
  const isNoAccess = !r.ok && sinAcceso(d.error?.message);
  return { ok: r.ok, shouldRotate: shouldRotate && !isNoAccess, isNoAccess, isSafetyBlock, status: r.status, data: d };
}

async function callGemini(model, prompt, characterRefs, projectId, token, isEcchi = false, aspectRatio = '9:16', continuityRef = null, styleSpec = '', sinCortes = false, segundosEntre = 8, planoPrevio = '', planoNuevo = '') {
  let cleanPrompt = prompt;
  for (const [pattern, replacement] of BLOCKED_WORDS) {
    cleanPrompt = cleanPrompt.replace(pattern, replacement);
  }

  const parts = [];
  const aspectStyle = aspectRatio === '16:9' ? '16:9 horizontal widescreen' : '9:16 vertical';

  // Global art-style contract — FIRST part so it frames everything that follows.
  //
  // Sale del estilo que eligió el usuario. Antes estaba escrito aquí a mano y
  // pedía "large detailed anime eyes", que es lo CONTRARIO de lo que pide el
  // estilo realista ("ojos de tamaño humano normal"). Como iba en la primera
  // parte, enmarcaba todo lo demás: elegir Realista no servía de nada, el
  // servidor lo desmentía antes de que el prompt llegara a hablar.
  const estilo = (typeof styleSpec === 'string' && styleSpec.trim().length > 40)
    ? styleSpec.trim()
    : 'high-budget cinematic 2D anime film, reference-tier MAPPA / Ufotable / top-tier cinematic donghua. Fine variable-weight linework, soft gradient cel-shading, large detailed anime eyes with specular highlights, richly detailed environment, filmic lighting. STRICTLY FORBIDDEN: western cartoon, webtoon-flat style, chibi, thick uniform outlines, flat 2-tone shading, 3D render, CGI, Disney/Pixar look, semi-realistic painted faces.';
  parts.push({ text: `ART STYLE (non-negotiable, applies to the ENTIRE image and every character in it): ${estilo}` });

  // Continuity reference (the previous generated shot) goes FIRST after the
  // style contract — it anchors location, lighting and wardrobe; character
  // refs follow so they stay closest to the scene prompt.
  if (continuityRef && continuityRef.img) {
    parts.push({ inlineData: { mimeType: continuityRef.mimeType || 'image/jpeg', data: continuityRef.img } });
    // Dos continuidades distintas, y confundirlas rompe el resultado.
    //
    // EPISODIO: entre plano y plano HAY UN CORTE, así que el encuadre nuevo
    // debe ser claramente otro; repetir la composición se ve como una imagen
    // congelada.
    //
    // CORTO: NO hay corte. Los dos fotogramas son los extremos de una misma
    // toma de ocho segundos, y Veo tiene que poder llegar de uno al otro
    // moviendo la cámara. Pedir "un ángulo claramente distinto" ahí es pedirle
    // que salte de un encuadre a otro sin cortar: eso es exactamente lo que le
    // hace deformar caras y inventar en el medio.
    const avanceComun = `Keep consistent with it ONLY: the identity of the location (same architecture, palette, time of day), the lighting mood, and each character's clothing and hairstyle. This new image is a LATER moment — the action has ADVANCED since this reference: characters may have moved through the space, object states may have changed, and new story elements described in the scene text may now be visible. If the scene text contradicts this reference (a door now open, a character now on the floor), the scene text ALWAYS wins.`;
    parts.push({ text: sinCortes
      ? `PREVIOUS KEYFRAME above (same unbroken take): this is the SAME CONTINUOUS SHOT exactly ${segundosEntre} seconds earlier. There is NO CUT between that image and this one - the camera never stopped rolling. ${avanceComun}

⚠️ THE SHOT SIZE CHANGES, AND THAT IS THE POINT.${planoPrevio ? ` That reference is a ${planoPrevio}.` : ''}${planoNuevo ? ` THIS new image is a ${planoNuevo}.` : ''} Over those ${segundosEntre} seconds the camera MOVED - it pushed in, pulled back, tracked around or craned - so the composition of this image MUST be clearly and obviously different from the reference: different distance to the subject, different angle, different amount of the room in frame.

What stays identical: the place, the light, the characters' faces, hair and clothes. What MUST change: how close the camera is, where it looks from, and what the characters are doing. If the two images look alike, the eight-second clip between them has nothing to animate and the video generator will fill the gap by warping faces and inventing things that are not in the story. A near-copy is the single worst outcome here - worse than a change that is too big.`
      : `↑ PREVIOUS SHOT (continuity reference): the immediately preceding moment of this story. ${avanceComun} Compose the NEW shot exactly as the scene text describes, from a clearly DIFFERENT camera angle and framing — NEVER re-render this reference's composition, never output a near-copy of it, never freeze the story at its moment.` });
  }

  // Las fichas de personaje, si las hay.
  if (characterRefs && characterRefs.length > 0) {
    for (const ref of characterRefs) {
      parts.push({ inlineData: { mimeType: ref.mimeType || 'image/png', data: ref.img } });
      parts.push({ text: `CHARACTER REFERENCE above: this is ${ref.name}. Match this character's IDENTITY exactly - same face shape, same hair colour and style, same eye colour, same outfit design - and render them in the SAME 2D anime art style as the reference. The ONLY things you must NOT copy are the pose, framing, size and plain background: redraw ${ref.name} at the body pose, camera angle and SCALE that THIS shot requires, correctly proportioned against the environment, feet grounded, sharing the scene's perspective and lighting. Do NOT mix up characters.` });
    }
  }

  // UNA sola rama para las reglas. Antes habia dos: una para cuando habia fichas
  // de personaje y otra para cuando no, y la segunda traia su PROPIO contrato de
  // estilo escrito a mano. El corto no manda fichas, asi que caia siempre en esa
  // segunda rama: el estilo que elegia el usuario no se aplicaba nunca ahi, y la
  // regla de "nada de texto" era una clausula suelta en medio de un parrafo.
  const namesList = (characterRefs || []).map(r => r.name).join(', ');
  const ecchiRules = isEcchi ? `
- This is an ecchi/fan-service anime scene. ALL characters are ADULTS (18 or older), in adult settings fitting the story's genre. NEVER draw school uniforms, classrooms, or anything implying minors.
- Draw it with appropriate suggestive visual elements: flattering angles, form-fitting clothing, blushing expressions, suggestive poses.` : '';
  parts.push({ text: `${namesList ? `Character references provided: ${namesList}.\n\n` : ''}MANDATORY RULES:
1. ABSOLUTELY NO TEXT. No letters, no words, no numbers, no watermarks, no captions, no subtitles, no readable signage, no speech bubbles, no logos, no signature. This is a single frame of animation, not a page of a comic. Any writing at all is a failed image.
2. Draw EVERY character named in the scene - if two or three are named, ALL appear. Do not add extra people beyond those mentioned.
3. Each character appears EXACTLY ONCE - never duplicate a character in the frame.${namesList ? `
4. Match EACH character to THEIR reference image. Do not swap faces or designs.` : ''}
5. Draw each character's hair exactly as described - never lengthen, shorten or restyle it to fit a convention.
6. Faces clear, well-defined and anatomically correct. No blur, no melted features, no extra limbs, no extra fingers.
7. Format and style: ${aspectStyle}. ${estilo}
8. Characters INTEGRATED into the environment at true real-world scale - feet grounded with contact shadows, natural headroom, sharing the perspective and light of the place. Never oversized, never floating, never pasted over the background.${ecchiRules}

Scene to illustrate:
${cleanPrompt}` });

  // ─── Resolve model → correct endpoint (IMAGE_MODEL_LOCATIONS-aware) ───
  const location = imageModelLocation(model);

  if (location === 'global') {
    // Global models: single endpoint, no rotation
    const url = vertexUrl(projectId, 'global', model, 'generateContent');
    const { ok, shouldRotate, isNoAccess, isSafetyBlock, data } = await callGeminiAtUrl(url, parts, projectId, token, aspectRatio);
    if (isNoAccess) return { error: data.error?.message || `Sin acceso a ${model}` };
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

  // Regional model: rotate through the configured regions for capacity
  const REGIONS = cfg.imageRegions.length ? cfg.imageRegions : [location];
  const start = Math.floor(Math.random() * REGIONS.length);
  const regions = [...REGIONS.slice(start), ...REGIONS.slice(0, start)];
  let lastError = '';
  for (const region of regions) {
    const url = vertexUrl(projectId, region, model, 'generateContent');

    const { ok, shouldRotate, isNoAccess, isSafetyBlock, data } = await callGeminiAtUrl(url, parts, projectId, token, aspectRatio);

    // Stop at the first region: the model is not available to this project
    // anywhere, so the other regions would fail identically.
    if (isNoAccess) return { error: data.error?.message || `Sin acceso a ${model}` };

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
module.exports = async function handler(req, res) {
  if (begin(req, res)) return;
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

    // The service account JSON is the SINGLE source of the GCP project, exactly
    // like every other endpoint. A GCP_PROJECT_ID override used to take
    // precedence here only, so switching accounts by replacing the service
    // account left images on the old project while everything else moved.
    const { projectId, token } = await auth();

    const aspectRatio = body.aspectRatio || '9:16';
    const model = forceModel || cfg.imageModel;
    // NO fallback: the selected model is the one used. If it fails, the error
    // says so — silently substituting another model would hand back images the
    // user did not ask for.
    const result = await callGemini(model, prompt, characterRefs, projectId, token, isEcchi === true,
      aspectRatio, continuityRef, body.styleSpec || '', body.sinCortes === true, Number(body.segundosEntre) || 8,
      String(body.planoPrevio || ''), String(body.planoNuevo || ''));
    return res.status(200).json(result);
  } catch(e) {
    return fail(res, e);
  }
};
