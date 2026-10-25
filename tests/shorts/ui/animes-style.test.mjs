import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openAnimes, pid, story, cloudWith, until} from './animes-page.mjs';
import {scriptedModel} from './animes-script-mock.mjs';

// The drawing style is the anime's: chosen before generating it, kept with the
// project, and the only style any prompt names. Saying "Japanese hand-drawn 2D
// anime" on top of it is what made choosing Realista or Donghua pointless.
const json = (value, status=200) => new Response(JSON.stringify(value), {status});
const imagen = () => json({imageData:'iVBORw0KGgo=', imageMimeType:'image/png'});

const conEstilo = async (t, estilo, extra = {}) => {
  const p = await openAnimes(t, {cloud:new Map(), imageAnswer:() => imagen(), ...extra});
  p.w.document.getElementById('estiloAnime').value = estilo;
  return p;
};

test('The style is chosen where the universe is created, not buried in another screen', async t => {
  const {w} = await openAnimes(t, {cloud:new Map()});
  const selector = w.document.getElementById('estiloAnime');
  assert.ok(selector, 'the selector exists');
  assert.equal(selector.closest('.panel').id, 'panel-universo', 'it is on the screen that creates the anime');
  const botón = w.document.getElementById('btnGenerarUniverso');
  assert.ok(selector.compareDocumentPosition(botón) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    'and it is answered before pressing Generar Universo');
  assert.deepEqual([...selector.options].map(o => o.value),
    ['japon_2d', 'cinematografico', 'realista', 'donghua', 'clasico90', 'suave', 'oscuro']);
});

test('A realistic anime never asks the model for Japanese 2D anime', async t => {
  // The real character-reference flow, prompt included: its text used to end
  // in "Authentic Japanese hand-drawn 2D anime" whatever the style was.
  const realista = story('Serio', 'texto');
  realista.universe.estilo = 'realista';
  realista.characters = [{id:'c1', name:'Kaito', role:'protagonista', age:'34', appearance:'abrigo gris, cicatriz'}];
  const p = await openAnimes(t, {cloud:cloudWith([pid, realista]), imageAnswer:() => imagen()});
  const {w} = p;
  await until(() => w.document.getElementById('charPrompt_c1'));
  await w.generateCharImage('c1');
  const enviado = p.imageCalls.at(-1);
  assert.match(enviado.styleSpec, /REALISTIC HUMAN PROPORTIONS/);
  assert.doesNotMatch(enviado.styleSpec, /Japanese 2D TV ANIME FRAME/i);
  assert.doesNotMatch(enviado.prompt, /Japanese/i, `prompt: ${enviado.prompt.slice(-240)}`);
  assert.match(enviado.prompt, /eyes are NORMAL HUMAN SIZE/, 'the chosen style is what frames the drawing');
});

test('Each style sends its own contract and nothing else', async t => {
  const p = await conEstilo(t, 'donghua');
  const {w} = p;
  for (const [estilo, señal] of [['donghua', /donghua/i], ['clasico90', /1990s hand-painted cel/], ['oscuro', /noir sensibility/]]) {
    w.testPage.getState().universe = {title:'Anime', estilo, subgenres:[], escenarios:[]};
    await w.generateImage('Una toma', null, null, {charSheet:true});
    const enviado = p.imageCalls.at(-1);
    assert.match(enviado.styleSpec, señal, estilo);
    assert.doesNotMatch(enviado.prompt, /Japanese/i, estilo + ' prompt');
  }
});

test('The style travels with the anime, not with the phone', async t => {
  const cloud = new Map();
  const a = await conEstilo(t, 'donghua');
  // Creating the universe records the chosen style in the project.
  a.w.testPage.getState().universe = {title:'Cultivadores', estilo:'donghua', subgenres:[], escenarios:[]};
  assert.equal(a.w.estiloElegido(), 'donghua');
  // Another phone, whose own selector is at the default, opens the same anime.
  const guardado = story('Cultivadores', 'texto');
  guardado.universe.estilo = 'donghua';
  const b = await openAnimes(t, {cloud:cloudWith([pid, guardado]), imageAnswer:() => imagen()});
  assert.equal(b.w.document.getElementById('estiloAnime').value, 'donghua', 'the selector shows the anime style');
  assert.equal(b.w.estiloElegido(), 'donghua');
  await b.w.generateImage('Una toma', null, null, {charSheet:true});
  assert.match(b.imageCalls.at(-1).styleSpec, /donghua/i);
});

test('An anime made before the style was saved keeps the drawing it was made with', async t => {
  const viejo = story('Anime antiguo', 'texto');   // no universe.estilo
  const p = await openAnimes(t, {cloud:cloudWith([pid, viejo]), imageAnswer:() => imagen()});
  p.w.document.getElementById('estiloAnime').value = 'oscuro';   // the phone prefers another one
  assert.equal(p.w.estiloElegido(), 'japon_2d', 'it was drawn in the default style and stays there');
  await p.w.generateImage('Una toma', null, null, {charSheet:true});
  assert.match(p.imageCalls.at(-1).styleSpec, /JAPANESE 2D TV ANIME FRAME/i);
});

test('Changing the selector with an anime open changes that anime', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]), imageAnswer:() => imagen()});
  const {w} = p;
  const selector = w.document.getElementById('estiloAnime');
  selector.value = 'suave';
  selector.dispatchEvent(new w.Event('change'));
  assert.equal(w.testPage.getState().universe.estilo, 'suave');
  assert.match(w.document.getElementById('toast').textContent, /conserva su dibujo/);
  await until(() => w.localStorage.getItem('anime_unsynced_' + w.testPage.getState().projectId) === null);
  assert.equal(p.saves.at(-1).data.universe.estilo, 'suave', 'and it is saved with the project');
});

test('The video prompt preserves the frame it was given instead of naming another style', async () => {
  const source = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('function buildVideoPrompt(');
  // A top-level function: it ends at the next closing brace in column zero.
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(body, /preserve the exact drawing of the first frame/);
  assert.doesNotMatch(body, /Japanese hand-drawn/, 'the clip follows the frame, whatever style it is in');
  assert.match(body, /\$\{estiloVideo\}/, 'and the anime style travels with it');
});

test('The server redraws a character reference in the style it was given', async () => {
  const source = fs.readFileSync(new URL('../../../api/image.js', import.meta.url), 'utf8');
  const instruction = source.slice(source.indexOf('CHARACTER REFERENCE above'));
  const line = instruction.slice(0, instruction.indexOf('` })'));
  assert.doesNotMatch(line, /Japanese/, 'it used to name a style AFTER the style contract, so it won');
  assert.match(line, /ART STYLE stated at the top of this message/);
});

// What the owner means by «los prompts»: the ones the director writes for each
// shot of the episode. They must be written in the style chosen at the start.
test('The director writes the episode prompts in the style chosen for the anime', async t => {
  const page = await openAnimes(t, {cloud:new Map(), fastTimers:true, scriptAnswer:scriptedModel({})});
  const {w} = page;
  w.document.getElementById('estiloAnime').value = 'realista';
  w.document.getElementById('epLengthSelect').value = 'corto';
  await page.press('btnGenerarUniverso');
  assert.equal(w.testPage.getState().universe.estilo, 'realista', 'chosen before generating, kept by the anime');
  await page.press('btnGenerarEpisodio');
  const visual = page.scriptCalls.filter(c => c.kind === 'visual');
  assert.ok(visual.length, 'the director was asked for the shots');
  assert.match(visual[0].system, /SIEMPRE empezar con: "Realistic-proportion seinen anime illustration/);
  assert.doesNotMatch(visual[0].system, /Authentic Japanese/);
});
