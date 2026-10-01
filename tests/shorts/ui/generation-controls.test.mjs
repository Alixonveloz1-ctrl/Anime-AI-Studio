import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createFixture} from './fixture.mjs';
import * as presentation from '../../../cortos/presentation.mjs';
import * as catalogue from '../../../cortos/catalog.mjs';

const html=await fs.readFile(new URL('../../../cortos/index.html',import.meta.url),'utf8');
const source=(await fs.readFile(new URL('../../../cortos/studio.mjs',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replace('export async function mountStudio','async function mountStudio').replace('export {api,say};','');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(intercept,prepare){
 const fixture=createFixture();prepare?.(fixture);
 const requests=[];
 const transport=async(url,options={})=>{
  const path=new URL(url,'https://fixture.invalid').searchParams.get('path');
  requests.push({path,...options,body:options.body?JSON.parse(options.body):undefined});
  const response=await intercept?.(path,options,fixture);
  return response===undefined?fixture.transport(url,options):response;
 };
 const dom=new JSDOM(html,{url:'https://fixture.invalid/cortos/',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{...catalogue,steps:presentation.steps,titleFor:presentation.label,terminal:presentation.terminal,
  unresolved:presentation.unresolved,jobMessage:presentation.jobMessage,versions:presentation.versions,
  taskActions:presentation.taskActions,entityName:presentation.entityName,fieldLabel:presentation.fieldLabel,
  TextEncoder,structuredClone,fetch:transport,confirm:()=>false,prompt:()=>null});
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.setInterval=()=>0;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.HTMLMediaElement.prototype.pause=function(){};
 w.eval(source+'\nwindow.hooks={api,go,mountStudio};');
 await w.hooks.mountStudio(fixture.identity,{projectId:'fixture',transport});
 const button=(text,parent=w.document)=>{
  const found=[...parent.querySelectorAll('button')].filter(b=>b.textContent===text);
  assert.equal(found.length,1,'Unique button: '+text);return found[0];
 };
 const people=()=>w.hooks.go('Personajes');
 const voice=()=>w.document.querySelector('select[aria-label="Voz de Haru"]');
 const sample=()=>button('Generar primera frase para escuchar',w.document.querySelector('.char-card'));
 const deadline=()=>{const original=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>original(fn,ms===30000?15:ms,...args);};
 return {fixture,requests,dom,w,button,people,voice,sample,deadline};
}

test('Changing a character voice and auditioning saves once before the paid request',async()=>{
 const h=await setup();try{
  await h.people();const oldAssets=h.fixture.project.assets.map(a=>a.id);
  h.voice().value='Puck';h.voice().onchange();
  const button=h.sample(),first=button.onclick();await button.onclick();await first;
  const saves=h.requests.filter(r=>r.path.endsWith('/characters/hero/voice'));
  const calls=h.requests.filter(r=>r.path.endsWith('/assets:generate'));
  assert.equal(saves.length,1);assert.equal(calls.length,1);
  assert.equal(saves[0].body.name,'Puck');assert.equal(calls[0].body.operation,'tts');
  assert.ok(h.requests.indexOf(saves[0])<h.requests.indexOf(calls[0]));
  assert.equal(h.voice().value,'Puck');assert.equal(h.sample().disabled,false);
  for(const id of oldAssets)assert.ok(h.fixture.project.assets.some(a=>a.id===id));
 }finally{h.dom.window.close();}
});

test('An invalid legacy voice is not offered as a valid option and can be repaired without deleting assets',async()=>{
 const h=await setup(undefined,f=>{f.project.developments[0].data.bible.characters[0].voice.name='invented-voice';});
 try{
  await h.people();assert.equal(h.voice().value,'');
  assert.ok(![...h.voice().options].some(o=>o.value==='invented-voice'));
  await h.sample().onclick();assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,0);
  assert.equal(h.sample().disabled,false);assert.equal(h.voice().disabled,false);
  h.voice().value='Aoede';h.voice().onchange();await h.sample().onclick();
  assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,1);
  assert.equal(h.fixture.project.developments[0].data.bible.characters[0].voice.name,'Aoede');
 }finally{h.dom.window.close();}
});

test('A failed voice save restores controls and does not submit audio; a later explicit attempt works',async()=>{
 let fail=true;const h=await setup((path,options)=>{
  if(path.endsWith('/characters/hero/voice')&&fail){fail=false;return new Response(JSON.stringify({error:'Guardado temporalmente no disponible'}),{status:503});}
 });try{
  await h.people();h.voice().value='Puck';h.voice().onchange();await h.sample().onclick();
  assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,0);
  assert.equal(h.voice().disabled,false);assert.equal(h.sample().disabled,false);
  assert.ok([...h.w.document.querySelectorAll('#steps button')].every(b=>!b.disabled));
  await h.sample().onclick();assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,1);
 }finally{h.dom.window.close();}
});

test('A hung response body times out, unlocks the generator and permits a new selection',async()=>{
 let hang=true;const h=await setup((path,options)=>{
  if(path.endsWith('/generators')&&options.method==='POST'&&hang){hang=false;return {ok:true,status:200,json:()=>new Promise(()=>{})};}
 });try{
  await h.people();h.deadline();const select=h.w.document.querySelector('select[aria-label="Generador de voces"]');
  select.value='gemini-2.5-flash-tts';await select.onchange();
  assert.equal(select.disabled,false);assert.match(h.w.document.querySelector('#notice').textContent,/30 segundos/);
  assert.equal(h.requests.filter(r=>r.path.endsWith('/generators')&&r.method==='POST').length,1);
  select.value='gemini-2.5-flash-tts';await select.onchange();
  assert.equal(h.fixture.project.generators.tts,'gemini-2.5-flash-tts');assert.equal(select.disabled,false);
 }finally{h.dom.window.close();}
});

test('Concurrent image and voice generator changes preserve both selections',async()=>{
 const h=await setup();try{
  await h.people();const image=h.w.document.querySelector('select[aria-label="Generador de imagen"]');
  const voice=h.w.document.querySelector('select[aria-label="Generador de voces"]');
  image.value='gemini-2.5-flash-image';const a=image.onchange();
  voice.value='gemini-2.5-flash-tts';const b=voice.onchange();await Promise.all([a,b]);
  assert.equal(h.fixture.project.generators.image,'gemini-2.5-flash-image');
  assert.equal(h.fixture.project.generators.tts,'gemini-2.5-flash-tts');
  assert.equal(image.disabled,false);assert.equal(voice.disabled,false);
 }finally{h.dom.window.close();}
});

test('Generation waits for an in-flight generator save instead of using the old model',async()=>{
 let release;const h=await setup((path,options)=>{
  if(path.endsWith('/generators')&&options.method==='POST')return new Promise(resolve=>{release=()=>resolve(undefined);});
 });try{
  await h.people();const select=h.w.document.querySelector('select[aria-label="Generador de voces"]');
  select.value='gemini-2.5-flash-tts';const save=select.onchange();
  for(let n=0;n<20&&!release;n++)await tick();assert.ok(release);
  const listen=h.sample().onclick();await tick();
  assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,0);
  release();await save;await listen;
  assert.equal(h.fixture.project.generators.tts,'gemini-2.5-flash-tts');
  assert.equal(h.requests.filter(r=>r.path.endsWith('/assets:generate')).length,1);
 }finally{h.dom.window.close();}
});

test('A token refresh timeout cannot submit the request after the timeout expires',async()=>{
 const h=await setup();try{
  h.deadline();let release;h.fixture.identity.getIdToken=()=>new Promise(resolve=>{release=resolve;});
  const count=h.requests.length;await assert.rejects(h.w.hooks.api('/health'),/30 segundos/);
  release('late-token');await tick();assert.equal(h.requests.length,count);
 }finally{h.dom.window.close();}
});

test('Unreadable successful generation responses retain the idempotency key for explicit reconciliation',async()=>{
 const h=await setup(path=>path.endsWith('/assets:generate')?new Response('not-json',{status:200}):undefined);
 try{
  await h.people();await h.sample().onclick();await h.sample().onclick();
  const requests=h.requests.filter(r=>r.path.endsWith('/assets:generate'));
  assert.equal(requests.length,2,'Only the two explicit clicks submit');
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  assert.equal(h.sample().disabled,false);
 }finally{h.dom.window.close();}
});

test('An external cancellation also covers reading the response body',async()=>{
 const h=await setup(path=>path==='/health'?{ok:true,status:200,json:()=>new Promise(()=>{})}:undefined);
 try{
  const controller=new h.w.AbortController();const pending=h.w.hooks.api('/health','GET',undefined,{},controller.signal);
  controller.abort();await assert.rejects(pending,/cancel/);
 }finally{h.dom.window.close();}
});
