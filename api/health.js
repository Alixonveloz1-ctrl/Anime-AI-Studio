// ════════════════════════════════════════════════════════════════
// HEALTH — read-only diagnostic: which Google Cloud account and
// bucket is this deployment actually using?
//
// Exists so switching GCP accounts can be verified from the app
// itself instead of digging through the Vercel dashboard. It never
// returns the private key, and it never returns the raw service
// account JSON — only the identifying fields.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// bot-anime@my-project.iam.gserviceaccount.com → bot-a…me@my-project.iam.gserviceaccount.com
function maskEmail(email) {
  const at = String(email || '').indexOf('@');
  if (at < 0) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 6) return local[0] + '…' + domain;
  return local.slice(0, 5) + '…' + local.slice(-2) + domain;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${sig}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || d.error || 'sin access_token');
  return d.access_token;
}

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const out = {
    serviceAccount: { configured: false },
    bucket:         { configured: false },
    checks:         {},
  };

  // ─── GCP_SERVICE_ACCOUNT ───
  const saRaw = (process.env.GCP_SERVICE_ACCOUNT || '').trim();
  if (!saRaw) {
    out.serviceAccount.error = 'GCP_SERVICE_ACCOUNT no configurado en Vercel';
    return res.status(200).json(out);
  }

  let sa;
  try {
    sa = JSON.parse(saRaw);
  } catch (e) {
    out.serviceAccount.error = 'GCP_SERVICE_ACCOUNT no es JSON válido — pega el archivo completo de la service account, sin comillas extra';
    return res.status(200).json(out);
  }

  out.serviceAccount = {
    configured:   true,
    projectId:    sa.project_id || null,
    clientEmail:  maskEmail(sa.client_email),
    hasPrivateKey: typeof sa.private_key === 'string' && sa.private_key.includes('PRIVATE KEY'),
  };
  if (!sa.project_id)     out.serviceAccount.error = 'el JSON no tiene project_id';
  if (!out.serviceAccount.hasPrivateKey) out.serviceAccount.error = 'el JSON no tiene private_key válida';

  // ─── GCS_OUTPUT_BUCKET ───
  const bucket = (process.env.GCS_OUTPUT_BUCKET || '').trim().replace(/\/+$/, '');
  out.bucket = bucket
    ? { configured: true, name: bucket.replace(/^gs:\/\//, ''), warning: bucket.startsWith('gs://') ? 'quita el prefijo gs:// — se espera solo el nombre del bucket' : undefined }
    : { configured: false, error: 'GCS_OUTPUT_BUCKET no configurado — la generación de video fallará' };

  // ─── Live checks: credentials, Vertex AI, bucket access ───
  let token = null;
  try {
    token = await getAccessToken(sa);
    out.checks.credentials = { ok: true };
  } catch (e) {
    out.checks.credentials = { ok: false, error: `no se pudo obtener token: ${e.message}` };
    return res.status(200).json(out);
  }

  const projectId = sa.project_id;

  // Vertex AI reachable + enabled for this project
  try {
    const r = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId } },
    );
    if (r.ok) out.checks.vertexAI = { ok: true };
    else {
      const d = await r.json().catch(() => ({}));
      out.checks.vertexAI = { ok: false, status: r.status, error: (d.error?.message || 'error').slice(0, 200) };
    }
  } catch (e) {
    out.checks.vertexAI = { ok: false, error: e.message };
  }

  // Bucket exists and the service account can read its metadata
  if (out.bucket.configured) {
    try {
      const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${out.bucket.name}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId },
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        out.checks.bucket = { ok: true, location: d.location || null, sameProject: true };
      } else {
        out.checks.bucket = { ok: false, status: r.status, error: (d.error?.message || 'error').slice(0, 200) };
      }
    } catch (e) {
      out.checks.bucket = { ok: false, error: e.message };
    }
  }

  return res.status(200).json(out);
};
