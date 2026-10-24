// ════════════════════════════════════════════════════════════════
// MUSIC PROXY — Lyria on Vertex AI.
//
// Lyria returns an instrumental clip (about 30 seconds) as base64
// audio from a text prompt. The model is cfg.musicModel, overridable
// with MUSIC_MODEL; its region with MUSIC_LOCATION.
//
// Music is scored per EPISODE, not per scene: one cue is generated
// for each act of the episode and the client loops/crossfades them
// under the narration.
// ════════════════════════════════════════════════════════════════
const { cfg, auth, vertexUrl, gcsUpload, signedUrl, begin, fail } = require('./_lib/gcp');

// A 30 s 48 kHz stereo clip is about 5.5 MB, which is 7.3 MB as base64: far
// over Vercel's 4.5 MB body limit, so the answer never reached the phone. The
// clip is written straight into the project's bucket and only its pointer
// travels back, exactly as scene images already do.
const LIMITE_MS = 52000;

// Lyria refuses vocals; keep the negative prompt explicit so a cue never
// competes with the narration track.
const BASE_NEGATIVE = 'vocals, singing, voice, lyrics, spoken word, rap, choir';

module.exports = async function handler(req, res) {
  const limite = Date.now() + LIMITE_MS;
  if (await begin(req, res)) return;

  try {
    const { prompt, negativePrompt, seed, sampleCount } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'prompt requerido' });
    }

    const studioProjectId = String(req.body?.studioProjectId || '').trim();
    const storageKey = String(req.body?.storageKey || '').trim();
    if (studioProjectId || storageKey) {
      if (!/^p[a-zA-Z0-9_-]{5,80}$/.test(studioProjectId)) return res.status(400).json({ error:'studioProjectId inválido' });
      if (!/^[a-zA-Z0-9_.-]{3,220}$/.test(storageKey)) return res.status(400).json({ error:'storageKey inválido' });
      if (!cfg.bucket) return res.status(500).json({ error:'GCS_OUTPUT_BUCKET no configurado', configError:true });
    }

    const { sa, projectId, token } = await auth();
    const model = cfg.musicModel;
    const url = vertexUrl(projectId, cfg.musicLocation, model, 'predict');

    const instance = {
      prompt: String(prompt).slice(0, 2000),
      negative_prompt: [BASE_NEGATIVE, negativePrompt].filter(Boolean).join(', '),
    };
    // Lyria rejects seed and sample_count together — only send a seed when
    // exactly one clip is requested.
    const count = Math.min(Math.max(parseInt(sampleCount, 10) || 1, 1), 4);
    if (count > 1) instance.sample_count = count;
    else if (Number.isInteger(seed)) instance.seed = seed;

    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': projectId,
        },
        body: JSON.stringify({ instances: [instance], parameters: {} }),
        signal: AbortSignal.timeout(Math.max(1000, limite - Date.now())),
      });
    } catch (e) {
      if (e.name !== 'TimeoutError' && e.name !== 'AbortError') throw e;
      return res.status(504).json({ error: `Lyria tardó más de ${Math.round(LIMITE_MS / 1000)} s en componer esta pista. Vuelve a intentarlo.`, timeout: true });
    }

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = { error: { message: raw.slice(0, 200) || `HTTP ${r.status}` } }; }
    if (!r.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(r.status).json({ error: `Lyria (${model}) ${r.status}: ${msg}`, retryable: [429, 500, 502, 503, 504].includes(r.status) });
    }

    // Predictions carry the audio under one of a couple of field names
    // depending on model version — accept either rather than hardcoding one.
    const preds = Array.isArray(data.predictions) ? data.predictions : [];
    const clips = preds
      .map(p => ({
        audioData: p?.bytesBase64Encoded || p?.audioContent || p?.audio || null,
        mimeType:  p?.mimeType || 'audio/wav',
      }))
      .filter(c => c.audioData);

    if (!clips.length) {
      const detail = preds.length ? Object.keys(preds[0] || {}).join(', ') : 'sin predictions';
      return res.status(500).json({ error: `Lyria no devolvió audio (${detail})` });
    }

    // With a storage key the clip stays in the bucket and only its pointer is
    // returned; without one (older pages) the base64 travels as before.
    if (storageKey && studioProjectId) {
      const first = clips[0];
      const mime = first.mimeType || 'audio/wav';
      const ext = /mpeg|mp3/i.test(mime) ? 'mp3' : 'wav';
      const objectPath = `${cfg.prefix}/projects/${studioProjectId}/media/${storageKey}.${ext}`;
      await gcsUpload(token, cfg.bucket, objectPath, Buffer.from(first.audioData, 'base64'), mime);
      return res.status(200).json({
        clips: [{
          audioUri: `gs://${cfg.bucket}/${objectPath}`,
          audioUrl: signedUrl(sa, cfg.bucket, objectPath, { expiresSeconds: 6 * 3600 }),
          mimeType: mime,
        }],
        model,
      });
    }

    return res.status(200).json({ clips, model });
  } catch (e) {
    return fail(res, e);
  }
};
