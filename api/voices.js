// ════════════════════════════════════════════════════════════════
// VOICES — asks Google which voices this project can actually use.
//
// The app used to carry a hand-written list, and it was wrong: it offered
// "Perseus", which is not a Gemini voice, and only four Chirp 3: HD voices when
// there are many more. A list written in code goes stale the day Google adds a
// voice, and nobody notices until a generation fails.
//
// So it is not written in code any more. This asks the Text-to-Speech API, which
// answers with exactly what this service account is allowed to synthesise, in
// every language. It cannot offer a voice that does not exist.
// ════════════════════════════════════════════════════════════════
const { auth, begin, fail } = require('./_lib/gcp');

// es-US first: the app narrates in Latin American Spanish by default.
const ORDEN_IDIOMA = ['es-US', 'es-ES', 'es-419', 'en-US', 'pt-BR', 'ja-JP'];

module.exports = async function handler(req, res) {
  if (begin(req, res, ['GET', 'POST'])) return;

  try {
    const { token } = await auth();
    const r = await fetch('https://texttospeech.googleapis.com/v1/voices', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: `No se pudo pedir la lista de voces: ${d.error?.message || r.status}`,
        hint: r.status === 403
          ? 'Habilitá texttospeech.googleapis.com en el proyecto, o dale a la service account permiso para usarla.'
          : undefined,
      });
    }

    // One entry per (voice, language). A voice can serve several languages, and
    // the pair is what the synthesis call needs.
    const salida = [];
    for (const v of (d.voices || [])) {
      const nombre = v.name || '';
      const familia = /Chirp3-HD/i.test(nombre) ? 'chirp3hd'
                    : /Chirp/i.test(nombre)     ? 'chirp'
                    : /Neural2/i.test(nombre)   ? 'neural2'
                    : /Studio/i.test(nombre)    ? 'studio'
                    : /Wavenet/i.test(nombre)   ? 'wavenet'
                    : /Standard/i.test(nombre)  ? 'standard' : 'otra';
      for (const lang of (v.languageCodes || [])) {
        salida.push({
          name: nombre,
          lang,
          familia,
          // The bit after the last dash is the personality: "Charon" in
          // "es-US-Chirp3-HD-Charon".
          etiqueta: nombre.split('-').pop(),
          genero: (v.ssmlGender || '').toLowerCase(),
        });
      }
    }

    salida.sort((a, b) => {
      const ia = ORDEN_IDIOMA.indexOf(a.lang), ib = ORDEN_IDIOMA.indexOf(b.lang);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({ voices: salida, total: salida.length });
  } catch (e) {
    return fail(res, e);
  }
};
