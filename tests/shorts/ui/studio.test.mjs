import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createFixture} from './fixture.mjs';
import * as presentation from '../../../cortos/presentation.mjs';
const html=await fs.readFile(new URL('../../../cortos/index.html',import.meta.url),'utf8');
let source=await fs.readFile(new URL('../../../cortos/studio.mjs',import.meta.url),'utf8');
source=source.replace(/^import .*;\n/gm,'').replace('export async function mountStudio','async function mountStudio').replace('export {api,say};','');
async function setup(options={}){
 const fixture=createFixture(options),dom=new JSDOM(html,{url:'https://fixture.invalid/cortos/',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{steps:presentation.steps,titleFor:presentation.label,terminal:presentation.terminal,versions:presentation.versions,taskActions:presentation.taskActions,entityName:presentation.entityName,fieldLabel:presentation.fieldLabel,TextEncoder,structuredClone,fetch:fixture.transport,confirm:()=>{throw new Error('Unexpected confirmation')},prompt:()=>null});
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.setInterval=()=>0;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};w.HTMLMediaElement.prototype.pause=function(){};
 w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});
 w.eval(source+'\nwindow.testMount=mountStudio;');await w.testMount(fixture.identity,{transport:fixture.transport,projectId:'fixture'});
 async function click(name,parent=w.document){const buttons=[...parent.querySelectorAll('button')].filter(b=>b.textContent===name);assert.equal(buttons.length,1,'Unique button: '+name);await buttons[0].onclick();assert.equal(w.document.querySelector('#notice').className,'',w.document.querySelector('#notice').textContent);}
 return {fixture,w,dom,click};
}
test('Five stages, no budgets, no financial fields in generation requests',async()=>{
 const {fixture,w,dom,click}=await setup({empty:true});
 assert.deepEqual([...w.document.querySelectorAll('#steps button')].map(b=>b.textContent),presentation.steps);
 assert.doesNotMatch(w.document.body.textContent,/USD|presupuesto|reserva máxima/);
 await click('Generar tres ideas');const sent=fixture.calls.find(c=>c.path.endsWith('/ideas:generate'));
 assert.ok(sent.body.session);assert.equal('budgetId' in sent.body,false);assert.equal(w.document.querySelectorAll('.story-content .grid>.card').length,3);
 dom.window.close();
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
