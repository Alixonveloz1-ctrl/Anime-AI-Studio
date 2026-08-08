// ════════════════════════════════════════════════════════════════
// TRANSCRIBE — Speech-to-Text with word time offsets, used for
// FORCED ALIGNMENT of subtitles.
//
// We already know what was said (the app generated the narration),
// so the transcript itself is not the point: the word timings are.
// The client aligns these timings onto the exact script text, so the
// subtitles carry the script wording with the real spoken timing.
//
// Each scene's narration is ~20s, comfortably inside the v1 sync
// recognize limit (~1 minute).
// ════════════════════════════════════════════════════════════════
const { cfg, auth, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { audioData, mimeType, languageCode } = req.body || {};
    if (!audioData) return res.status(400).json({ error: 'audioData requerido' });

    const { projectId, token } = await auth();

    // LINEAR16 needs an explicit sample rate; compressed formats carry their
    // own header, so let the API detect them.
    const mime = String(mimeType || 'audio/wav').toLowerCase();
    const encoding = mime.includes('mpeg') || mime.includes('mp3') ? 'MP3'
                   : mime.includes('ogg') || mime.includes('opus') ? 'OGG_OPUS'
                   : 'LINEAR16';

    const config = {
      languageCode: languageCode || cfg.sttLanguage,
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: false,
      model: cfg.sttModel,
      encoding,
    };
    // Gemini TTS returns 24 kHz mono PCM wrapped in WAV.
    if (encoding === 'LINEAR16') config.sampleRateHertz = 24000;

    const r = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify({ config, audio: { content: audioData.replace(/\s/g, '') } }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(r.status).json({ error: `Speech-to-Text: ${msg}` });
    }

    // "1.500s" → 1.5
    const secs = v => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'object') return Number(v.seconds || 0) + Number(v.nanos || 0) / 1e9;
      return parseFloat(String(v).replace('s', '')) || 0;
    };

    const words = [];
    for (const result of (data.results || [])) {
      for (const w of (result.alternatives?.[0]?.words || [])) {
        words.push({ word: w.word, start: secs(w.startTime), end: secs(w.endTime) });
      }
    }

    // No words is not an error — the client falls back to proportional timing.
    return res.status(200).json({ words, count: words.length });
  } catch (e) {
    return fail(res, e);
  }
};
