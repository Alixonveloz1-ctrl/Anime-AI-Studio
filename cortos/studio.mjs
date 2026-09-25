import {fileHash} from './hash.mjs';
import {steps,label as titleFor,terminal,unresolved,jobMessage,versions,taskActions,entityName,fieldLabel} from './presentation.mjs';
import {genres,subgenres,storyChoice} from './catalog.mjs';
const $=s=>document.querySelector(s), screen=$('#screen'), notice=$('#notice');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let batchRunning=false;
let user,p,stage='Historia',productionTab='tomas',reviewTab='corto',active=false,busy=false,heartbeatBusy=false,needsRedraw=false;
let mediaLoads=[];
let knownJobs=[],watchVersion=0;
const projectTitle=item=>item.title?.trim()||'Corto sin título';
let transport=fetch;
const session=crypto.randomUUID(),device=localStorage.getItem('animeShorts:v2:device')||crypto.randomUUID();localStorage.setItem('animeShorts:v2:device',device);
const say=(s,error=false)=>{notice.textContent=s;notice.className=error?'error':'';};
function action(label,fn,secondary=false){const b=document.createElement('button');b.textContent=label;if(secondary)b.className='secondary';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){say(e.message,true);}finally{b.disabled=false;if(needsRedraw&&!document.querySelector('dialog[open]')){needsRedraw=false;await draw();}}};return b;}
function card(title,content=''){const e=document.createElement('article');e.className='card';e.innerHTML=`<h3>${esc(title)}</h3>${content}`;return e;}
function buttons(parent,items){const row=document.createElement('div');row.className='actions';items.forEach(([label,fn,secondary])=>row.append(action(label,fn,secondary)));parent.append(row);return row;}
async function api(path,method='GET',data,headers={},signal){
  const h={...headers};if(user)h.Authorization='Bearer '+await user.getIdToken();if(data)h['Content-Type']='application/json';
  // Application revisions are not HTTP entity tags. A CDN evaluates If-Match
  // before our gateway and can replace a valid read with an empty 412 response.
  const revision=h['X-Shorts-Revision']??h['If-Match']??(p?String(p.revision):undefined);delete h['If-Match'];
  if(method!=='GET'&&revision!==undefined)h['X-Shorts-Revision']=String(revision);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  let r;
  try{r=await transport('/api/shorts?path='+encodeURIComponent(path),{method,headers:h,cache:'no-store',signal:signal||controller.signal,body:data?JSON.stringify(data):undefined});}
  catch(error){if(controller.signal.aborted)throw new Error('El servicio no respondió en 30 segundos. La solicitud no se repetirá automáticamente.');throw error;}
  finally{clearTimeout(timeout);}
  let j;try{j=await r.json();}catch{
    const error=new Error(`No se pudo leer la respuesta del servicio (${r.status}). La solicitud no se repetirá automáticamente.`);error.status=r.status;throw error;
  }
  if(!r.ok){const error=new Error(j.error||'No se completó la solicitud.');error.status=r.status;error.code=j.code;throw error;}return j;
}
const route=s=>`/projects/${p.id}${s}`;
async function getProject(id){
 const project=await api('/projects/'+id);
 for(const [kind,first] of Object.entries(project.entityCursors||{})){let cursor=first;while(cursor){const page=await api(`/projects/${id}/entities/${kind}/after/${cursor}`);project[kind].push(...page.items);cursor=page.next;}}
 project.developmentDrafts=project.developmentDrafts||[];
 for(const kind of ['ideas','developments','assets','cues','events','timelines','previews','developmentDrafts'])project[kind].sort((a,b)=>(a.created||0)-(b.created||0)||a.id.localeCompare(b.id));
 return project;
}
async function refresh(){p=await getProject(p.id);}
async function mutate(path,data,method='POST'){busy=true;try{while(heartbeatBusy)await new Promise(r=>setTimeout(r,50));await refresh();const result=await api(path,method,data);await refresh();return result;}finally{busy=false;}}
async function lease(enable){if(!p)return;await refresh();const v=await api(route('/lease'),'POST',{session,device,active:enable});p={...p,revision:v.revision,lease:v.lease};active=enable;}
setInterval(async()=>{if(!active||busy||heartbeatBusy||!p)return;heartbeatBusy=true;try{const v=await api(route('/lease'),'POST',{session,device,heartbeat:true,active:true});p.revision=v.revision;p.lease=v.lease;}catch{active=false;say('Lote pausado por pérdida de sesión. Puedes continuar sin rehacer lo terminado.',true);}finally{heartbeatBusy=false;}},10000);
function fold(parent,title,open=false){const d=document.createElement('details');d.className='disclosure';const summary=document.createElement('summary');summary.textContent=title;d.append(summary);d.open=open;parent.append(d);return d;}
function pageTitle(title,subtitle=''){const h=document.createElement('div');h.className='section-heading';h.innerHTML=`<div><p class="eyebrow">${esc(p?.title||'TU ESTUDIO')}</p><h2>${esc(title)}</h2>${subtitle?`<p class="muted">${esc(subtitle)}</p>`:''}</div>`;screen.append(h);return h;}
function empty(title,text){screen.append(card(title,`<p class="muted">${esc(text)}</p>`));}
async function go(next,part){stage=next;if(part&&next==='Escenas')productionTab=part;if(part&&next==='Revisión')reviewTab=part;await draw();}
function tabs(parent,options,selected,onSelect){const nav=document.createElement('nav');nav.className='tabs';nav.setAttribute('aria-label','Contenido de esta etapa');for(const [id,name] of options){const b=action(name,()=>onSelect(id),true);b.setAttribute('aria-pressed',String(id===selected));nav.append(b);}parent.append(nav);}
function describeIssue(text){const d=development();if(!d)return text;let value=String(text);const ids=[...d.shots,...d.utterances,...d.soundRequests,...d.musicRequests,...d.bible.characters,...d.bible.locations,...d.bible.props].sort((a,b)=>b.id.length-a.id.length);for(const row of ids)value=value.replaceAll(row.id,entityName(d,row.id));return value;}
async function runTask(operation,path,data={}){
 if(['ideas','develop'].includes(operation)){
  const {jobs}=await api(route('/jobs'));knownJobs=jobs;
  const existing=jobs.find(j=>j.operation===operation&&unresolved(j));
  if(existing){say('Ya existe una solicitud pendiente. Comprobamos esa misma solicitud.');await watch(existing.id);needsRedraw=true;return existing.id;}
 }
 if(!active)await lease(true);
 await refresh();const projectId=p.id,currentStage=stage;
 const bytes=new TextEncoder().encode(JSON.stringify([projectId,operation,path,data]));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const storageKey='animeShorts:request:'+hash,key=localStorage.getItem(storageKey)||crypto.randomUUID();localStorage.setItem(storageKey,key);
 let job;try{job=await api(path,'POST',{...data,session},{'Idempotency-Key':key});}catch(e){if(e.status&&e.status<500)localStorage.removeItem(storageKey);throw e;}
 say('Solicitud guardada. Comprobando su estado…');
 const result=await watch(job.jobId,projectId);
 if(result&&terminal(result.state)&&result.state!=='submitted_unknown')localStorage.removeItem(storageKey);
 if(p?.id===projectId&&stage===currentStage)needsRedraw=true;
 return job.jobId;
}
function showJob(job){
 const panel=$('#activity');panel.hidden=false;panel.replaceChildren();
 const text=document.createElement('div'),heading=document.createElement('strong'),message=document.createElement('p');
 heading.textContent=titleFor(job.operation)+' · '+titleFor(job.state);message.textContent=job.state==='running'&&job.progress?`${job.progress.stage}/${job.progress.total} · ${job.progress.label}`:describeIssue(jobMessage(job));text.append(heading,message);panel.append(text);
 const controls=[],available=taskActions(job);
 if(unresolved(job))controls.push(['Comprobar estado',async()=>{
  const latest=await api('/jobs/'+job.id);
  if(taskActions(latest).inspect){const result=await api('/jobs/'+job.id+':inspect','POST',{}, {'If-Match':String(latest.revision)});say(result.message);}
  await watch(job.id);await draw();
 },true]);
 if(available.recover)controls.push(['Continuar',async()=>{
  if(!active)await lease(true);const latest=await api('/jobs/'+job.id);
  await api('/jobs/'+job.id+':resume','POST',{session},{'If-Match':String(latest.revision)});
  await watch(job.id);await draw();
 },true]);
 if(available.cancel)controls.push(['Cancelar',async()=>{
  const latest=await api('/jobs/'+job.id);await api('/jobs/'+job.id+':cancel','POST',{}, {'If-Match':String(latest.revision)});
  ++watchVersion;await draw();say('Cancelación solicitada. Lo ya generado se conserva.');
 },true]);
 if(['awaiting_review','succeeded'].includes(job.state))controls.push(['Ver resultado',()=>go(['ideas','develop','revise'].includes(job.operation)?'Historia':'Escenas'),true]);
 buttons(panel,controls);
}
async function watch(id,projectId=p?.id){
 const version=++watchVersion;
 // Cold Cloud Run jobs can start after the old three-minute window. Keep
 // reading the same ID for twelve minutes; never turn a slow read into a POST.
 for(let n=0;n<240;n++){
  let j;try{j=await api('/jobs/'+id);}catch(error){say('No se pudo comprobar el trabajo. '+error.message,true);return;}
  if(version!==watchVersion||p?.id!==projectId)return j;
  knownJobs=[j,...knownJobs.filter(x=>x.id!==j.id)];showJob(j);
  if(terminal(j.state)){
   say(describeIssue(jobMessage(j)),['failed','submitted_unknown'].includes(j.state));
   await refresh();return j;
  }
  if(j.dispatchError||j.queueError){say(jobMessage(j),true);return j;}
  if(n===239){say(j.state==='queued'?'Todavía no se confirmó el inicio. Puedes comprobar o cancelar este mismo trabajo.':'La consulta automática se pausó. Usa Comprobar estado para consultar este mismo trabajo.');return j;}
  await new Promise(r=>setTimeout(r,3000));
 }
}
function navigation(){
 const nav=$('#steps');nav.replaceChildren();
 const icons=['🌌','👥','🎬','📤'];
 for(const [i,name] of steps.entries()){
  const b=action(name,()=>go(name),true);b.dataset.icon=icons[i];b.disabled=name!=='Historia'&&!p;
  const selected=name===stage||(name==='Exportar'&&stage==='Revisión');
  b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');nav.append(b);
 }
 $('#project-name').textContent=p?projectTitle(p):'';
}
let drawRequest=0,drawQueue=Promise.resolve();
function draw(){
 const request=++drawRequest;
 const pending=drawQueue.catch(()=>{}).then(()=>{if(request===drawRequest)return drawScreen();});
 drawQueue=pending;return pending;
}
async function drawScreen(){
 mediaLoads=[];
 await renderStage();
 const queued=mediaLoads,generation=drawRequest;
 // Paint the complete page first. Read only visible media, at most three at a
 // time. A slow or inaccessible image never hides the other scene controls.
 void Promise.all(Array.from({length:3},async()=>{
  while(queued.length&&generation===drawRequest){const load=queued.shift();await load();}
 }));
}
async function renderStage(){
 if(!p)stage='Historia';
 if(p)await refresh();navigation();screen.replaceChildren();
 if(!p){$('#activity').hidden=true;knownJobs=[];return newProject();}
 try{
  const {jobs}=await api(route('/jobs'));knownJobs=jobs;
  const latest=[...jobs].sort((a,b)=>(b.created||0)-(a.created||0));
  const current=latest.find(unresolved)||latest.find(j=>j.state==='failed');
  if(current)showJob(current);else $('#activity').hidden=true;
 }catch(error){say('No se pudo leer el estado de los trabajos. '+error.message,true);}
 if(stage==='Historia'){pageTitle('Tu historia');tabs(screen,[['ideas','Ideas'],['guion','Guion y biblias']],p.selectedIdea?'guion':'ideas',async part=>{screen.querySelector('.story-content')?.remove();const slot=document.createElement('div');slot.className='story-content';screen.append(slot);await (part==='ideas'?ideas:script)(slot);[...screen.querySelectorAll('.tabs button')].forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===(part==='ideas'?'Ideas':'Guion y biblias'))));});const slot=document.createElement('div');slot.className='story-content';screen.append(slot);return (p.selectedIdea?script:ideas)(slot);}
 if(stage==='Personajes')return references();
 if(stage==='Escenas')return production();
 if(stage==='Revisión')return review();
 return exportsView();
}
async function openProject(id){
 const next=await getProject(id);
 if(active)await lease(false);
 ++watchVersion;knownJobs=[];p=next;stage='Historia';location.hash=`/proyectos/${id}`;await draw();
}
function openFailure(id,error){
 say('El proyecto está guardado, pero no se pudo abrir. '+error.message,true);
 notice.append(action('Volver a abrir',async()=>{await openProject(id);say('Proyecto abierto.');},true));
}
function newProject(){
 const form=card('🌌 Crear corto');form.id='new-project';screen.append(form);
 const choices=items=>items.map(g=>`<label class="choice"><input type="checkbox" class="subgenre" value="${esc(g.value)}"> ${esc(g.label)}</label>`).join('');
 form.insertAdjacentHTML('beforeend',`<label>Género principal<select id="genre">${genres.map(g=>`<option value="${esc(g.value)}">${esc(g.label)}</option>`).join('')}</select></label><fieldset class="story-subgenres"><legend>Subgéneros · puedes elegir varios</legend><div class="choice-grid">${choices(subgenres.filter(g=>g.legacyId))}</div><details class="disclosure"><summary>Más subgéneros</summary><div class="choice-grid">${choices(subgenres.filter(g=>!g.legacyId))}</div></details></fieldset><label>Concepto opcional<textarea id="concept" placeholder="Una situación, un personaje, una emoción…"></textarea></label><label>Título opcional<input id="title" placeholder="Lo puedes decidir después"></label><label>Formato<select id="format"><option value="16:9">Horizontal · 16:9</option><option value="9:16">Vertical · 9:16</option></select></label><p class="muted">Después podrás generar tres ideas distintas y elegir una.</p>`);
 let created,creationUncertain=false;
 const create=action('Crear historia',async()=>{
  if(creationUncertain){await projectList();return;}
  if(!created){
   const settings=storyChoice(form.querySelector('#genre').value,[...form.querySelectorAll('.subgenre:checked')].map(e=>e.value));
   try{created=await api('/projects','POST',{title:form.querySelector('#title').value.trim()||'Corto sin título',...settings,concept:form.querySelector('#concept').value,format:form.querySelector('#format').value});}
   catch(error){if(!error.status||error.status<400||error.status>=500){creationUncertain=true;create.textContent='Revisar proyectos guardados';say('No se pudo confirmar el guardado. Revisa Proyectos antes de crear otro corto.',true);return;}throw error;}
   // Keep the successful ID even if opening fails. Retrying this button opens
   // that record instead of creating a second project.
   create.textContent='Abrir historia guardada';location.hash=`/proyectos/${created.id}`;
  }
  try{await openProject(created.id);say('Proyecto guardado. Ahora puedes generar tus tres ideas.');}
  catch(error){openFailure(created.id,error);}
 });
 const row=document.createElement('div');row.className='actions';row.append(create);form.append(row);
}
async function projectList(){
 if(document.querySelector('.projects-dialog[open]'))return;
 const dialog=document.createElement('dialog');dialog.className='projects-dialog';document.body.append(dialog);
 const heading=document.createElement('div');heading.className='dialog-header';const h=document.createElement('h2');h.textContent='📁 Proyectos';heading.append(h,action('Cerrar',()=>{dialog.close();dialog.remove();},true));dialog.append(heading);
 const content=document.createElement('div');dialog.append(content);content.textContent='Cargando proyectos…';dialog.showModal();
 try{
  const list=await api('/projects');content.replaceChildren();
  const visible=list.projects.filter(x=>!x.archived);
  if(!visible.length){const line=document.createElement('p');line.textContent='Todavía no has guardado ningún corto.';content.append(line);}
  for(const item of visible){
   const row=document.createElement('div');row.className='project-row';
   const open=action(projectTitle(item),async()=>{try{await openProject(item.id);dialog.close();dialog.remove();say('Proyecto abierto.');}catch(error){openFailure(item.id,error);}},true);open.className='project-open';
   const meta=document.createElement('small');meta.textContent=[item.genre,item.created?new Date(item.created*1000).toLocaleString('es'):null].filter(Boolean).join(' · ');open.append(meta);row.append(open);
   const archive=action('Archivar',async()=>{
    if(!confirm('¿Archivar este corto? Su guion y sus archivos se conservarán.'))return;
    const stored=await getProject(item.id);
    await api(`/projects/${item.id}`,'PATCH',{archived:true},{'X-Shorts-Revision':String(stored.revision)});
    if(p?.id===item.id){if(active)await lease(false);p=null;stage='Historia';location.hash='';await draw();}
    row.remove();say('Corto archivado. Sus archivos se conservan.');
   },true);row.append(archive);content.append(row);
  }
  buttons(content,[['＋ Nuevo proyecto',async()=>{if(active)await lease(false);p=null;stage='Historia';location.hash='';dialog.close();dialog.remove();await draw();say('');}]]);
  const archived=list.projects.filter(x=>x.archived);
  if(archived.length){const history=fold(content,'Archivados · '+archived.length);for(const item of archived)buttons(history,[[`Recuperar ${projectTitle(item)}`,async()=>{const stored=await getProject(item.id);await api(`/projects/${item.id}`,'PATCH',{archived:false},{'X-Shorts-Revision':String(stored.revision)});dialog.close();dialog.remove();await projectList();},true]]);}
 }catch(error){content.textContent='No se pudo leer la lista: '+error.message;buttons(content,[['Reintentar',async()=>{dialog.close();dialog.remove();await projectList();},true]]);}
}
async function ideas(parent=screen){
 const c=card('El comienzo',`<p>${esc(p.genre)}${p.subgenres.length?' · '+esc(p.subgenres.join(', ')):''}</p><p class="muted">${esc(p.concept||'Partimos de tu género para proponer tres historias distintas.')}</p><p class="muted">Tres títulos con un concepto breve. Solo desarrollaremos la historia que elijas.</p>`);
 const pending=knownJobs.some(j=>j.operation==='ideas'&&unresolved(j));
 if(pending){const note=document.createElement('p');note.textContent='Ya hay una solicitud de ideas pendiente. Su estado aparece arriba.';c.append(note);}
 else buttons(c,[[p.ideas.length?'Generar otras tres ideas':'Generar tres ideas',()=>runTask('ideas',route('/ideas:generate'))]]);parent.append(c);
 const batches=Object.values(Object.groupBy(p.ideas||[],x=>x.batchId)).reverse();
 for(const [index,batch] of batches.entries()){const target=index?fold(parent,'Propuestas anteriores'):parent,grid=document.createElement('div');grid.className='grid';target.append(grid);const latest=new Map();for(const idea of batch)latest.set(idea.data.id,idea);for(const idea of latest.values())candidates(grid,idea,idea.data,'ideas');const old=batch.filter(x=>latest.get(x.data.id)!==x);if(old.length){const h=fold(target,'Versiones anteriores de estas ideas');old.forEach(x=>candidates(h,x,x.data,'ideas'));}}
}
function candidates(parent,entity,d,kind){const selected=p.selectedIdea?.id===entity.id,c=card(d.title||'Propuesta',`<p>${esc(d.premise||'')}</p>`);buttons(c,[[selected?'Idea elegida':'Elegir esta historia',async()=>{await mutate(route(`/ideas/${entity.id}:select`),{});await go('Historia');}],['Ajustar idea',()=>revise(kind,entity),true]]);parent.append(c);}

async function revise(kind,e){
 if(kind==='ideas'){
  const dialog=document.createElement('dialog');document.body.append(dialog);const label=document.createElement('label');label.textContent='Parte de la idea';const select=document.createElement('select');
  for(const [field,title] of Object.entries({title:'Título',premise:'Concepto'})){const option=document.createElement('option');option.value=field;option.textContent=title;select.append(option);}label.append(select);dialog.append(label);
  const instruction=document.createElement('textarea');instruction.placeholder='¿Qué debe cambiar en esa parte?';dialog.append(instruction);
  buttons(dialog,[['Crear candidata',async()=>{if(!instruction.value.trim())throw new Error('Describe el cambio.');const id=await runTask('revise',route(`/revisions/${kind}/${e.id}:revise`),{instruction:instruction.value,scope:{field:select.value}});if(id){dialog.close();dialog.remove();await draw();}}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();return;
 }
 const dialog=document.createElement('dialog');document.body.append(dialog);const heading=document.createElement('h2');heading.textContent='Corregir una parte con IA';dialog.append(heading);
 const label=document.createElement('label');label.textContent='Alcance';const select=document.createElement('select'),options=[];
 for(const [group,name,rows] of [['shots','Toma',e.data.shots],['utterances','Intervención',e.data.utterances],['characters','Personaje',e.data.bible.characters],['locations','Lugar',e.data.bible.locations],['props','Objeto',e.data.bible.props],['soundRequests','Efecto',e.data.soundRequests],['musicRequests','Música',e.data.musicRequests]])for(const item of rows){options.push({group,entityId:item.id});const option=document.createElement('option');option.value=options.length-1;option.textContent=`${name}: ${item.name||item.spanish||entityName(e.data,item.id)}`;select.append(option);}
 options.push({group:'whole'});const entire=document.createElement('option');entire.value=options.length-1;entire.textContent='Guion completo (revisar todo el impacto)';select.append(entire);label.append(select);dialog.append(label);
 const instruction=document.createElement('textarea');instruction.placeholder='Describe qué debe cambiar y qué debe conservarse';const field=document.createElement('label');field.textContent='Corrección';field.append(instruction);dialog.append(field);
 buttons(dialog,[['Crear candidata',async()=>{if(!instruction.value.trim())throw new Error('Describe la corrección.');await runTask('revise',route(`/revisions/${kind}/${e.id}:revise`),{instruction:instruction.value,scope:options[Number(select.value)]});dialog.close();dialog.remove();await draw();}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}
async function approve(kind,id,reviewed=false){await mutate(route(`/revisions/${kind}/${id}:approve`),{reviewed});needsRedraw=true;say('Versión aprobada y conservada.');}
function readable(parent,value){
 const labels={story:'Historia',beats:'Momentos dramáticos',shots:'Planos',utterances:'Voces del guion',soundRequests:'Efectos de sonido',musicRequests:'Música',subtitles:'Subtítulos',dramatic:'Dirección dramática',visual:'Estilo visual',characters:'Personajes',locations:'Lugares',props:'Objetos',name:'Nombre',japaneseReading:'Lectura japonesa',age:'Edad',objective:'Objetivo',relationships:'Relaciones',speech:'Forma de hablar',voice:'Voz',languageCode:'Idioma',direction:'Actuación',costumes:'Vestuario',description:'Descripción',referencePrompt:'Referencia visual',layout:'Distribución',entrances:'Entradas',windows:'Ventanas',furniture:'Mobiliario',light:'Luz',soundZones:'Zonas sonoras',owner:'Poseedor',state:'Estado'};
 for(const [key,item] of Object.entries(value)){if(['id','hash','sha256','developmentId','assetId','audioHash','nativeQualityGuaranteed','assetRevision','audioRevision','voiceBinding'].includes(key))continue;if(item&&typeof item==='object'){const group=document.createElement('details'),title=document.createElement('summary');title.textContent=item.name||labels[key]||(/^[0-9]+$/.test(key)?'Elemento '+(Number(key)+1):fieldLabel(key));group.append(title);readable(group,item);parent.append(group);}else{const line=document.createElement('p'),label=document.createElement('strong');label.textContent=(labels[key]||fieldLabel(key))+': ';line.append(label,document.createTextNode(typeof item==='boolean'?(item?'Sí':'No'):String(item??'')));parent.append(line);}}
}
async function script(parent=screen){
 if(!p.selectedIdea){const c=card('Elige una idea primero','<p>Las tres propuestas son el punto de partida de tu guion.</p>');buttons(c,[['Ver ideas',()=>ideas(parent)]]);parent.append(c);return;}
 const intro=card('Guion y biblias',`<p>${esc(p.ideas.find(i=>i.id===p.selectedIdea?.id)?.data.title||'Tu historia elegida')}</p>`);
 const working=knownJobs.some(j=>j.operation==='develop'&&unresolved(j));
 const stages=['Historia','Guion, biblias y planos','Sonido, música y subtítulos','Revisión de continuidad'];
 const drafts=(p.developmentDrafts||[]).filter(d=>d.ideaId===p.selectedIdea.id);
 let approved=drafts.find(d=>d.id===p.activeDraft&&d.approvalState==='approved');
 if(approved&&drafts.some(d=>d.stage===1&&d.approvalState!=='approved'&&d.created>approved.created))approved=null;
 const next=(approved?.stage||0)+1;
 const choices=drafts.filter(d=>d.stage===next&&(next===1||d.sourceDraftId===approved?.id)).sort((a,b)=>b.created-a.created);
 const latest=choices[0];
 const parentId=approved?.id;
 const runStage=(number,instruction='')=>runTask('develop',route('/develop'),{stage:number,sourceDraftId:number>1?parentId:null,instruction});
 const note=document.createElement('p');note.textContent='Cada paso se genera solo cuando lo pides. Lee el resultado y apruébalo antes de continuar.';intro.append(note);
 if(approved){const details=fold(intro,'Paso '+approved.stage+' aprobado · '+stages[approved.stage-1]);try{const saved=await api(route('/drafts/'+approved.id));readable(details,saved.data);}catch(e){details.append(document.createTextNode(e.message));}}
 if(working){const note=document.createElement('p');note.textContent='El paso solicitado está pendiente. Su estado aparece arriba.';intro.append(note);}
 else if(next<=4){
  const heading=document.createElement('h4');heading.textContent='Paso '+next+' de 4 · '+stages[next-1];intro.append(heading);
  if(latest){
   try{
    const saved=await api(route('/drafts/'+latest.id));
    if(saved.data?.story){const story=document.createElement('p');story.style.whiteSpace='pre-wrap';story.textContent=saved.data.story;intro.append(story);}
    if(next>1){const details=fold(intro,'Leer contenido de este paso',true);const groups=next===2?['bible','shots','utterances']:next===3?['soundRequests','musicRequests','subtitles']:[];for(const group of groups)if(saved.data?.[group])readable(details,{[group]:saved.data[group]});if(saved.review)readable(details,saved.review);}
    if(saved.error){const error=document.createElement('p');error.textContent=saved.error.message+' Los pasos aprobados siguen guardados.';intro.append(error);}
    if(saved.status==='ready'&&next<4)buttons(intro,[['Aprobar este paso',async()=>{await mutate(route('/drafts/'+saved.id+':approve'),{});await draw();say('Paso aprobado. El siguiente se genera únicamente cuando lo solicites.');}]]);
   }catch(e){const error=document.createElement('p');error.textContent=e.message;intro.append(error);}
  }
  const label=document.createElement('label');label.textContent=latest?'Qué quieres corregir en este paso (opcional)':'Indicaciones para este paso (opcional)';
  const instruction=document.createElement('textarea');instruction.maxLength=3000;label.append(instruction);intro.append(label);
  buttons(intro,[[latest?'Generar otra versión de este paso':'Generar '+stages[next-1].toLowerCase(),()=>runStage(next,instruction.value)]]);
  if(next===1){
   const old=drafts.filter(d=>!d.stage&&d.hasStory).sort((a,b)=>b.created-a.created);
   if(old.length){const history=fold(intro,'Recuperar historias de intentos anteriores');for(const draft of old)buttons(history,[['Recuperar historia · '+new Date(draft.created*1000).toLocaleString(),async()=>{await mutate(route('/drafts/'+draft.id+':recover'),{});await draw();say('Historia recuperada para leer y aprobar. No se llamó a Gemini.');},true]]);}
  }
 }
 if(p.activeDevelopment)buttons(intro,[['Continuar a producción',()=>go('Escenas')]]);
 if(approved){const restart=fold(intro,'Crear otra historia para esta idea');buttons(restart,[['Generar otra historia',()=>runStage(1),true]]);}
 parent.append(intro);
 const grouped=versions(p.developments,p.activeDevelopment);
 const show=(target,e)=>{const d=e.data,c=card(d.title,`<p class="badge">${esc(titleFor(e.approvalState))}${e.id===p.activeDevelopment?' · versión en uso':''}</p>`);
 for(const [index,shot] of d.shots.entries()){const scene=fold(c,`Toma ${index+1} · ${(shot.frames/24).toFixed(1)} s · ${shot.function}`);for(const u of d.utterances.filter(u=>u.shotId===shot.id)){const line=document.createElement('p');line.innerHTML=`<strong>${esc(entityName(d,u.speakerId))}</strong><br>${esc(u.spanish)}`;scene.append(line);const jp=fold(scene,'Japonés y actuación');jp.append(document.createTextNode(u.japanese+' · '+u.acting));}const direction=fold(scene,'Dirección visual');direction.append(document.createTextNode(shot.prompt));}
 const bible=fold(c,'Personajes, lugares y objetos');readable(bible,d.bible);
 if(e.impact){const changes=fold(c,'Qué cambia en esta versión');const line=document.createElement('p');line.textContent=`${e.impact.changes.length} cambios. ${e.impact.assetsNeedingReview?.length||0} recursos necesitan revisión.`;changes.append(line);for(const asset of e.impact.assetsNeedingReview||[]){const note=document.createElement('p');note.textContent=entityName(d,asset.entityId);changes.append(note);}}
 if(e.review){const report=fold(c,'Notas de revisión');readable(report,e.review);}
 if(e.approvalState==='candidate')buttons(c,[['Aprobar guion y biblias',async()=>{await approve('developments',e.id);await go('Escenas');}]]);
 else if(e.approvalState==='approved'&&e.id!==p.activeDevelopment)buttons(c,[['Usar esta versión',()=>approve('developments',e.id),true]]);
 const edit=fold(c,'Editar esta versión');buttons(edit,[['Corregir con IA',()=>revise('developments',e),true],['Editar manualmente',()=>editDevelopment(e),true]]);target.append(c);};
 grouped.visible.forEach(e=>show(parent,e));if(grouped.history.length){const h=fold(parent,'Historial del guion · '+grouped.history.length);grouped.history.forEach(e=>show(h,e));}
}
async function production(){
 const heading=pageTitle('Escenas','Da forma a las imágenes, las voces y el sonido.');
 if(!development()){empty('Tu guion está primero','Aprueba el guion y sus biblias en Historia para preparar los recursos.');buttons(screen,[['Ir a Historia',()=>go('Historia')]]);return;}
 buttons(heading,[['Revisar el corto',()=>go('Revisión'),true],[batchRunning?'Producción en marcha':'Generar pendientes',()=>runBatch()],...(active?[['Pausar',async()=>{batchRunning=false;await lease(false);say('Producción pausada. Lo terminado se conserva.');await draw();},true]]:[])]);
 tabs(screen,[['tomas','Escenas y voces'],['sonido','Música y efectos']],productionTab,async part=>{productionTab=part;await draw();});
 if(productionTab==='sonido')await sounds();else await shots();
 await activityList();
}
async function activityList(){
 const {jobs}=await api(route('/jobs'));if(!jobs.length)return;
 const pending=jobs.filter(j=>!j.settled&&!terminal(j.state)),attention=jobs.filter(j=>j.state==='submitted_unknown'||j.state==='failed');
 const box=fold(screen,'Actividad · '+pending.length+' en curso',attention.length>0);
 const ordered=[...jobs].sort((a,b)=>(b.created||0)-(a.created||0));
 for(const job of ordered.slice(0,30)){const row=document.createElement('div');row.className='activity-row';row.innerHTML=`<p><strong>${esc(titleFor(job.operation))}</strong><span class="muted">${esc(titleFor(job.state))}</span></p>`;const a=taskActions(job),items=[];
 if(a.recover)items.push(['Continuar',async()=>{if(!active)await lease(true);const j=await api('/jobs/'+job.id);await api('/jobs/'+job.id+':resume','POST',{session},{'If-Match':String(j.revision)});await watch(job.id);await draw();},true]);
 if(a.cancel)items.push(['Cancelar',async()=>{const j=await api('/jobs/'+job.id);await api('/jobs/'+job.id+':cancel','POST',{}, {'If-Match':String(j.revision)});await draw();},true]);
 if(a.inspect)items.push(['Comprobar estado',async()=>{const j=await api('/jobs/'+job.id);const result=await api('/jobs/'+job.id+':inspect','POST',{}, {'If-Match':String(j.revision)});say(result.message);await draw();},true]);
 if(job.result?.previewId)items.push(['Reproducir',()=>playPreview(job.result.previewId,row),true]);
 if(items.length)buttons(row,items);if(job.result?.error){const message=document.createElement('p');message.className='muted';message.textContent=describeIssue(job.result.error);row.append(message);}box.append(row);
 }
}

async function runBatch(){
 if(batchRunning)return;
 const plan=await api(route('/batches')),ready=plan.nodes.filter(x=>x.state==='ready');
 if(!ready.length){say('No hay generaciones listas. Revisa y aprueba las candidatas o completa sus referencias.');return;}
 say(`Preparando ${ready.length} recursos pendientes. Conservamos las versiones ya creadas.`);
 await lease(true);const batch=await mutate(route('/batches'),{session,acceptPlanHash:plan.planHash});batchRunning=true;
 const allowed=new Set(ready.map(x=>x.key));
 try{for(let n=0;n<plan.nodes.length&&batchRunning&&active;n++){
  const now=await api(route('/batches'));const next=now.nodes.find(x=>x.state==='ready');
  if(!next||!allowed.has(next.key)){say('Lote conservado. Revisa las candidatas antes de continuar la siguiente etapa.');break;}
  await refresh();const result=await api(route(`/batches/${batch.id}:next`),'POST',{session});
  if(!result.jobId){say('Pendientes guardados para revisión.');break;}
  const job=await watch(result.jobId);if(!job||!['succeeded','awaiting_review'].includes(job.state)){say('Lote pausado: revisa la tarea antes de continuar.',true);break;}
 }}finally{batchRunning=false;needsRedraw=true;}
}

const development=()=>p.developments.find(x=>x.id===p.activeDevelopment)?.data;
const selectedAsset=(id,kind)=>p.assets.find(a=>a.id===p.assetSelections?.[id+'|'+kind])||p.assets.filter(a=>a.entityId===id&&a.kind===kind&&a.approvalState==='approved').at(-1);
function expandImage(url,name){
 const dialog=document.createElement('dialog');dialog.className='image-dialog';const bar=document.createElement('div');bar.className='dialog-header';const label=document.createElement('strong');label.textContent=name;bar.append(label,action('Cerrar',()=>{dialog.close();dialog.remove();},true));dialog.append(bar);
 const img=document.createElement('img');img.src=url;img.alt=name;dialog.append(img);document.body.append(dialog);dialog.showModal();
}
async function assetCard(parent,a){
 const name=entityName(development(),a.entityId),projectId=p.id;
 const c=card(titleFor(a.kind),`<p class="badge">${esc(titleFor(a.approvalState))}${selectedAsset(a.entityId,a.kind)?.id===a.id?' · en uso':''}</p>`);c.classList.add('asset-card');parent.append(c);
 if(a.requestId&&a.samples){const requested=development()?.soundRequests.find(x=>x.id===a.requestId);const duration=document.createElement('p');duration.className='muted';duration.textContent=`Solicitado: ${requested?.seconds??'—'} s · archivo: ${(a.samples/48000).toFixed(2)} s`;c.append(duration);}
 const mediaBox=document.createElement('div');mediaBox.className='asset-media';c.append(mediaBox);
 if(a.approvalState==='quarantined'||!['image','pcm','veo_silent_validated'].includes(a.kind)){mediaBox.textContent='Este archivo no está validado para reproducirse.';return;}
 let opened=false,loading;
 const open=()=>{
  if(loading)return loading;
  if(opened)return Promise.resolve();
  mediaBox.textContent='Cargando '+titleFor(a.kind).toLowerCase()+'…';
  loading=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const {url}=await api(`/projects/${projectId}/assets/${a.id}/url`,'GET',undefined,{},controller.signal);
    if(!c.isConnected)return;
    const media=document.createElement(a.kind==='image'?'img':a.kind==='pcm'?'audio':'video');
    media.src=url;media.controls=true;media.playsInline=true;media.preload='none';media.alt=name;
    if(a.kind==='image'){media.loading='lazy';media.decoding='async';media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label','Ampliar imagen de '+name);media.onclick=()=>expandImage(url,name);media.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();expandImage(url,name);}};}
    // The backend supplies only validated silent Veo derivatives. Raw provider
    // files never appear in this view; integrated playback uses muxed previews.
    if(a.kind==='veo_silent_validated')media.muted=true;
    media.onloadeddata=()=>{opened=true;};media.onload=()=>{opened=true;};
    media.onerror=()=>{opened=false;mediaBox.textContent='No se pudo cargar este archivo.';mediaBox.append(action('Volver a cargar',open,true));};
    mediaBox.replaceChildren(media);
   }catch(error){mediaBox.textContent='No se pudo cargar este archivo.';mediaBox.append(action('Volver a cargar',open,true));}
   finally{clearTimeout(timer);loading=null;}
  })();return loading;
 };
 mediaLoads.push(open);
 if(a.approvalState==='candidate')buttons(c,[['Aprobar versión',async()=>{if(!opened){await open();say('Revisa el recurso cargado y pulsa Aprobar versión cuando esté listo.');return;}await approve('assets',a.id,true);},true]]);
 else if(a.approvalState==='approved'&&selectedAsset(a.entityId,a.kind)?.id!==a.id)buttons(c,[['Usar esta versión',()=>approve('assets',a.id),true]]);
}
async function assetVersions(parent,rows){
 const groups=Object.groupBy(rows,a=>a.entityId+'|'+a.kind);
 for(const [key,items] of Object.entries(groups)){const v=versions(items,p.assetSelections?.[key]);for(const item of v.visible)await assetCard(parent,item);if(v.history.length){const h=fold(parent,'Versiones anteriores · '+v.history.length);let loaded=false;h.addEventListener('toggle',async()=>{if(h.open&&!loaded){loaded=true;const start=mediaLoads.length;for(const item of v.history)await assetCard(h,item);const queue=mediaLoads.splice(start);for(const load of queue)await load();}});}}
}
async function references(){
 pageTitle('👥 Personajes, lugares y objetos');
 const d=development();
 if(!d){empty('Aprueba primero tu historia','Las fichas de esta historia aparecerán aquí después de aprobar el guion y sus biblias.');buttons(screen,[['Ir a Historia',()=>go('Historia')]]);return;}
 for(const [group,title] of [['characters','Personajes'],['locations','Lugares'],['props','Objetos']]){
  if(!d.bible[group].length)continue;
  const heading=document.createElement('h3');heading.textContent=title;screen.append(heading);
  for(const e of d.bible[group]){
   const section=card(e.name);section.classList.add('char-card');screen.append(section);
   const description=document.createElement('p');description.className='char-detail';description.textContent=e.description||e.objective||e.layout||e.state||'';section.append(description);
   const rows=p.assets.filter(a=>a.entityId===e.id);await assetVersions(section,rows);
   if(!rows.length){const placeholder=document.createElement('div');placeholder.className='scene-img media-empty';placeholder.textContent='Referencia por generar';section.append(placeholder);}
   buttons(section,[[rows.length?'Crear otra referencia':'Generar referencia',()=>runTask('image',route('/assets:generate'),{operation:'image',entityId:e.id}),rows.length>0]]);
   const details=fold(section,'Ficha y dirección visual');readable(details,e);
  }
 }
 const importBox=fold(screen,'Reutilizar de otra historia');buttons(importBox,[['Importar referencia o música',()=>importAsset(),true]]);
}
async function shots(){
 const d=development();
 const pending=['characters','locations','props'].flatMap(k=>d.bible[k]).filter(e=>!selectedAsset(e.id,'image'));
 if(pending.length){const c=card('Referencias pendientes',`<p>${pending.length} fichas necesitan una imagen aprobada para producir las escenas.</p>`);buttons(c,[['Ver personajes y referencias',()=>go('Personajes'),true]]);screen.append(c);}
 for(const [index,shot] of d.shots.entries()){
  const has=selectedAsset(shot.id,shot.treatment==='veo'?'veo_silent_validated':'image');
  const c=document.createElement('article');c.className='shot-section scene-card';c.dataset.shot=shot.id;screen.append(c);
  const header=document.createElement('div');header.className='scene-header';header.innerHTML=`<h3 class="scene-num">Plano ${String(index+1).padStart(2,'0')}</h3><span class="scene-act">${esc(titleFor(shot.treatment))} · ${(shot.frames/24).toFixed(1)} s</span>`;c.append(header);
  const image=selectedAsset(shot.id,'image'),visuals=p.assets.filter(a=>a.entityId===shot.id||a.variantOf===shot.id);
  const media=document.createElement('div');media.className='scene-visuals';c.append(media);
  if(!visuals.length){const placeholder=document.createElement('div');placeholder.className='scene-img media-empty';placeholder.style.aspectRatio=p.format==='9:16'?'9 / 16':'16 / 9';placeholder.textContent='Imagen por generar';media.append(placeholder);}
  await assetVersions(media,visuals);
  const description=document.createElement('p');description.className='scene-narration';description.textContent=shot.function;c.append(description);
  const actions=[];
  if(!image&&!visuals.some(a=>a.kind==='image'&&a.approvalState==='candidate'))actions.push(['Generar imagen',()=>runTask('image',route('/assets:generate'),{operation:'image',entityId:shot.id})]);
  if(image&&shot.treatment==='veo'&&!visuals.some(a=>a.kind==='veo_silent_validated'&&['candidate','approved'].includes(a.approvalState)))actions.push(['Generar video',()=>runTask('veo',route('/assets:generate'),{operation:'veo',entityId:shot.id,seconds:8})]);
  if(actions.length)buttons(c,actions);
  for(const u of d.utterances.filter(u=>u.shotId===shot.id)){
   const row=document.createElement('div');row.className='voice-row';row.innerHTML=`<p><strong>🎙️ ${esc(entityName(d,u.speakerId))}</strong></p><p class="scene-narration">${esc(u.spanish)}</p>`;c.append(row);
   const assets=p.assets.filter(a=>a.entityId===u.id);await assetVersions(row,assets);
   buttons(row,[[assets.length?'Generar otra interpretación':'Generar voz japonesa',()=>runTask('tts',route('/assets:generate'),{operation:'tts',entityId:u.id}),assets.length>0]]);
  }
  if(has)buttons(c,[['Ver toma completa',()=>previewShots([shot.id],c)]]);
  const direction=fold(c,'Dirección visual');direction.append(document.createTextNode(shot.prompt));
  const more=fold(c,'Editar y comparar');buttons(more,[['Movimiento y capas',()=>visualEditor(shot),true],...(visuals.length?[['Crear otra imagen',()=>runTask('image',route('/assets:generate'),{operation:'image',entityId:shot.id}),true]]:[]),...(image&&shot.treatment==='veo'?[['Crear otro video',()=>runTask('veo',route('/assets:generate'),{operation:'veo',entityId:shot.id,seconds:8}),true]]:[])]);
  if(has)buttons(more,[['Ver escena',()=>previewShots(d.shots.filter(x=>x.beatId===shot.beatId).map(x=>x.id),c),true],['Comparar tomas contiguas',()=>compareShots(shot,c),true]]);
 }
}

async function importAsset(){
 const dialog=document.createElement('dialog');document.body.append(dialog);const box=card('Importación explícita','<p>Se crea una copia dentro de esta historia, con procedencia y revisión propia. Elige el recurso y su destino.</p>');dialog.append(box);
 const projects=await api('/projects'),from=document.createElement('select'),assets=document.createElement('select'),target=document.createElement('select');
 for(const [label,input] of [['Historia de origen',from],['Recurso aprobado',assets],['Ficha o música de destino',target]]){const l=document.createElement('label');l.textContent=label;l.append(input);box.append(l);}
 const others=projects.projects.filter(x=>x.id!==p.id);let source,sourceAssets=[];
 for(const q of others){const option=document.createElement('option');option.value=q.id;option.textContent=q.title;from.append(option);}
 function targets(){target.replaceChildren();const a=sourceAssets.find(x=>x.id===assets.value);if(!a)return;const dev=source.developments.find(x=>x.id===a.developmentId)?.data;const group=['characters','locations','props'].find(k=>dev?.bible[k].some(x=>x.id===a.entityId));const rows=group?development().bible[group]:development().musicRequests;for(const item of rows){const option=document.createElement('option');option.value=item.id;option.textContent=item.name||item.prompt.slice(0,80);target.append(option);}}
 async function load(){assets.replaceChildren();if(!from.value)return;source=await getProject(from.value);sourceAssets=source.assets.filter(a=>{if(a.approvalState!=='approved')return false;const d=source.developments.find(x=>x.id===a.developmentId)?.data;return d&&((a.kind==='image'&&['characters','locations','props'].some(k=>d.bible[k].some(x=>x.id===a.entityId)))||(a.kind==='pcm'&&d.musicRequests.some(x=>x.id===a.entityId)));});for(const a of sourceAssets){const option=document.createElement('option');option.value=a.id;option.textContent=entityName(source.developments.find(x=>x.id===a.developmentId)?.data,a.entityId)+' · '+titleFor(a.kind);assets.append(option);}targets();}
 from.onchange=()=>load().catch(e=>say(e.message,true));assets.onchange=targets;await load();
 buttons(box,[['Copiar como candidata',async()=>{if(!assets.value||!target.value)throw new Error('Selecciona un recurso compatible y su destino.');const id=await runTask('import',route('/imports'),{sourceProjectId:from.value,sourceAssetId:assets.value,targetId:target.value});if(id){dialog.close();dialog.remove();stage='Historia';await draw();say('Copia conservada con procedencia. Revisa la ficha y el archivo importados antes de aprobarlos.');}}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}
async function previewShots(ids,parent){
 const timeline=await mutate(route('/timeline:compile'),{}),shots=timeline.data.shots.filter(x=>ids.includes(x.id));
 const jobId=await runTask('preview',route('/previews'),{timelineId:timeline.id,startFrame:Math.min(...shots.map(x=>x.startFrame)),endFrame:Math.max(...shots.map(x=>x.startFrame+x.frames))});
 if(jobId){const job=await api('/jobs/'+jobId);if(job.result?.previewId)await playPreview(job.result.previewId,parent);}
}
async function compareShots(shot,parent){
 const d=development(),index=d.shots.findIndex(x=>x.id===shot.id),view=document.createElement('div');view.className='grid';parent.append(view);
 for(const adjacent of d.shots.slice(Math.max(0,index-1),index+2)){
  const item=card(entityName(d,adjacent.id),`<p>${esc(adjacent.function)}</p>`);view.append(item);
  const images=p.assets.filter(a=>a.entityId===adjacent.id&&a.kind==='image'),approved=selectedAsset(adjacent.id,'image'),candidate=images.filter(a=>a.approvalState==='candidate').at(-1);
  for(const asset of [approved,candidate].filter(Boolean)){const image=document.createElement('img');image.src=(await api(route(`/assets/${asset.id}/url`))).url;image.alt=adjacent.id+' · '+asset.approvalState;const label=document.createElement('p');label.textContent=asset.approvalState==='approved'?'Aprobada':'Candidata';item.append(label,image);}
 }
}
async function sounds(){
 const d=development();
 if(d.musicRequests.length){const music=fold(screen,'Música',true);for(const [index,m] of d.musicRequests.entries()){const c=card('Pieza '+(index+1),`<p class="muted">${m.seconds} segundos</p>`);const description=fold(c,'Dirección musical');description.append(document.createTextNode(m.prompt));const rows=p.assets.filter(a=>a.entityId===m.id);buttons(c,[[rows.length?'Crear otra pieza':'Generar música',()=>runTask('music',route('/assets:generate'),{operation:'music',entityId:m.id}),rows.length>0]]);await assetVersions(c,rows);music.append(c);}}
 for(const r of d.soundRequests){const c=card(r.name,`<p>${esc(r.description)}</p><p class="muted">${r.seconds} s · ${esc(r.perspective)}</p>`);screen.append(c);
  const request=fold(c,'Prompt y preparación');request.innerHTML+=`<p>${esc(r.prompt)}</p><p>Preparación: ${r.preparationSeconds} s · Cola: ${r.tailSeconds} s</p>`;buttons(request,[['Copiar prompt',()=>navigator.clipboard.writeText(r.prompt),true]]);
  const label=document.createElement('label');label.className='upload';label.textContent='Subir tu efecto';const input=document.createElement('input');input.type='file';input.accept='audio/*';label.append(input);c.append(label);const progress=document.createElement('progress');progress.max=1;progress.value=0;progress.hidden=true;c.append(progress);
  input.onchange=async()=>{progress.hidden=false;try{await uploadSound(r,input.files[0],progress);await draw();}catch(e){say(e.message,true);}finally{progress.hidden=true;}};
  const cues=p.cues.filter(x=>x.requestId===r.id),v=versions(cues,p.cueSelections?.[r.id]);
  const showCue=(parent,cue)=>{const box=document.createElement('div');box.className='cue-controls';const state=document.createElement('p');state.className='badge';state.textContent=cue.manualLock?'Ajuste manual fijado':titleFor(cue.approvalState);box.append(state);buttons(box,[['Ajustar sincronización',()=>openEditor(cue)]]);const options=fold(box,'Ayuda con IA');
   if(cue.manualLock){options.append(document.createTextNode('Tu ajuste está protegido. Puedes crear una nueva corrección manual o permitir una nueva propuesta.'));buttons(options,[['Permitir nueva propuesta',async()=>{await mutate(route(`/cues/${cue.id}`),{cueRevision:cue.revision,patch:{reason:'Solicito una nueva propuesta de sincronización'}},'PATCH');await draw();},true]]);}
   else{if((cue.analysisAttempts||0)<2)buttons(options,[['Localizar contacto',()=>runTask('analyze',route(`/cues/${cue.id}:analyze`)),true],['Corregir con IA',async()=>{const reason=prompt('¿Qué debe cambiar en este sonido?');if(reason)await runTask('analyze',route(`/cues/${cue.id}:correct`),{reason});},true]]);else options.append(document.createTextNode('El análisis no resolvió el contacto. El ajuste manual sigue disponible.'));
   if(cue.proposedEventId)buttons(options,[['Usar propuesta',async()=>{await mutate(route(`/cues/${cue.id}/proposal:apply`),{});await draw();},true]]);}
   if(cue.analysisScan?.options.length>1&&(cue.analysisAttempts||0)<2)for(const [index,option] of cue.analysisScan.options.entries())buttons(options,[[`Contacto ${index+1} · ${option.description}`,()=>runTask('analyze',route(`/cues/${cue.id}:analyze`),{occurrenceIndex:index,reason:'Usar el contacto elegido'}),true]]);
   parent.append(box);};
  v.visible.forEach(cue=>showCue(c,cue));if(v.history.length){const history=fold(c,'Ajustes anteriores · '+v.history.length);v.history.forEach(cue=>showCue(history,cue));}
  await assetVersions(c,p.assets.filter(a=>a.requestId===r.id));const omit=fold(c,'Opciones del efecto');buttons(omit,[['Omitir este efecto',async()=>{const reason=prompt('¿Por qué quieres omitirlo?');if(reason){await mutate(route(`/sound-requests/${r.id}/omit`),{reason});await draw();}},true]]);
 }
}

async function uploadSound(r,file,progress){
 if(!file)return;if(file.size>250*1024*1024)throw new Error('Máximo 250 MB.');
 say('Verificando el archivo completo antes de subir…');
 const fileKey=await fileHash(file,value=>progress.value=value),payload={mime:file.type||'audio/mpeg',size:file.size,fileKey};
 await refresh();let sessionUpload=await api(route(`/sound-requests/${r.id}/upload-session`),'POST',payload);
 const queryStatus=()=>fetch(sessionUpload.uploadUrl,{method:'PUT',headers:{'Content-Range':`bytes */${file.size}`}});
 let query=await queryStatus();
 if([404,410].includes(query.status)){
  await refresh();sessionUpload=await api(route(`/sound-requests/${r.id}/upload-session`),'POST',{...payload,renew:true});
  if(!sessionUpload.complete)query=await queryStatus();
 }
 let offset=0;
 if(sessionUpload.complete||query.ok)offset=file.size;
 else if(query.status===308){const range=query.headers.get('Range');offset=range?Number(range.split('-')[1])+1:0;}
 else throw new Error('No se pudo confirmar el estado de la carga. Selecciona de nuevo el mismo archivo.');
 while(offset<file.size){
  const end=Math.min(offset+8*1024*1024,file.size);
  const resp=await fetch(sessionUpload.uploadUrl,{method:'PUT',headers:{'Content-Type':payload.mime,'Content-Range':`bytes ${offset}-${end-1}/${file.size}`},body:file.slice(offset,end)});
  if(!(resp.ok||resp.status===308))throw new Error('Carga interrumpida. Selecciona otra vez el mismo archivo para continuar.');
  const range=resp.headers.get('Range'),received=resp.ok?file.size:range?Number(range.split('-')[1])+1:0;
  if(received<=offset)throw new Error('La nube aún no confirmó nuevos bytes. Selecciona el archivo para consultar su estado.');
  offset=received;progress.value=offset/file.size;
 }
 const jobId=await runTask('media',route(`/sound-requests/${r.id}/complete`),{assetId:sessionUpload.assetId});
 say(jobId?'Archivo recibido. Revisa el ataque propuesto y su contexto.':'Archivo conservado. Su preparación espera tu autorización.');
}

async function playPreview(id,parent){const d=await api(route(`/previews/${id}`));if(!d.url)throw new Error('Preview aún no disponible.');if(d.current===false){const stale=document.createElement('p');stale.className='error';stale.textContent='Versión anterior: cambiaron sus dependencias. Puedes compararla, pero no aprobar ajustes nuevos con ella.';parent.append(stale);}if(d.draftIssues?.length){const note=document.createElement('p');note.textContent='Borrador: '+d.draftIssues.map(describeIssue).join(' · ');parent.append(note);}parent.querySelector(':scope > video.preview-player')?.remove();const v=document.createElement('video');v.className='preview-player';v.controls=true;v.playsInline=true;v.src=d.url;parent.append(v);return d;}
async function preparePreview(parent){
 const t=await mutate(route('/timeline:compile'),{});const id=await runTask('preview',route('/previews'),{timelineId:t.id,startFrame:0,endFrame:t.data.frames});
 if(id){const job=await api('/jobs/'+id);if(job.result?.previewId)await playPreview(job.result.previewId,parent);}
}
async function review(){
 pageTitle('Revisión','Escucha, compara y decide qué conservar.');
 if(!development()){empty('Aún no hay material para revisar','Aprueba tu guion en Historia para continuar.');return;}
 tabs(screen,[['corto','Corto completo'],['subtitulos','Subtítulos']],reviewTab,async part=>{reviewTab=part;await draw();});
 if(reviewTab==='subtitulos')return subtitlesView();
 const c=card('Tu corto',`<p class="muted">Una reproducción con imagen, voces, música y efectos juntos.</p>`);screen.append(c);buttons(c,[['Preparar vista previa',()=>preparePreview(c)]]);
 await previewHistory(c,false);
 const mix=fold(screen,'Ajustes de mezcla');mix.innerHTML+=`<label class="choice"><input id="normalize-program" type="checkbox" ${p.mixPolicy?.normalization?.enabled?'checked':''}> Equilibrar el volumen del corto</label><label class="choice"><input id="duck-program" type="checkbox" ${p.mixPolicy?.ducking?.enabled?'checked':''}> Bajar la música cuando hay voces</label>`;
 buttons(mix,[['Guardar mezcla',async()=>{await mutate(route('/mix-policy'),{normalize:$('#normalize-program').checked,duckMusic:$('#duck-program').checked});say('Mezcla guardada. Prepara una nueva vista previa para escucharla.');},true]]);
 buttons(screen,[['Ajustar un efecto',()=>go('Escenas','sonido'),true],['Ir a exportación',()=>go('Exportar'),true]]);
}
async function previewHistory(parent,final){
 const rows=p.previews.filter(x=>!!x.final===final&&x.state==='ready').sort((a,b)=>(b.created||0)-(a.created||0));
 for(const [index,r] of rows.entries()){const target=index?fold(parent,`Versión anterior · ${new Date(r.created*1000).toLocaleDateString('es')}`):parent;
  const item=card(final?'Archivo terminado':index?'Vista previa anterior':'Última vista previa',`<p class="muted">${r.startFrame/24}–${r.endFrame/24} segundos</p>`);target.append(item);buttons(item,[['Reproducir',()=>playPreview(r.id,item),true]]);
  if(final)buttons(item,[['Descargar archivos',async()=>{if(item.querySelector('.download-list'))return;const list=await api(route(`/exports/${r.id}`)),box=document.createElement('div');box.className='download-list';for(const file of list.files){const link=document.createElement('a');link.href=file.url;link.textContent=file.name;link.className='button secondary';link.target='_blank';link.rel='noopener';box.append(link);}item.append(box);}]]);
 }
}
async function exportsView(){
 pageTitle('Exportar','Conserva la versión que has revisado.');
 if(!development()){empty('El corto todavía no tiene guion aprobado','Continúa en Historia.');return;}
 const c=card('Preparar entrega');screen.append(c);
 const ready=p.previews.filter(r=>!r.final&&r.state==='ready'&&r.startFrame===0&&r.endFrame>=6840&&r.endFrame<=7560).sort((a,b)=>(b.created||0)-(a.created||0));
 let current;for(const candidate of ready){const detail=await api(route(`/previews/${candidate.id}`));if(detail.current&&detail.fullProgram){current=detail;break;}}
 if(!current){c.innerHTML+='<p>Prepara y revisa el corto completo antes de exportar.</p>';buttons(c,[['Revisar el corto',()=>go('Revisión')]]);}
 else if(current.draftIssues?.length){const list=document.createElement('ul');for(const issue of current.draftIssues){const li=document.createElement('li');li.textContent=describeIssue(issue);list.append(li);}c.append(list);buttons(c,[['Revisar pendientes',()=>go('Revisión')],['Abrir producción',()=>go('Escenas'),true]]);}
 else{c.innerHTML+='<p>Reproduce esta versión. Al aprobarla se prepararán el video final, los subtítulos y las pistas de sonido.</p>';await playPreview(current.id,c);buttons(c,[['Aprobar y exportar',async()=>{const t=await mutate(route('/timeline:compile'),{});if(t.compiledHash!==current.manifestHash)throw new Error('El corto cambió. Revisa una nueva vista previa antes de exportar.');await approve('timelines',t.id);await runTask('render',route('/renders'));await draw();}]]);}
 await previewHistory(screen,true);
}

async function openEditor(initial){
 await refresh();let cue=p.cues.find(c=>c.id===initial.id),frames=[],framePos=0,framesId=null,previousPreview=null,currentPreview=null,correctionId=null;
 const box=$('#editor-content');box.replaceChildren();$('#editor').showModal();
 const title=document.createElement('p');title.textContent=cue.eventDescription;box.append(title);
 const image=document.createElement('img');image.className='frame';image.alt='Fotograma indexado del video aprobado';box.append(image);
 const info=document.createElement('p');info.className='frame-info';box.append(info);
 const frameInput=document.createElement('input');frameInput.type='number';frameInput.min=0;frameInput.value=0;const frameLabel=document.createElement('label');frameLabel.textContent='Inicio del intervalo de fotogramas';frameLabel.append(frameInput);const interval=fold(box,'Elegir otro intervalo');interval.append(frameLabel);
 function showFrame(){if(!frames.length)return;image.src=frames[framePos].url;info.textContent=`Fotograma ${frames[framePos].index} · ${Number(frames[framePos].seconds).toFixed(3)} s`;}
 async function save(patch){const result=await mutate(route(`/cues/${cue.id}`),{cueRevision:cue.revision,patch},'PATCH');cue=result.cue;correctionId=result.correctionId;status.textContent='Ajuste guardado como candidata. Prueba una nueva preview.';}
 buttons(box,[['Cargar fotogramas',async()=>{const jid=await runTask('frames',route(`/shots/${cue.shotId}/frames`),{start:Number(frameInput.value),count:48});if(!jid)return;const job=await api('/jobs/'+jid);framesId=job.result?.framesId;if(!framesId)throw new Error('La extracción no terminó. Consulta Escenas.');const r=await api(route(`/frames/${framesId}`));frames=r.frames;framePos=0;showFrame();}],['← Fotograma',()=>{framePos=Math.max(0,framePos-1);showFrame();},true],['Fotograma →',()=>{framePos=Math.min(frames.length-1,framePos+1);showFrame();},true],['El sonido debe coincidir aquí',async()=>{if(!frames.length)throw new Error('Carga primero los fotogramas indexados.');cue=await mutate(route(`/cues/${cue.id}/anchor`),{cueRevision:cue.revision,framesId,frameIndex:frames[framePos].index});status.textContent='Contacto seleccionado. Marca ahora el ataque del sonido.';}]]);
 const data=await api(route(`/assets/${cue.audioRevision}/waveform`));let selected=cue.sourceSyncSample,viewStart=0,viewEnd=data.samples;
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=180;canvas.className='wave';canvas.setAttribute('aria-label','Onda sonora; selecciona el ataque con el dedo');box.append(canvas);
 const sampleInfo=document.createElement('p');box.append(sampleInfo);
 function paint(){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,900,180);ctx.strokeStyle='#00e5ff';for(let x=0;x<900;x++){const idx=Math.min(data.peaks.length-1,Math.floor((viewStart+x/900*(viewEnd-viewStart))/data.binSamples));const peak=data.peaks[idx]||0;ctx.beginPath();ctx.moveTo(x,90-peak*85);ctx.lineTo(x,90+peak*85);ctx.stroke();}const marker=(selected-viewStart)/(viewEnd-viewStart)*900;ctx.strokeStyle='#ff4081';ctx.beginPath();ctx.moveTo(marker,0);ctx.lineTo(marker,180);ctx.stroke();sampleInfo.textContent=`Ataque seleccionado: ${(selected/48000).toFixed(3)} s`;}
 canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect();selected=Math.max(0,Math.min(data.samples-1,Math.round(viewStart+(e.clientX-r.left)/r.width*(viewEnd-viewStart))));paint();};paint();
 const audio=document.createElement('audio');audio.controls=true;audio.src=(await api(route(`/assets/${cue.audioRevision}/url`))).url;box.append(audio);
 buttons(box,[['Este es el golpe',()=>save({sourceSyncSample:selected})],['Ampliar onda',()=>{const span=Math.max(4800,(viewEnd-viewStart)/2);viewStart=Math.max(0,selected-span/2);viewEnd=Math.min(data.samples,viewStart+span);paint();},true],['Onda completa',()=>{viewStart=0;viewEnd=data.samples;paint();},true],['Escuchar zona',async()=>{audio.currentTime=Math.max(0,selected/48000-.25);await audio.play();const stop=()=>{if(audio.currentTime>selected/48000+.75){audio.pause();audio.removeEventListener('timeupdate',stop);}};audio.addEventListener('timeupdate',stop);},true]]);
 const attacks=document.createElement('select');attacks.innerHTML='<option value="">Elegir otro transitorio</option>'+data.attackCandidates.map(s=>`<option value="${s}">${(s/48000).toFixed(3)} s</option>`).join('');attacks.onchange=()=>{if(attacks.value){selected=Number(attacks.value);paint();}};const transients=fold(box,'Otros ataques detectados');transients.append(attacks);
 buttons(box,[['Adelantar 1 fotograma',()=>save({offsetSamples:(cue.offsetSamples||0)-2000}),true],['Retrasar 1 fotograma',()=>save({offsetSamples:(cue.offsetSamples||0)+2000}),true]]);
 const fields=document.createElement('div');fields.innerHTML=`<label>Ganancia (dB)<input id="cue-gain" type="number" min="-60" max="12" value="${cue.gainDb||0}"></label><label>Entrada del archivo (segundos)<input id="cue-in" type="number" min="0" step="0.001" value="${cue.trimInSample/48000}"></label><label>Salida / cola (segundos)<input id="cue-out" type="number" min="0" step="0.001" value="${cue.trimOutSample/48000}"></label>`;const adjustments=fold(box,'Volumen y recortes');adjustments.append(fields);
 buttons(adjustments,[['Guardar ganancia y recortes',()=>save({gainDb:Number($('#cue-gain').value),trimInSample:Math.round(Number($('#cue-in').value)*48000),trimOutSample:Math.round(Number($('#cue-out').value)*48000)})]]);
 const status=document.createElement('p');box.append(status);const player=document.createElement('video');player.controls=true;player.playsInline=true;box.append(player);
 buttons(box,[['Probar ajuste',async()=>{const t=await mutate(route('/timeline:compile'),{cueOverrides:{[cue.requestId]:cue.id}});const s=t.data.shots.find(s=>s.id===cue.shotId);const jid=await runTask('preview',route('/previews'),{timelineId:t.id,startFrame:Math.max(0,s.startFrame-48),endFrame:Math.min(t.data.frames,s.startFrame+s.frames+72)});if(!jid)return;const job=await api('/jobs/'+jid);const rid=job.result?.previewId;if(!rid)throw new Error('Preview pendiente.');previousPreview=currentPreview;currentPreview=await api(route(`/previews/${rid}`));player.src=currentPreview.url;status.textContent='Preview muxada del ajuste actual.';}],['Comparar anterior / candidata',()=>{if(!previousPreview)throw new Error('Primero prueba dos ajustes para comparar.');player.pause();player.src=player.src===currentPreview.url?previousPreview.url:currentPreview.url;},true],['Deshacer',async()=>{if(!correctionId)throw new Error('No hay un ajuste nuevo que deshacer.');cue=await mutate(route(`/corrections/${correctionId}:undo`),{});correctionId=null;status.textContent='Ajuste anterior recuperado. Prepara su preview.';},true],['Aprobar y fijar',async()=>{if(!currentPreview)throw new Error('Prepara y escucha una preview de esta versión.');cue=await mutate(route(`/cues/${cue.id}:approve`),{previewId:currentPreview.id});status.textContent='Corrección aprobada y protegida frente al reanálisis automático.';}]]);
}
$('#close-editor').onclick=async()=>{$('#editor').querySelectorAll('video,audio').forEach(m=>m.pause());$('#editor').close();if(needsRedraw){needsRedraw=false;await draw();}};
document.addEventListener('play',e=>{if(e.target.matches('video,audio'))document.querySelectorAll('video,audio').forEach(m=>{if(m!==e.target)m.pause();});},true);
$('#back').onclick=async e=>{if(active){e.preventDefault();if(confirm('¿Pausar nuevas generaciones y volver a Animes?')){await lease(false);location.href='/';}}};
async function editDevelopment(entity){
 const dialog=document.createElement('dialog'),box=document.createElement('div');dialog.append(box);document.body.append(dialog);
 const patches=new Map(),labels={title:'Título',bible:'Biblias',story:'Historia',beats:'Momentos dramáticos',shots:'Planos',utterances:'Voces del guion',soundRequests:'Efectos de sonido',musicRequests:'Música',subtitles:'Subtítulos',dramatic:'Dirección dramática',visual:'Dirección visual',characters:'Personajes',locations:'Lugares',props:'Objetos',beats:'Unidades dramáticas',shots:'Tomas',utterances:'Intervenciones',soundRequests:'Efectos y ambientes',musicRequests:'Música',subtitles:'Subtítulos',spanish:'Español',japanese:'Japonés',acting:'Actuación',prompt:'Instrucción',frames:'Duración (fotogramas)',before:'Estado antes',after:'Estado después',treatment:'Tratamiento visual',camera:'Cámara',name:'Nombre',description:'Descripción',seconds:'Duración (segundos)',preparationSeconds:'Preparación',tailSeconds:'Cola',perspective:'Perspectiva',text:'Texto',layout:'Distribución',referencePrompt:'Referencia visual',voice:'Voz',direction:'Dirección de voz',japaneseReading:'Lectura japonesa',minFrames:'Mínimo de fotogramas',maxFrames:'Máximo de fotogramas',leadFrames:'Acción inicial (frames)',tailFrames:'Acción final (frames)',pauseBeforeFrames:'Pausa antes (frames)',pauseAfterFrames:'Pausa después (frames)',timingReason:'Razón de la duración',gainDb:'Ganancia (dB)',sourceInSample:'Recorte de entrada (muestras)',fadeInSamples:'Fundido de entrada (muestras)',fadeOutSamples:'Fundido de salida (muestras)'};
 const heading=document.createElement('h2');heading.textContent='Editar guion y biblias';box.append(heading);
 const explanation=document.createElement('p');explanation.textContent='Los cambios crean una candidata. Antes de guardar verás qué recursos necesitan revisión. Las versiones aprobadas se conservan.';box.append(explanation);
 function fields(parent,value,path=[]){
  for(const [key,current] of Object.entries(value)){
   if(['id','hash','sha256','developmentId','assetId','audioHash','nativeQualityGuaranteed','assetRevision','audioRevision','voiceBinding'].includes(key))continue;
   const part=Array.isArray(value)?Number(key):key,next=[...path,part],name=labels[key]||fieldLabel(key);
   if(current!==null&&typeof current==='object'){
    const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=Array.isArray(value)?(current.name||(current.id?entityName(entity.data,current.id):`Elemento ${Number(key)+1}`)):name;group.append(summary);parent.append(group);fields(group,current,next);continue;
   }
   if(current===null)continue;
   const label=document.createElement('label');label.textContent=name;let input;
   const relation=['locationId','speakerId','shotId','beatId'].includes(key)?key:['visibleCharacters','offscreenCharacters','referenceEntityIds','props'].includes(path.at(-1))?path.at(-1):null;
   if(relation&&typeof current==='string'){input=document.createElement('select');const d=entity.data;const rows=relation==='locationId'?d.bible.locations:relation==='shotId'?d.shots:relation==='beatId'?d.beats:relation==='props'?d.bible.props:relation==='referenceEntityIds'?[...d.bible.characters,...d.bible.locations,...d.bible.props]:d.bible.characters;for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.name||row.change||entityName(d,row.id);input.append(option);}input.value=current;}
   else if(key==='treatment'){input=document.createElement('select');for(const item of ['hold','camera2d','localized','veo']){const option=document.createElement('option');option.value=item;option.textContent={hold:'Ilustración sostenida',camera2d:'Cámara 2D',localized:'Animación localizada',veo:'Veo'}[item];input.append(option);}input.value=current;}
   else{input=document.createElement(typeof current==='string'?'textarea':'input');if(typeof current==='boolean'){input.type='checkbox';input.checked=current;}else if(typeof current==='number'){input.type='number';input.step='any';input.value=current;}else input.value=current;}
   input.onchange=()=>{const v=typeof current==='boolean'?input.checked:typeof current==='number'?Number(input.value):input.value;const k=JSON.stringify(next);if(v===current)patches.delete(k);else patches.set(k,{path:next,value:v});};label.append(input);parent.append(label);
  }
 }
 fields(box,entity.data);
 const order=card('Orden de tomas','<p>Mover una toma conserva su contenido. Revisa continuidad y anclas después de aprobar.</p>'),ordered=[...entity.data.shots];box.append(order);
 function drawOrder(){order.querySelectorAll('.shot-order').forEach(x=>x.remove());ordered.forEach((shot,index)=>{const row=document.createElement('div');row.className='shot-order';row.textContent=entityName(entity.data,shot.id);buttons(row,[['↑',()=>move(index,-1),true],['↓',()=>move(index,1),true]]);order.append(row);});}
 function move(index,delta){const target=index+delta;if(target<0||target>=ordered.length)return;[ordered[index],ordered[target]]=[ordered[target],ordered[index]];patches.set('order',{path:['shots'],value:ordered});drawOrder();}drawOrder();
 const report=document.createElement('div');box.append(report);let confirmed;
 buttons(box,[['Revisar cambios',async()=>{const input={sourceHash:entity.dataHash,patches:[...patches.values()]};const result=await api(route(`/developments/${entity.id}/edits:preview`),'POST',input);confirmed={...input,impactHash:result.impactHash};report.replaceChildren();const detail=document.createElement('p');detail.textContent=`${result.report.changes.length} cambios. Recursos que necesitan revisión: ${result.report.assetsNeedingReview.map(x=>entityName(entity.data,x.entityId)+' ('+titleFor(x.kind)+')').join(', ')||'ninguno'}. No se genera contenido al guardar.`;report.append(detail);}],['Guardar candidata',async()=>{if(!confirmed||JSON.stringify(confirmed.patches)!==JSON.stringify([...patches.values()]))throw new Error('Revisa los cambios actuales antes de guardar.');await mutate(route(`/developments/${entity.id}/edits:save`),confirmed);dialog.close();dialog.remove();await draw();say('Candidata guardada. Revisa y aprueba cuando esté lista.');}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);
 dialog.showModal();
}

async function subtitlesView(){
 const data=await api(route('/subtitles'));
 if(!data.rows.length){empty('Primero prepara las voces','Los subtítulos se ajustan al audio definitivo.');return;}
 buttons(screen,[['Aprobar subtítulos revisados',async()=>{const audioHashes=Object.fromEntries(data.rows.map(row=>[row.audioRevision,row.audioHash]));await mutate(route('/subtitles:approve'),{developmentId:p.activeDevelopment,audioHashes});say('Traducción y tiempos aprobados. Prepara la vista previa del corto.');await go('Revisión','corto');}]]);
 screen.append(card('Subtítulos sobre la voz definitiva','<p>Los tiempos son relativos a cada intervención. Divide por unidades de sentido y deja libres los silencios. Guardar texto o tiempos no genera otra voz.</p>'));
 for(const row of data.rows){
  const c=card(entityName(development(),row.utteranceId),`<p>${esc(row.japanese)}</p>${row.stale?'<p class="error">La voz cambió: revisa los tiempos.</p>':''}`);screen.append(c);
  const audio=document.createElement('audio');audio.controls=true;audio.src=(await api(route(`/assets/${row.audioRevision}/url`))).url;c.append(audio);
  const segments=structuredClone(row.segments),list=document.createElement('div');c.append(list);
  function drawRows(){list.replaceChildren();segments.forEach((segment,i)=>{
   const line=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`Bloque ${i+1}`;line.append(legend);
   for(const [key,label] of [['text','Español'],['startSample','Inicio (segundos)'],['endSample','Fin (segundos)'],['exceptionReason','Justificación si necesita exceder los límites de lectura']]){
    if(key==='exceptionReason'&&!segment.exceptionReason&&!row.warnings.some(w=>w.block===i+1))continue;const field=document.createElement('label');field.textContent=label;const input=document.createElement(key==='text'||key==='exceptionReason'?'textarea':'input');if(key.endsWith('Sample')){input.type='number';input.min=0;input.step='.001';input.value=segment[key]/48000;input.onchange=()=>segment[key]=Math.round(Number(input.value)*48000);}else{input.value=segment[key]||'';input.onchange=()=>segment[key]=input.value;}field.append(input);line.append(field);
   }
   const timing=fold(line,'Marcar tiempos y dividir');buttons(timing,[['Inicio en el audio actual',()=>{segment.startSample=Math.round(audio.currentTime*48000);drawRows();},true],['Fin en el audio actual',()=>{segment.endSample=Math.round(audio.currentTime*48000);drawRows();},true],['Dividir aquí',()=>{const at=Math.round(audio.currentTime*48000);if(at<=segment.startSample||at>=segment.endSample)throw new Error('Sitúa el audio dentro del bloque.');const next={text:'',startSample:at,endSample:segment.endSample};segment.endSample=at;segments.splice(i+1,0,next);drawRows();},true],['Eliminar bloque',()=>{if(segments.length===1)throw new Error('Conserva al menos un bloque.');segments.splice(i,1);drawRows();},true]]);list.append(line);
  });}drawRows();
  const warnings=document.createElement('p');warnings.textContent=row.warnings.map(w=>`Bloque ${w.block}: ${w.issues.join(', ')}`).join(' · ');c.append(warnings);
  const recognition=fold(c,'Ayuda para localizar palabras');buttons(recognition,[['Reconocer japonés y consultar tiempos',async()=>{const jid=await runTask('transcribe',route('/assets:generate'),{operation:'transcribe',entityId:row.utteranceId});if(!jid)return;const job=await api('/jobs/'+jid);if(job.result?.alignmentId){const record=await api(route(`/alignments/${job.result.alignmentId}`));const note=document.createElement('p');note.textContent=record.precisionNotice+' · '+record.words.map(w=>`${w.text}: ${(w.startSample/48000).toFixed(2)}–${(w.endSample/48000).toFixed(2)} s`).join(' · ');c.append(note);}},true]]);buttons(c,[['Guardar subtítulos',async()=>{const result=await mutate(route(`/subtitles/${row.utteranceId}`),{audioRevision:row.audioRevision,audioHash:row.audioHash,segments});row.warnings=result.warnings;drawRows();warnings.textContent=result.warnings.map(w=>`Bloque ${w.block}: ${w.issues.join(', ')}`).join(' · ')||'Sin conflictos de lectura.';say('Texto y tiempos guardados. Revisa la preview de la toma.');}],['Ver toma con subtítulos',async()=>{const t=await mutate(route('/timeline:compile'),{});const shot=t.data.shots.find(s=>s.id===row.shotId);const jid=await runTask('preview',route('/previews'),{timelineId:t.id,startFrame:shot.startFrame,endFrame:shot.startFrame+shot.frames});if(jid){const job=await api('/jobs/'+jid);if(job.result?.previewId)await playPreview(job.result.previewId,c);}}]]);
 }
}

async function visualEditor(shot){
 const dialog=document.createElement('dialog');document.body.append(dialog);const box=card('Movimiento y capas','<p>La cámara reutiliza la imagen aprobada. Una variante localizada solo se genera cuando la solicitas; el montaje reutiliza su archivo.</p>');dialog.append(box);
 const fields={},field=(key,label,value,min,max,step='any')=>{const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=value;l.append(input);box.append(l);fields[key]=input;};
 const methodLabel=document.createElement('label');methodLabel.textContent='Tratamiento';const method=document.createElement('select');for(const [value,label] of [['hold','Ilustración sostenida'],['camera2d','Cámara 2D'],['localized','Variante localizada'],['veo','Veo']]){const option=document.createElement('option');option.value=value;option.textContent=label;method.append(option);}method.value=shot.treatment;methodLabel.append(method);box.append(methodLabel);
 for(const [end,label] of [['start','Inicio'],['end','Final']]){const values=shot.camera?.[end]||[1,.5,.5];field(end+'Zoom',label+' · zoom',values[0],1,2);field(end+'X',label+' · centro horizontal (%)',values[1]*100,0,100);field(end+'Y',label+' · centro vertical (%)',values[2]*100,0,100);}
 const base=selectedAsset(shot.id,'image');
 if(base){const image=document.createElement('img');image.src=(await api(route(`/assets/${base.id}/url`))).url;image.alt='Referencia de la toma para elegir región';box.append(image);}
 const promptField=document.createElement('textarea');promptField.placeholder='Ejemplo: párpados cerrados, conservar todo lo demás';const label=document.createElement('label');label.textContent='Cambio para una nueva variante';label.append(promptField);box.append(label);
 buttons(box,[['Generar variante con Gemini',async()=>{if(!promptField.value.trim())throw new Error('Describe la variante.');await runTask('image',route('/assets:generate'),{operation:'image',entityId:shot.id,variantPrompt:promptField.value});dialog.close();dialog.remove();await draw();say('Variante creada. Revisa y aprueba su imagen antes de aplicar la máscara.');},true]]);
 const variants=p.assets.filter(a=>a.variantOf===shot.id&&a.approvalState==='approved'),layerRows=[];
 for(const variant of variants){const previous=shot.layers?.find(x=>x.assetRevision===variant.id);const row=card('Variante visual'),use=document.createElement('input');use.type='checkbox';use.checked=!!previous;const label=document.createElement('label');label.append(use,document.createTextNode('Usar esta variante'));row.append(label);const image=document.createElement('img');image.src=(await api(route(`/assets/${variant.id}/url`))).url;image.alt='Variante regional aprobada';row.append(image);const inputs={};
  for(const [key,title,value,max] of [['x','Izquierda (%)',(previous?.mask.x??0)*100,100],['y','Arriba (%)',(previous?.mask.y??0)*100,100],['width','Ancho (%)',(previous?.mask.width??1)*100,100],['height','Alto (%)',(previous?.mask.height??1)*100,100],['startFrame','Primer fotograma',previous?.startFrame??0,shot.frames-1],['endFrame','Fotograma de salida',previous?.endFrame??shot.frames,shot.frames]]){const l=document.createElement('label');l.textContent=title;const input=document.createElement('input');input.type='number';input.min=0;input.max=max;input.value=value;input.step=key.endsWith('Frame')?'1':'.1';l.append(input);row.append(l);inputs[key]=input;}
  const note=document.createElement('p');note.textContent='Se superpone únicamente la región rectangular elegida durante este intervalo; comprueba sus bordes y continuidad en la preview.';row.append(note);const voice=document.createElement('select'),manual=document.createElement('option');manual.value='';manual.textContent='Intervalo manual';voice.append(manual);
  for(const u of development().utterances.filter(u=>u.shotId===shot.id)){const a=selectedAsset(u.id,'pcm');if(a){const option=document.createElement('option');option.value=a.id;option.textContent='Boca por actividad: '+u.spanish.slice(0,45);voice.append(option);}}
  voice.value=previous?.voiceBinding?.audioRevision||'';const voiceLabel=document.createElement('label');voiceLabel.textContent='Activar variante (apertura/cierre limitado, sin sincronía fonética garantizada)';voiceLabel.append(voice);row.append(voiceLabel);box.append(row);layerRows.push({variant,use,inputs,voice});
 }
 buttons(box,[['Guardar candidata visual',async()=>{const camera=Object.fromEntries(['start','end'].map(end=>[end,[Number(fields[end+'Zoom'].value),Number(fields[end+'X'].value)/100,Number(fields[end+'Y'].value)/100]]));const layers=layerRows.filter(x=>x.use.checked).map(({variant,inputs,voice})=>({...(voice.value?{voiceBinding:(()=>{const a=p.assets.find(a=>a.id===voice.value);return {utteranceId:a.entityId,audioRevision:a.id,audioHash:a.sha256};})()}:{}),assetRevision:variant.id,mask:Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(inputs[k].value)/100])),startFrame:Number(inputs.startFrame.value),endFrame:Number(inputs.endFrame.value),approved:true}));await mutate(route(`/shots/${shot.id}/visual:propose`),{treatment:method.value,camera,layers});dialog.close();dialog.remove();stage='Historia';await draw();say('Edición visual candidata. Revisa su alcance antes de aprobarla.');}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}

// A transport can be injected by the isolated UI tests; production always uses fetch.
export async function mountStudio(identity,options={}){
 user=identity;transport=options.transport||fetch;
 $('#projects').hidden=!user;$('#projects').onclick=()=>projectList().catch(e=>say(e.message,true));
 $('#account').hidden=!user;$('#login').hidden=!!user;$('#workspace').hidden=!user;document.body.classList.toggle('connected',!!user);
 if(!user){p=null;active=false;return;}
 say('');
 const match=location.hash.match(/^#\/proyectos\/([a-zA-Z0-9_-]+)$/);
 if(options.projectId||match){p=await getProject(options.projectId||match[1]);await lease(false);stage='Historia';}
 await draw();
}
export {api,say};
