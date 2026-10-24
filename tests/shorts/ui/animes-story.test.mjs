import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid} from './animes-page.mjs';
import {scriptedModel, storyAnswer, splitAnswer, visualScenes, planFor, words, VERCEL_TIMEOUT} from './animes-script-mock.mjs';

// The episode generator on the real page with a scripted model: what it asks
// again, what it keeps, and what it refuses to commit.
async function newAnime(t, {format='corto', mode='narrated', overrides={}, cloud=new Map(), local={}} = {}) {
  const page = await openAnimes(t, {cloud, local, fastTimers:true, scriptAnswer:scriptedModel(overrides)});
  page.w.document.getElementById('epLengthSelect').value = format;
  page.w.document.getElementById('storyModeSelect').value = mode;
  await page.press('btnGenerarUniverso');
  return {...page, cloud, state:() => page.w.testPage.getState(), calls:kind => page.scriptCalls.filter(c => c.kind === kind)};
}
const sceneSets = calls => calls.map(c => visualScenes(c.prompt).map(s => s.num).join(','));
const episodeWords = scenes => scenes.reduce((n, s) => n + words(s.narration).length, 0);

test('Visual direction keeps the scenes it accepted and asks again only for the one that failed', async t => {
  // Scene 3 always comes back with solo coverage although two characters share it.
  const a = await newAnime(t, {overrides:{visual:call => JSON.stringify({imagePrompts:visualScenes(call.prompt).map(s => planFor(s, {solo:s.num === 3}))})}});
  await a.press('btnGenerarEpisodio');
  assert.equal(a.state().episodes[1].length, 12, 'the episode is completed');
  const sets = sceneSets(a.calls('visual'));
  assert.equal(sets[0], '1,2,3,4,5');
  assert.deepEqual(sets.slice(1, 4), ['3', '3', '3'], 'only the rejected scene is requested again');
  assert.equal(sets.filter(x => x.split(',').includes('1')).length, 1, 'accepted scenes are never requested twice');
  assert.match(a.calls('visual')[1].prompt, /REINTENTO: .*\n- Escena 3: en la escena aparecen/, 'the retry says why it was rejected');
  assert.equal(a.modal(), '');
});

test('A visual request that does not fit in the time limit is split, never resent unchanged', async t => {
  const a = await newAnime(t, {overrides:{visual:(call, normal) => visualScenes(call.prompt).length > 2 ? VERCEL_TIMEOUT() : normal()}});
  await a.press('btnGenerarEpisodio');
  assert.equal(a.state().episodes[1].length, 12);
  const big = sceneSets(a.calls('visual')).filter(x => x.split(',').length > 2);
  assert.equal(new Set(big).size, big.length, 'no oversized request is sent twice');
  assert.ok(a.calls('visual').length <= 12, `visual calls: ${a.calls('visual').length}`);
});

test('A story block that comes back short is retried with the exact number of words missing', async t => {
  let first = true;
  const a = await newAnime(t, {overrides:{story:(call, normal) => {
    if (first) { first = false; return storyAnswer(call.prompt, 0.85); }
    return normal();
  }}});
  await a.press('btnGenerarEpisodio');
  const prompts = a.calls('story').map(c => c.prompt);
  assert.match(prompts[0], /MÍNIMO OBLIGATORIO: \d+ palabras/, 'the hard minimum is stated up front');
  assert.match(prompts[1], /el bloque anterior tenía \d+ palabras y el MÍNIMO de este bloque es \d+/);
  assert.equal(a.state().episodes[1].length, 12);
});

test('Scenes that lose part of the block are rejected and the exact text is split instead', async t => {
  const a = await newAnime(t, {overrides:{split:call => splitAnswer(call.prompt, 0.5)}});
  await a.press('btnGenerarEpisodio');
  const scenes = a.state().episodes[1];
  assert.equal(scenes.length, 12);
  // 'corto' = 5 min at 145 words/min; the block itself was at least 92%.
  assert.ok(episodeWords(scenes) >= Math.round(5 * 145 * 0.92), `episode words: ${episodeWords(scenes)}`);
});

test('Retrying an episode with new characters neither duplicates them nor rewrites saved blocks', async t => {
  let failSecondBlock = false;
  const a = await newAnime(t, {format:'medio', overrides:{story:(call, normal) => {
    if (failSecondBlock && call.prompt.includes('HISTORIA YA ESCRITA')) throw new Error('Gemini 503: overloaded');
    return normal();
  }}});
  await a.press('btnGenerarEpisodio');
  assert.equal(a.state().episodes[1].length, 18);
  failSecondBlock = true;
  a.w.document.getElementById('newCharsInput').value = 'Mizuki, una rival de pelo blanco';
  await a.press('btnNextEpisode');
  assert.match(a.modal(), /Generación pausada/);
  const storyCalls = a.calls('story').length;
  failSecondBlock = false;
  await a.press('btnGenerarEpisodio');
  const names = a.state().characters.map(c => c.name);
  assert.equal(names.filter(n => n === 'Mizuki Sato').length, 1, `cast: ${names.join(', ')}`);
  assert.equal(a.calls('newCharacters').length, 1);
  assert.equal(a.calls('story').length - storyCalls, 1, 'only the missing block is written');
  assert.equal(a.state().episodes[2].length, 18);
});

test('Episode instructions survive a reload, so the saved blocks are resumed with them', async t => {
  const cloud = new Map();
  let failSecondBlock = true;
  const story = (call, normal) => {
    if (failSecondBlock && call.prompt.includes('HISTORIA YA ESCRITA')) throw new Error('Gemini 503: overloaded');
    return normal();
  };
  const a = await newAnime(t, {format:'medio', cloud, overrides:{story}});
  a.w.document.getElementById('episodeInstructions').value = 'El episodio termina con una lluvia inesperada';
  await a.press('btnGenerarEpisodio');
  assert.match(a.modal(), /Generación pausada/);
  await new Promise(r => setTimeout(r, 500));   // the draft reaches the cloud
  failSecondBlock = false;
  // Same anime opened again (reload or another phone): the box starts empty.
  const b = await openAnimes(t, {cloud, fastTimers:true, scriptAnswer:scriptedModel({story})});
  assert.equal(b.w.document.getElementById('episodeInstructions').value, '');
  await b.press('btnGenerarEpisodio');
  const storyCalls = b.scriptCalls.filter(c => c.kind === 'story');
  assert.equal(storyCalls.length, 1, 'block 1 was resumed, not rewritten');
  assert.match(storyCalls[0].prompt, /lluvia inesperada/);
  assert.equal(b.w.testPage.getState().episodes[1].length, 18);
});

test('A new universe on an anime that already has episodes goes to a new project', async t => {
  const a = await newAnime(t);
  await a.press('btnGenerarEpisodio');
  const firstId = a.state().projectId;
  const before = JSON.stringify(a.cloud.get(firstId).manifest.data.episodes);
  await a.press('btnGenerarUniverso');
  assert.match(a.asked.at(-1), /se creará en un PROYECTO NUEVO/);
  assert.notEqual(a.state().projectId, firstId);
  assert.equal(JSON.stringify(a.state().episodes), '{"1":[]}');
  assert.equal(a.state().currentEpisode, 1);
  assert.equal(JSON.stringify(a.cloud.get(firstId).manifest.data.episodes), before, 'the first anime is untouched');
});

test('After episode 1 the length selector shows the fixed format and cannot change it', async t => {
  const a = await newAnime(t);
  const select = a.w.document.getElementById('epLengthSelect');
  assert.equal(select.disabled, false);
  await a.press('btnGenerarEpisodio');
  assert.equal(select.disabled, true);
  assert.equal(select.value, 'corto');
  assert.match(a.w.document.getElementById('epFormatNote').textContent, /~5 min .*Duración fijada por el Episodio 1/);
});

test('Plan checks: very short scenes can be anchored and names match whole words only', async () => {
  // The validators run inside the episode handler; check them on their exact source.
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const grab = name => {
    const start = source.indexOf(`    function ${name}(`);
    let depth = 0, i = source.indexOf('{', start);
    for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && !--depth) break; }
    return source.slice(start, i + 1);
  };
  const state = {characters:[{name:'Ren Takeda'}, {name:'Ana Ruiz'}, {name:'Kaito Mori'}]};
  const {validarAnclasNarrativas, validarPuestaEnEscena} = new Function('state',
    ['tokensCronologia', 'buscarSecuencia', 'validarAnclasNarrativas', 'validarPuestaEnEscena'].map(grab).join('\n')
    + '\nreturn {validarAnclasNarrativas, validarPuestaEnEscena};')(state);
  const plan = anclas => ({prompts:anclas.map(() => 'Scene with...'), anclasNarrativas:anclas, layoutEscena:'x'.repeat(50), estadoEscenaInicial:'y'.repeat(25),
    funciones:anclas.map(() => 'action'), personajesVisibles:anclas.map(() => ['Kaito Mori']), cambios:anclas.map(() => 'he moves the box'), estadosDespues:anclas.map(() => 'the box is now on the table')});
  for (const narration of ['—¡Basta!', 'Nadie respondió.']) assert.equal(validarAnclasNarrativas({narration}, plan([narration])), '');
  const alone = {narration:'Me quedé frente a la ventana toda la semana. Mañana sería diferente, pensé, y apreté el puño.'};
  assert.equal(validarPuestaEnEscena(alone, plan(['Me quedé frente a la ventana'])), '', '"frente" is not Ren, "ventana" is not Ana');
  const together = {narration:'Ren me miró y Ana cerró la puerta detrás de nosotros sin decir nada.'};
  assert.match(validarPuestaEnEscena(together, plan(['Ren me miró y Ana cerró'])), /Ren Takeda y Ana Ruiz/);
});

test('A momentary Vertex overload is retried after a pause instead of pausing the episode', async t => {
  let overloads = 1;
  const a = await newAnime(t, {overrides:{direction:(call, normal) => overloads-- > 0
    ? new Response(JSON.stringify({error:'Gemini (fixture) 503: The model is overloaded.', retryable:true}), {status:503})
    : normal()}});
  await a.press('btnGenerarEpisodio');
  assert.equal(a.calls('direction').length, 2);
  assert.equal(a.state().episodes[1].length, 12);
  assert.ok(a.state().episodeDirection[1], 'the director note was kept');
});
