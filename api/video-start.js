// ════════════════════════════════════════════════════════════════
// VIDEO START — Veo 3.1 via Vertex AI (Node.js runtime — uses crypto)
// Starts async video generation and returns operationName for polling
// ════════════════════════════════════════════════════════════════
const { cfg, auth, vertexUrl, begin, fail } = require('./_lib/gcp');

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { prompt, imageA, imageB, aspectRatio = '9:16', generateAudio = false, veoModel } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

    const MODEL_ID = (veoModel || cfg.veoModel).trim();
    const bucket = cfg.bucket;
    if (!bucket) return res.status(500).json({ error: 'GCS_OUTPUT_BUCKET no configurado en Vercel', configError: true });

    const { projectId, token } = await auth();

    // Single reference image (Veo 3.1 Lite uses image field, not referenceImages array)
    const imageData = (imageA || imageB || '').replace(/\s/g, '');

    const url = vertexUrl(projectId, cfg.veoLocation, MODEL_ID, 'predictLongRunning');

    const body = {
      instances: [{
        prompt,
        ...(imageData ? { image: { bytesBase64Encoded: imageData, mimeType: 'image/png' } } : {}),
      }],
      parameters: {
        aspectRatio: (aspectRatio === '16:9') ? '16:9' : '9:16',
        sampleCount: 1,
        durationSeconds: 8,
        generateAudio: generateAudio === true,
        storageUri: `gs://${bucket}/veo-outputs/`,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || data.error?.status || JSON.stringify(data).slice(0, 200);
      return res.status(response.status).json({ error: `Veo: ${msg}` });
    }
    if (!data.name) return res.status(500).json({ error: 'Veo no devolvió operationName' });

    return res.status(200).json({ operationName: data.name, projectId, model: MODEL_ID });
  } catch (e) {
    return fail(res, e);
  }
};
