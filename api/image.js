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

function extractB64(data) {
  if (data.predictions?.[0]?.bytesBase64Encoded) return data.predictions[0].bytesBase64Encoded;
  if (data.predictions?.[0]?.image?.bytesBase64Encoded) return data.predictions[0].image.bytesBase64Encoded;
  return null;
}

async function tryGemini(model, prompt, refImageBase64, projectId, location, accessToken) {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  // Build parts — include reference image if available
  const parts = [];
  if (refImageBase64) {
    parts.push({
      inlineData: { mimeType: 'image/png', data: refImageBase64 }
    });
    parts.push({
      text: `This is the reference character image. Generate a new scene image keeping this exact character appearance, face, hair color, eye color and outfit style consistent. Scene: ${prompt}`
    });
  } else {
    parts.push({ text: prompt });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  const data = await res.json();
  if (res.ok) {
    const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (imgPart) return { success: true, imageData: imgPart.inlineData.data };
    return { success: false, error: `${model}: no image in response` };
  }
  return { success: false, error: `${model}: ${data.error?.message || res.status}` };
}

async function tryImagen(model, prompt, projectId, location, accessToken) {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '9:16', safetySetting: 'block_only_high' },
    }),
  });
  const data = await res.json();
  if (res.ok) {
    const b64 = extractB64(data);
    if (b64) return { success: true, imageData: b64 };
    if (data.predictions?.[0]?.raiFilteredReason) return { success: false, error: `${model}: safety block` };
    return { success: false, error: `${model}: no bytes` };
  }
  return { success: false, error: `${model}: ${data.error?.message || res.status}` };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const { prompt, refImageBase64 } = await req.json();
    const saJson = process.env.GCP_SERVICE_ACCOUNT;
    if (!saJson) return new Response(JSON.stringify({ error: 'GCP_SERVICE_ACCOUNT not configured' }), { status: 500, headers: CORS });

    const serviceAccount = JSON.parse(saJson);
    const projectId = serviceAccount.project_id;
    const location = 'us-central1';
    const accessToken = await getAccessToken(serviceAccount);

    let result;

    // 1. Gemini 3.1 Pro — mejor calidad, acepta imagen de referencia
    result = await tryGemini('gemini-3.1-pro-preview', prompt, refImageBase64, projectId, location, accessToken);
    if (result.success) return new Response(JSON.stringify({ imageData: result.imageData, model: 'gemini-3.1-pro' }), { status: 200, headers: CORS });

    // 2. Gemini 3.1 Flash Lite — rápido
    result = await tryGemini('gemini-3.1-flash-lite-preview', prompt, refImageBase64, projectId, location, accessToken);
    if (result.success) return new Response(JSON.stringify({ imageData: result.imageData, model: 'gemini-3.1-flash-lite' }), { status: 200, headers: CORS });

    // 3. Imagen 4.0 — fallback (sin referencia)
    result = await tryImagen('imagen-4.0-generate-001', prompt, projectId, location, accessToken);
    if (result.success) return new Response(JSON.stringify({ imageData: result.imageData, model: 'imagen-4.0' }), { status: 200, headers: CORS });

    // 4. Imagen 4.0 Fast
    result = await tryImagen('imagen-4.0-fast-generate-001', prompt, projectId, location, accessToken);
    if (result.success) return new Response(JSON.stringify({ imageData: result.imageData, model: 'imagen-4.0-fast' }), { status: 200, headers: CORS });

    // 5. Imagen 3.0 — último fallback
    result = await tryImagen('imagen-3.0-generate-002', prompt, projectId, location, accessToken);
    if (result.success) return new Response(JSON.stringify({ imageData: result.imageData, model: 'imagen-3.0' }), { status: 200, headers: CORS });

    return new Response(JSON.stringify({ error: result.error || 'All models failed' }), { status: 500, headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
