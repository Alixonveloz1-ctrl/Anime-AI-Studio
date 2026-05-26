export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { prompt, refImageBase64 } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    const projectId = process.env.GCP_PROJECT_ID || 'anime-ai-studio-497502';
    const location = 'us-central1';

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured in Vercel' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Detect key type
    const isServiceAccountKey = apiKey.startsWith('AQ.');

    let imageData = null;
    let lastError = null;

    if (isServiceAccountKey) {
      // ── VERTEX AI (Agent Platform) con Service Account Key ──
      // Usar endpoint de Vertex AI con la key de cuenta de servicio
      const vertexEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-generate-002:predict`;

      try {
        const res = await fetch(vertexEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            instances: [{
              prompt: prompt,
            }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '9:16',
              safetySetting: 'block_only_high',
            },
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          lastError = `Vertex imagen-3.0: ${data.error?.message || res.status}`;
        } else {
          const b64 = data.predictions?.[0]?.bytesBase64Encoded;
          if (b64) imageData = b64;
          else lastError = 'Vertex: no image bytes in response';
        }
      } catch(e) {
        lastError = 'Vertex imagen-3.0: ' + e.message;
      }

      // Fallback: Gemini 2.0 flash image via Vertex
      if (!imageData) {
        try {
          const geminiVertexUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.0-flash-preview-image-generation:generateContent`;

          const parts = [];
          if (refImageBase64) {
            parts.push({ inlineData: { mimeType: 'image/png', data: refImageBase64 } });
            parts.push({ text: 'Use as character reference. Generate: ' + prompt });
          } else {
            parts.push({ text: prompt });
          }

          const res2 = await fetch(geminiVertexUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
            }),
          });

          const data2 = await res2.json();
          if (res2.ok) {
            const imgPart = data2.candidates?.[0]?.content?.parts?.find(
              p => p.inlineData?.mimeType?.startsWith('image/')
            );
            if (imgPart) imageData = imgPart.inlineData.data;
            else lastError = 'Vertex Gemini: no image in response';
          } else {
            lastError = `Vertex Gemini: ${data2.error?.message || res2.status}`;
          }
        } catch(e) {
          lastError = 'Vertex Gemini fallback: ' + e.message;
        }
      }

    } else {
      // ── GENERATIVE LANGUAGE API con API key estándar (AIza...) ──
      const models = [
        'gemini-2.0-flash-preview-image-generation',
        'gemini-2.0-flash-exp-image-generation',
      ];

      const parts = [];
      if (refImageBase64) {
        parts.push({ inlineData: { mimeType: 'image/png', data: refImageBase64 } });
        parts.push({ text: 'Use as character reference. Generate: ' + prompt });
      } else {
        parts.push({ text: prompt });
      }

      for (const model of models) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
              }),
            }
          );
          const data = await res.json();
          if (!res.ok) { lastError = `${model}: ${data.error?.message || res.status}`; continue; }
          const imgPart = data.candidates?.[0]?.content?.parts?.find(
            p => p.inlineData?.mimeType?.startsWith('image/')
          );
          if (imgPart) { imageData = imgPart.inlineData.data; break; }
          lastError = `${model}: no image in response`;
        } catch(e) {
          lastError = `${model}: ${e.message}`;
        }
      }

      // Fallback imagen-3
      if (!imageData) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1, aspectRatio: '9:16' },
              }),
            }
          );
          const data = await res.json();
          const b64 = data.predictions?.[0]?.bytesBase64Encoded;
          if (b64) imageData = b64;
          else lastError = 'imagen-3.0: ' + JSON.stringify(data.error || 'no image');
        } catch(e) {
          lastError = 'imagen-3.0: ' + e.message;
        }
      }
    }

    if (imageData) {
      return new Response(
        JSON.stringify({ imageData }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response(
      JSON.stringify({ error: lastError || 'All models failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );

  } catch(e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
