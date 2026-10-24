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
  if (await begin(req, res)) return;

  try {
    const body = req.body || {};
    const action = String(body.action || '').trim();

    // Cloud project storage shares this existing storage endpoint so the Hobby
    // deployment stays within Vercel's 12-function limit.
    if (action) {
      if (!cfg.bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });

      // Project manifests: listing, reading and conditional saves live in
      // _lib/project-store.js (tests/recovery/project-store.test.cjs).
      if (action === 'projectList' || action === 'projectGet' || action === 'projectSave') {
        const store = require('./_lib/project-store');
        const { token } = await auth();
        try {
          if (action === 'projectList') return res.status(200).json(await store.listProjects(token));
          if (action === 'projectGet') {
            const found = await store.getProject(token, safeProjectId(body.id) || '');
            const project = found.project;
            // Load diagnostics contain counts only, never story text or media URLs.
            console.info('[animes:project-load]', JSON.stringify({id:project.id, dataType:typeof project.data, universe:!!project.data?.universe, characters:Array.isArray(project.data?.characters)?project.data.characters.length:0, currentEpisode:project.data?.currentEpisode||1, episodes:Object.fromEntries(Object.entries(project.data?.episodes||{}).map(([key,value])=>[key,Array.isArray(value)?value.length:0])), legacyScenes:Array.isArray(project.data?.scenes)?project.data.scenes.length:0}));
            return res.status(200).json(found);
          }
          const project = await store.saveProject(token, safeProjectId(body.id) || '', body);
          return res.status(200).json({ ok:true, project });
        } catch (e) {
          if (!e.status) throw e;
          return res.status(e.status).json({ error:e.message, conflict:!!e.conflict, generation:e.generation, updated:e.updated });
        }
      }

      // Owner-only metadata recovery; existing generation endpoints are unchanged.
      if (action === 'projectRecovery' || action === 'projectRecover') {
        const id = safeProjectId(body.id);
        if (!id) return res.status(400).json({ error:'project id inválido' });
        const { token } = await auth();
        const recovery = require('./_lib/project-recovery');
        try {
          if (action === 'projectRecover') {
            const project = await recovery.restoreProject(token, id, body.key, body.expectedGeneration);
            return res.status(200).json({ project });
          }
          const project = await readProjectManifest(token, id);
          if (!project) return res.status(404).json({ error:'Proyecto no encontrado en el bucket' });
          return res.status(200).json(await recovery.inspectProject(token, id, project));
        } catch (e) { return res.status(e.status === 412 ? 409 : e.status || 500).json({ error:e.message }); }
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

        // The cache entry for an image now contains only a gs:// pointer. Delete
        // the pointed binary too, otherwise regenerating an episode would leave
        // orphaned media in the bucket.
        const raw = await gcsReadText(token, cfg.bucket, cachePath(id, key));
        let mediaDeleted = false;
        if (raw && String(raw).startsWith(`gs://${cfg.bucket}/${cfg.prefix}/`)) {
          const objectPath = String(raw).slice(`gs://${cfg.bucket}/`.length);
          mediaDeleted = await gcsDelete(token, cfg.bucket, objectPath);
        }
        const deleted = await gcsDelete(token, cfg.bucket, cachePath(id, key));
        return res.status(200).json({ ok:true, deleted, mediaDeleted });
      }

      if (action === 'mediaSign') {
        const id = safeProjectId(body.projectId), key = safeCacheKey(body.key);
        const method = String(body.method || 'PUT').toUpperCase();
        const mime = String(body.mime || 'image/png').toLowerCase();
        if (!id || !key || !['GET','PUT'].includes(method)) {
          return res.status(400).json({ error:'projectId/key/method inválidos' });
        }
        const ext = /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png';
        const objectPath = `${projectRoot(id)}/media/${key}.${ext}`;
        const sa = loadServiceAccount();
        if (method === 'PUT') {
          try {
            const token = await getAccessToken(sa);
            const cors = await asegurarCors(token, cfg.bucket);
            if (!cors.ok) console.warn('CORS media asset:', cors.error);
          } catch (e) { console.warn('CORS media asset:', e.message); }
        }
        return res.status(200).json({
          path: objectPath,
          gcsUri: `gs://${cfg.bucket}/${objectPath}`,
          url: signedUrl(sa, cfg.bucket, objectPath, { method, expiresSeconds:method === 'PUT' ? 3600 : 6 * 3600 }),
        });
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
