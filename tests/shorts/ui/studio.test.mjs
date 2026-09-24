import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createFixture} from './fixture.mjs';
import * as presentation from '../../../cortos/presentation.mjs';
import * as catalogue from '../../../cortos/catalog.mjs';
import {execFileSync} from 'node:child_process';
const html=await fs.readFile(new URL('../../../cortos/index.html',import.meta.url),'utf8');
let source=await fs.readFile(new URL('../../../cortos/studio.mjs',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'').replace('export async function mountStudio','async function mountStudio').replace('export {api,say};','');
async function setup(options={}){
 const fixture=createFixture(options);
 const baseTransport=fixture.transport;fixture.transport=async(url,request={})=>{
 const path=new URL(url,'https://fixture.invalid').searchParams.get('path');
 if(options.uncertainCreation&&path==='/projects'&&request.method==='POST'){options.createCalls=(options.createCalls||0)+1;await baseTransport(url,request);return new Response('',{status:502});}
 if(options.failOpening&&path==='/projects/fixture'&&fixture.calls.some(c=>c.path==='/projects'&&c.method==='POST')){options.failOpening=false;return new Response(JSON.stringify({error:'Lectura temporalmente no disponible'}),{status:503});}
 if(options.failImage&&path==='/projects/fixture/assets/imgCandidate/url')return new Response('{}',{status:503});
 if(options.threeDrafts&&path==='/projects'&&(request.method||'GET')==='GET')return new Response(JSON.stringify({projects:[1,2,3].map(n=>({...fixture.project,id:'draft'+n,title:'',created:n}))}));
 if(options.pendingAfterSubmit&&path.endsWith('/ideas:generate')){const r=await baseTransport(url,request);const job=fixture.jobs.at(-1);Object.assign(job,{state:'queued',settled:false});options.savedIdeas=fixture.project.ideas;fixture.project.ideas=[];return r;}
 if(options.jobSequence&&path.startsWith('/jobs/')&&!path.includes(':')){const job=fixture.jobs.find(j=>j.id===path.split('/').at(-1));const next=options.jobSequence.shift();if(next)Object.assign(job,next);if(next?.state==='awaiting_review')fixture.project.ideas=options.savedIdeas;}
 if(options.pendingJob&&path.endsWith('/jobs')&&!fixture.jobs.length)fixture.jobs.push(structuredClone(options.pendingJob));
 if(options.nonJsonError&&decodeURIComponent(url).endsWith('/ideas:generate')){options.errorRequests=(options.errorRequests||0)+1;return new Response('',{status:502});}if(new Headers(request.headers).has('If-Match'))return new Response('',{status:412});return baseTransport(url,request);};
 const dom=new JSDOM(html,{url:'https://fixture.invalid/cortos/',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{...catalogue,steps:presentation.steps,titleFor:presentation.label,terminal:presentation.terminal,unresolved:presentation.unresolved,jobMessage:presentation.jobMessage,versions:presentation.versions,taskActions:presentation.taskActions,entityName:presentation.entityName,fieldLabel:presentation.fieldLabel,TextEncoder,structuredClone,fetch:fixture.transport,confirm:()=>{throw new Error('Unexpected confirmation')},prompt:()=>null});
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.setInterval=()=>0;if(options.fastPoll){const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===3000?0:ms,...args);}
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
 w.eval(source+'\nwindow.testMount=mountStudio;');await Promise.all(Array.from({length:options.mounts||1},()=>w.testMount(fixture.identity,{transport:fixture.transport,...(options.projectList?{}:{projectId:'fixture'})})));
 async function click(name,parent=w.document){const buttons=[...parent.querySelectorAll('button')].filter(b=>b.textContent===name);assert.equal(buttons.length,1,'Unique button: '+name);await buttons[0].onclick();assert.equal(w.document.querySelector('#notice').className,'',w.document.querySelector('#notice').textContent);}
 return {fixture,w,dom,click};
}
test('Four familiar sections and projects in the header, no budgets, no financial fields in generation requests',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true});
 assert.deepEqual([...w.document.querySelectorAll('#steps button')].map(b=>b.textContent),presentation.steps);
 assert.doesNotMatch(w.document.body.textContent,/USD|presupuesto|reserva máxima|Cloud Shell|Conectar el ensamblador/);
 assert.equal(w.document.querySelector('#settings-toggle,#setup-panel,a[href*="cloudshell"]'),null);
 await click('Generar tres ideas');const sent=fixture.calls.find(c=>c.path.endsWith('/ideas:generate'));
 assert.ok(sent.body.session);assert.equal('budgetId' in sent.body,false);assert.equal(w.document.querySelectorAll('.story-content .grid>.card').length,3);
 dom.window.close();
});
test('Three overlapping mounts leave one project form and submit only its selected fields',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true,projectList:true,mounts:3});
 try {
  assert.equal(w.document.querySelectorAll('#title').length,1);
  assert.equal(w.document.querySelectorAll('#genre').length,1);
  assert.equal(w.document.querySelectorAll('#concept').length,1);
  const ecchi=w.document.querySelector('input[value="ecchi adulto no explícito"]');
  assert.equal(ecchi.closest('fieldset').querySelector('legend').textContent,'Subgéneros · puedes elegir varios');
  assert.equal(ecchi.closest('details'),null,'Ecchi is visible in the same selector layout as Animes');
  w.document.querySelector('#title').value='Historia elegida';w.document.querySelector('#genre').value='donghua';
  w.document.querySelector('#concept').value='Una secta de cultivadores rivales';ecchi.checked=true;
  w.document.querySelector('input[value="overpowered"]').checked=true;
  await click('Crear historia');
  const calls=fixture.calls.filter(c=>c.path==='/projects'&&c.method==='POST');assert.equal(calls.length,1);
  assert.equal(calls[0].body.title,'Historia elegida');
  assert.deepEqual(calls[0].body.subgenres,['donghua / cultivación','ecchi adulto no explícito','overpowered']);
  await click('Generar tres ideas');assert.equal(w.document.querySelectorAll('.story-content .grid>.card').length,3,'Three results, never three forms');
 }finally{dom.window.close();}
});
test('Cortos includes every Animes genre/subgenre and sends choices accepted by the installed service',async()=>{
 const legacy=new JSDOM(await fs.readFile(new URL('../../../index.html',import.meta.url),'utf8'));
 try {
  for(const option of legacy.window.document.querySelectorAll('#generoSelect option'))assert.ok(catalogue.genres.some(g=>g.legacyId===option.value),option.value);
  for(const input of legacy.window.document.querySelectorAll('#subgeneroGrid input'))assert.ok(catalogue.subgenres.some(g=>g.legacyId===input.value),input.value);
  const payloads=catalogue.genres.map(g=>({...catalogue.storyChoice(g.value,catalogue.subgenres.map(s=>s.value)),format:'16:9'}));
  const result=execFileSync('python3',['-c','import json,sys; from shorts.core.contracts import project; from shorts.service.director import ideas_prompt; rows=json.load(sys.stdin); [ideas_prompt(project("fixture", "fixture", row)) for row in rows]; print(len(rows))'],{cwd:new URL('../../../',import.meta.url),input:JSON.stringify(payloads),encoding:'utf8'});
  assert.equal(Number(result.trim()),catalogue.genres.length);
 }finally{legacy.window.close();}
});
test('Idea selection and development stay connected to the production actions',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true});await click('Generar tres ideas');
 await click('Elegir esta historia',w.document.querySelector('.grid>.card'));await click('Desarrollar esta historia');
 await click('Aprobar guion y biblias');assert.equal(fixture.project.activeDevelopment,'dev');assert.equal(w.document.querySelector('#steps [aria-current]').textContent,'Escenas');dom.window.close();
});
test('Current and candidate remain visible; previous versions are folded; one review approves',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Escenas');
 const shot=[...w.document.querySelectorAll('.shot-section')][0];const history=[...shot.querySelectorAll('details')].find(x=>x.querySelector('summary')?.textContent.startsWith('Versiones anteriores'));assert.ok(history);assert.equal(history.open,false);
 const candidate=[...shot.querySelectorAll('.card')].find(x=>x.querySelector(':scope>.badge')?.textContent.includes('Por revisar'));
 assert.ok(candidate);assert.equal(candidate.querySelectorAll('input[type=checkbox]').length,0);
 await new Promise(r=>setTimeout(r,0));assert.ok(candidate.querySelector('img'),'Candidate image is visible without opening another panel');candidate.querySelector('img').onload();await click('Aprobar versión',candidate);
 const sent=fixture.calls.find(c=>c.path.includes('imgCandidate:approve'));assert.deepEqual(sent.body,{reviewed:true});assert.equal(fixture.project.assetSelections['shot1|image'],'imgCandidate');dom.window.close();
});
test('Manual synchronization is usable with analysis exhausted and without AI calls',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Escenas');await click('Música y efectos');
 assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Usar propuesta'),false);
 await click('Ajustar sincronización');assert.ok(w.document.querySelector('#editor[open]'));
 await click('Cargar fotogramas');await click('Fotograma →');await click('El sonido debe coincidir aquí');await click('Este es el golpe');await click('Probar ajuste');await click('Aprobar y fijar');
 assert.equal(fixture.project.cues[0].manualLock,true);assert.equal(fixture.calls.some(c=>c.path.includes(':analyze')||c.path.includes(':correct')),false);
 dom.window.close();
});
test('Subtitle approval, automatic preview preparation and final export are connected',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Exportar');await click('Revisar el corto');await click('Subtítulos');
 assert.equal([...w.document.querySelectorAll('textarea')].length,1,'No empty exception fields');
 await click('Aprobar subtítulos revisados');await click('Preparar vista previa');await click('Exportar');await click('Aprobar y exportar');await click('Descargar archivos');
 assert.ok(fixture.calls.some(c=>c.path.endsWith('/timeline:compile')));assert.ok(fixture.calls.some(c=>c.path.endsWith('/renders')));assert.equal(w.document.querySelectorAll('.download-list a').length,2);
 assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Compilar montaje'),false);dom.window.close();
});

test('Cortos reads never carry a write precondition; writes retain the expected revision',async()=>{
 const {fixture,dom,click}=await setup({empty:true});
 try {
  await click('Generar tres ideas');
  const reads=fixture.calls.filter(c=>c.method==='GET'),writes=fixture.calls.filter(c=>c.method!=='GET');
  assert.ok(reads.length>0);assert.ok(writes.length>0);
  for(const c of reads){assert.equal(new Headers(c.headers).has('If-Match'),false);assert.equal(new Headers(c.headers).has('X-Shorts-Revision'),false);}
  for(const c of writes)assert.match(new Headers(c.headers).get('X-Shorts-Revision'),/^\d+$/);
 }finally{dom.window.close();}
});

test('An empty gateway error is explained and never retried as a paid generation',async()=>{
 const options={empty:true,nonJsonError:true},{w,dom}=await setup(options);
 try{await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Generar tres ideas').onclick();assert.match(w.document.querySelector('#notice').textContent,/respuesta del servicio \(502\)/);assert.equal(options.errorRequests,1);}finally{dom.window.close();}
});


test('Project list stays in the header, contains only stored records, and empty titles are explicit',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true,projectList:true,threeDrafts:true});
 try{
  assert.equal(w.document.querySelectorAll('#new-project').length,1);
  assert.equal(w.document.querySelectorAll('.project-row').length,0,'No projects masquerading as generated stories on the creation page');
  assert.deepEqual([...w.document.querySelectorAll('#steps button')].map(b=>b.textContent),['Historia','Personajes','Escenas','Exportar']);
  await click('📁 Proyectos');
  assert.equal(w.document.querySelectorAll('.projects-dialog[open] .project-row').length,3);
  for(const row of w.document.querySelectorAll('.project-open'))assert.match(row.textContent,/Corto sin título/);
  assert.doesNotMatch(w.document.body.textContent,/Una nueva historia por contar/);
  assert.equal(fixture.calls.some(c=>c.method!=='GET'),false,'Viewing the list cannot create, archive or generate anything');
 }finally{dom.window.close();}
});

test('A saved project with a failed opening retries its existing ID instead of creating a duplicate',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true,projectList:true,failOpening:true});
 try{
  const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Crear historia');
  await button.onclick();
  assert.match(w.document.querySelector('#notice').textContent,/proyecto está guardado/);
  assert.equal(button.textContent,'Abrir historia guardada');
  assert.equal(w.location.hash,'#/proyectos/fixture');
  await click('Abrir historia guardada');
  assert.equal(fixture.calls.filter(c=>c.path==='/projects'&&c.method==='POST').length,1);
  assert.equal(fixture.project.title,'Corto sin título');
  assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Generar tres ideas'));
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/ideas:generate')),false);
 }finally{dom.window.close();}
});

test('Scenes show image and voice players inline, references stay under Personajes, and opening views generates nothing',async()=>{
 const {fixture,w,dom,click}=await setup();
 try{
  await click('Escenas');await new Promise(r=>setTimeout(r,0));
  const shots=w.document.querySelectorAll('.scene-card');assert.equal(shots.length,2);
  assert.equal(shots[0].closest('details'),null);
  assert.equal(shots[0].querySelectorAll('.scene-visuals>.asset-card img').length,2,'Approved image and candidate both remain visible');
  assert.ok(shots[0].querySelector('.voice-row audio[controls]'));
  assert.equal(shots[0].querySelector('audio').autoplay,false);
  assert.ok(shots[0].textContent.includes('Todavía estamos a tiempo.'));
  assert.equal([...shots[0].querySelectorAll('button')].some(b=>b.textContent==='Ver imagen'),false);
  const image=shots[0].querySelector('img');image.onclick();assert.ok(w.document.querySelector('.image-dialog[open] img'));await click('Cerrar',w.document.querySelector('.image-dialog'));
  await click('Personajes');await new Promise(r=>setTimeout(r,0));
  assert.equal(w.document.querySelectorAll('.char-card').length,2);assert.equal(w.document.querySelectorAll('.char-card img').length,2);
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/assets:generate')),false);
 }finally{dom.window.close();}
});

test('A media read failure stays local, leaves scene controls usable and cannot approve an unloaded candidate',async()=>{
 const {fixture,w,dom,click}=await setup({failImage:true});
 try{
  await click('Escenas');await new Promise(r=>setTimeout(r,0));
  const broken=[...w.document.querySelectorAll('.asset-card')].find(c=>c.textContent.includes('No se pudo cargar'));
  assert.ok(broken);assert.ok(broken.querySelector('.asset-media button'));
  assert.equal(w.document.querySelectorAll('.scene-card').length,2);
  await click('Aprobar versión',broken);
  assert.equal(fixture.calls.some(c=>c.path.includes('imgCandidate:approve')),false);
  assert.ok(w.document.querySelector('.scene-card .voice-row audio'));
 }finally{dom.window.close();}
});


test('An unknown create response never automatically creates a second project',async()=>{
 const options={empty:true,projectList:true,uncertainCreation:true},{fixture,w,dom,click}=await setup(options);
 try{
  await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Crear historia').onclick();
  assert.match(w.document.querySelector('#notice').textContent,/No se pudo confirmar el guardado/);
  await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Revisar proyectos guardados').onclick();
  assert.equal(options.createCalls,1);assert.equal(w.document.querySelectorAll('.projects-dialog[open] .project-row').length,1);
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/ideas:generate')),false);
 }finally{dom.window.close();}
});

test('Only validated silent video is displayed; playback pauses other media',async()=>{
 const {fixture,w,dom,click}=await setup();
 try{
  fixture.project.assets.push({id:'clip',entityId:'shot1',kind:'veo_silent_validated',approvalState:'approved',created:3});
  fixture.project.assets.push({id:'raw',entityId:'shot2',kind:'veo',approvalState:'quarantined',created:3});
  await click('Escenas');await new Promise(r=>setTimeout(r,0));
  const clip=w.document.querySelector('.asset-media video');assert.ok(clip);assert.equal(clip.muted,true);assert.equal(clip.autoplay,false);assert.equal(clip.playsInline,true);
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/assets/raw/url')),false);
  let pauses=0;const voice=w.document.querySelector('audio');voice.pause=()=>pauses++;
  clip.dispatchEvent(new w.Event('play'));assert.equal(pauses,1);
 }finally{dom.window.close();}
});

test('Ideas display only title and concept; selecting one does not automatically develop it',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true});
 try{
  await click('Generar tres ideas');
  const cards=[...w.document.querySelectorAll('.story-content .grid>.card')];assert.equal(cards.length,3);
  assert.doesNotMatch(cards.map(c=>c.textContent).join(' '),/Conflicto\.|Emoción\.|Ver desenlace|Una decisión cambia/);
  await click('Elegir esta historia',cards[1]);
  assert.equal(fixture.project.selectedIdea.id,'idea2');assert.equal(fixture.calls.some(c=>c.path.endsWith('/develop')),false);
 }finally{dom.window.close();}
});
test('A queued idea remains accessible in Historia after reload, without another generation',async()=>{
 const {fixture,w,dom}=await setup({empty:true,pendingJob:{id:'old',operation:'ideas',state:'queued',revision:1,created:1}});
 try{
  const panel=w.document.querySelector('#activity');assert.equal(panel.hidden,false);assert.match(panel.textContent,/todavía no ha confirmado el arranque/);
  assert.ok([...panel.querySelectorAll('button')].some(b=>b.textContent==='Continuar'));
  assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Generar tres ideas'),false);
  assert.equal(fixture.calls.some(c=>c.path.endsWith('/ideas:generate')),false);
 }finally{dom.window.close();}
});
test('Polling timeout does not claim ongoing work, hide recovery, or resend ideas',async()=>{
 const {fixture,w,dom}=await setup({empty:true,pendingAfterSubmit:true,fastPoll:true});
 try{
  await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Generar tres ideas').onclick();
  assert.match(w.document.querySelector('#notice').textContent,/Todavía no se confirmó el inicio/);
  assert.doesNotMatch(w.document.body.textContent,/El trabajo continúa|aparecerá en Escenas/);
  assert.equal(fixture.calls.filter(c=>c.path.endsWith('/ideas:generate')).length,1);
  assert.equal(fixture.calls.filter(c=>c.path==='/jobs/job1').length,240);
  assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Generar tres ideas'),false);
  assert.ok([...w.document.querySelectorAll('#activity button')].some(b=>b.textContent==='Comprobar estado'));
 }finally{dom.window.close();}
});
test('429 from a provider is displayed in Historia with no automatic resubmission',async()=>{
 const {fixture,w,dom}=await setup({empty:true,pendingAfterSubmit:true,jobSequence:[{state:'failed',settled:true,result:{code:'PROVIDER_QUOTA',error:'Google rejected 429'}}]});
 try{
  await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Generar tres ideas').onclick();
  assert.match(w.document.querySelector('#activity').textContent,/cuota o límite de solicitudes \(429\)/);
  assert.equal(fixture.calls.filter(c=>c.path.endsWith('/ideas:generate')).length,1);
 }finally{dom.window.close();}
});
test('Confirmed Cloud Run operation enables status inspection even while still queued',()=>{
 assert.equal(presentation.taskActions({state:'queued',dispatchState:'submitted',workerOperation:'projects/p/locations/r/operations/o'}).inspect,true);
 assert.equal(presentation.taskActions({state:'queued',dispatchUnknown:true}).recover,false);
 assert.match(presentation.jobMessage({state:'queued',dispatchError:{message:'Sesión pausada'}}),/Sesión pausada/);
});
test('Cold worker starting after the former three-minute limit still paints its three saved ideas',async()=>{
 const states=[...Array.from({length:70},()=>({state:'queued'})),{state:'running'},{state:'awaiting_review',settled:true,result:{ideas:['idea1','idea2','idea3']}}];
 const {fixture,w,dom,click}=await setup({empty:true,pendingAfterSubmit:true,fastPoll:true,jobSequence:states});
 try{
  await click('Generar tres ideas');assert.equal(w.document.querySelectorAll('.story-content .grid>.card').length,3);
  assert.equal(fixture.calls.filter(c=>c.path==='/jobs/job1').length,72);
  assert.equal(fixture.calls.filter(c=>c.path.endsWith('/ideas:generate')).length,1);
 }finally{dom.window.close();}
});
