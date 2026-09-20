// ════════════════════════════════════════════════════════════════
// UPLOAD URL — mints V4 signed PUT URLs so the browser uploads the
// episode's assets straight to GCS.
//
// An episode can carry 144 images plus audio, music and subtitles.
// None of that can travel through a Vercel function (body limits,
// 60s), so the browser uploads directly and the Cloud Run job reads
// the objects from the bucket with its own identity.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, getAccessToken, signedUrl, asegurarCors, auth, gcsUpload, gcsReadText, gcsList, gcsDelete, begin, fail } = require('./_lib/gcp');

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


function safeProjectId(v) {
  const id = String(v || '').trim();
  return /^p[a-zA-Z0-9_-]{5,80}$/.test(id) ? id : null;
}
function safeCacheKey(v) {
  const key = String(v || '').trim();
  return /^[a-zA-Z0-9_.-]{3,220}$/.test(key) ? key : null;
}
const manifestRoot = () => `${cfg.prefix}/project-manifests`;
const projectRoot = id => `${cfg.prefix}/projects/${id}`;
const manifestPath = id => `${manifestRoot()}/${id}.json`;
const cachePath = (id, key) => `${projectRoot(id)}/cache/${key}.txt`;

async function readProjectManifest(token, id) {
  const raw = await gcsReadText(token, cfg.bucket, manifestPath(id));
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    return m && m.id === id && m.data ? m : null;
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const body = req.body || {};
    const action = String(body.action || '').trim();

    // Cloud project storage shares this existing storage endpoint so the Hobby
    // deployment stays within Vercel's 12-function limit.
    if (action) {
      if (!cfg.bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });

      if (action === 'projectList') {
        const { token } = await auth();
        const objects = await gcsList(token, cfg.bucket, manifestRoot() + '/');
        const ids = [...new Set(objects
          .map(x => String(x.name || ''))
          .filter(n => n.startsWith(manifestRoot() + '/') && /\.json$/.test(n))
          .map(n => n.slice((manifestRoot() + '/').length, -5))
          .filter(safeProjectId))];
        const projects = [];
        for (let i = 0; i < ids.length; i += 10) {
          const found = await Promise.all(ids.slice(i, i + 10).map(id => readProjectManifest(token, id)));
          for (const m of found) if (m) projects.push({
            id:m.id,
            name:m.name || m.data?.universe?.title || 'Proyecto',
            updated:Number(m.updated || 0) || 0,
            created:Number(m.created || 0) || 0,
          });
        }
        projects.sort((a,b) => (b.updated || 0) - (a.updated || 0));
        return res.status(200).json({ projects });
      }

      if (action === 'projectGet') {
        const id = safeProjectId(body.id);
        if (!id) return res.status(400).json({ error:'project id inválido' });
        const { token } = await auth();
        const project = await readProjectManifest(token, id);
        if (!project) return res.status(404).json({ error:'Proyecto no encontrado en el bucket' });
        return res.status(200).json({ project });
      }

      if (action === 'projectSave') {
        const id = safeProjectId(body.id);
        const data = body.data;
        if (!id || !data || typeof data !== 'object') return res.status(400).json({ error:'id/data inválidos' });
        const { token } = await auth();
        const existing = await readProjectManifest(token, id);
        const now = Date.now();
        const manifest = {
          version:1, id,
          name:String(body.name || data?.universe?.title || existing?.name || 'Proyecto').slice(0,200),
          created:Number(body.created || existing?.created || now) || now,
          updated:Number(body.updated || now) || now,
          data,
        };
        const raw = JSON.stringify(manifest);
        if (Buffer.byteLength(raw, 'utf8') > 3.5 * 1024 * 1024) {
          return res.status(413).json({ error:'project.json demasiado grande; el estado no debe contener medios binarios' });
        }
        await gcsUpload(token, cfg.bucket, manifestPath(id), raw, 'application/json; charset=utf-8');
        return res.status(200).json({ ok:true, project:{ id, name:manifest.name, created:manifest.created, updated:manifest.updated } });
      }

      if (action === 'projectDelete') {
        const id = safeProjectId(body.id);
        if (!id) return res.status(400).json({ error:'project id inválido' });
        const { token } = await auth();
        const objects = await gcsList(token, cfg.bucket, projectRoot(id) + '/');
        let deleted = 0;
        for (let i = 0; i < objects.length; i += 20) {
          const rr = await Promise.all(objects.slice(i, i + 20).map(o => gcsDelete(token, cfg.bucket, o.name)));
          deleted += rr.filter(Boolean).length;
        }
        if (await gcsDelete(token, cfg.bucket, manifestPath(id))) deleted++;
        return res.status(200).json({ ok:true, deleted });
      }

      if (action === 'assetList') {
        const id = safeProjectId(body.projectId);
        if (!id) return res.status(400).json({ error:'projectId inválido' });
        const prefix = projectRoot(id) + '/cache/';
        const { token } = await auth();
        const objects = await gcsList(token, cfg.bucket, prefix);
        const keys = objects.map(o => String(o.name || ''))
          .filter(n => n.startsWith(prefix) && n.endsWith('.txt'))
          .map(n => n.slice(prefix.length, -4))
          .filter(safeCacheKey);
        return res.status(200).json({ keys });
      }

      if (action === 'assetDelete') {
        const id = safeProjectId(body.projectId), key = safeCacheKey(body.key);
        if (!id || !key) return res.status(400).json({ error:'projectId/key inválidos' });
        const { token } = await auth();
        const deleted = await gcsDelete(token, cfg.bucket, cachePath(id, key));
        return res.status(200).json({ ok:true, deleted });
      }

      if (action === 'assetSign') {
        const id = safeProjectId(body.projectId), key = safeCacheKey(body.key);
        const method = String(body.method || 'GET').toUpperCase();
        if (!id || !key || !['GET','PUT'].includes(method)) return res.status(400).json({ error:'projectId/key/method inválidos' });
        const sa = loadServiceAccount();
        if (method === 'PUT') {
          try {
            const token = await getAccessToken(sa);
            const cors = await asegurarCors(token, cfg.bucket);
            if (!cors.ok) console.warn('CORS project asset:', cors.error);
          } catch (e) { console.warn('CORS project asset:', e.message); }
        }
        return res.status(200).json({
          path:cachePath(id, key),
          url:signedUrl(sa, cfg.bucket, cachePath(id, key), { method, expiresSeconds:method === 'PUT' ? 3600 : 6 * 3600 }),
        });
      }

      return res.status(400).json({ error:'action desconocida' });
    }

    const { paths, contentType } = body;
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
