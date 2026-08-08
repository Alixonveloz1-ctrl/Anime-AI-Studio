// ════════════════════════════════════════════════════════════════
// ASSEMBLE — authenticated proxy to the Cloud Run ffmpeg service.
//
// The service is deployed private, so it is reached with a Google
// signed ID token minted from the same GCP_SERVICE_ACCOUNT. Proxying
// through here also keeps the service URL and CORS out of the
// browser's problem space.
//
// The render itself runs in the background on Cloud Run: this
// endpoint only starts a job and reports its status, so it never
// approaches Vercel's function timeout.
//
//   POST /api/assemble { manifest }        → { jobId }
//   POST /api/assemble { jobId }           → { state, progress, url }
//   GET  /api/assemble                     → { available, url }
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, getIdToken, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res, ['GET', 'POST'])) return;

  try {
    const base = cfg.assemblyUrl;

    // Availability probe, so the UI can explain what is missing instead of
    // showing a button that fails.
    if (req.method === 'GET') {
      return res.status(200).json({
        available: !!base,
        url: base || null,
        hint: base ? null : 'Desplegá cloud-run/ y poné su URL en ASSEMBLY_SERVICE_URL',
      });
    }

    if (!base) {
      return res.status(503).json({
        error: 'El servicio de ensamblaje no está configurado. Desplegá cloud-run/ (ver su README) y añadí ASSEMBLY_SERVICE_URL en Vercel.',
        configError: true,
      });
    }

    const { manifest, jobId } = req.body || {};
    // Validate before minting a token: a malformed request should not cost an
    // OAuth round-trip.
    if (!jobId && !manifest?.scenes?.length) {
      return res.status(400).json({ error: 'manifest.scenes o jobId requerido' });
    }

    const sa = loadServiceAccount();
    const idToken = await getIdToken(sa, base);

    // ─── Status ───
    if (jobId) {
      const r = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json({ error: data.error || `Estado del ensamblaje: ${r.status}` });
      return res.status(200).json(data);
    }

    // ─── Start ───
    const r = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 403 here almost always means the app's service account was never
      // granted run.invoker on the service.
      const extra = r.status === 403
        ? ' — ¿le diste roles/run.invoker a la service account de la app sobre el servicio de Cloud Run?'
        : '';
      return res.status(r.status).json({ error: (data.error || `Ensamblaje: ${r.status}`) + extra });
    }
    return res.status(200).json(data);
  } catch (e) {
    return fail(res, e);
  }
};
