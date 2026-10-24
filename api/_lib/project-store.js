// Project manifests (project-manifests/<id>.json) in GCS.
//
// Every read returns the object's generation and every write is conditional on
// the generation the device last saw. A late request, a second tab or the
// Home-Screen copy with old state can no longer land over newer work: the save
// gets 409 and the app asks what to keep. Only a real 404 means "absent"; any
// other read failure is an error, never an empty or missing project.
const { cfg, gcsList } = require('./gcp');
const { preserveManifest } = require('./project-recovery');

const MAX_BYTES = 3.5 * 1024 * 1024;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const validId = id => /^p[a-zA-Z0-9_-]{5,80}$/.test(id);
const manifestRoot = () => `${cfg.prefix}/project-manifests`;
const manifestPath = id => `${manifestRoot()}/${id}.json`;
const objectUrl = (id, params) => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o/`
  + `${encodeURIComponent(manifestPath(id))}?${new URLSearchParams(params)}`;
const error = (status, message, extra) => Object.assign(new Error(message), { status }, extra);

// One GCS request, retried once when Google answers with a transient status.
async function gcs(token, url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok || r.status === 404 || r.status === 412 || attempt >= 1 || !RETRYABLE.has(r.status)) return r;
    await new Promise(done => setTimeout(done, 400));
  }
}

function parse(raw, id) {
  try {
    const m = JSON.parse(raw);
    return m && m.id === id && m.data && typeof m.data === 'object' ? m : null;
  } catch (_) { return null; }
}

// The manifest with its generation: { manifest, generation }. A missing object
// is { manifest:null, generation:'0' } ('0' = "must not exist yet" for GCS).
async function readManifest(token, id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await gcs(token, objectUrl(id, { fields: 'generation' }), { cache: 'no-store' });
    if (meta.status === 404) return { manifest: null, generation: '0' };
    if (!meta.ok) throw error(meta.status, `No se pudo leer el proyecto en Google Cloud (${meta.status}).`);
    const { generation } = await meta.json();
    // Read exactly that generation, so content and version always match.
    const body = await gcs(token, objectUrl(id, { alt: 'media', generation }), { cache: 'no-store' });
    if (body.status === 404) continue; // replaced between both requests: read again
    if (!body.ok) throw error(body.status, `No se pudo leer el proyecto en Google Cloud (${body.status}).`);
    return { manifest: parse(await body.text(), id), generation: String(generation) };
  }
  throw error(409, 'El proyecto está cambiando ahora mismo en otro dispositivo. Vuelve a intentarlo.');
}

async function getProject(token, id) {
  if (!validId(id)) throw error(400, 'project id inválido');
  const { manifest, generation } = await readManifest(token, id);
  if (!manifest) throw error(404, 'Proyecto no encontrado en el bucket');
  return { project: manifest, generation };
}

// Summaries of every manifest. A manifest that cannot be read right now is
// reported in `unreadable` instead of silently disappearing from the list.
async function listProjects(token) {
  const prefix = manifestRoot() + '/';
  const objects = await gcsList(token, cfg.bucket, prefix);
  const ids = [...new Set(objects
    .map(x => String(x.name || ''))
    .filter(n => n.startsWith(prefix) && /\.json$/.test(n))
    .map(n => n.slice(prefix.length, -5))
    .filter(validId))];
  const projects = [], unreadable = [];
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async id => {
      try {
        const r = await gcs(token, objectUrl(id, { alt: 'media' }), { cache: 'no-store' });
        if (r.status === 404) return; // deleted after the listing
        if (!r.ok) throw error(r.status, String(r.status));
        const m = parse(await r.text(), id);
        if (!m) throw error(422, 'formato');
        projects.push({
          id: m.id,
          name: m.name || m.data?.universe?.title || 'Proyecto',
          updated: Number(m.updated || 0) || 0,
          created: Number(m.created || 0) || 0,
        });
      } catch (e) {
        console.warn('[animes:project-list]', id, e.message);
        unreadable.push(id);
      }
    }));
  }
  projects.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return { projects, unreadable };
}

// body: { id, data, name, created, updated, baseGeneration?, force? }
// baseGeneration is the version this device last read or wrote. Without it
// (pages cached before this change) a save can still not go back in time.
async function saveProject(token, id, body) {
  const data = body.data;
  if (!validId(id) || !data || typeof data !== 'object' || Array.isArray(data)) throw error(400, 'id/data inválidos');
  const { manifest: existing, generation } = await readManifest(token, id);
  const conflict = current => error(409, 'Este proyecto cambió en otro dispositivo o pestaña después de abrirlo aquí.', {
    conflict: true, generation: current, updated: Number(existing?.updated || 0) || 0,
  });
  if (!body.force) {
    const base = body.baseGeneration;
    if (base !== undefined && base !== null && String(base) !== generation) throw conflict(generation);
    if ((base === undefined || base === null) && existing && body.updated
      && Number(body.updated) < Number(existing.updated || 0)) throw conflict(generation);
  }
  const now = Date.now();
  const manifest = {
    version: 1, id,
    name: String(body.name || data?.universe?.title || existing?.name || 'Proyecto').slice(0, 200),
    created: Number(body.created || existing?.created || now) || now,
    updated: Number(body.updated || now) || now,
    data,
  };
  const raw = JSON.stringify(manifest);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    throw error(413, 'project.json demasiado grande; el estado no debe contener medios binarios');
  }
  // The version being replaced is kept in history/ (Revisar copias guardadas).
  if (generation !== '0') await preserveManifest(token, id, existing);
  const q = new URLSearchParams({ uploadType: 'media', name: manifestPath(id), ifGenerationMatch: generation });
  const r = await gcs(token, `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: raw,
  });
  // Another save landed between our read and this write.
  if (r.status === 412) throw conflict(null);
  if (!r.ok) throw error(r.status, `No se pudo guardar el proyecto en Google Cloud (${r.status}).`);
  const written = await r.json().catch(() => ({}));
  return {
    id, name: manifest.name, created: manifest.created, updated: manifest.updated,
    generation: written.generation ? String(written.generation) : null,
  };
}

module.exports = { readManifest, getProject, listProjects, saveProject };
