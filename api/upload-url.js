// ════════════════════════════════════════════════════════════════
// UPLOAD URL — mints V4 signed PUT URLs so the browser uploads the
// episode's assets straight to GCS.
//
// An episode can carry 144 images plus audio, music and clips. None
// of that can travel through a Vercel function (body limits, 60s),
// so the browser uploads directly and the assembly service reads the
// objects from the bucket with its own identity.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, signedUrl, begin, fail } = require('./_lib/gcp');

// Object paths come from the client, so they are constrained here: no
// traversal, no absolute paths, and everything under a known prefix.
function safePath(p) {
  const clean = String(p || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .replace(/[^\w./-]/g, '_');
  return clean.startsWith('ensamblaje/') ? clean : null;
}

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { paths, contentType } = req.body || {};
    if (!Array.isArray(paths) || !paths.length) {
      return res.status(400).json({ error: 'paths requerido (array)' });
    }
    if (paths.length > 500) {
      return res.status(400).json({ error: 'demasiados objetos en una sola petición (máx 500)' });
    }
    if (!cfg.bucket) {
      return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });
    }

    const sa = loadServiceAccount();
    const urls = [];
    for (const p of paths) {
      const objectPath = safePath(p);
      if (!objectPath) return res.status(400).json({ error: `ruta no permitida: ${p}` });
      urls.push({
        path: objectPath,
        url: signedUrl(sa, cfg.bucket, objectPath, { method: 'PUT', expiresSeconds: 3600 }),
      });
    }

    return res.status(200).json({ bucket: cfg.bucket, contentType: contentType || 'application/octet-stream', urls });
  } catch (e) {
    return fail(res, e);
  }
};
