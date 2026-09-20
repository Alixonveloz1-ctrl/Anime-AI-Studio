// ════════════════════════════════════════════════════════════════
// PROJECT STORE — Google Cloud Storage is the permanent source of truth.
//
// localStorage/IndexedDB are only device caches. Every project has one manifest:
//   <prefix>/projects/<projectId>/project.json
//
// GET    /api/project-store           -> list cloud projects
// GET    /api/project-store?id=p...   -> full project manifest
// POST   /api/project-store           -> save/replace manifest
// DELETE /api/project-store           -> delete the entire project prefix
// ════════════════════════════════════════════════════════════════
const { cfg, auth, gcsUpload, gcsReadText, gcsList, gcsDelete, begin, fail } = require('./_lib/gcp');

function safeProjectId(v) {
  const id = String(v || '').trim();
  return /^p[a-zA-Z0-9_-]{5,80}$/.test(id) ? id : null;
}
const root = () => `${cfg.prefix}/projects`;
const manifestPath = id => `${root()}/${id}/project.json`;

async function readManifest(token, id) {
  const raw = await gcsReadText(token, cfg.bucket, manifestPath(id));
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    if (!m || m.id !== id || !m.data) return null;
    return m;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (begin(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    if (!cfg.bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado', configError: true });
    const { token } = await auth();

    if (req.method === 'GET') {
      const id = safeProjectId(req.query?.id);
      if (req.query?.id && !id) return res.status(400).json({ error: 'project id inválido' });

      if (id) {
        const manifest = await readManifest(token, id);
        if (!manifest) return res.status(404).json({ error: 'Proyecto no encontrado en el bucket' });
        return res.status(200).json({ project: manifest });
      }

      // GCS listing is the authoritative project index. No browser/device index
      // is needed, so a new phone sees every project immediately.
      const objects = await gcsList(token, cfg.bucket, root() + '/');
      const ids = [...new Set(objects
        .map(x => String(x.name || ''))
        .filter(n => /\/project\.json$/.test(n))
        .map(n => n.split('/').slice(-2, -1)[0])
        .filter(safeProjectId))];

      const projects = [];
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        const found = await Promise.all(chunk.map(pid => readManifest(token, pid)));
        for (const m of found) {
          if (!m) continue;
          projects.push({
            id: m.id,
            name: m.name || m.data?.universe?.title || 'Proyecto',
            updated: Number(m.updated || 0) || 0,
            created: Number(m.created || 0) || 0,
          });
        }
      }
      projects.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      return res.status(200).json({ projects });
    }

    if (req.method === 'POST') {
      const id = safeProjectId(req.body?.id);
      if (!id) return res.status(400).json({ error: 'project id inválido' });
      const data = req.body?.data;
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data requerido' });

      const existing = await readManifest(token, id);
      const now = Date.now();
      const manifest = {
        version: 1,
        id,
        name: String(req.body?.name || data?.universe?.title || existing?.name || 'Proyecto').slice(0, 200),
        created: Number(req.body?.created || existing?.created || now) || now,
        updated: Number(req.body?.updated || now) || now,
        data,
      };
      const body = JSON.stringify(manifest);
      if (Buffer.byteLength(body, 'utf8') > 3.5 * 1024 * 1024) {
        return res.status(413).json({ error: 'project.json demasiado grande; el estado no debe contener medios binarios' });
      }
      await gcsUpload(token, cfg.bucket, manifestPath(id), body, 'application/json; charset=utf-8');
      return res.status(200).json({ ok: true, project: { id, name: manifest.name, created: manifest.created, updated: manifest.updated } });
    }

    const id = safeProjectId(req.body?.id);
    if (!id) return res.status(400).json({ error: 'project id inválido' });
    const prefix = `${root()}/${id}/`;
    const objects = await gcsList(token, cfg.bucket, prefix);
    let deleted = 0;
    for (let i = 0; i < objects.length; i += 20) {
      const results = await Promise.all(objects.slice(i, i + 20).map(o => gcsDelete(token, cfg.bucket, o.name)));
      deleted += results.filter(Boolean).length;
    }
    return res.status(200).json({ ok: true, deleted });
  } catch (e) {
    return fail(res, e);
  }
};
