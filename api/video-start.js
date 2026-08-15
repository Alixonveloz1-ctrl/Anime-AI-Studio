// ════════════════════════════════════════════════════════════════
// VIDEO START — Veo 3.1 via Vertex AI (Node.js runtime — uses crypto)
// Starts async video generation and returns operationName for polling
// ════════════════════════════════════════════════════════════════
const { cfg, auth, vertexUrl, begin, fail } = require('./_lib/gcp');
// Veo tiene el MISMO filtro que el generador de imagen y el prompt le llegaba
// sin tocar. Un clip bloqueado cuesta bastante más que una imagen bloqueada.
const { limpiarPrompt } = require('./_lib/texto');

// Durations each Veo model accepts. Asking for a length the model does not
// support is rejected, and asking for more seconds than the shot needs is worse:
// the model fills the surplus with invented action.
const DURACIONES = {
  'veo-3.1-generate-001':      [4, 6, 8],
  'veo-3.1-fast-generate-001': [4, 6, 8],
  'veo-3.1-lite-generate-001': [4, 6, 8],
  'veo-2.0-generate-001':      [5, 6, 7, 8],
};

// Closest supported duration. The montage does not trim or loop a clip to fit
// its shot — it retimes it — so being a second over or a second under costs the
// same: a slightly different pace, both ends intact. That makes the tie-break a
// money question, and the SHORTER one wins, because Veo bills per second
// generated: at 4 s a clip costs a third less than at 6 s.
function duracionValida(model, pedida) {
  const opciones = DURACIONES[model] || [4, 6, 8];
  const d = Number(pedida);
  if (!Number.isFinite(d) || d <= 0) return opciones[opciones.length - 1];
  return opciones.reduce((mejor, o) =>
    Math.abs(o - d) < Math.abs(mejor - d) || (Math.abs(o - d) === Math.abs(mejor - d) && o < mejor) ? o : mejor);
}

// Does this rejection mean "this model has no last frame" rather than "your
// request is wrong"? Google words it differently per model and per version, so
// match on the field name instead of on an exact sentence.
function rechazaFotogramaFinal(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('lastframe') ||
    (m.includes('last frame') && /not support|unsupported|invalid|not allowed|no admite/.test(m));
}

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { prompt, negativePrompt, imageA, imageB, lastFrame, durationSeconds,
            imageMimeType, lastFrameMimeType,
            aspectRatio = '9:16', generateAudio = false, veoModel } = req.body;
    // The frames used to be hardcoded as image/png. They arrive re-encoded as
    // JPEG now (two detailed PNGs were 7.7 MB, over the 4.5 MB body limit), and
    // declaring the wrong type is how a valid image gets rejected.
    const tipo = t => (t === 'image/jpeg' || t === 'image/png') ? t : 'image/png';
    if (!prompt) return res.status(400).json({ error: 'prompt requerido' });
    // El prompt de video se limpia igual que el de imagen. `desdeNarracion` lo
    // marca el cliente cuando el director no escribió movimiento y hay que tirar
    // del texto de la escena, que no está escrito para ser un prompt.
    const promptLimpio = limpiarPrompt(prompt, { desdeNarracion: req.body.desdeNarracion === true });

    const MODEL_ID = (veoModel || cfg.veoModel).trim();
    const bucket = cfg.bucket;
    if (!bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });

    const { projectId, token } = await auth();

    // Single reference image (Veo 3.1 Lite uses image field, not referenceImages array)
    const imageData = (imageA || imageB || '').replace(/\s/g, '');

    const url = vertexUrl(projectId, cfg.veoLocation, MODEL_ID, 'predictLongRunning');

    // lastFrame pins where the clip ENDS. Passing the next shot's still image
    // makes Veo interpolate between the two instead of inventing its own
    // ending, which is what makes consecutive clips cut together cleanly.
    const finalData = (lastFrame || '').replace(/\s/g, '');

    // negativePrompt belongs to `parameters`, not to the instance. It carries
    // more weight than it looks: Veo 3.x always runs its own prompt rewriter and
    // it cannot be turned off, so the positive prompt reaches the generator
    // already reworded by another model. The negative prompt is applied after
    // that rewrite — it is the one constraint the rewriter cannot water down.
    const parameters = {
      aspectRatio: (aspectRatio === '16:9') ? '16:9' : '9:16',
      sampleCount: 1,
      durationSeconds: duracionValida(MODEL_ID, durationSeconds),
      generateAudio: generateAudio === true,
      personGeneration: 'allow_adult',
      ...(negativePrompt ? { negativePrompt: String(negativePrompt).slice(0, 1000) } : {}),
      storageUri: `gs://${bucket}/${cfg.prefix}/veo/`,
    };
    const instancia = {
      prompt: promptLimpio,
      ...(imageData ? { image: { bytesBase64Encoded: imageData, mimeType: tipo(imageMimeType) } } : {}),
    };

    const pedir = async (conFotogramaFinal) => {
      const body = {
        instances: [conFotogramaFinal
          ? { ...instancia, lastFrame: { bytesBase64Encoded: finalData, mimeType: tipo(lastFrameMimeType) } }
          : instancia],
        parameters,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': projectId,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return { ok: response.ok, status: response.status, data,
        msg: data.error?.message || data.error?.status || JSON.stringify(data).slice(0, 200) };
    };

    // Ask for the interpolated clip first. Not every Veo tier accepts a last
    // frame, and Google's own docs disagree with each other about which do, so
    // the model answers the question itself: if it rejects the field, the SAME
    // model runs again without it and the response says so out loud. The model
    // is never swapped — only the field it refused is dropped.
    let r = await pedir(!!finalData);
    let sinFotogramaFinal = null;
    if (!r.ok && finalData && rechazaFotogramaFinal(r.msg)) {
      sinFotogramaFinal = `${MODEL_ID} no acepta fotograma final — el clip se generó solo con la imagen inicial`;
      r = await pedir(false);
    }

    if (!r.ok) return res.status(r.status).json({ error: `Veo: ${r.msg}` });
    if (!r.data.name) return res.status(500).json({ error: 'Veo no devolvió operationName' });

    return res.status(200).json({
      operationName: r.data.name, projectId, model: MODEL_ID,
      durationSeconds: parameters.durationSeconds,
      interpolado: !!finalData && !sinFotogramaFinal,
      sinFotogramaFinal,
    });
  } catch (e) {
    return fail(res, e);
  }
};
