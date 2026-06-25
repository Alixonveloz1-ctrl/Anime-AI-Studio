// ════════════════════════════════════════════════════════════════
// VIDEO START — Veo 3.1 via Vertex AI (Node.js runtime — uses crypto)
// Starts async video generation and returns operationName for polling
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const MODEL_ID = 'veo-3.1-lite-generate-001'; // must match video-status.js exactly
const LOCATION  = 'us-central1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${signingInput}.${sig}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imageA, imageB } = req.body; // imageA = the specific image for this video
    if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

    const saRaw = process.env.GCP_SERVICE_ACCOUNT;
    const bucket = (process.env.GCS_OUTPUT_BUCKET || '').trim().replace(/\/+$/, '');
    if (!saRaw) return res.status(500).json({ error: 'GCP_SERVICE_ACCOUNT no configurado en Vercel' });
    if (!bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel' });

    const sa = JSON.parse(saRaw.trim());
    const projectId = sa.project_id;
    const token = await getGoogleToken(sa);

    // Single reference image (Veo 3.1 Lite uses image field, not referenceImages array)
    const imageData = (imageA || imageB || '').replace(/\s/g, '');

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predictLongRunning`;

    const body = {
      instances: [{
        prompt,
        ...(imageData ? { image: { bytesBase64Encoded: imageData, mimeType: 'image/png' } } : {}),
      }],
      parameters: {
        aspectRatio: '9:16',
        sampleCount: 1,
        durationSeconds: 8,
        storageUri: `gs://${bucket}/veo-outputs/`,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || data.error?.status || JSON.stringify(data).slice(0, 200);
      return res.status(response.status).json({ error: `Veo: ${msg}` });
    }
    if (!data.name) return res.status(500).json({ error: 'Veo no devolvió operationName' });

    return res.status(200).json({ operationName: data.name, projectId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
