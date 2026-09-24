import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {JSDOM, VirtualConsole} from 'jsdom';

// Run the real legacy page and IndexedDB callbacks against explicit, read-only
// fixtures. No Firebase, bucket or generation provider is contacted.
const root = new URL('../../../', import.meta.url);
const html = process.env.ANIMES_LOADING_BASE
  ? execFileSync('git', ['show', `${process.env.ANIMES_LOADING_BASE}:index.html`], {cwd:root, encoding:'utf8'})
  : fs.readFileSync(new URL('index.html', root), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('let state ='));
const pid = 'p12345678';
const saved = {
  universe:{title:'Proyecto anterior', carpeta:'proyecto-anterior', genero:'aventura', demo:'shonen', subgenres:[], storyMode:'cast', aspectRatio:'16:9', escenarios:[]},
  characters:[{id:'hero', name:'Akira', role:'Protagonista', appearance:'Abrigo azul'}],
  episodes:{1:[], 2:[{id:'scene2', num:1, act:'Encuentro', narration:'La historia que ya estaba guardada.', imagePromptA:'A preserved shot'}]},
  currentEpisode:2, episodeDirection:{2:{approved:true}},
};
function fixtureDB(entries) {
  const store = new Map(entries);
  const request = value => {
    const r = {result:value}; queueMicrotask(()=>r.onsuccess?.({target:r})); return r;
  };
  const db = {transaction() {
    const tx = {objectStore:()=>({
      get:k=>request(store.get(k)), getAllKeys:()=>request([...store.keys()]),
      put:(v,k)=>{store.set(k,v);queueMicrotask(()=>tx.oncomplete?.());},
      delete:k=>{store.delete(k);queueMicrotask(()=>tx.oncomplete?.());},
    })}; return tx;
  }};
  return {store, indexedDB:{open:()=>request(db)}};
}
async function setup(t, {rejectList=false, data=saved}={}) {
  const calls=[], errors=[], network={authorized:false, rejectGet:false};
  const console = new VirtualConsole(); console.on('jsdomError', e=>errors.push(e));
  const dom = new JSDOM(html,{url:'https://fixture.invalid/',runScripts:'outside-only',virtualConsole:console});
  t.after(()=>dom.window.close());
  const w=dom.window, db=fixtureDB([
    [`ci_${pid}_hero`,'gs://fixture/hero.png'],
    [`sia_${pid}_ep2_scene2`,'gs://fixture/shot.png'],
    [`sva_${pid}_ep2_scene2`,'gs://fixture/shot.mp4'],
  ]);
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  Object.assign(w, {indexedDB:db.indexedDB, structuredClone, TextEncoder, fetch:async (url, options={})=>{
    const body=JSON.parse(options.body||'{}'); calls.push({url,body});
    if (!network.authorized) return json({error:'Sesión pendiente'},401);
    if(url==='/api/voices') return json({voices:[]});
    if(url==='/api/download-url') {
      return json({url:'https://fixture.invalid/media/'+body.gcsUri.split('/').at(-1)});
    }
    if(url.startsWith('https://fixture.invalid/missing/')) return new Response('',{status:404});
    assert.equal(url,'/api/upload-url','No generation or unexpected endpoints');
    if(body.action==='projectList') return rejectList ? json({error:'Lista no disponible'},503) : json({projects:[{id:pid,name:saved.universe.title,updated:2}]});
    if(body.action==='projectGet') return network.rejectGet ? json({error:'Lectura no disponible'},503) : json({project:{id:body.id,data}});
    if(body.action==='assetSign' && body.method==='GET') return json({url:'https://fixture.invalid/missing/'+body.key});
    assert.fail('Unexpected write or generation: '+JSON.stringify(body));
  }});
  w.setInterval=()=>0;
  w.localStorage.setItem('anime_cloud_migrated_v1','1');
  w.eval(fs.readFileSync(new URL('auth/ready.js',root),'utf8'));
  w.eval(script.replace('(async function init() {','window.testInit = (async function init() {') + '\nwindow.testPage={loadStateFor,switchProject,applyStateData,renderAll,openProjectsModal,getState:()=>state};');
  // Baseline comparisons may reject during startup; preserve the rejection for
  // authorize() without reporting it as an unrelated unhandled promise.
  w.testInit.catch(()=>{});
  async function authorize() {
    network.authorized=true;
    // Exercise the production module's callback after the simulated session
    // exchange completes, rather than signaling readiness from test code.
    w.protectPage=async callback=>callback({uid:'fixture-owner'});
    w.showSessionError=e=>{throw e;};
    w.eval(fs.readFileSync(new URL('auth/animes.mjs',root),'utf8').replace(/^import .*;\n/,''));
    await w.testInit;
  }
  return {w,calls,errors,network,db,authorize};
}
test('Delayed authentication: no project/media requests until session is ready; saved episodes and media render',async t=>{
  const {w,calls,errors,authorize}=await setup(t);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(calls.length,0,'Do not read protected APIs before restoring the session');
  await authorize();
  assert.equal(w.testPage.getState().projectId,pid);
  assert.equal(w.testPage.getState().currentEpisode,2);
  assert.equal(w.testPage.getState().universe.storyMode,'cast');
  assert.match(w.document.querySelector('#universoDisplay').textContent,/Proyecto anterior/);
  assert.match(w.document.querySelector('#charactersList').textContent,/Akira/);
  assert.match(w.document.querySelector('#scenesList').textContent,/La historia que ya estaba guardada/);
  assert.ok(w.document.querySelector('#charactersList img[src$="hero.png"]'));
  assert.ok(w.document.querySelector('#scenesList img[src$="shot.png"]'));
  assert.ok(w.document.querySelector('#scenesList video[src$="shot.mp4"]'));
  assert.equal(errors.length,0);
});
test('Failed cloud read without a cache preserves the open project and other device copies',async t=>{
  const {w,network,authorize}=await setup(t);await authorize();
  const before=JSON.stringify(w.testPage.getState());
  w.localStorage.setItem('proj_pother99',JSON.stringify(saved));network.rejectGet=true;
  await w.testPage.switchProject('pmissing99');
  assert.equal(JSON.stringify(w.testPage.getState()),before);
  assert.ok(w.localStorage.getItem('proj_pother99'));
  assert.match(w.document.querySelector('#modalContainer').textContent,/No se pudo cargar el proyecto/);
  assert.doesNotMatch(w.document.querySelector('#toast').textContent,/Proyecto cargado/);
});
test('Cached emergency copy is identified honestly and other caches are not purged',async t=>{
  const {w,network,authorize}=await setup(t);await authorize();
  const cache={...saved,characters:[],episodes:{1:[]},currentEpisode:1};
  w.localStorage.setItem('proj_pcached99',JSON.stringify(cache));
  w.localStorage.setItem('proj_pother99',JSON.stringify(cache));network.rejectGet=true;
  await w.testPage.switchProject('pcached99');
  assert.equal(w.testPage.getState().projectId,'pcached99');
  assert.ok(w.localStorage.getItem('proj_pother99'));
  assert.match(w.document.querySelector('#toast').textContent,/copia de este dispositivo/);
});
test('Malformed cache does not replace the open project with an empty one',async t=>{
  const {w,network,authorize}=await setup(t);await authorize();
  const before=JSON.stringify(w.testPage.getState());network.rejectGet=true;
  for(const raw of ['{','null','[]','"broken"','{}','{"characters":{}}']) {
    w.localStorage.setItem('proj_pbroken99',raw);
    await assert.rejects(w.testPage.loadStateFor('pbroken99'));
    assert.equal(JSON.stringify(w.testPage.getState()),before);
  }
});
test('An unrecognized cloud snapshot cannot silently appear as a successfully loaded empty story',async t=>{
 const {w,authorize}=await setup(t);await authorize();
 const before=JSON.stringify(w.testPage.getState()),fetch=w.fetch;
 w.fetch=async(url,options)=>url==='/api/upload-url'&&JSON.parse(options.body).action==='projectGet'
   ? new Response(JSON.stringify({project:{id:'pbroken99',data:JSON.stringify(saved)}})) : fetch(url,options);
 await w.testPage.switchProject('pbroken99');
 assert.equal(JSON.stringify(w.testPage.getState()),before);
 assert.match(w.document.querySelector('#modalContainer').textContent,/formato esperado/);
 assert.doesNotMatch(w.document.querySelector('#toast').textContent,/Proyecto cargado/);
});
test('Unavailable cloud project list on a new device never creates an empty project',async t=>{
  const {w,calls,authorize}=await setup(t,{rejectList:true});await authorize();
  assert.equal(calls.some(c=>c.body.action==='projectSave'),false);
  assert.equal(w.testPage.getState().projectId,null);
  assert.match(w.document.querySelector('#modalContainer').textContent,/No se pudieron leer tus proyectos/);
});
test('Project success waits for media rendering instead of reporting completion early',async t=>{
  const {w,authorize}=await setup(t);await authorize();
  const original=w.testPage.getState();
  let release;const gate=new Promise(r=>release=r);
  const fetch=w.fetch;w.fetch=async (...args)=>{if(args[0]==='/api/download-url')await gate;return fetch(...args);};
  // A different pointer avoids the signed-URL cache; IndexedDB fixture is explicit.
  await new Promise(resolve=>{const req=w.indexedDB.open();req.onsuccess=()=>{const tx=req.result.transaction();tx.objectStore().put('gs://fixture/new-hero.png',`ci_${pid}_hero`);tx.oncomplete=resolve;};});
  const pending=w.testPage.switchProject(pid);
  await new Promise(r=>setTimeout(r,20));
  assert.match(w.document.querySelector('#charactersList').textContent,/Akira/,'Story information appears while the image is still pending');
  assert.match(w.document.querySelector('#charactersList').textContent,/Cargando archivos/);
  assert.doesNotMatch(w.document.querySelector('#toast').textContent,/Proyecto cargado/);
  release();await pending;
  assert.match(w.document.querySelector('#toast').textContent,/Proyecto cargado desde Google Cloud/);
  assert.ok(w.document.querySelector('#charactersList img[src$="new-hero.png"]'));
  assert.equal(w.testPage.getState().universe.title,original.universe.title);
});
test('A failed saved image cannot hide the project, and retry reads files without generating',async t=>{
 const {w,db,calls,authorize}=await setup(t);await authorize();
 db.store.set(`ci_${pid}_hero`,'gs://fixture/unavailable.png');
 const fetch=w.fetch;
 w.fetch=async(url,options)=>url==='/api/download-url'&&JSON.parse(options.body).gcsUri.endsWith('/unavailable.png')
   ? new Response(JSON.stringify({error:'Archivo temporalmente inaccesible'}),{status:503}) : fetch(url,options);
 await w.testPage.openProjectsModal();
 assert.match(w.document.querySelector('#modalContainer').textContent,/Proyecto anterior/);
 await w.testPage.switchProject(pid);
 assert.equal(w.document.querySelector('#modalContainer').textContent,'');
 assert.match(w.document.querySelector('#charactersList').textContent,/Akira/);
 assert.match(w.document.querySelector('#scenesList').textContent,/La historia que ya estaba guardada/);
 assert.ok(w.document.querySelector('#scenesList video'));
 assert.match(w.document.querySelector('#toast').textContent,/Algunos archivos/);
 const retry=[...w.document.querySelectorAll('#charactersList button')].find(b=>b.textContent==='Volver a cargar archivos');
 assert.ok(retry);assert.equal(retry.disabled,false);
 w.fetch=fetch;await retry.onclick();
 assert.ok(w.document.querySelector('#charactersList img[src$="unavailable.png"]'));
 assert.equal(calls.some(c=>/image|script|video-start|audio/.test(c.url)),false);
});
test('Delayed media from a previously opened project cannot repaint the new project',async t=>{
 const {w,db,authorize}=await setup(t);await authorize();
 db.store.set(`ci_${pid}_hero`,'gs://fixture/delayed.png');
 let release;const gate=new Promise(r=>release=r),fetch=w.fetch;
 w.fetch=async (...args)=>{if(args[0]==='/api/download-url')await gate;return fetch(...args);};
 const old=w.testPage.renderAll();await new Promise(r=>setTimeout(r,10));
 w.testPage.applyStateData('pnew9999',{universe:{title:'Otra historia',carpeta:'otra'},characters:[],scenes:[]});
 await w.testPage.renderAll();release();await old;
 assert.doesNotMatch(w.document.querySelector('#charactersList').textContent,/Akira/);
 assert.match(w.document.querySelector('#universoDisplay').textContent,/Otra historia/);
});
test('A failed bucket cache read is reported as unavailable, never as a new ungenerated asset',async t=>{
 const {w,authorize}=await setup(t);await authorize();
 const fetch=w.fetch;
 w.fetch=async(url,options)=>url==='/api/upload-url'&&JSON.parse(options.body).action==='assetSign'
   ? new Response(JSON.stringify({error:'No se pudo leer el archivo'}),{status:503}) : fetch(url,options);
 w.testPage.applyStateData('pother99',saved);
 await w.testPage.renderAll();
 assert.match(w.document.querySelector('#charactersList').textContent,/No se pudo leer parte del material/);
 const generate=[...w.document.querySelectorAll('#charactersList button')].find(b=>b.textContent.includes('Generar Imagen'));
 assert.equal(generate.disabled,true,'Cannot unknowingly regenerate a resource whose read failed');
});
