// Deterministic stand-in for /api/script: answers each kind of request the
// Animes episode generator makes, recognised by its system prompt.
const SUBJ = ['la caja', 'el cuchillo', 'la puerta', 'el saco', 'la llave', 'el mapa', 'la carta', 'el cuenco'];
const VERB = ['Agarré', 'Solté', 'Empujé', 'Revisé', 'Guardé', 'Levanté', 'Cerré', 'Miré'];
export const words = t => String(t).trim().split(/\s+/).filter(Boolean);

// First-person, short sentences, frequent direct speech: what the reference
// cadence check expects.
export function storyText(nWords, seed = 1) {
  const out = [];
  let w = 0, i = seed * 1000;
  while (w < nWords) {
    i++;
    let s;
    switch (i % 5) {
      case 0: s = `—No pienso entregarte nada hoy —dije yo número ${i}.`; break;
      case 1: s = `${VERB[i % 8]} ${SUBJ[i % 8]} con las dos manos firmes ${i}.`; break;
      case 2: s = `Ana me miró sin decir palabra alguna ${i}.`; break;
      case 3: s = `—Devuélvelo ahora mismo, Kaito —gritó ella ${i}.`; break;
      default: s = `Mi corazón latía rápido bajo el abrigo ${i}.`;
    }
    out.push(s);
    w += s.split(/\s+/).length;
  }
  return out.join(' ');
}

export function storyAnswer(prompt, lengthFactor = 1) {
  const m = /Objetivo de este bloque: unas (\d+) palabras/.exec(prompt);
  const n = Math.round((m ? Number(m[1]) : 800) * lengthFactor);
  const story = storyText(n, (prompt.length % 7) + 1);
  const ws = words(story);
  return JSON.stringify({story, viralEvidence:ws.slice(5, 15).join(' '), viralConsequence:ws.slice(40, 52).join(' ')});
}

export function splitRequest(prompt) {
  const m = /^BLOQUE A DIVIDIR:\n\n([\s\S]*)\n\nDivídelo en EXACTAMENTE (\d+) escenas/.exec(prompt);
  return {text:m[1], wanted:Number(m[2])};
}
// keep: fraction of each scene's sentences returned (1 = the whole text).
export function splitAnswer(prompt, keep = 1) {
  const {text, wanted} = splitRequest(prompt);
  const sentences = text.match(/[^.!?…]+[.!?…]+/g).map(s => s.trim());
  const scenes = [];
  for (let i = 0; i < wanted; i++) {
    const own = sentences.slice(Math.floor(i * sentences.length / wanted), Math.floor((i + 1) * sentences.length / wanted));
    scenes.push({id:'s'+(i+1), num:i+1, title:`Escena corta ${i+1}`, narration:own.slice(0, Math.max(1, Math.round(own.length * keep))).join(' ')});
  }
  return JSON.stringify({scenes});
}

export function visualScenes(prompt) {
  const start = prompt.indexOf('esos prompts:\n\n');
  const end = prompt.indexOf('\n\nDevuelve SOLO: {"imagePrompts"');
  const body = prompt.slice(start + 'esos prompts:\n\n'.length, end);
  const heads = [...body.matchAll(/Escena (\d+) \[[^\]]*\] "[^"]*" — MÍNIMO (\d) plano\(s\): /g)];
  return heads.map((h, i) => ({
    num:Number(h[1]), min:Number(h[2]),
    narration:body.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : body.length).trim(),
  }));
}
export function planFor(scene, {solo=false} = {}) {
  const ws = words(scene.narration);
  const n = Math.max(scene.min, 3);
  const at = [0, Math.floor(ws.length * 0.4), Math.floor(ws.length * 0.7)].slice(0, n);
  const shot = k => `Authentic Japanese hand-drawn 2D TV anime frame, crisp linework, hard-edged cel shading. Scene with Kaito Mori and Ana Ruiz at the workbench, warm lamp light, beat ${k} of scene ${scene.num}, tension visible in their hands.`;
  return {
    num:scene.num, escenario:'loc1', planos:n, continuarAnterior:false,
    layoutEscena:'Kaito kneels at the workbench on the left; Ana stands near the door on the right holding the box.',
    estadoEscenaInicial:'Door closed, box in Ana arms, lamp on, Kaito unhurt.',
    anclasNarrativas:at.map(p => ws.slice(p, p + 6).join(' ')),
    // Solo coverage is wrong when two characters share the scene.
    funciones:(solo ? ['action', 'insert', 'action'] : ['establishing', 'interaction', 'reaction']).slice(0, n),
    personajesVisibles:(solo ? [['Kaito Mori'], ['Kaito Mori'], ['Kaito Mori']] : [['Kaito Mori', 'Ana Ruiz'], ['Kaito Mori', 'Ana Ruiz'], ['Ana Ruiz']]).slice(0, n),
    cambios:['Kaito rises slowly from the floor', 'Ana steps back toward the door', 'Ana grips the box tighter'].slice(0, n),
    estadosDespues:['Kaito standing at the bench, Ana by door', 'Ana one step from the door, box held', 'Ana at the door, box held tightly'].slice(0, n),
    prompts:[1, 2, 3].slice(0, n).map(shot),
    tamanos:['general', 'medio', 'cerca'].slice(0, n), pesos:[2, 2, 1].slice(0, n),
    videoRecomendado:[false, false, false].slice(0, n),
    movimientos:['Kaito rises from his knees', 'Ana takes one step back', 'Ana tightens her grip'].slice(0, n),
    continuos:[false, false, false].slice(0, n),
  };
}

export const CAST = [
  {id:'c1', name:'Kaito Mori', role:'protagonista', gender:'male', age:'24', appearance:'black messy short hair, grey work jacket', personality:'Terco. Calculador.', backstory:'Perdió el taller. Quiere recuperarlo.'},
  {id:'c2', name:'Ana Ruiz', role:'rival', gender:'female', age:'25', appearance:'long auburn hair, navy apron', personality:'Fría. Leal.', backstory:'Trabaja para el prestamista. Duda.'},
  {id:'c3', name:'Ren Takeda', role:'prestamista', gender:'male', age:'50', appearance:'grey suit, scar on chin', personality:'Paciente. Cruel.', backstory:'Compró las deudas del barrio.'},
];

export function kindOf({system, prompt}) {
  if (system.includes('creador de universos')) return 'universe';
  if (system.includes('diseñador de personajes')) return prompt.includes('Crea SOLO los personajes nuevos') ? 'newCharacters' : 'characters';
  if (system.includes('DIRECTOR CREATIVO')) return prompt.includes('Escribe la BIBLIA') ? 'bible' : prompt.includes('Estás dirigiendo') ? 'direction' : 'music';
  if (system.includes('guionista principal')) return 'story';
  if (system.includes('editor de guion')) return prompt.startsWith('BLOQUE A DIVIDIR') ? 'split' : 'tag';
  if (system.includes('DIRECTOR DE FOTOGRAFÍA')) return 'visual';
  if (system.includes('DIRECTOR DE ARTE, CONTINUIDAD')) return 'supervisor';
  if (system.startsWith('Eres un director de arte de anime')) return prompt.includes('HISTORIA DEL EPISODIO') ? 'scenarios' : 'assign';
  return 'other';
}

// overrides[kind](call, defaultAnswer) may return a different answer.
export function scriptedModel(overrides = {}) {
  const answer = call => {
    switch (kindOf(call)) {
      case 'universe': return JSON.stringify({title:'El Taller de Kaito', tagline:'Una deuda', concepto:'c', conflicto:'k', hook:'h', setting:'Osaka 2020'});
      case 'characters': return JSON.stringify({characters:CAST});
      case 'newCharacters': return JSON.stringify({characters:[{id:'c_new1', name:'Mizuki Sato', role:'rival', gender:'female', age:'19', appearance:'white hair', personality:'Fría.', backstory:'Secreto.'}]});
      case 'bible': return JSON.stringify({direccionVisual:'ocre y azul', narrativa:'primera_referencia', identidadMusical:'cuerdas', ritmo:'r', ritmoVisual:'rv', arcoTemporada:['a', 'b'], motivosRecurrentes:['llave'], reglasDeOro:['x']});
      case 'direction': return JSON.stringify({objetivo:'o', curvaEmocional:'c', imagenClave:'i', notaDeDireccion:'n', quedaAbierto:'q'});
      case 'music': return JSON.stringify({cues:[]});
      case 'story': return storyAnswer(call.prompt);
      case 'split': return splitAnswer(call.prompt);
      case 'visual': return JSON.stringify({imagePrompts:visualScenes(call.prompt).map(s => planFor(s))});
      case 'supervisor': return JSON.stringify({correcciones:[]});
      case 'scenarios': return JSON.stringify({nuevos:[{name:'Taller', desc:'A cramped workshop with a workbench and shelves, warm lamp light, wooden floor, realistic human scale with clear headroom for a standing adult.'}]});
      case 'assign': return JSON.stringify({asignaciones:[]});
      default: throw new Error('unclassified call: ' + call.system.slice(0, 80));
    }
  };
  return call => {
    const kind = kindOf(call);
    call.kind = kind;
    return overrides[kind] ? overrides[kind](call, () => answer(call)) : answer(call);
  };
}

export const VERCEL_TIMEOUT = () => new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\niad1::abcde-1234567890\n', {status:504, headers:{'content-type':'text/plain'}});
