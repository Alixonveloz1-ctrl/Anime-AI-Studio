// ════════════════════════════════════════════════════════════════
// UPLOAD URL — mints V4 signed PUT URLs so the browser uploads the
// episode's assets straight to GCS.
//
// An episode can carry 144 images plus audio, music and subtitles.
// None of that can travel through a Vercel function (body limits,
// 60s), so the browser uploads directly and the Cloud Run job reads
// the objects from the bucket with its own identity.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, getAccessToken, signedUrl, asegurarCors, begin, fail } = require('./_lib/gcp');

// Object paths come from the client, so they are constrained here: no
// traversal, no absolute paths, and everything under a known prefix.
function safePath(p) {
  const clean = String(p || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .replace(/[^\w./-]/g, '_');
  // Anything this app writes must stay inside its own prefix, so a bucket
  // shared with other projects can never be written outside it.
  return clean.startsWith(cfg.prefix + '/') ? clean : null;
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

    // A signed PUT carrying a Content-Type is preflighted by the browser, so the
    // bucket has to allow PUT. Guaranteed HERE, right before the upload, because
    // this endpoint is the one that needs it — leaving it to whoever happened to
    // set CORS last is how finishing a Veo clip silently broke the montage.
    // It is reported rather than thrown: the URLs are valid either way, and a
    // bucket already configured by hand should not fail for lack of permission
    // to re-set what is already right.
    //
    // Firmar no necesita red — la clave privada firma aquí mismo — y esto sí.
    // Así que va envuelto: un token que no se puede pedir NO puede impedir que
    // se entreguen unas URLs que son válidas igual.
    let cors = { ok: true };
    try {
      cors = await asegurarCors(await getAccessToken(sa), cfg.bucket);
    } catch (e) {
      cors = { ok: false, error: e.message };
    }

    return res.status(200).json({
      bucket: cfg.bucket, contentType: contentType || 'application/octet-stream', urls,
      corsWarning: cors.ok ? undefined
        : `No se pudo asegurar el CORS del bucket (${cors.error}). Si la subida falla con "Load failed", `
          + `dale a la service account el permiso storage.buckets.update o configura el CORS del bucket a mano con PUT permitido.`,
    });
  } catch (e) {
    return fail(res, e);
  }
};
