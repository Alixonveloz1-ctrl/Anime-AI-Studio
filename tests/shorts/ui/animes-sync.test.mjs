import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

// The real Animes page against an in-memory project store that follows the
// same rules as api/_lib/project-store.js: every manifest has a generation and
// a save based on an older one is answered with 409. No provider is contacted.
const root = new URL('../../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let state ='));
const pid = 'p12345678', other = 'p87654321';
const story = (title, narration) => ({
  universe:{title, carpeta:'proyecto', genero:'aventura', demo:'shonen', subgenres:[], storyMode:'cast', aspectRatio:'16:9', escenarios:[]},
  characters:[], episodes:{1:[{id:'s1', num:1, narration, imagePromptA:'A shot'}]}, currentEpisode:1, episodeDirection:{},
});
const wait = ms => new Promise(r=>setTimeout(r,ms));
async function until(check, ms=6000) {
  const end = Date.now()+ms;
  while (!check()) { if (Date.now()>end) throw new Error('Timed out waiting'); await wait(20); }
}
function fixtureDB(entries={}) {
  const store = new Map(Object.entries(entries));
  const request = value => { const r={result:value}; queueMicrotask(()=>r.onsuccess?.({target:r})); return r; };
  const db = {transaction() {
    const tx = {objectStore:()=>({
      get:k=>request(store.get(k)), getAllKeys:()=>request([...store.keys()]),
      put:(v,k)=>{store.set(k,v);queueMicrotask(()=>tx.oncomplete?.());},
      delete:k=>{store.delete(k);queueMicrotask(()=>tx.oncomplete?.());},
    })}; return tx;
  }};
  return {indexedDB:{open:()=>request(db)}};
}

// cloud: id -> {generation, manifest}. hooks.save(body) may return a Response
// (failure) or a promise (delay) before the normal conditional write.
async function open(t, {cloud, local={}, idb={}, hooks={}, unreadable=[], confirm=()=>true, signInDelay=0}={}) {
  const saves = [], errors = [], asked = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e=>errors.push(e));
  const dom = new JSDOM(html, {url:'https://fixture.invalid/', runScripts:'outside-only', virtualConsole});
  t.after(()=>dom.window.close());
  const w = dom.window;
  const json = (value, status=200) => new Response(JSON.stringify(value), {status});
  Object.assign(w, {indexedDB:fixtureDB(idb).indexedDB, structuredClone, TextEncoder,
    confirm: message => { asked.push(message); return confirm(message); },
    fetch: async (url, options={}) => {
      const body = JSON.parse(options.body||'{}');
      if (url==='/api/voices') return json({voices:[]});
      if (url==='/api/download-url') return json({url:'https://fixture.invalid/unavailable/'+body.gcsUri.split('/').at(-1)});
      if (url.startsWith('https://fixture.invalid/unavailable/')) return new Response('', {status:503});
      assert.equal(url, '/api/upload-url', 'No generation or unexpected endpoints');
      if (body.action==='projectList') return json({projects:[...cloud].filter(([id])=>!unreadable.includes(id)).map(([id,o])=>({id, name:o.manifest.name, updated:o.manifest.updated, created:1})), unreadable});
      if (body.action==='projectGet') {
        const o = cloud.get(body.id);
        return o ? json({project:o.manifest, generation:String(o.generation)}) : json({error:'Proyecto no encontrado'}, 404);
      }
      if (body.action==='projectSave') {
        saves.push(body);
        const injected = await hooks.save?.(body);
        if (injected instanceof Response) return injected;
        const o = cloud.get(body.id), current = o ? String(o.generation) : '0';
        if (!body.force && body.baseGeneration!=null && String(body.baseGeneration)!==current) return json({error:'Este proyecto cambió', conflict:true, generation:current}, 409);
        const generation = (o?.generation||0)+1;
        cloud.set(body.id, {generation, manifest:{version:1, id:body.id, name:body.name, created:body.created, updated:body.updated, data:body.data}});
        return json({ok:true, project:{id:body.id, name:body.name, generation:String(generation)}});
      }
      if (body.action==='projectRecovery') return json({currentGeneration:'1', images:0, imageReferences:0, candidates:[], warnings:[]});
      if (body.action==='assetList') return json({keys:[]});
      if (body.action==='assetSign') return json({url:'https://fixture.invalid/missing/'+body.key});
      assert.fail('Unexpected request: '+JSON.stringify(body));
    }});
  w.setInterval = () => 0;
  w.localStorage.setItem('anime_cloud_migrated_v1', '1');
  for (const [k, v] of Object.entries(local)) w.localStorage.setItem(k, v);
  w.eval(fs.readFileSync(new URL('auth/ready.js', root), 'utf8'));
  w.eval(fs.readFileSync(new URL('animes/recovery.js', root), 'utf8'));
  w.eval(script.replace('(async function init() {', 'window.testInit = (async function init() {')
    + '\nwindow.testPage={getState:()=>state, getTanda:()=>tanda, ocuparProyecto, nube};');
  w.testInit.catch(()=>{});
  // In production the session sync takes a while; nothing may depend on it being instant.
  await wait(signInDelay);
  w.protectPage = async callback => callback({uid:'fixture-owner'});
  w.showSessionError = e => { throw e; };
  w.eval(fs.readFileSync(new URL('auth/animes.mjs', root), 'utf8').replace(/^import .*;\n/, ''));
  await w.testInit;
  const narration = () => w.testPage.getState().scenes[0]?.narration;
  const edit = text => { w.testPage.getState().scenes[0].narration = text; w.saveState(); };
  return {w, saves, errors, asked, narration, edit};
}
const cloudWith = (...entries) => new Map(entries.map(([id, data, generation=1]) => [id, {generation, manifest:{version:1, id, name:data.universe.title, created:1, updated:2, data}}]));
const cloudText = (cloud, id=pid) => cloud.get(id).manifest.data.episodes[1][0].narration;

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
