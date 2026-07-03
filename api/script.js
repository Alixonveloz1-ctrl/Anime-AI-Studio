// ════════════════════════════════════════════════════════════════
// SCRIPT GENERATION PROXY — Gemini 3.1 Pro (Vertex AI), the most
// capable text model available. This is the SINGLE point that
// generates ALL text in the app: universe, characters, scene
// narration, image prompts, repairs, translation.
//
// NO model fallback: per project requirement, the ONLY text generator
// is the maximum-quality model. If 3.1 Pro fails (capacity/quota), the
// call returns a clear error instead of silently downgrading to a
// weaker model. Transient blips are already absorbed by the client,
// which retries each text call up to 4 times.
//
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
//
// Gemini 3.x preview models are ONLY available at the "global"
// endpoint, not a regional one like us-central1.
//
// Gemini 3.1 Pro always "thinks" before answering (cannot be
// disabled) and may return a "thought" part ahead of the real answer
// in the response — text extraction below filters those out so we
// never accidentally return the thinking summary instead of the JSON.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MODEL = 'gemini-3.1-pro-preview';

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
  // Sign with Node's native crypto (same robust approach as video-start.js):
  // the PEM private key is passed straight to createSign, which parses the PEM
  // (headers + newlines) internally. This avoids atob(), whose strict base64
  // decoding on Vercel's runtime threw "The string did not match the expected
  // pattern" whenever the key had any stray whitespace or newline formatting.
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${sig}`;
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
      // Adult-content app: set every CONFIGURABLE safety filter to OFF (the most
      // permissive value) so suggestive/explicit-adult text is never blocked on
      // probability. NOTE: this only covers the four adjustable categories below.
      // Gemini's core, NON-configurable protections (most importantly child
      // safety) can never be turned off by any threshold — if generation is
      // blocked with these already OFF, the cause is either one of those core
      // protections (e.g. content that reads as sexualizing minors) or a
      // non-safety issue (MAX_TOKENS, parse), which the error detail will show.
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      ],
    };

    let { ok, status, data: d } = await callModel(MODEL, 'global', projectId, token, body);

    if (!ok) {
      const msg = d.error?.message || JSON.stringify(d).slice(0, 200);
      return res.status(status).json({ error: `Gemini (${MODEL}): ${msg}` });
    }

    const text = extractText(d);
    if (!text) {
      const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
      const promptBlock = d.promptFeedback?.blockReason;
      // Surface the blocked safety category when present, so the client error
      // is actionable instead of just "no response".
      const blockedCat = (d.candidates?.[0]?.safetyRatings || [])
        .filter(r => r.blocked)
        .map(r => r.category?.replace('HARM_CATEGORY_', ''))
        .join(', ');
      const detail = promptBlock
        ? `prompt bloqueado: ${promptBlock}`
        : `finishReason: ${reason}${blockedCat ? ` (${blockedCat})` : ''}`;
      return res.status(500).json({ error: `Gemini sin respuesta [${detail}] (${MODEL})` });
    }

    return res.status(200).json({ text, model: MODEL });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
