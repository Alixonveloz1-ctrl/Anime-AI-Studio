// ════════════════════════════════════════════════════════════════
// PROJECT ASSET — signed access to the bucket mirror of IndexedDB values.
//
// The browser keeps only a cache. Every generated media/runtime value is mirrored:
//   <prefix>/projects/<projectId>/cache/<indexedDbKey>.txt
//
// POST   {projectId,key,method:"GET"|"PUT"} -> signed URL
// DELETE {projectId,key}                    -> remove remote cached object
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, auth, signedUrl, asegurarCors, gcsDelete, begin, fail } = require('./_lib/gcp');

function safeProjectId(v) {
  const id = String(v || '').trim();
  return /^p[a-zA-Z0-9_-]{5,80}$/.test(id) ? id : null;
}
function safeKey(v) {
  const key = String(v || '').trim();
  return /^[a-zA-Z0-9_.-]{3,220}$/.test(key) ? key : null;
}
function objectPath(projectId, key) {
  return `${cfg.prefix}/projects/${projectId}/cache/${key}.txt`;
}

module.exports = async function handler(req, res) {
  if (begin(req, res, ['POST', 'DELETE'])) return;
  try {
    if (!cfg.bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado', configError: true });
    const projectId = safeProjectId(req.body?.projectId);
    const key = safeKey(req.body?.key);
    if (!projectId || !key) return res.status(400).json({ error: 'projectId/key inválidos' });
    const path = objectPath(projectId, key);

    if (req.method === 'DELETE') {
      const { token } = await auth();
      const deleted = await gcsDelete(token, cfg.bucket, path);
      return res.status(200).json({ ok: true, deleted });
    }

    const method = String(req.body?.method || 'GET').toUpperCase();
    if (!['GET', 'PUT'].includes(method)) return res.status(400).json({ error: 'method debe ser GET o PUT' });
    const sa = loadServiceAccount();

    if (method === 'PUT') {
      // Ensure the bucket permits browser PUT before returning the URL.
      try {
        const { token } = await auth();
        const cors = await asegurarCors(token, cfg.bucket);
        if (!cors.ok) console.warn('CORS project asset:', cors.error);
      } catch (e) {
        console.warn('CORS project asset:', e.message);
      }
    }

    return res.status(200).json({
      path,
      url: signedUrl(sa, cfg.bucket, path, {
        method,
        expiresSeconds: method === 'PUT' ? 3600 : 6 * 3600,
      }),
    });
  } catch (e) {
    return fail(res, e);
  }
};
