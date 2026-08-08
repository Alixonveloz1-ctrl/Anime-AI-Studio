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
const crypto = require('crypto');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  // Native crypto signing (robust, same as video-start.js) — passes the PEM
  // straight to createSign, avoiding the fragile atob() key decode that threw
  // "The string did not match the expected pattern" on Vercel's runtime.
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const b64sig = signer.sign(sa.private_key, 'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token error: ' + JSON.stringify(d));
  return d.access_token;
}

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
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, speed, emotion } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    // The engine is chosen by the voice prefix; default to the same Gemini
    // voice the TTS branch falls back to, so a missing value can never throw.
    const voice = String((req.body || {}).voice || 'gemini_Orus');

    // ─── Google Cloud TTS (Neural2 / WaveNet) ───
    if (voice.startsWith('gcp_')) {
      const sa = JSON.parse((process.env.GCP_SERVICE_ACCOUNT || '').trim());
      const token = await getAccessToken(sa);
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
    const sa = JSON.parse((process.env.GCP_SERVICE_ACCOUNT || '').trim());
    const projectId = sa.project_id;
    const token = await getAccessToken(sa);

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
      const url = `https://us-central1-aiplatform.googleapis.com/${apiVersion}/projects/${projectId}/locations/us-central1/publishers/google/models/${modelId}:generateContent`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Goog-User-Project': projectId },
        body: reqBody,
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    };

    // Try Gemini 3.1 TTS first, fall back to 2.5
    let r = await callModel('gemini-3.1-flash-tts-preview', 'v1beta1');
    if (!r.ok && (r.status === 404 || r.status === 403 || r.status === 503)) {
      r = await callModel('gemini-2.5-flash-preview-tts', 'v1');
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
    return res.status(500).json({ error: e.message });
  }
};
