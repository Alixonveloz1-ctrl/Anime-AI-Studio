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

  // Which APIs are actually enabled on the project.
  //
  // This replaced a probe that listed publisher models under
  // projects/*/locations/*/publishers/google/models — a path that is not valid
  // for that collection, so it failed even on healthy projects and reported a
  // red "Vertex AI — error" with no detail. Asking Service Usage answers the
  // real question ("is this API turned on?") instead of guessing from a call.
  const SERVICIOS = [
    ['aiplatform.googleapis.com',   'Vertex AI',      'guiones, imágenes, video y música'],
    ['storage.googleapis.com',      'Cloud Storage',  'bucket y montaje'],
    ['speech.googleapis.com',       'Speech-to-Text', 'subtítulos con timing exacto'],
    ['texttospeech.googleapis.com', 'Cloud TTS',      'solo para las voces Neural2/WaveNet'],
    ['run.googleapis.com',          'Cloud Run',      'montaje del MP4'],
  ];
  out.services = [];
  for (const [id, nombre, para] of SERVICIOS) {
    try {
      const r = await fetch(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${id}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // A 403 here means the service account cannot READ the API list, which
        // says nothing about whether the API works. Do not call that a failure.
        out.services.push({ id, nombre, para, state: 'desconocido',
          note: r.status === 403 ? 'sin permiso para consultarlo (roles/serviceusage.serviceUsageConsumer)' : `consulta ${r.status}` });
      } else {
        out.services.push({ id, nombre, para, state: d.state === 'ENABLED' ? 'habilitada' : 'apagada' });
      }
    } catch (e) {
      out.services.push({ id, nombre, para, state: 'desconocido', note: e.message.slice(0, 120) });
    }
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
        // Always carry the status and a body snippet: "error" on its own is
        // unactionable, especially from a phone.
        out.checks.bucket = { ok: false, status: r.status,
          error: `${r.status} — ${(d.error?.message || JSON.stringify(d) || 'sin detalle').slice(0, 180)}` };
      }
    } catch (e) {
      out.checks.bucket = { ok: false, error: e.message };
    }
  }

  return res.status(200).json(out);
};
