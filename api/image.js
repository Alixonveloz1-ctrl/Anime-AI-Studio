// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION PROXY — Vertex AI Gemini Image (Nano Banana)
// Multi-region: us-central1 → europe-west4 → us-east4 on 429
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
// ════════════════════════════════════════════════════════════════
const { cfg, auth, imageModelLocation, vertexUrl, gcsUpload, signedUrl, begin, fail } = require('./_lib/gcp');

// Google's wording when a model id does not exist for this project. Kept so the
// region rotation does not treat it as a capacity problem: retrying the other
// regions is pointless and its wrapper truncates the message, hiding the cause.
function sinAcceso(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('was not found or your project does not have access')
      || (m.includes('publisher model') && m.includes('not found'));
}

// El saneado de prompts vive en _lib/texto: lo usan imagen Y video. Estaba sólo
// aquí, así que los prompts de video llegaban a Veo sin tocar — mismo filtro y
// un clip bloqueado cuesta mucho más que una imagen bloqueada.
const { enfriar, quitarRedundante, limpiarPrompt } = require('./_lib/texto');

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

async function pedirImagen(model, cleanPrompt, characterRefs, projectId, token, isEcchi, aspectRatio, continuityRef, styleSpec, sinCortes, segundosEntre, planoPrevio, planoNuevo) {

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
    : 'AUTHENTIC JAPANESE HAND-DRAWN 2D TV ANIME FRAME. Crisp variable-weight ink lines, hard-edged cel shadow shapes, matte skin, grouped graphic hair locks, expressive Japanese anime facial acting, detailed painted 2D background. Characters must look like drawn animation cels, not rendered models. STRICTLY FORBIDDEN: 3D render, CGI character shading, PBR materials, ambient-occlusion-heavy faces, subsurface/glossy skin, videogame cutscene, semi-realistic AI portrait, Chinese donghua/manhua rendering, Korean webtoon rendering, Disney/Pixar, photorealistic human skin.';
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
    const avanceComun = `This reference is the immediately preceding physical state, not a loose mood board. Keep the SAME location identity (architecture, palette, time of day), lighting, character identity, clothing, hairstyle, injuries and object state. Preserve spatial continuity: a character remains at the same place in the room until the CURRENT scene text moves them; an open door stays open; an object already held stays held until the text changes it. A camera cut changes framing, NOT reality. A character may be off-camera only when the CURRENT prompt deliberately frames something else — do not erase, teleport or relocate them just because the angle changed. This new image is a LATER moment, so actions may advance ONLY as described by the current scene text. If the current text explicitly changes state (door opens, character falls, object is picked up), the current text wins.`;
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
      parts.push({ text: `CHARACTER REFERENCE above: this is ${ref.name}. Use it ONLY as the identity anchor: same face shape, facial proportions, hair colour/style, eye colour, adult body proportions and distinctive traits. DO NOT copy the reference pose, framing, neutral background or reference-sheet composition. WARDROBE IS CONTROLLED BY THE CURRENT SCENE TEXT: if this shot specifies a different outfit, use the shot's outfit while preserving identity. Redraw ${ref.name} in authentic Japanese hand-drawn 2D anime at the body pose, camera angle and scale required by this scene, grounded in the environment and sharing its perspective/light. Never turn the reference into a collage or duplicate the person. Do not mix up characters.` });
    }
  }

  // UNA sola rama para las reglas. Antes habia dos: una para cuando habia fichas
  // de personaje y otra para cuando no, y la segunda traia su PROPIO contrato de
  // estilo escrito a mano. El corto no manda fichas, asi que caia siempre en esa
  // segunda rama: el estilo que elegia el usuario no se aplicaba nunca ahi, y la
  // regla de "nada de texto" era una clausula suelta en medio de un parrafo.
  const namesList = (characterRefs || []).map(r => r.name).join(', ');
  const ecchiRules = isEcchi ? `
- This project may contain ECCHI/FAN-SERVICE, and every sexualized character is an ADULT (18+), clearly adult in face, body and context. Never imply minors or secondary-school settings.
- Fan-service is SCENE-DRIVEN, not a permanent body filter. If the current scene text describes an adult suggestive beat, wardrobe or awkward romantic situation, render it confidently in Japanese ecchi-anime language through pose, framing, timing and expression while staying non-explicit. If the current beat is grief, combat, exposition, danger or ordinary conversation, do NOT force cleavage, blushing, form-fitting clothes or suggestive poses that the scene did not request.
- Preserve the character's actual current wardrobe and proportions; do not turn every adult woman into the same exaggerated body type.` : '';
  parts.push({ text: `${namesList ? `Character references provided: ${namesList}.\n\n` : ''}MANDATORY RULES:
1. ABSOLUTELY NO TEXT. No letters, no words, no numbers, no watermarks, no captions, no subtitles, no readable signage, no speech bubbles, no logos, no signature. This is a single frame of animation, not a page of a comic. Any writing at all is a failed image.
2. Draw EVERY character named in the scene - if two or three are named, ALL appear. Do not add extra people beyond those mentioned.
3. Each character appears EXACTLY ONCE - never duplicate a character in the frame.${namesList ? `
4. Match EACH character to THEIR reference image. Do not swap faces or designs.` : ''}
5. Draw each character's hair exactly as described - never lengthen, shorten or restyle it to fit a convention.
6. Faces clear, well-defined and anatomically correct. No blur, no melted features, no extra limbs, no extra fingers.
7. Format and style: ${aspectStyle}. ${estilo}
8. Characters INTEGRATED into the environment at true real-world scale - feet grounded with contact shadows, natural headroom, sharing the perspective and light of the place. Never oversized, never floating, never pasted over the background.
9. LITERAL STAGING ONLY. Draw what a camera standing in that room would record. If any phrase reads as a figure of speech about a feeling - eyes turning red with envy, blood running cold, a heart breaking, fire in someone's gaze, jaw hitting the floor - draw the ordinary physical reality behind it: an expression, a posture, a held breath, a hand stopped halfway. NEVER turn an emotion into a special effect: no glowing or coloured eyes, no beams, no energy, no floating symbols, no transformation for a feeling. Genuine supernatural events stay fully allowed when the description states them as things that physically happen in this world - the ban is on metaphors, not on magic.${ecchiRules}

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
      return { error: `bloqueado [${finishReason}]`, bloqueado: true };
    }
    if (!ok) return { error: data.error?.message || `Error ${model}` };
    const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (img) return { imageData: img.inlineData.data.replace(/\s/g,''), imageMimeType: img.inlineData.mimeType || 'image/png', model, region: 'global' };
    const fr = data.candidates?.[0]?.finishReason || 'UNKNOWN';
    const rat = data.candidates?.[0]?.safetyRatings?.filter(x => x.blocked)?.map(x => x.category.replace('HARM_CATEGORY_',''))?.join(', ');
    return { error: `bloqueado [${fr}]${rat ? ' — ' + rat : ''}`, bloqueado: true };
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
      lastError = `${region}: ${data.error?.message?.slice(0,300) || 'sin capacidad'}`;
      continue;
    }
    if (isSafetyBlock) {
      const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
      let errorMsg = `bloqueado [${data.candidates?.[0]?.finishReason || 'SAFETY'}]`;
      if (textPart) errorMsg += ` — "${textPart.slice(0,80)}"`;
      return { error: errorMsg, bloqueado: true };
    }
    if (!ok) { lastError = `${region}: ${data.error?.message?.slice(0,80) || 'error'}`; continue; }
    const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (img) return { imageData: img.inlineData.data.replace(/\s/g,''), imageMimeType: img.inlineData.mimeType || 'image/png', model, region };
    const cand = data.candidates?.[0];
    const finishReason = cand?.finishReason || 'UNKNOWN';
    // Una respuesta SIN imagen no es falta de capacidad: es un rechazo. Aquí
    // sólo se reconocían SAFETY y RECITATION, y para imágenes Gemini devuelve
    // IMAGE_SAFETY y PROHIBITED_CONTENT — que se colaban hasta el final del
    // bucle y salían como "429 — sin capacidad". El usuario veía "cuota
    // excedida" en el primer intento de una imagen que en realidad estaba
    // bloqueada, y el cliente, al leer 429, se ponía a reintentar ocho veces
    // con esperas de hasta cinco minutos. Rotar de región tampoco arregla un
    // rechazo: el filtro es el mismo en todas.
    if (finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      const safety = cand?.safetyRatings?.filter(s => s.blocked)?.map(s => s.category.replace('HARM_CATEGORY_',''))?.join(', ');
      return { error: `bloqueado [${finishReason}]${safety ? ' — ' + safety : ''}`, bloqueado: true };
    }
    lastError = `${region}: respuesta vacía [${finishReason}]`;
    continue;
  }
  // Sin recortar: el mensaje de Google dice QUÉ cuota se agotó y cada cuánto se
  // repone, y cortarlo a sesenta caracteres se llevaba justo esa parte.
  return { error: `Sin capacidad en ninguna región (${regions.join(', ')}). ${lastError}`, sinCapacidad: true };
}


// Escalera de rescate. Un bloqueo NO es el final: se vuelve a pedir la misma
// escena con el texto enfriado. Se devuelve en qué escalón salió, para poder
// decírselo al usuario en vez de cambiarle el prompt a sus espaldas.
async function callGemini(model, prompt, characterRefs, projectId, token, isEcchi = false, aspectRatio = '9:16', continuityRef = null, styleSpec = '', sinCortes = false, segundosEntre = 8, planoPrevio = '', planoNuevo = '', desdeNarracion = false) {
  // Limpieza de entrada: palabras que bloquean seguro, frases que sólo señalan lo
  // que hay bajo la ropa (redundantes: la ficha del personaje ya viaja dibujada),
  // y la narración enfriada cuando es lo único que hay — no está escrita para ser
  // un prompt, y sin enfriar se bloquea siempre.
  const base = limpiarPrompt(prompt, { desdeNarracion });

  // El último escalón suelta también la REFERENCIA DE CONTINUIDAD, que es la
  // imagen del plano anterior. Una imagen de entrada puede bloquear el plano por
  // sí sola, y contra eso no hay edición de texto que valga: por mucho que se
  // suavice el prompt, se le sigue enseñando el fotograma anterior y pidiéndole
  // el momento siguiente. No cuesta una llamada más — es el mismo tercer intento
  // que ya se hacía, ahora con más posibilidades de salir.
  const escalones = [
    { texto: base, ecchi: isEcchi, cont: continuityRef, nivel: 0 },
    { texto: enfriar(base, 1), ecchi: isEcchi, cont: continuityRef, nivel: 1 },
    { texto: enfriar(base, 2), ecchi: false, cont: null, nivel: 2 },
  ];

  let ultimo = null;
  for (const e of escalones) {
    // Un escalón que no cambió NADA respecto del anterior no se paga dos veces.
    if (ultimo && e.texto === ultimo.texto && e.ecchi === ultimo.ecchi && e.cont === ultimo.cont) continue;
    const r = await pedirImagen(model, e.texto, characterRefs, projectId, token, e.ecchi,
      aspectRatio, e.cont, styleSpec, sinCortes, segundosEntre, planoPrevio, planoNuevo);
    if (r.imageData) return e.nivel ? { ...r, rescate: e.nivel } : r;
    // Sólo los bloqueos se enfrían. Un 429 o un modelo sin acceso no mejora
    // cambiando palabras, y reintentarlo tres veces sólo tarda más.
    if (!r.bloqueado) return r;
    ultimo = { ...e, error: r.error };
  }
  return { error: `${ultimo.error} — se reintentó suavizando el texto y, la última vez, `
           + `también sin la imagen del plano anterior. Siguió bloqueado.`,
           bloqueado: true, rescateAgotado: true };
}

// ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (await begin(req, res)) return;
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
    const { sa, projectId, token } = await auth();

    const aspectRatio = body.aspectRatio || '9:16';
    const model = forceModel || cfg.imageModel;
    // NO fallback: the selected model is the one used. If it fails, the error
    // says so — silently substituting another model would hand back images the
    // user did not ask for.
    const result = await callGemini(model, prompt, characterRefs, projectId, token, isEcchi === true,
      aspectRatio, continuityRef, body.styleSpec || '', body.sinCortes === true, Number(body.segundosEntre) || 8,
      String(body.planoPrevio || ''), String(body.planoNuevo || ''), body.desdeNarracion === true);

    // Production images never need to come back through Safari as multi-megabyte
    // base64 strings. When the client supplies its lightweight storage key, save
    // the binary directly in this project's GCS media folder and return only a
    // gs:// pointer. This keeps the browser cache tiny and avoids iOS killing the
    // page during long image batches.
    if (result.imageData && body.storageKey && body.studioProjectId) {
      const studioProjectId = String(body.studioProjectId || '').trim();
      const storageKey = String(body.storageKey || '').trim();
      if (!/^p[a-zA-Z0-9_-]{5,80}$/.test(studioProjectId)) {
        return res.status(400).json({ error:'studioProjectId inválido' });
      }
      if (!/^[a-zA-Z0-9_.-]{3,220}$/.test(storageKey)) {
        return res.status(400).json({ error:'storageKey inválido' });
      }
      if (!cfg.bucket) {
        return res.status(500).json({ error:'GCS_OUTPUT_BUCKET no configurado', configError:true });
      }
      const mime = result.imageMimeType || 'image/png';
      const ext = /jpe?g/i.test(mime) ? 'jpg' : /webp/i.test(mime) ? 'webp' : 'png';
      const objectPath = `${cfg.prefix}/projects/${studioProjectId}/media/${storageKey}.${ext}`;
      await gcsUpload(token, cfg.bucket, objectPath, Buffer.from(result.imageData, 'base64'), mime);
      const { imageData, ...meta } = result;
      const imageUri = `gs://${cfg.bucket}/${objectPath}`;
      return res.status(200).json({
        ...meta,
        imageUri,
        imageUrl: signedUrl(sa, cfg.bucket, objectPath, { expiresSeconds: 6 * 3600 }),
        imageMimeType: mime,
      });
    }

    return res.status(200).json(result);
  } catch(e) {
    return fail(res, e);
  }
};
