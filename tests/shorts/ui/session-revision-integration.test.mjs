import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createFixture} from './fixture.mjs';
import {revisionTransport} from '../../../cortos/revision-transport.mjs';
import * as presentation from '../../../cortos/presentation.mjs';
import * as catalogue from '../../../cortos/catalog.mjs';

const html=await fs.readFile(new URL('../../../cortos/index.html',import.meta.url),'utf8');
const source=(await fs.readFile(new URL('../../../cortos/studio.mjs',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replace('export async function mountStudio','async function mountStudio').replace('export {api,say};','');

test('the actual Cortos UI can generate after its own heartbeat but preserves a genuine content conflict',async()=>{
 for(const repair of [false,true]){
  const fixture=createFixture();let inject=false;const writes=[];let transport;
  const base=async(url,options={})=>{
   const path=new URL(url,'https://fixture.invalid').searchParams.get('path');
   const method=options.method||'GET',headers=Object.fromEntries(new Headers(options.headers));
   if(method!=='GET'&&path.startsWith('/projects/fixture/')){
    writes.push(path);
    const expected=Number(headers['x-shorts-revision']);
    if(expected!==fixture.project.revision)return new Response(JSON.stringify({code:'REVISION_CONFLICT',error:'La revisión cambió en otra sesión'}),{status:409});
   }
   if(path.endsWith('/lease')){
    const data=JSON.parse(options.body);fixture.project.lease={...data};fixture.project.revision++;
    return new Response(JSON.stringify(fixture.project),{headers:{'Content-Type':'application/json'}});
   }
   const response=await fixture.transport(url,{...options,headers:{...headers,'Idempotency-Key':headers['idempotency-key']}});
   if(inject&&path==='/projects/fixture'&&method==='GET'){
    // Return the old project snapshot after the SAME page has renewed its lease.
    inject=false;const revision=fixture.project.revision;
    await transport('/api/shorts?path='+encodeURIComponent('/projects/fixture/lease'),{
     method:'POST',headers:{'X-Shorts-Revision':String(revision)},body:JSON.stringify(fixture.project.lease)});
   }
   return response;
  };
  transport=repair?revisionTransport(base):base;
  const dom=new JSDOM(html,{url:'https://fixture.invalid/cortos/',runScripts:'outside-only'}),w=dom.window;
  Object.assign(w,{...catalogue,steps:presentation.steps,titleFor:presentation.label,terminal:presentation.terminal,
   unresolved:presentation.unresolved,jobMessage:presentation.jobMessage,versions:presentation.versions,
   taskActions:presentation.taskActions,entityName:presentation.entityName,fieldLabel:presentation.fieldLabel,
   TextEncoder,structuredClone,fetch:transport,confirm:()=>false,prompt:()=>null});
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.setInterval=()=>0;
  w.HTMLMediaElement.prototype.pause=function(){};
  w.eval(source+'\nwindow.hooks={api,runTask,lease,mountStudio};');
  try{
   await w.hooks.mountStudio(fixture.identity,{projectId:'fixture',transport});
   await w.hooks.lease(true);inject=true;
   const attempt=w.hooks.runTask('image','/projects/fixture/assets:generate',{operation:'image',entityId:'hero'});
   if(repair){await attempt;assert.equal(fixture.jobs.filter(j=>j.operation==='image').length,1);}
   else{await assert.rejects(attempt,/revisión cambió/);assert.equal(fixture.jobs.length,0);}
   assert.equal(writes.filter(p=>p.endsWith('/assets:generate')).length,1,'No paid retry');
   if(repair){
    const old=fixture.project.revision;fixture.project.revision++;
    const response=await transport('/api/shorts?path='+encodeURIComponent('/projects/fixture/generators'),{
     method:'POST',headers:{'X-Shorts-Revision':String(old)},body:'{}'});
    assert.equal(response.status,409);
   }
  }finally{w.close();}
 }
});
