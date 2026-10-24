import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, story, cloudWith, until, wait} from './animes-page.mjs';

// ⏹️ Detener is the only way to stop a batch, and a batch of Veo clips is the
// most expensive thing the app can start. It has to be on the screen the batch
// was started from, and pressing it has to stop the batch.
const json = (value, status=200) => new Response(JSON.stringify(value), {status});
const esVisible = el => {
  for (let node = el; node && node.style; node = node.parentElement) {
    if (node.style.display === 'none') return false;
    if (node.classList?.contains('panel') && !node.classList.contains('active')) return false;
  }
  return !!el;
};
const freno = w => w.document.getElementById('btnDetenerTanda');
const abrir = (w, id) => { w.document.querySelectorAll('.panel').forEach(p => p.classList.remove('active')); w.document.getElementById(id).classList.add('active'); };

test('The stop control is shown on the open screen and returned to its place', async t => {
  const {w} = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')])});
  for (const panelId of ['panel-personajes', 'panel-exportar', 'panel-universo', 'panel-episodio']) {
    abrir(w, panelId);
    assert.equal(w.empezarTanda('Trabajando...'), true);
    assert.ok(esVisible(freno(w)), 'visible with ' + panelId + ' open');
    assert.equal(freno(w).disabled, false);
    assert.ok(w.document.getElementById(panelId).contains(freno(w)), 'inside ' + panelId);
    assert.match(w.document.getElementById('bulkText').textContent, /Trabajando/);
    assert.equal(w.empezarTanda('Otra'), false, 'two batches never run at once');
    w.terminarTanda();
    assert.equal(esVisible(freno(w)), false);
  }
  const episodio = w.document.getElementById('panel-episodio');
  assert.deepEqual([...episodio.querySelectorAll('#bulkProgress, #scenesList')].map(x => x.id),
    ['bulkProgress', 'scenesList'], 'the progress block is back above the scene list');
});

test('Each batch shows it while it runs, wherever it was started', async t => {
  const a = story('Anime', 'La escena.');
  a.characters = [{id:'c1', name:'Kaito', role:'protagonista', appearance:'abrigo gris'}];
  a.episodes = {1:[{id:'s1', num:1, act:'cold_open', narration:'La escena.', imagePromptA:'A shot', videoRecommendedA:true}]};
  // The music batch asks the director for the missing briefs before composing;
  // with them in place it goes straight to its first act.
  a.universe.musicBriefs = {cold_open:{prompt:'Piano íntimo, sin voces.', negative:''}};
  const {w} = await openAnimes(t, {cloud:cloudWith([pid, a])});
  // These three are the ones that showed nothing: the images and narration
  // batches already opened the progress block themselves (animes-media.test.mjs
  // and the stop test below cover those).
  for (const [panelId, arranque] of [
    ['panel-episodio', () => w.generateAllVideos()],
    ['panel-personajes', () => w.document.getElementById('btnAllCharacterRefs').click()],
    ['panel-exportar', () => w.document.getElementById('btnGenerarMusica').click()],
  ]) {
    abrir(w, panelId);
    // Each of them starts its batch before its first await: the control is
    // there from the moment the owner starts paying.
    const corriendo = arranque();
    assert.ok(esVisible(freno(w)), 'stop button visible for the batch started from ' + panelId);
    assert.equal(freno(w).disabled, false);
    assert.ok(w.document.getElementById(panelId).contains(freno(w)), 'and on the open screen: ' + panelId);
    freno(w).click();
    assert.equal(w.testPage.getTanda().detener, true, 'and pressing it asks the batch to stop');
    await corriendo;
    await until(() => w.trabajoEnCurso() === '', 20000);
    assert.equal(esVisible(freno(w)), false, 'and it goes away when the batch ends');
  }
});

test('Pressing stop leaves the rest of the batch ungenerated', async t => {
  const a = story('Anime', 'texto');
  a.characters = [{id:'hero', name:'Akira', role:'Protagonista', gender:'male'}];
  a.episodes = {1:[1, 2, 3, 4, 5].map(n => ({id:'s'+n, num:n, act:'cold_open', narration:'Escena número '+n+'.',
    imagePromptA:'A shot', interventions:[{type:'dialogue', speakerId:'hero', text:'Escena número '+n+'.'}]}))};
  let pedidas = 0, liberar;
  const puerta = new Promise(r => liberar = r);
  const p = await openAnimes(t, {cloud:cloudWith([pid, a]),
    voices:[{name:'es-US-Neural2-B', languageCode:'es-US', ssmlGender:'MALE'}],
    audioAnswer:async (body, n) => { pedidas++; if (n === 1) await puerta; return json({audioData:'UklGRg==', mimeType:'audio/wav'}); }});
  const {w} = p;
  abrir(w, 'panel-episodio');
  const corriendo = w.document.getElementById('btnAllAudio').click();
  await until(() => pedidas === 1, 10000);
  assert.ok(esVisible(freno(w)));
  freno(w).click();
  liberar();
  await corriendo;
  await until(() => w.trabajoEnCurso() === '', 30000);
  await wait(60);
  assert.equal(pedidas, 1, `the batch stopped after ${pedidas} of 5 narrations`);
  assert.equal(await w.dbHas('sa_' + pid + '_s5'), false, 'the last scene was never voiced');
});
