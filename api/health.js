// ════════════════════════════════════════════════════════════════
// HEALTH — read-only diagnostic: which Google Cloud account and
// bucket is this deployment actually using?
//
// Exists so switching GCP accounts can be verified from the app
// itself instead of digging through the Vercel dashboard. It never
// returns the private key, and it never returns the raw service
// account JSON — only the identifying fields.
// ════════════════════════════════════════════════════════════════
const { cfg, imageModelLocation, loadServiceAccount, getAccessToken, begin } = require('./_lib/gcp');

// bot-anime@my-project.iam.gserviceaccount.com → bot-a…me@my-project.iam.gserviceaccount.com
function maskEmail(email) {
  const at = String(email || '').indexOf('@');
  if (at < 0) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 6) return local[0] + '…' + domain;
  return local.slice(0, 5) + '…' + local.slice(-2) + domain;
}

module.exports = async function handler(req, res) {
  if (begin(req, res, ['GET', 'POST'])) return;

  const out = {
    serviceAccount: { configured: false },
    bucket:         { configured: false },
    // Every model and region in use, and the env var that overrides each —
    // so a project without allowlist for one of them can be pointed at
    // another without touching code.
    config: {
      scriptModel:  { value: cfg.scriptModel,  env: 'SCRIPT_MODEL',  location: cfg.scriptLocation },
      imageModel:   { value: cfg.imageModel,   env: 'IMAGE_MODEL',   location: imageModelLocation(cfg.imageModel), regions: cfg.imageRegions },
      ttsModel:     { value: cfg.ttsModel,     env: 'TTS_MODEL',     location: cfg.ttsLocation, fallback: cfg.ttsFallback },
      veoModel:     { value: cfg.veoModel,     env: 'VEO_MODEL',     location: cfg.veoLocation },
      musicModel:   { value: cfg.musicModel,   env: 'MUSIC_MODEL',   location: cfg.musicLocation },
      sttModel:     { value: cfg.sttModel,     env: 'STT_MODEL',     language: cfg.sttLanguage },
    },
    checks:         {},
  };

  // ─── GCP_SERVICE_ACCOUNT ───
  let sa;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    out.serviceAccount.error = e.message;
    return res.status(200).json(out);
  }

  out.serviceAccount = {
    configured:    true,
    projectId:     sa.project_id,
    clientEmail:   maskEmail(sa.client_email),
    hasPrivateKey: String(sa.private_key).includes('PRIVATE KEY'),
  };
  if (!out.serviceAccount.hasPrivateKey) out.serviceAccount.error = 'el JSON no tiene una private_key válida';

  // ─── GCS_OUTPUT_BUCKET ───
  const bucketRaw = (process.env.GCS_OUTPUT_BUCKET || '').trim();
  out.bucket = cfg.bucket
    ? { configured: true, name: cfg.bucket, warning: bucketRaw.startsWith('gs://') ? 'quita el prefijo gs:// — se espera solo el nombre del bucket' : undefined }
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
      `https://${cfg.location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${cfg.location}/publishers/google/models`,
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
