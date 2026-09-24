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
 const fixture=createFixture(options),dom=new JSDOM(html,{url:'https://fixture.invalid/cortos/',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{...catalogue,steps:presentation.steps,titleFor:presentation.label,terminal:presentation.terminal,versions:presentation.versions,taskActions:presentation.taskActions,entityName:presentation.entityName,fieldLabel:presentation.fieldLabel,TextEncoder,structuredClone,fetch:fixture.transport,confirm:()=>{throw new Error('Unexpected confirmation')},prompt:()=>null});
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.setInterval=()=>0;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
 w.eval(source+'\nwindow.testMount=mountStudio;');await Promise.all(Array.from({length:options.mounts||1},()=>w.testMount(fixture.identity,{transport:fixture.transport,...(options.projectList?{}:{projectId:'fixture'})})));
 async function click(name,parent=w.document){const buttons=[...parent.querySelectorAll('button')].filter(b=>b.textContent===name);assert.equal(buttons.length,1,'Unique button: '+name);await buttons[0].onclick();assert.equal(w.document.querySelector('#notice').className,'',w.document.querySelector('#notice').textContent);}
 return {fixture,w,dom,click};
}
test('Five stages, no budgets, no financial fields in generation requests',async()=>{
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
  assert.equal(ecchi.closest('details').querySelector('summary').textContent,'Crear una historia','Ecchi is not hidden inside optional subgenres');
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
 await click('Aprobar guion y biblias');assert.equal(fixture.project.activeDevelopment,'dev');assert.equal(w.document.querySelector('#steps [aria-current]').textContent,'Producción');dom.window.close();
});
test('Current and candidate remain visible; previous versions are folded; one review approves',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Producción');
 const shot=[...w.document.querySelectorAll('.shot-section')][0];const history=[...shot.querySelectorAll('details')].find(x=>x.querySelector('summary')?.textContent.startsWith('Versiones anteriores'));assert.ok(history);assert.equal(history.open,false);
 const candidate=[...shot.querySelectorAll('.card')].find(x=>x.querySelector(':scope>.badge')?.textContent.includes('Por revisar'));
 assert.ok(candidate);assert.equal(candidate.querySelectorAll('input[type=checkbox]').length,0);
 await click('Ver imagen',candidate);await click('Aprobar versión',candidate);
 const sent=fixture.calls.find(c=>c.path.includes('imgCandidate:approve'));assert.deepEqual(sent.body,{reviewed:true});assert.equal(fixture.project.assetSelections['shot1|image'],'imgCandidate');dom.window.close();
});
test('Manual synchronization is usable with analysis exhausted and without AI calls',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Producción');await click('Música y efectos');
 assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Usar propuesta'),false);
 await click('Ajustar sincronización');assert.ok(w.document.querySelector('#editor[open]'));
 await click('Cargar fotogramas');await click('Fotograma →');await click('El sonido debe coincidir aquí');await click('Este es el golpe');await click('Probar ajuste');await click('Aprobar y fijar');
 assert.equal(fixture.project.cues[0].manualLock,true);assert.equal(fixture.calls.some(c=>c.path.includes(':analyze')||c.path.includes(':correct')),false);
 dom.window.close();
});
test('Subtitle approval, automatic preview preparation and final export are connected',async()=>{
 const {fixture,w,dom,click}=await setup();await click('Revisión');await click('Subtítulos');
 assert.equal([...w.document.querySelectorAll('textarea')].length,1,'No empty exception fields');
 await click('Aprobar subtítulos revisados');await click('Preparar vista previa');await click('Exportar');await click('Aprobar y exportar');await click('Descargar archivos');
 assert.ok(fixture.calls.some(c=>c.path.endsWith('/timeline:compile')));assert.ok(fixture.calls.some(c=>c.path.endsWith('/renders')));assert.equal(w.document.querySelectorAll('.download-list a').length,2);
 assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Compilar montaje'),false);dom.window.close();
});
