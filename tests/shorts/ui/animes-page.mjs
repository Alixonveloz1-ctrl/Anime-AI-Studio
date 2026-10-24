import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

// The real Animes page against an in-memory project store that follows the
// same rules as api/_lib/project-store.js (every manifest has a generation and
// a save based on an older one gets 409) and a scripted /api/script. No
// provider, bucket or Firebase is contacted.
const root = new URL('../../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let state ='));
export const pid = 'p12345678', other = 'p87654321';
export const wait = ms => new Promise(r=>setTimeout(r,ms));
export async function until(check, ms=6000) {
  const end = Date.now()+ms;
  while (!check()) { if (Date.now()>end) throw new Error('Timed out waiting'); await wait(20); }
}
export const story = (title, narration) => ({
  universe:{title, carpeta:'proyecto', genero:'aventura', demo:'shonen', subgenres:[], storyMode:'cast', aspectRatio:'16:9', escenarios:[]},
  characters:[], episodes:{1:[{id:'s1', num:1, narration, imagePromptA:'A shot'}]}, currentEpisode:1, episodeDirection:{},
});
export const cloudWith = (...entries) => new Map(entries.map(([id, data, generation=1]) => [id, {generation, manifest:{version:1, id, name:data.universe?.title || 'Nuevo proyecto', created:1, updated:2, data}}]));
export const cloudText = (cloud, id=pid) => cloud.get(id).manifest.data.episodes[1][0].narration;

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
// scriptAnswer({system, prompt, body}) answers /api/script with a string (the
// model text) or a Response; imageAnswer(body, n) answers /api/image. fastTimers shortens waits of 1 s or more.
export async function openAnimes(t, {cloud, local={}, idb={}, media={}, hooks={}, unreadable=[], confirm=()=>true, signInDelay=0, scriptAnswer=null, imageAnswer=null, audioAnswer=null, musicAnswer=null, fastTimers=false}={}) {
  const saves = [], errors = [], asked = [], scriptCalls = [], imageCalls = [], audioCalls = [], musicCalls = [];
  // Bucket objects: cache entries written by dbSet, and media bodies that a
  // signed download URL serves, as GCS does.
  const bucket = new Map(Object.entries(media));
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e=>errors.push(e));
  const dom = new JSDOM(html, {url:'https://fixture.invalid/', runScripts:'outside-only', virtualConsole});
  t.after(()=>dom.window.close());
  const w = dom.window;
  const json = (value, status=200) => new Response(JSON.stringify(value), {status});
  if (fastTimers) {
    const original = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...args) => original(fn, ms >= 1000 ? Math.max(1, Math.floor(ms / 200)) : ms, ...args);
  }
  Object.assign(w, {indexedDB:fixtureDB(idb).indexedDB, structuredClone, TextEncoder,
    confirm: message => { asked.push(message); return confirm(message); },
    fetch: async (url, options={}) => {
      let body = {};
      try { body = JSON.parse(options.body||'{}'); } catch (_) {}
      if (url==='/api/voices') return json({voices:[]});
      if (url==='/api/download-url') return bucket.has(body.gcsUri)
        ? json({url:'https://fixture.invalid/object/'+encodeURIComponent(body.gcsUri)})
        : json({url:'https://fixture.invalid/unavailable/'+body.gcsUri.split('/').at(-1)});
      if (url.startsWith('https://fixture.invalid/object/')) return new Response(bucket.get(decodeURIComponent(url.slice('https://fixture.invalid/object/'.length))));
      if (url.startsWith('https://fixture.invalid/asset/')) {
        const key = decodeURIComponent(url.slice('https://fixture.invalid/asset/'.length));
        if ((options.method||'GET')==='PUT') { bucket.set('cache:'+key, String(options.body)); return new Response('', {status:200}); }
        return bucket.has('cache:'+key) ? new Response(bucket.get('cache:'+key)) : new Response('', {status:404});
      }
      if (url.startsWith('https://fixture.invalid/unavailable/')) return new Response('', {status:503});
      if (url.startsWith('https://fixture.invalid/missing/')) return new Response('', {status:404});
      // Media is out of scope here: reference images simply fail.
      if (url==='/api/image') {
        imageCalls.push(body);
        return imageAnswer ? imageAnswer(body, imageCalls.length) : json({error:'Imagen no disponible en la prueba'}, 400);
      }
      if (url==='/api/audio' && audioAnswer) { audioCalls.push(body); return audioAnswer(body, audioCalls.length); }
      if (url==='/api/music' && musicAnswer) { musicCalls.push(body); return musicAnswer(body, musicCalls.length); }
      if (url==='/api/script') {
        assert.ok(scriptAnswer, 'Unexpected text generation');
        const call = {system:body.system||'', prompt:body.messages?.[0]?.parts?.[0]?.text||'', body};
        scriptCalls.push(call);
        try {
          const answer = await scriptAnswer(call);
          return answer instanceof Response ? answer : json({text:answer, model:'fixture'});
        } catch (e) { return json({error:'fixture: '+e.message}, 500); }
      }
      assert.equal(url, '/api/upload-url', 'No media generation or unexpected endpoints');
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
      if (body.action==='assetSign') {
        // Same key rule as the server: an accented key is refused.
        if (!/^[a-zA-Z0-9_.-]{3,220}$/.test(String(body.key||''))) return json({error:'projectId/key/method inválidos'}, 400);
        return json({url:'https://fixture.invalid/asset/'+encodeURIComponent(body.key)});
      }
      if (body.action==='assetDelete') return json({ok:true, deleted:false});
      assert.fail('Unexpected request: '+JSON.stringify(body));
    }});
  w.setInterval = () => 0;
  w.localStorage.setItem('anime_cloud_migrated_v1', '1');
  for (const [k, v] of Object.entries(local)) w.localStorage.setItem(k, v);
  w.eval(fs.readFileSync(new URL('auth/ready.js', root), 'utf8'));
  w.eval(fs.readFileSync(new URL('animes/recovery.js', root), 'utf8'));
  w.eval(script.replace('(async function init() {', 'window.testInit = (async function init() {')
    + '\nwindow.testPage={getState:()=>state, getTanda:()=>tanda, ocuparProyecto, nube, esperasDeCuota:ESPERAS_DE_CUOTA};'
    + '\nwindow.musicKey=musicKey;window.episodeActs=episodeActs;');
  w.testInit.catch(()=>{});
  // In production the session sync takes a while; nothing may depend on it being instant.
  await wait(signInDelay);
  w.protectPage = async callback => callback({uid:'fixture-owner'});
  w.showSessionError = e => { throw e; };
  w.eval(fs.readFileSync(new URL('auth/animes.mjs', root), 'utf8').replace(/^import .*;\n/, ''));
  await w.testInit;
  const narration = () => w.testPage.getState().scenes[0]?.narration;
  const edit = text => { w.testPage.getState().scenes[0].narration = text; w.saveState(); };
  const modal = () => w.document.querySelector('#modalContainer').textContent;
  // Clicks a generation button and waits until the work it started is over.
  const press = async (id, ms=60000) => {
    const before = scriptCalls.length;
    w.document.getElementById(id).click();
    // With an instant fixture model the work may already be over when polled.
    await until(() => scriptCalls.length > before || w.trabajoEnCurso() !== '', 20000);
    await until(() => w.trabajoEnCurso() === '', ms);
    await wait(30);
  };
  return {w, saves, errors, asked, scriptCalls, imageCalls, audioCalls, musicCalls, bucket, narration, edit, modal, press};
}
