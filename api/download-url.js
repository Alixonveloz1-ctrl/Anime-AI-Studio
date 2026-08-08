// ════════════════════════════════════════════════════════════════
// DOWNLOAD URL — signed GET link for a finished render.
//
// The bucket is private, so the MP4 is reached with a short-lived
// signed URL minted on demand rather than a link stored anywhere.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, signedUrl, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { gcsUri } = req.body || {};
    if (!gcsUri || !String(gcsUri).startsWith('gs://')) {
      return res.status(400).json({ error: 'gcsUri requerido (gs://…)' });
    }
    if (!cfg.bucket) {
      return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });
    }

    const rest = String(gcsUri).slice('gs://'.length);
    const slash = rest.indexOf('/');
    const bucket = slash > 0 ? rest.slice(0, slash) : rest;
    const objectPath = slash > 0 ? rest.slice(slash + 1) : '';

    // Only ever sign inside this app's own prefix: the URI comes from the
    // client, and the bucket is shared with other projects.
    if (bucket !== cfg.bucket || !objectPath.startsWith(cfg.prefix + '/')) {
      return res.status(400).json({ error: 'La ruta no pertenece a esta herramienta' });
    }

    const sa = loadServiceAccount();
    return res.status(200).json({
      url: signedUrl(sa, bucket, objectPath, { expiresSeconds: 6 * 3600 }),
    });
  } catch (e) {
    return fail(res, e);
  }
};
