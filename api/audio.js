export const config = { runtime: 'edge' };

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: serviceAccount.token_uri,
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pemBody = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const tokenRes = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('OAuth error: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const { text, voice, act } = await req.json();

    const saJson = process.env.GCP_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ error: 'GCP_SERVICE_ACCOUNT not configured' }), { status: 500, headers: CORS });

    const serviceAccount = JSON.parse(saJson);
    const projectId = serviceAccount.project_id;
    const location = 'us-central1';
    const accessToken = await getAccessToken(serviceAccount);

    const voiceMap = {
      gemini_male:   'Charon',
      gemini_female: 'Kore',
      gemini_male2:  'Fenrir',
      gemini_female2:'Aoede',
    };
    const voiceName = voiceMap[voice] || 'Charon';
    const emotionPrefix = act === 'climax' ? '[excited] ' : act === 'resolution' ? '[soft] ' : act === 'cold_open' ? '[curious] ' : '';
    const taggedText = emotionPrefix + text;

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash-preview-tts:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: taggedText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          }
        }
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Gemini TTS: ${data.error?.message || res.status}` }), { status: 500, headers: CORS });
    }

    const audioB64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioB64) {
      return new Response(JSON.stringify({ error: 'Gemini TTS: no audio in response — ' + JSON.stringify(data).substring(0,150) }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ audioData: audioB64 }), { status: 200, headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
