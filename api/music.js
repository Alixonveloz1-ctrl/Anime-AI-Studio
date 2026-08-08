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
const { cfg, auth, vertexUrl, begin, fail } = require('./_lib/gcp');

// Lyria refuses vocals; keep the negative prompt explicit so a cue never
// competes with the narration track.
const BASE_NEGATIVE = 'vocals, singing, voice, lyrics, spoken word, rap, choir';

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { prompt, negativePrompt, seed, sampleCount } = req.body || {};
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'prompt requerido' });
    }

    const { projectId, token } = await auth();
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

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify({ instances: [instance], parameters: {} }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(r.status).json({ error: `Lyria (${model}): ${msg}` });
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

    return res.status(200).json({ clips, model });
  } catch (e) {
    return fail(res, e);
  }
};
