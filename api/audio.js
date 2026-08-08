// ════════════════════════════════════════════════════════════════
// AUDIO PROXY — Google Cloud only: Gemini TTS (Vertex AI) and
// Cloud TTS Neural2/WaveNet. Credentials come from the single
// GCP_SERVICE_ACCOUNT env var, same as every other endpoint.
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
// ════════════════════════════════════════════════════════════════
const { cfg, auth, vertexUrl, begin, fail } = require('./_lib/gcp');

function pcmToWav(pcmB64) {
  // Buffer-based decode/encode (robust) — avoids atob/btoa, whose strict
  // base64 handling can throw "The string did not match the expected pattern".
  const pcm = Buffer.from(pcmB64, 'base64');
  const sampleRate = 24000, channels = 1, bits = 16;
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off+i, s.charCodeAt(i)); };
  w(0,'RIFF'); dv.setUint32(4,36+dataSize,true); w(8,'WAVE'); w(12,'fmt ');
  dv.setUint32(16,16,true); dv.setUint16(20,1,true);
  dv.setUint16(22,channels,true); dv.setUint32(24,sampleRate,true);
  dv.setUint32(28,byteRate,true); dv.setUint16(32,blockAlign,true);
  dv.setUint16(34,bits,true); w(36,'data'); dv.setUint32(40,dataSize,true);
  const wav = new Uint8Array(buf); wav.set(pcm,44);
  return Buffer.from(wav).toString('base64');
}

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { text, speed, emotion } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    // The engine is chosen by the voice prefix; default to the same Gemini
    // voice the TTS branch falls back to, so a missing value can never throw.
    const voice = String((req.body || {}).voice || 'gemini_Orus');

    // ─── Google Cloud TTS (Neural2 / WaveNet) ───
    if (voice.startsWith('gcp_')) {
      const { token } = await auth();
      const voiceName = voice.replace('gcp_', ''); // e.g. "es-US-Neural2-B"
      const langCode  = voiceName.slice(0, 5);     // e.g. "es-US"
      const spd = parseFloat(speed) || 1.0;

      const gcpRes = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: langCode, name: voiceName },
          audioConfig: { audioEncoding: 'LINEAR16', speakingRate: spd },
        }),
      });

      const data = await gcpRes.json();
      if (!gcpRes.ok || !data.audioContent)
        return res.status(gcpRes.status || 500).json({ error: `GCP TTS: ${data.error?.message || gcpRes.status}` });

      return res.status(200).json({ audioData: data.audioContent, mimeType: 'audio/wav' });
    }

    // ─── Gemini TTS via Vertex AI ───
    const { projectId, token } = await auth();

    // Voice IDs follow format gemini_{Name} — strip prefix to get Gemini voice name
    const voiceName = voice.startsWith('gemini_') ? voice.replace('gemini_', '') : 'Orus';

    const spd = parseFloat(speed) || 1.0;
    const speedTag = spd <= 0.6 ? '[slow] ' : spd >= 1.8 ? '[fast] '
                   : spd >= 1.4 ? '[slightly fast] ' : spd <= 0.8 ? '[slightly slow] ' : '';

    // Style instruction: conversational by default; 'subtle' allows light emotional
    // emphasis at climactic/final moments. Previously this was hardcoded and ignored
    // the emotion parameter the UI sends — the "Expresividad de voz" selector did
    // nothing at all.
    const styleTag = emotion === 'subtle'
      ? '[Read in a natural conversational tone, like a narrator telling a story to a friend — allow a touch of genuine emotional emphasis at climactic or final moments, but stay grounded, NOT theatrical, NOT overacted] '
      : '[Read in a natural conversational tone, calm and engaging, like a narrator telling a story to a friend — NOT theatrical, NOT dramatic, NOT overly expressive] ';

    const reqBody = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: styleTag + speedTag + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });

    const callModel = async (modelId, apiVersion) => {
      const url = vertexUrl(projectId, cfg.ttsLocation, modelId, 'generateContent')
        .replace('/v1/projects/', `/${apiVersion}/projects/`);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Goog-User-Project': projectId },
        body: reqBody,
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    };

    // Preferred TTS model first, fall back to the secondary one when the
    // project has no access to it. Both are TTS_MODEL / TTS_FALLBACK_MODEL.
    let r = await callModel(cfg.ttsModel, 'v1beta1');
    if (!r.ok && (r.status === 404 || r.status === 403 || r.status === 503) && cfg.ttsFallback) {
      r = await callModel(cfg.ttsFallback, 'v1');
    }
    if (!r.ok) return res.status(500).json({ error: `Gemini TTS: ${r.data?.error?.message || r.status}` });

    const part = r.data.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) return res.status(500).json({ error: 'No audio en respuesta Gemini' });

    const mime = part.inlineData.mimeType || 'audio/pcm';
    let audioData = part.inlineData.data;
    if (mime.includes('pcm') || mime.includes('l16') || mime.includes('raw')) {
      audioData = pcmToWav(audioData);
    }
    return res.status(200).json({ audioData, mimeType: 'audio/wav' });

  } catch (e) {
    return fail(res, e);
  }
};
