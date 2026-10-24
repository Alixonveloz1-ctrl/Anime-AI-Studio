import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes as open, pid, other, story, wait, until, cloudWith, cloudText} from './animes-page.mjs';

// Project sync, the generation guard and the episode controls on the real
// Animes page (see animes-page.mjs for the fixture store).
test('A slow save can never land after a newer one: saves leave one at a time, newest last', async t => {
  const cloud = cloudWith([pid, story('Anime', 'original')]);
  let release;
  const {w, saves, edit} = await open(t, {cloud, hooks:{save: body => body.data.episodes[1][0].narration==='primera' ? new Promise(r=>{release=r;}) : undefined}});
  edit('primera');
  await until(() => saves.length===1);
  edit('segunda');
  await wait(700);
  assert.equal(saves.length, 1, 'the second save waits for the first one');
  release();
  await until(() => saves.length===2 && w.localStorage.getItem('anime_unsynced_'+pid)===null);
  assert.equal(cloudText(cloud), 'segunda');
  assert.equal(saves[1].baseGeneration, '2', 'each save is based on the version the previous one created');
});

test('A failed save is retried by itself and the device copy is protected meanwhile', async t => {
  const cloud = cloudWith([pid, story('Anime', 'original')]);
  let failures = 2;
  const {w, saves, edit} = await open(t, {cloud, hooks:{save: () => failures-- > 0 ? new Response(JSON.stringify({error:'GCS 503'}), {status:503}) : undefined}});
  edit('sin conexión');
  await until(() => saves.length===1);
  await wait(50);
  assert.equal(w.localStorage.getItem('anime_unsynced_'+pid), '1');
  assert.match(w.document.querySelector('#toast').textContent, /se reintentará solo/);
  await until(() => saves.length===3, 9000);
  await until(() => w.localStorage.getItem('anime_unsynced_'+pid)===null);
  assert.equal(cloudText(cloud), 'sin conexión');
});

test('Reopening with changes that never reached the cloud uploads them instead of discarding them', async t => {
  const cloud = cloudWith([pid, story('Anime', 'nube'), 4]);
  const {saves, narration, asked} = await open(t, {cloud, local:{
    ['proj_'+pid]: JSON.stringify(story('Anime', 'editado sin conexión')),
    ['anime_unsynced_'+pid]: '1', ['anime_gen_'+pid]: '4',
  }});
  assert.equal(narration(), 'editado sin conexión');
  assert.equal(asked.length, 0, 'the cloud did not change: nothing to ask');
  await until(() => saves.length===1);
  await until(() => cloudText(cloud)==='editado sin conexión');
});

test('If both this device and another one changed the project, the owner is asked', async t => {
  for (const keepDevice of [true, false]) {
    const cloud = cloudWith([pid, story('Anime', 'otro dispositivo'), 6]);
    const {narration, asked, w} = await open(t, {cloud, confirm:()=>keepDevice, local:{
      ['proj_'+pid]: JSON.stringify(story('Anime', 'este teléfono')),
      ['anime_unsynced_'+pid]: '1', ['anime_gen_'+pid]: '4',
    }});
    assert.equal(asked.length, 1);
    assert.match(asked[0], /también se guardó desde otro dispositivo/);
    assert.equal(narration(), keepDevice ? 'este teléfono' : 'otro dispositivo');
    await until(() => w.localStorage.getItem('anime_unsynced_'+pid)===null);
    assert.equal(cloudText(cloud), keepDevice ? 'este teléfono' : 'otro dispositivo');
  }
});

test('A stale tab gets a question instead of overwriting newer work', async t => {
  for (const keepDevice of [false, true]) {
    const cloud = cloudWith([pid, story('Anime', 'original')]);
    const {edit, asked, narration, w} = await open(t, {cloud, confirm:()=>keepDevice});
    // Another tab or device saves first.
    cloud.set(pid, {generation:9, manifest:{...cloud.get(pid).manifest, data:story('Anime', 'otra pestaña')}});
    edit('pestaña vieja');
    await until(() => asked.length===1);
    await until(() => w.localStorage.getItem('anime_unsynced_'+pid)===null);
    assert.equal(cloudText(cloud), keepDevice ? 'pestaña vieja' : 'otra pestaña');
    assert.equal(narration(), keepDevice ? 'pestaña vieja' : 'otra pestaña');
  }
});

test('Nuevo Proyecto only reports success after the project exists in the cloud', async t => {
  const cloud = cloudWith([pid, story('Anime', 'original')]);
  let fail = true;
  const {w, narration} = await open(t, {cloud, hooks:{save: () => fail ? new Response(JSON.stringify({error:'GCS subida: 503'}), {status:500}) : undefined}});
  await w.crearProyecto();
  assert.equal(w.testPage.getState().projectId, pid, 'stays on the open project');
  assert.equal(narration(), 'original');
  assert.match(w.document.querySelector('#modalContainer').textContent, /No se pudo crear el proyecto/);
  assert.doesNotMatch(w.document.querySelector('#toast').textContent, /Proyecto creado/);
  fail = false;
  await w.crearProyecto();
  const created = w.testPage.getState().projectId;
  assert.notEqual(created, pid);
  assert.ok(cloud.has(created));
  assert.match(w.document.querySelector('#toast').textContent, /Proyecto creado en Google Cloud/);
});

test('A project the list could not read is kept: no empty project is created and it still opens', async t => {
  const cloud = cloudWith([pid, story('Anime', 'original')]);
  const {w, saves, narration} = await open(t, {cloud, unreadable:[pid], local:{projects_index: JSON.stringify([{id:pid, name:'Anime', updated:2}])}});
  assert.equal(saves.length, 0, 'nothing was created');
  assert.equal(w.testPage.getState().projectId, pid);
  assert.equal(narration(), 'original');
});

test('Opening another project or episode is refused while something is generating for this one', async t => {
  const cloud = cloudWith([pid, story('Anime', 'original')], [other, story('Otro', 'otro')]);
  const {w} = await open(t, {cloud});
  const release = w.testPage.ocuparProyecto('la generación de prueba');
  await w.switchProject(other);
  assert.equal(w.testPage.getState().projectId, pid);
  assert.match(w.document.querySelector('#toast').textContent, /Espera a que termine la generación de prueba/);
  assert.equal(await w.newProject(), false);
  release();
  await w.switchProject(other);
  assert.equal(w.testPage.getState().projectId, other);
});

test('A storage error while preparing the image batch releases the batch lock', async t => {
  const data = story('Anime', 'original');
  data.characters = [{id:'c1', name:'Akira', role:'Protagonista'}];
  const {w} = await open(t, {cloud:cloudWith([pid, data]), idb:{[`ci_${pid}_c1`]:'gs://fixture/c1.png'}});
  w.document.getElementById('btnAllImages').click();
  await until(() => /No se pudo preparar la tanda de imágenes/.test(w.document.querySelector('#modalContainer').textContent));
  assert.equal(w.testPage.getTanda().enCurso, false, 'other batches are not blocked');
  assert.equal(w.document.getElementById('btnAllImages').disabled, false);
});

test('Episode tabs and buttons always describe the open project, even when sign-in is slow', async t => {
  const twoEpisodes = story('Anime', 'ep1');
  twoEpisodes.episodes[2] = [{id:'s1', num:1, narration:'ep2', imagePromptA:'A shot'}];
  twoEpisodes.currentEpisode = 2;
  const cloud = cloudWith([pid, twoEpisodes], [other, story('Otro', 'otro')]);
  cloud.get(other).manifest.updated = 1;
  const {w} = await open(t, {cloud, signInDelay:800});
  const nav = () => ({
    shown: w.document.getElementById('episodeNav').style.display,
    tabs: [...w.document.querySelectorAll('#episodeTabs button')].map(b=>b.textContent.trim()),
    label: w.document.getElementById('btnGenerarEpisodio').textContent,
  });
  assert.deepEqual(nav(), {shown:'block', tabs:['Ep 1','Ep 2'], label:'✨ Generar Episodio 2 (reemplazar)'});
  await w.switchProject(other);
  assert.deepEqual(nav(), {shown:'block', tabs:['Ep 1'], label:'✨ Generar Episodio 1 (reemplazar)'});
});
