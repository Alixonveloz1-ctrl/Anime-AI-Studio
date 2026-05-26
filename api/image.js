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

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured in Vercel' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Build request parts
    const parts = [];
    if (refImageBase64) {
      parts.push({ inlineData: { mimeType: 'image/png', data: refImageBase64 } });
      parts.push({ text: 'Use this as character reference. Generate: ' + prompt });
    } else {
      parts.push({ text: prompt });
    }

    // Try models in order
    const models = [
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation',
      'gemini-1.5-flash',
    ];

    let lastError = null;

    for (const model of models) {
      try {
        const geminiRes = await fetch(
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

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
          lastError = `${model}: ${data.error?.message || geminiRes.status}`;
          // If 404, try next model
          if (geminiRes.status === 404) continue;
          // If quota on free tier but paid available, still try next
          if (geminiRes.status === 429) continue;
          continue;
        }

        const imgPart = data.candidates?.[0]?.content?.parts?.find(
          p => p.inlineData?.mimeType?.startsWith('image/')
        );

        if (imgPart) {
          return new Response(
            JSON.stringify({ imageData: imgPart.inlineData.data, model }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            }
          );
        }

        lastError = `${model}: no image in response`;
      } catch (e) {
        lastError = `${model}: ${e.message}`;
      }
    }

    // All models failed — try imagen-3
    try {
      const imagenRes = await fetch(
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

      const imagenData = await imagenRes.json();
      const b64 = imagenData.predictions?.[0]?.bytesBase64Encoded;

      if (b64) {
        return new Response(
          JSON.stringify({ imageData: b64, model: 'imagen-3.0' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      }

      lastError = 'imagen-3.0: ' + JSON.stringify(imagenData.error || 'no image');
    } catch (e) {
      lastError = 'imagen-3.0: ' + e.message;
    }

    return new Response(JSON.stringify({ error: lastError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

