// ════════════════════════════════════════════════════════════════
// AUDIO PROXY — Gemini TTS + ElevenLabs (keys from env vars)
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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
  const pcm = Uint8Array.from(atob(pcmB64), c => c.charCodeAt(0));
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
  let s = ''; for (let i = 0; i < wav.length; i++) s += String.fromCharCode(wav[i]);
  return btoa(s);
}

function b64ToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { text, provider, voice, voiceId, speed, emotion } = await req.json();
    if (!text) return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: CORS });

    // ─── ElevenLabs via proxy (key from env var) ───
    if (provider === 'elevenlabs') {
      const elKey = (process.env.ELEVENLABS_API_KEY || '').trim();
      if (!elKey) return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY no configurado en Vercel' }), { status: 500, headers: CORS });
      if (!voiceId) return new Response(JSON.stringify({ error: 'voiceId requerido para ElevenLabs' }), { status: 400, headers: CORS });

      const modelId = 'eleven_v3';
      const voiceSettings = { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true };

      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail?.message || err.detail || res.statusText;
        return new Response(JSON.stringify({ error: `ElevenLabs ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` }), { status: res.status, headers: CORS });
      }

      const buf = await res.arrayBuffer();
      return new Response(JSON.stringify({ audioData: b64ToBase64(buf), mimeType: 'audio/mpeg' }), { headers: CORS });
    }

    // ─── Google Cloud TTS (Neural2 / WaveNet) ───
    if (voice.startsWith('gcp_')) {
      const sa = JSON.parse((process.env.GCP_SERVICE_ACCOUNT || '').trim());
      const token = await getAccessToken(sa);
      const voiceName = voice.replace('gcp_', ''); // e.g. "es-US-Neural2-B"
      const langCode  = voiceName.slice(0, 5);     // e.g. "es-US"
      const spd = parseFloat(speed) || 1.0;

      const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: langCode, name: voiceName },
          audioConfig: { audioEncoding: 'LINEAR16', speakingRate: spd },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.audioContent)
        return new Response(JSON.stringify({ error: `GCP TTS: ${data.error?.message || res.status}` }), { status: res.status || 500, headers: CORS });

      return new Response(JSON.stringify({ audioData: data.audioContent, mimeType: 'audio/wav' }), { headers: CORS });
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

    // Style instruction: conversational, not theatrical
    const styleTag = '[Read in a natural conversational tone, calm and engaging, like a narrator telling a story to a friend — NOT theatrical, NOT dramatic, NOT overly expressive] ';

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
    if (!r.ok) return new Response(JSON.stringify({ error: `Gemini TTS: ${r.data?.error?.message || r.status}` }), { status: 500, headers: CORS });

    const part = r.data.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) return new Response(JSON.stringify({ error: 'No audio en respuesta Gemini' }), { status: 500, headers: CORS });

    const mime = part.inlineData.mimeType || 'audio/pcm';
    let audioData = part.inlineData.data;
    if (mime.includes('pcm') || mime.includes('l16') || mime.includes('raw')) {
      audioData = pcmToWav(audioData);
    }
    return new Response(JSON.stringify({ audioData, mimeType: 'audio/wav' }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
