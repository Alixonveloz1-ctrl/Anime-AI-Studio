import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../../../animes/recovery.js',import.meta.url),'utf8');
const id='p12345678',state={projectId:id,universe:{title:'Anterior'},characters:[],episodes:{1:[]}};
function setup(t){
 const dom=new JSDOM('<div class="app"><div class="header"></div></div>',{url:'https://fixture.invalid/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,calls=[],opened=[];
 const report={images:2,imageReferences:2,currentGeneration:'4',warnings:[],candidates:[{key:'version:2',source:'Versión anterior',date:'2026-09-23T00:00:00Z',counts:{characters:1,scenes:2}}]};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.confirm=message=>{assert.match(message,/copia actual|respaldo/);return true;};
 w.fetch=async(url,options)=>{assert.equal(url,'/api/upload-url');const body=JSON.parse(options.body);calls.push(body);assert.ok(['projectRecovery','projectRecover','projectSave'].includes(body.action));return new Response(JSON.stringify(body.action==='projectRecovery'?report:{project:{id}}));};
 w.eval(source);return {w,calls,opened,report,open:async pid=>opened.push(pid)};
}
test('Conditional recovery dialog sends the selected version and expected generation exactly once',async t=>{
 const {w,calls,opened,open}=setup(t);await w.animeRecovery.present(state,open);
 await [...w.document.querySelectorAll('button')].find(x=>x.textContent==='Revisar copias guardadas').onclick();
 assert.match(w.document.querySelector('dialog').textContent,/1 personajes · 2 escenas/);
 await [...w.document.querySelectorAll('button')].find(x=>x.textContent==='Recuperar esta copia').onclick();
 assert.deepEqual(calls[1],{action:'projectRecover',id,key:'version:2',expectedGeneration:'4'});assert.deepEqual(opened,[id]);assert.equal(w.document.querySelector('dialog'),null);
});
test('A new project invalidates a delayed recovery lookup for the previous project',async t=>{
 const {w,open}=setup(t);let release;const original=w.fetch;w.fetch=async(...args)=>{await new Promise(r=>release=r);return original(...args);};
 const pending=w.animeRecovery.present(state,open);w.animeRecovery.invalidate('p87654321');release();await pending;assert.equal(w.document.querySelector('#animes-recovery'),null);
});
// Nothing is missing: the owner made a universe and its character references
// and has not written the episode yet. The banner used to announce that the
// open copy «no contiene escenas. No es una recuperación completa».
test('A project whose episode is not written yet raises no recovery notice',async t=>{
 const {w,report,open,calls}=setup(t);
 report.candidates=[];                      // nothing recoverable in the bucket
 await w.animeRecovery.present(state,open); // 2 images and 2 references do exist
 assert.equal(w.document.querySelector('#animes-recovery'),null,'no notice at all');
 assert.deepEqual(calls.map(c=>c.action),['projectRecovery'],'and nothing else was asked for');
});
test('A warning or a recoverable copy still raises it',async t=>{
 const conAviso=setup(t);conAviso.report.candidates=[];conAviso.report.warnings=['Una copia no se pudo leer.'];
 await conAviso.w.animeRecovery.present(state,conAviso.open);
 assert.match(conAviso.w.document.querySelector('#animes-recovery').textContent,/no contiene escenas/);
 const conCopia=setup(t);
 await conCopia.w.animeRecovery.present(state,conCopia.open);
 assert.ok(conCopia.w.document.querySelector('#animes-recovery'),'a previous version with scenes is worth telling');
});
