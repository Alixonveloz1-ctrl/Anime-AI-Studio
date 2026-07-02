// ════════════════════════════════════════════════════════════════
// SCRIPT GENERATION PROXY — Gemini 3.1 Pro (Vertex AI), the most
// capable text model available, with a 2.5 Flash fallback on
// capacity/availability errors. This is the SINGLE point that
// generates ALL text in the app: universe, characters, scene
// narration, image prompts, repairs, translation.
//
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
//
// Gemini 2.5+ preview models (including 3.1 Pro) are ONLY available
// at the "global" endpoint, not a regional one like us-central1 — the
// fallback model (2.5 Flash, stable) uses the regional endpoint.
//
// Gemini 3 Pro / 3.1 Pro always "think" before answering (cannot be
// disabled) and may return a "thought" part ahead of the real answer
// in the response — text extraction below filters those out so we
// never accidentally return the thinking summary instead of the JSON.
// ════════════════════════════════════════════════════════════════
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MODEL_PRIMARY  = 'gemini-3.1-pro-preview';
const MODEL_FALLBACK = 'gemini-2.5-flash';

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
  const pem = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----','')
    .replace('-----END PRIVATE KEY-----','')
    .replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyDer,
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('OAuth error: ' + JSON.stringify(d));
  return d.access_token;
}

function buildUrl(projectId, modelId, location) {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelId}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
}

async function callModel(modelId, location, projectId, token, body) {
  const url = buildUrl(projectId, modelId, location);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  return { ok: r.ok, status: r.status, data: d };
}

// Extracts the final answer text, skipping any "thought" parts (Gemini 3
// Pro/3.1 Pro reasoning models can include these ahead of the real answer).
function extractText(d) {
  const parts = d.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system } = req.body || {};
    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'messages requerido' });
    }

    const sa = JSON.parse((process.env.GCP_SERVICE_ACCOUNT || '').trim());
    const projectId = sa.project_id;
    const token = await getAccessToken(sa);

    const body = {
      contents: messages,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature: 0.8,
        // Higher than before: Gemini 3.1 Pro's thinking tokens count against
        // this budget too, on top of the actual JSON answer.
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
      },
    };

    let { ok, status, data: d } = await callModel(MODEL_PRIMARY, 'global', projectId, token, body);

    const msg1 = (d.error?.message || '').toLowerCase();
    const shouldFallback = !ok && (
      status === 429 || status === 503 || status === 404 ||
      msg1.includes('quota') || msg1.includes('exhausted') || msg1.includes('resource') ||
      msg1.includes('overload') || msg1.includes('unavailable') ||
      msg1.includes('not found') || msg1.includes('not support')
    );
    let modelUsed = MODEL_PRIMARY;
    if (shouldFallback) {
      modelUsed = MODEL_FALLBACK;
      ({ ok, status, data: d } = await callModel(MODEL_FALLBACK, 'us-central1', projectId, token, body));
    }

    if (!ok) {
      const msg = d.error?.message || JSON.stringify(d).slice(0, 200);
      return res.status(status).json({ error: `Gemini (${modelUsed}): ${msg}` });
    }

    const text = extractText(d);
    if (!text) {
      const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
      return res.status(500).json({ error: `Gemini sin respuesta [${reason}] (${modelUsed})` });
    }

    return res.status(200).json({ text, model: modelUsed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
