// ════════════════════════════════════════════════════════════════
// ASSEMBLE — launches the Cloud Run JOB that renders the final MP4.
//
// It reuses the montador already deployed in this Google Cloud
// account (the one DIEZMO uses). That container carries nothing
// project-specific: it downloads a job folder from the bucket and
// runs whatever ffmpeg script the app put there. So the render logic
// lives here, and nothing new has to be deployed.
//
// Contract expected by the container (montaje/montar.sh):
//   gs://<bucket>/<carpeta>/hoja.json      the spec, for the record
//   gs://<bucket>/<carpeta>/montar.sh      the ffmpeg script it runs
//   gs://<bucket>/<carpeta>/descargas.txt  TSV: gs://origen <TAB> nombre-local
//   gs://<bucket>/<carpeta>/error.txt      emptied at start; the reason on failure
// launched with TRABAJO / PREFIJO / SALIDA as container env overrides.
//
//   POST { manifest }  → { operationName, salida }
//   POST { operationName, episodio } → { done, error? }
//   GET                → { available, job, region }
// ════════════════════════════════════════════════════════════════
const { cfg, auth, gcsUpload, gcsReadText, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res, ['GET', 'POST'])) return;

  try {
    const bucket = cfg.bucket;
    const job = cfg.montajeJob;
    const region = cfg.montajeRegion;

    if (req.method === 'GET') {
      return res.status(200).json({
        available: !!bucket,
        job, region,
        hint: bucket ? null : 'Falta GCS_OUTPUT_BUCKET en Vercel',
      });
    }

    if (!bucket) {
      return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });
    }

    const { manifest, operationName, episodio, projectId: appProject } = req.body || {};
    // Validate before authenticating: a malformed encargo should not cost an
    // OAuth round-trip.
    if (!operationName && (!manifest?.script || !Array.isArray(manifest.descargas) || !manifest.descargas.length)) {
      return res.status(400).json({ error: 'manifest.script y manifest.descargas son requeridos' });
    }
    const { projectId, token } = await auth();

    // ─── Poll ───
    if (operationName) {
      const r = await fetch(`https://run.googleapis.com/v2/${operationName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = await r.text();
      let j = null;
      try { j = JSON.parse(raw); } catch (e) { /* respuesta no-JSON */ }
      if (!r.ok) return res.status(r.status).json({ error: `Montaje: consulta ${r.status}`, detail: raw.slice(0, 500) });

      j = j || {};
      if (!j.done) return res.status(200).json({ done: false });
      if (j.error) {
        // Cloud Run only reports "exit code N". The container writes the real
        // reason into error.txt before dying, which is the only thing readable
        // from a phone — prefer it.
        let motivo = '';
        if (episodio) {
          const nota = await gcsReadText(token, bucket, `${carpetaDe(episodio, appProject)}/error.txt`);
          if (nota) motivo = nota.trim().slice(0, 700);
        }
        return res.status(200).json({
          done: true,
          error: motivo || `${(j.error.message || JSON.stringify(j.error)).slice(0, 400)} — el registro completo está en Cloud Run → Jobs → ${job} → Ejecuciones.`,
        });
      }
      return res.status(200).json({ done: true });
    }

    // ─── Start ───
    const carpeta  = carpetaDe(manifest.episodio, manifest.projectId);
    const material = `${carpeta}/material`;
    const salida   = `${carpeta}/completo.mp4`;

    // TSV, read by a shell loop in the container — no JSON parser needed there.
    // THE TRAILING NEWLINE IS NOT OPTIONAL: shell `read` returns false on a
    // last line without one, silently dropping the final file.
    const lista = manifest.descargas
      .map(d => `gs://${bucket}/${d.origen}\t${d.destino}`)
      .join('\n') + '\n';

    await gcsUpload(token, bucket, `${carpeta}/hoja.json`,
      Buffer.from(JSON.stringify(manifest.hoja || {}, null, 2)), 'application/json');
    await gcsUpload(token, bucket, `${carpeta}/montar.sh`,
      Buffer.from(String(manifest.script)), 'text/x-shellscript');
    await gcsUpload(token, bucket, `${carpeta}/descargas.txt`,
      Buffer.from(lista), 'text/plain');
    // Clear the previous reason, so a run that fails without leaving a note
    // does not inherit the complaint from the last attempt.
    await gcsUpload(token, bucket, `${carpeta}/error.txt`, Buffer.from(''), 'text/plain');

    const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${job}:run`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [{
            env: [
              { name: 'TRABAJO', value: `gs://${bucket}/${carpeta}` },
              { name: 'PREFIJO', value: `gs://${bucket}/${material}` },
              { name: 'SALIDA',  value: `gs://${bucket}/${salida}` },
            ],
          }],
        },
      }),
    });

    const raw = await r.text();
    if (!r.ok) {
      const pista = r.status === 404
        ? ` No se encuentra el montador "${job}" en ${region}. Comprueba el nombre con MONTAJE_JOB / MONTAJE_REGION.`
        : r.status === 403
          ? ' La cuenta de servicio no tiene permiso para lanzar el montador (roles/run.invoker sobre el job).'
          : '';
      return res.status(r.status).json({ error: `Montaje: inicio ${r.status}.${pista}`, detail: raw.slice(0, 500) });
    }

    let out = {};
    try { out = JSON.parse(raw); } catch (e) { /* respuesta no-JSON */ }
    return res.status(200).json({ operationName: out.name || '', salida: `gs://${bucket}/${salida}` });
  } catch (e) {
    return fail(res, e);
  }
};

// Job folder for an episode. Keyed by app project so two projects rendering at
// the same time never overwrite each other's encargo.
function carpetaDe(episodio, projectId) {
  const ep = String(parseInt(episodio, 10) || 1).padStart(2, '0');
  const proj = String(projectId || 'proyecto').replace(/[^\w-]/g, '');
  return `anime-studio/${proj}/ep${ep}`;
}
