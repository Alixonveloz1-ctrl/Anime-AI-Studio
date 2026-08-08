// ════════════════════════════════════════════════════════════════
// VIDEO STATUS — Veo 3.1 polling (Node.js runtime)
// Returns a V4 Signed URL (7 days) — works without public bucket access
// MODEL_ID must match video-start.js exactly
// Migrated off Edge runtime for consistency with the rest of api/ —
// Edge Functions are deprecated on Vercel and hard-cap response-start
// at 25s regardless of maxDuration.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, getAccessToken, vertexUrl, signedUrl, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { operationName, projectId, model } = req.body || {};
    if (!operationName) return res.status(400).json({ error:'operationName requerido' });

    const sa = loadServiceAccount();
    const pid = projectId || sa.project_id;
    const token = await getAccessToken(sa);

    // The operation belongs to the model that started it, so poll THAT model.
    // This used to be hardcoded to the lite model, which broke polling for
    // anyone who picked Veo Fast or Quality in the UI. The client echoes the
    // model back from /api/video-start; fall back to the configured default.
    const modelId = (model || '').trim() || cfg.veoModel;
    const pollUrl = vertexUrl(pid, cfg.veoLocation, modelId, 'fetchPredictOperation');

    const response = await fetch(pollUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': pid },
      body: JSON.stringify({ operationName }),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(response.status).json({ error: `Status check: ${msg}` });
    }

    if (!data.done) return res.status(200).json({ done: false });

    if (data.response?.raiMediaFilteredCount > 0 && !data.response?.videos?.length) {
      return res.status(200).json({ done: true, error: 'Video bloqueado por filtros de seguridad — modifica el prompt' });
    }

    const video = data.response?.videos?.[0];
    if (!video?.gcsUri) {
      return res.status(200).json({ done: true, error: 'Veo terminó pero no devolvió video' });
    }

    const gcsUri = video.gcsUri;
    // Parse gs://bucket/path
    const gcsPath  = gcsUri.replace('gs://', '');
    const slash    = gcsPath.indexOf('/');
    const bucket   = gcsPath.slice(0, slash);
    const objPath  = gcsPath.slice(slash + 1);

    // Set CORS on bucket so browser fetch() works (needed for ZIP and blob download)
    try {
      await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cors: [{ origin: ['*'], method: ['GET', 'HEAD'], responseHeader: ['Content-Type','Content-Length','Content-Range'], maxAgeSeconds: 86400 }]
        }),
      });
    } catch(e) { console.warn('CORS patch:', e.message); }

    // Generate V4 Signed URL — 7 days, no public access needed
    const publicUrl = signedUrl(sa, bucket, objPath, { expiresSeconds: 604800 });

    return res.status(200).json({ done: true, gcsUri, publicUrl });

  } catch (e) {
    return fail(res, e);
  }
};
