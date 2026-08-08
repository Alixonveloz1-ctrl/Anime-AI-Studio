// ════════════════════════════════════════════════════════════════
// SCRIPT GENERATION PROXY — the single point that generates ALL text
// in the app: universe, characters, story, image prompts, direction
// and repairs.
//
// The model is cfg.scriptModel, overridable with the SCRIPT_MODEL env
// var (and SCRIPT_LOCATION for its endpoint). It defaults to the most
// capable model available; if a Google Cloud project has no allowlist
// for it, point SCRIPT_MODEL at one it does have instead of editing
// this file.
//
// NO automatic model fallback: per project requirement the call
// returns a clear error rather than silently downgrading quality.
// Transient blips are absorbed by the client, which retries each text
// call up to 4 times.
//
// Node.js runtime (NOT Edge): Vercel Edge Functions are deprecated
// and hard-cap "must begin sending a response" at 25s regardless of
// any maxDuration set in vercel.json — that 25s cap is exactly what
// caused the earlier character-generation timeout bug on this project.
// Node.js runtime + Fluid compute actually honors maxDuration.
//
// Gemini 3.x preview models are ONLY available at the "global"
// endpoint, not a regional one like us-central1.
//
// Gemini 3.1 Pro always "thinks" before answering (cannot be
// disabled) and may return a "thought" part ahead of the real answer
// in the response — text extraction below filters those out so we
// never accidentally return the thinking summary instead of the JSON.
// ════════════════════════════════════════════════════════════════
const { cfg, auth, vertexUrl, begin, fail } = require('./_lib/gcp');

async function callModel(modelId, location, projectId, token, body) {
  const url = vertexUrl(projectId, location, modelId, 'generateContent');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  return { ok: r.ok, status: r.status, data: d };
}

// Extracts the final answer text, skipping any "thought" parts (Gemini 3
// Pro/3.1 Pro reasoning models can include these ahead of the real answer).
function extractText(d) {
  const parts = d.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

module.exports = async function handler(req, res) {
  if (begin(req, res)) return;

  try {
    const { messages, system } = req.body || {};
    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'messages requerido' });
    }

    const { projectId, token } = await auth();
    const MODEL = cfg.scriptModel;

    const body = {
      contents: messages,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
        // Gemini 3.1 Pro defaults to thinkingLevel HIGH ("Deep Think Mini"),
        // the slowest setting. On the long story call that pushed total latency
        // past Vercel's 60s function limit, so Vercel returned a 504 error page
        // (non-JSON) and the browser's response parse failed with an opaque
        // error. LOW still reasons, is plenty for creative writing, and keeps
        // generation well under the time limit. (3.x uses thinkingLevel, NOT
        // thinkingBudget — setting both would 400. Raise to MEDIUM for more
        // depth only if it still completes in time.)
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
      // Adult-content app: set every CONFIGURABLE safety filter to OFF (the most
      // permissive value) so suggestive/explicit-adult text is never blocked on
      // probability. NOTE: this only covers the four adjustable categories below.
      // Gemini's core, NON-configurable protections (most importantly child
      // safety) can never be turned off by any threshold — if generation is
      // blocked with these already OFF, the cause is either one of those core
      // protections (e.g. content that reads as sexualizing minors) or a
      // non-safety issue (MAX_TOKENS, parse), which the error detail will show.
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      ],
    };

    let { ok, status, data: d } = await callModel(MODEL, cfg.scriptLocation, projectId, token, body);

    if (!ok) {
      const msg = d.error?.message || JSON.stringify(d).slice(0, 200);
      return res.status(status).json({ error: `Gemini (${MODEL}): ${msg}` });
    }

    const text = extractText(d);
    if (!text) {
      const reason = d.candidates?.[0]?.finishReason || 'UNKNOWN';
      const promptBlock = d.promptFeedback?.blockReason;
      // Surface the blocked safety category when present, so the client error
      // is actionable instead of just "no response".
      const blockedCat = (d.candidates?.[0]?.safetyRatings || [])
        .filter(r => r.blocked)
        .map(r => r.category?.replace('HARM_CATEGORY_', ''))
        .join(', ');
      const detail = promptBlock
        ? `prompt bloqueado: ${promptBlock}`
        : `finishReason: ${reason}${blockedCat ? ` (${blockedCat})` : ''}`;
      return res.status(500).json({ error: `Gemini sin respuesta [${detail}] (${MODEL})` });
    }

    return res.status(200).json({ text, model: MODEL });
  } catch (e) {
    return fail(res, e);
  }
};
