// ════════════════════════════════════════════════════════════════
// AUDIO GENERATION PROXY — Gemini 2.5 Flash TTS via Vertex AI
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

// ───────── OAuth: Service Account → Access Token ─────────
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = { iss:sa.client_email, sub:sa.client_email, aud:sa.token_uri, iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/cloud-platform' };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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

// ───────── PCM 24kHz mono 16-bit → WAV base64 ─────────
function pcmToWav(pcmB64) {
  const pcm = Uint8Array.from(atob(pcmB64), c => c.charCodeAt(0));
  const sampleRate = 24000, channels = 1, bits = 16;
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv  = new DataView(buf);
  const w = (off, s) => { for (let i=0; i<s.length; i++) dv.setUint8(off+i, s.charCodeAt(i)); };

  w(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);   dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, dataSize, true);

  const wav = new Uint8Array(buf);
  wav.set(pcm, 44);

  let s = '';
  for (let i=0; i<wav.length; i++) s += String.fromCharCode(wav[i]);
  return btoa(s);
}

// ───────── Handler ─────────
export default async function handler(req) {
  const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers:{ ...CORS, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status:405 });

  try {
    const { text, voice, act, speed, emotion } = await req.json();
    if (!text) return new Response(JSON.stringify({ error:'text required' }), { status:400, headers:CORS });

    const saJson = process.env.GCP_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ error:'GCP_SERVICE_ACCOUNT missing' }), { status:500, headers:CORS });
    const sa = JSON.parse(saJson);
    const projectId = sa.project_id;
    const token = await getAccessToken(sa);

    const voiceMap = {
      gemini_male:    'Charon',
      gemini_female:  'Kore',
      gemini_male2:   'Fenrir',
      gemini_female2: 'Aoede',
    };
    const voiceName = voiceMap[voice] || 'Charon';

    // Speed tag for Gemini 3.1 Flash TTS (prepended to text)
    const spd = parseFloat(speed) || 1.0;
    const speedTag = spd <= 0.6  ? '[slow] '
                   : spd >= 1.8  ? '[fast] '
                   : spd >= 1.4  ? '[slightly fast] '
                   : spd <= 0.8  ? '[slightly slow] '
                   : '';

    // Delivery tag by act — only applied when emotion mode is on.
    // Default 'neutral' = no tags = natural narration without theatrical over-acting.
    let tag = '';
    if (emotion === 'subtle') {
      tag = act === 'climax'     ? '[slightly intense] '
          : act === 'resolution' ? '[calm] '
          : '';
    }

    const reqBody = JSON.stringify({
      contents:[{ role:'user', parts:[{ text: speedTag + tag + text }] }],
      generationConfig:{
        responseModalities:['AUDIO'],
        speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName } } },
      },
    });

    const callModel = async (modelId, apiVersion) => {
      const url = `https://us-central1-aiplatform.googleapis.com/${apiVersion}/projects/${projectId}/locations/us-central1/publishers/google/models/${modelId}:generateContent`;
      const resp = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'X-Goog-User-Project':projectId },
        body: reqBody,
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    };

    // Try Gemini 3.1 Flash TTS first; fall back to 2.5 if preview unavailable
    let r = await callModel('gemini-3.1-flash-tts-preview', 'v1beta1');
    if (!r.ok && (r.status === 404 || r.status === 403 || r.status === 503)) {
      console.warn('3.1 TTS no disponible, usando 2.5:', r.data?.error?.message);
      r = await callModel('gemini-2.5-flash-preview-tts', 'v1');
    }
    if (!r.ok) return new Response(JSON.stringify({ error: `Gemini TTS: ${r.data?.error?.message || r.status}` }), { status:500, headers:CORS });
    const d = r.data;

    const part = d.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) return new Response(JSON.stringify({ error: 'No audio in response' }), { status:500, headers:CORS });

    const mime = part.inlineData.mimeType || 'audio/pcm';
    let audioData = part.inlineData.data;
    if (mime.includes('pcm') || mime.includes('l16') || mime.includes('raw')) {
      audioData = pcmToWav(audioData);
    }

    return new Response(JSON.stringify({ audioData, mimeType: 'audio/wav' }), { status:200, headers:CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:CORS });
  }
}
