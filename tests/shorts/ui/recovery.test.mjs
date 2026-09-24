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
