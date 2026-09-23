import {fileHash} from './hash.mjs';
const $=s=>document.querySelector(s), screen=$('#screen'), notice=$('#notice');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const genres=['acción','aventura','fantasía','isekai','drama','psicológico','terror','misterio','romance','comedia','comedia romántica','vida cotidiana','ciencia ficción','mecha','sobrenatural','supervivencia','deportes','videojuego/sistema'];
const subgenres=['absurdo','humor negro','sátira','tensión romántica','ecchi adulto no explícito','tragedia','venganza','suspenso','terror psicológico','fantasía oscura','misterio sobrenatural','rivalidad','entrenamiento/superación','sistema/progresión','exploración','relación laboral','familia','reencuentro','conflicto moral','apocalipsis','combate táctico'];
let batchRunning=false;
let auth,authFns,user,p,stage='Proyectos',budgetId,rates={},active=false,busy=false,heartbeatBusy=false;
const session=crypto.randomUUID(),device=localStorage.getItem('animeShorts:v2:device')||crypto.randomUUID();localStorage.setItem('animeShorts:v2:device',device);
const say=(s,error=false)=>{notice.textContent=s;notice.className=error?'error':'';};
function action(label,fn,secondary=false){const b=document.createElement('button');b.textContent=label;if(secondary)b.className='secondary';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){say(e.message,true);}finally{b.disabled=false;}};return b;}
function card(title,content=''){const e=document.createElement('article');e.className='card';e.innerHTML=`<h3>${esc(title)}</h3>${content}`;return e;}
function buttons(parent,items){const row=document.createElement('div');row.className='actions';items.forEach(([label,fn,secondary])=>row.append(action(label,fn,secondary)));parent.append(row);return row;}
async function api(path,method='GET',data,headers={}){
  const h={...headers};if(user)h.Authorization='Bearer '+await user.getIdToken();if(data)h['Content-Type']='application/json';if(p&&!h['If-Match'])h['If-Match']=String(p.revision);
  const r=await fetch('/api/shorts?path='+encodeURIComponent(path),{method,headers:h,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||`Error ${r.status}`);return j;
}
const route=s=>`/projects/${p.id}${s}`;
async function getProject(id){
 const project=await api('/projects/'+id);
 for(const [kind,first] of Object.entries(project.entityCursors||{})){let cursor=first;while(cursor){const page=await api(`/projects/${id}/entities/${kind}/after/${cursor}`);project[kind].push(...page.items);cursor=page.next;}}
 for(const kind of ['ideas','developments','assets','cues','events','timelines','previews'])project[kind].sort((a,b)=>(a.created||0)-(b.created||0)||a.id.localeCompare(b.id));
 return project;
}
async function refresh(){p=await getProject(p.id);}
async function mutate(path,data,method='POST'){busy=true;try{while(heartbeatBusy)await new Promise(r=>setTimeout(r,50));await refresh();const result=await api(path,method,data);await refresh();return result;}finally{busy=false;}}
async function lease(enable){if(!p)return;await refresh();const v=await api(route('/lease'),'POST',{session,device,active:enable});p={...p,revision:v.revision,lease:v.lease};active=enable;}
setInterval(async()=>{if(!active||busy||heartbeatBusy||!p)return;heartbeatBusy=true;try{const v=await api(route('/lease'),'POST',{session,device,heartbeat:true,active:true});p.revision=v.revision;p.lease=v.lease;}catch{active=false;say('Lote pausado por pérdida de sesión. Puedes continuar sin rehacer lo terminado.',true);}finally{heartbeatBusy=false;}},10000);
async function paid(operation,path,data={}){
  if(!budgetId)throw new Error('Primero autoriza un presupuesto en «Producción».');
  if(!Object.keys(rates).length){const cfg=await api(route('/budgets'));rates=cfg.rates;}
  const rate=rates[operation];if(!rate)throw new Error('Falta verificar la tarifa de esta operación. No se enviará ninguna generación.');
  if(!confirm(`Autorizar ${operation}: reserva máxima ${(rate.maxMicros/1e6).toFixed(4)} USD (generación ${(rate.generationMicros/1e6).toFixed(4)} + worker ${(rate.workerMicros/1e6).toFixed(4)}). No incluye almacenamiento, transferencia ni hosting.${operation==='media'?' La carga también puede iniciar análisis visual con su propia reserva autorizada.':''} Tarifa verificada ${rate.verifiedDate}. ¿Continuar?`))return;
  if(!active)await lease(true);
  await refresh();const key=crypto.randomUUID();
  const j=await api(path,'POST',{...data,budgetId,session},{'Idempotency-Key':key});
  say('Trabajo guardado. Puedes revisar su progreso en Producción.');
  await watch(j.jobId);
  return j.jobId;
}
async function watch(id){
  const panel=card('Trabajo en curso','<p class="job-state"></p>');screen.prepend(panel);
  for(let n=0;n<360;n++){
    const j=await api('/jobs/'+id);panel.querySelector('.job-state').textContent=`${j.operation} · ${j.state}`;
    if(['awaiting_review','succeeded','failed','cancelled','submitted_unknown'].includes(j.state)){
      if(j.result)panel.append(card('Resultado',`<p>${esc(j.result.error||'Recurso conservado. Revisa la etapa correspondiente.')}</p>`));
      if(j.result?.previewId)await playPreview(j.result.previewId,panel);
      await refresh();return j;
    }
    await new Promise(r=>setTimeout(r,3000));
  }
  say('El trabajo sigue en servidor. Consulta Producción para recuperarlo.');
}
function navigation(){const nav=$('#steps');nav.replaceChildren();for(const s of ['Proyectos','Ideas','Guion y biblias','Producción','Tomas','Sonido','Subtítulos','Exportar'])nav.append(action(s,async()=>{stage=s;await draw();},true));[...nav.children].forEach(b=>b.classList.toggle('active',b.textContent===stage));}
async function draw(){navigation();screen.replaceChildren();if(stage==='Proyectos')return projectList();if(!p){stage='Proyectos';return draw();}await refresh();if(stage==='Ideas')return ideas();if(stage==='Guion y biblias')return script();if(stage==='Producción')return production();if(stage==='Tomas')return shots();if(stage==='Sonido')return sounds();if(stage==='Subtítulos')return subtitlesView();return exportsView();}
async function projectList(){
 const list=await api('/projects');const form=card('Nueva historia',`<label>Título<input id="title" placeholder="Título provisional"></label><label>Género principal<select id="genre">${genres.map(g=>`<option>${g}</option>`).join('')}</select></label><details><summary>Subgéneros opcionales</summary>${subgenres.map((g,i)=>`<label><input type="checkbox" class="subgenre" value="${g}" style="width:22px;min-height:22px"> ${g}</label>`).join('')}</details><label>Concepto opcional<textarea id="concept" placeholder="Una situación, un personaje, una emoción… Puedes dejarlo vacío."></textarea></label><label>Formato<select id="format"><option>16:9</option><option>9:16</option></select></label>`);
 buttons(form,[['Crear historia',async()=>{p=await api('/projects','POST',{title:$('#title').value,genre:$('#genre').value,subgenres:[...document.querySelectorAll('.subgenre:checked')].map(e=>e.value),concept:$('#concept').value,format:$('#format').value});stage='Ideas';location.hash=`/proyectos/${p.id}`;await draw();}]]);screen.append(form);
 const grid=document.createElement('div');grid.className='grid';screen.append(grid);
 for(const item of list.projects.filter(x=>!x.archived)){const c=card(item.title,`<p class="badge">${esc(item.genre)} · ${esc(item.stage)}</p>`);buttons(c,[['Abrir',async()=>{if(active)await lease(false);p=item;budgetId=null;stage='Ideas';location.hash=`/proyectos/${p.id}`;await draw();}],['Archivar',async()=>{p=item;await mutate(route(''),{archived:true},'PATCH');await draw();},true]]);grid.append(c);}
}
async function ideas(){
 const c=card(p.title,`<p>${esc(p.genre)} · ${esc(p.subgenres.join(', '))}</p><p>${esc(p.concept||'Concepto abierto')}</p>`);buttons(c,[['Generar tres ideas',()=>paid('ideas',route('/ideas:generate'))],['Configurar presupuesto',async()=>{stage='Producción';await draw();},true]]);screen.append(c);
 const batches=Object.groupBy(p.ideas||[],x=>x.batchId);for(const batch of Object.values(batches).reverse()){const grid=document.createElement('div');grid.className='grid';screen.append(grid);const latest=new Map();for(const idea of batch)latest.set(idea.data.id,idea);for(const i of latest.values())candidates(grid,i,i.data,'ideas');const old=batch.filter(i=>latest.get(i.data.id)!==i);if(old.length){const history=document.createElement('details');history.innerHTML='<summary>Versiones anteriores de estas ideas</summary>';old.forEach(i=>candidates(history,i,i.data,'ideas'));screen.append(history);}}
}
function candidates(parent,entity,d,kind){const c=card(d.title||'Propuesta',`<p>${esc(d.premise||'')}</p><p>${esc(d.initialSituation||'')}</p><p><strong>Conflicto:</strong> ${esc(d.obstacle||'')}</p><p><strong>Emoción:</strong> ${esc(d.emotionalProgression||'')}</p><p><strong>Cierre:</strong> ${esc(d.ending||'')}</p>`);buttons(c,[['Elegir',async()=>{await mutate(route(`/ideas/${entity.id}:select`),{});say('Idea elegida. Puedes desarrollar su guion.');stage='Guion y biblias';await draw();}],['Ajustar esta idea',()=>revise(kind,entity),true]]);parent.append(c);}
async function revise(kind,e){
 if(kind==='ideas'){
  const dialog=document.createElement('dialog');document.body.append(dialog);const label=document.createElement('label');label.textContent='Parte de la idea';const select=document.createElement('select');
  for(const [field,title] of Object.entries({title:'Título',premise:'Premisa',characters:'Personajes',initialSituation:'Situación inicial',objective:'Objetivo',obstacle:'Obstáculo',emotionalProgression:'Progresión emocional',climax:'Clímax',ending:'Desenlace',visualComplexity:'Complejidad visual'})){const option=document.createElement('option');option.value=field;option.textContent=title;select.append(option);}label.append(select);dialog.append(label);
  const instruction=document.createElement('textarea');instruction.placeholder='¿Qué debe cambiar en esa parte?';dialog.append(instruction);
  buttons(dialog,[['Crear candidata',async()=>{if(!instruction.value.trim())throw new Error('Describe el cambio.');const id=await paid('revise',route(`/revisions/${kind}/${e.id}:revise`),{instruction:instruction.value,scope:{field:select.value}});if(id){dialog.close();dialog.remove();await draw();}}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();return;
 }
 const dialog=document.createElement('dialog');document.body.append(dialog);const heading=document.createElement('h2');heading.textContent='Corregir una parte con IA';dialog.append(heading);
 const label=document.createElement('label');label.textContent='Alcance';const select=document.createElement('select'),options=[];
 for(const [group,name,rows] of [['shots','Toma',e.data.shots],['utterances','Intervención',e.data.utterances],['characters','Personaje',e.data.bible.characters],['locations','Lugar',e.data.bible.locations],['props','Objeto',e.data.bible.props],['soundRequests','Efecto',e.data.soundRequests],['musicRequests','Música',e.data.musicRequests]])for(const item of rows){options.push({group,entityId:item.id});const option=document.createElement('option');option.value=options.length-1;option.textContent=`${name}: ${item.name||item.spanish||item.id}`;select.append(option);}
 options.push({group:'whole'});const entire=document.createElement('option');entire.value=options.length-1;entire.textContent='Guion completo (revisar todo el impacto)';select.append(entire);label.append(select);dialog.append(label);
 const instruction=document.createElement('textarea');instruction.placeholder='Describe qué debe cambiar y qué debe conservarse';const field=document.createElement('label');field.textContent='Corrección';field.append(instruction);dialog.append(field);
 buttons(dialog,[['Crear candidata',async()=>{if(!instruction.value.trim())throw new Error('Describe la corrección.');await paid('revise',route(`/revisions/${kind}/${e.id}:revise`),{instruction:instruction.value,scope:options[Number(select.value)]});dialog.close();dialog.remove();await draw();}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}
async function approve(kind,id,checks={}){await mutate(route(`/revisions/${kind}/${id}:approve`),{checks});say('Versión aprobada y conservada.');}
function readable(parent,value){
 const labels={dramatic:'Dirección dramática',visual:'Estilo visual',characters:'Personajes',locations:'Lugares',props:'Objetos',name:'Nombre',japaneseReading:'Lectura japonesa',age:'Edad',objective:'Objetivo',relationships:'Relaciones',speech:'Forma de hablar',voice:'Voz',languageCode:'Idioma',direction:'Actuación',costumes:'Vestuario',description:'Descripción',referencePrompt:'Referencia visual',layout:'Distribución',entrances:'Entradas',windows:'Ventanas',furniture:'Mobiliario',light:'Luz',soundZones:'Zonas sonoras',owner:'Poseedor',state:'Estado'};
 for(const [key,item] of Object.entries(value)){if(key==='id')continue;if(item&&typeof item==='object'){const group=document.createElement('details'),title=document.createElement('summary');title.textContent=item.name||labels[key]||(/^[0-9]+$/.test(key)?'Elemento '+(Number(key)+1):key);group.append(title);readable(group,item);parent.append(group);}else{const line=document.createElement('p'),label=document.createElement('strong');label.textContent=(labels[key]||key)+': ';line.append(label,document.createTextNode(String(item??'')));parent.append(line);}}
}
async function script(){
 const intro=card('Guion y biblias',`<p>Idea elegida: ${esc(p.ideas.find(i=>i.id===p.selectedIdea?.id)?.data.title||'Ninguna')}</p>`);buttons(intro,[['Desarrollar la idea elegida',()=>paid('develop',route('/develop'))]]);screen.append(intro);
 for(const e of [...p.developments].reverse()){
   const d=e.data,c=card(d.title,`<p class="badge">${esc(e.approvalState)} · revisión ${e.revision}</p>`);
   for(const s of d.shots){const scene=document.createElement('details');scene.innerHTML=`<summary>${esc(s.id)} · ${esc(s.function)} · ${(s.frames/24).toFixed(1)} s</summary><p>${esc(s.prompt)}</p>`;for(const u of d.utterances.filter(u=>u.shotId===s.id))scene.innerHTML+=`<p><strong>${esc(u.speakerId)} · ${esc(u.type)}</strong><br>${esc(u.spanish)}</p><details><summary>Japonés y actuación</summary><p>${esc(u.japanese)}</p><p>${esc(u.acting)}</p></details>`;c.append(scene);}
   const b=document.createElement('details');b.innerHTML='<summary>Biblias de esta historia</summary>';readable(b,d.bible);c.append(b);
   if(e.impact){const impact=document.createElement('details');impact.innerHTML=`<summary>Cambios y recursos afectados</summary><p>${e.impact.changes.length} cambios · ${(e.impact.assetsNeedingReview||[]).map(x=>esc(x.entityId+' ('+x.kind+')')).join(', ')||'sin regeneraciones necesarias'}</p>`;for(const change of e.impact.changes){const line=document.createElement('p');line.textContent=change.path.join(' / ')+': '+JSON.stringify(change.before)+' → '+JSON.stringify(change.after);impact.append(line);}c.append(impact);}
   if(e.review){const r=document.createElement('details');r.innerHTML=`<summary>Revisión y límites observados</summary><pre>${esc(JSON.stringify(e.review,null,2))}</pre>`;c.append(r);}
   buttons(c,[['Aprobar guion y biblias',()=>approve('developments',e.id)],['Corregir una parte con IA',()=>revise('developments',e),true],['Editar manualmente',()=>editDevelopment(e),true]]);screen.append(c);
 }
}
async function production(){
 const cfg=await api(route('/budgets'));rates=cfg.rates;const valid=cfg.budgets.filter(b=>b.expires>Date.now()/1000);if(!budgetId&&valid.length)budgetId=valid.at(-1).id;
 const c=card('Autorización de producción',`<p>Elige un límite para generación y trabajo de montaje. Cada tarea muestra ambas reservas por separado. Las llamadas ya aceptadas pueden facturarse aunque pauses.</p><label>Límite en USD<input type="number" id="budget" min="0.01" step="0.01" placeholder="Sin presupuesto autorizado"></label><p class="muted">Generación y render requieren tarifas verificadas en el servidor.</p>`);
 buttons(c,[['Autorizar límite',async()=>{const value=Number($('#budget').value);if(!(value>0))throw new Error('Indica un importe.');if(!confirm(`¿Autorizas hasta ${value.toFixed(2)} USD durante 24 horas para esta historia?`))return;const b=await mutate(route('/budgets'),{limitMicros:Math.round(value*1e6),operations:['ideas','develop','revise','image','veo','tts','music','analyze','review','transcribe','media','preview','render','frames','import']});budgetId=b.id;await draw();}],['Pausar nuevas generaciones',async()=>{await lease(false);say('Pausado. Se conserva lo completado.');},true],['Continuar sesión',async()=>{await lease(true);say('Sesión activa. Solo se despacharán tareas autorizadas.');},true]]);
 for(const b of cfg.budgets){const row=document.createElement('p');row.textContent=`Autorizado: $${(b.limit/1e6).toFixed(2)} · reservado: $${(b.reserved/1e6).toFixed(4)} · uso estimado: $${(b.spent/1e6).toFixed(4)}`;c.append(row);buttons(c,[['Renovar / ampliar este límite',async()=>{const value=Number(prompt('Límite total en USD para esta autorización (incluye lo ya gastado y reservado):',String(b.limit/1e6)));if(!(value>0))return;if(!confirm(`¿Renovar por 24 horas con límite total de ${value.toFixed(2)} USD?`))return;const updated=await mutate(route(`/budgets/${b.id}:extend`),{limitMicros:Math.round(value*1e6)});budgetId=updated.id;await draw();},true]]);}
 screen.append(c);
 if(p.activeDevelopment)buttons(c,[['Generar pendientes / continuar lote',()=>runBatch()],['Detener lote',async()=>{batchRunning=false;await lease(false);say('Lote detenido; las tareas ya aceptadas pueden terminar.');},true]]);
 const jobs=await api(route('/jobs'));for(const j of jobs.jobs){const item=card(j.operation,`<p>${esc(j.state)}</p>`);buttons(item,[['Consultar resultado',()=>watch(j.id),true],['Diagnosticar ejecución',async()=>{const current=await api('/jobs/'+j.id);const result=await api('/jobs/'+j.id+':inspect','POST',{}, {'If-Match':String(current.revision)});say(result.message);await draw();},true]]);if(j.state==='queued'||(j.state==='waiting_provider'&&['VEO_PENDING','SPEECH_PENDING'].includes(j.errorCode)))buttons(item,[['Recuperar pendiente',async()=>{if(!active)await lease(true);const current=await api('/jobs/'+j.id);await api('/jobs/'+j.id+':resume','POST',{session},{'If-Match':String(current.revision)});await draw();},true]]);if(['queued','running','waiting_provider'].includes(j.state))buttons(item,[['Cancelar tarea',async()=>{const current=await api('/jobs/'+j.id);await api('/jobs/'+j.id+':cancel','POST',{}, {'If-Match':String(current.revision)});await draw();},true]]);if(j.result?.previewId)buttons(item,[['Reproducir resultado',()=>playPreview(j.result.previewId,item)]]);screen.append(item);}
}
async function runBatch(){
 if(batchRunning)return;
 if(!budgetId)throw new Error('Autoriza primero un presupuesto.');
 const plan=await api(route('/batches')),ready=plan.nodes.filter(x=>x.state==='ready');
 if(!ready.length){say('No hay generaciones listas. Revisa y aprueba las candidatas o completa sus referencias.');return;}
 if(!confirm(`Generar ${ready.length} recursos listos, con reserva máxima de ${(plan.maxMicros/1e6).toFixed(4)} USD. Los aprobados y las candidatas existentes se conservan. El lote se detiene donde haga falta tu revisión. ¿Continuar?`))return;
 await lease(true);const batch=await mutate(route('/batches'),{budgetId,session,acceptPlanHash:plan.planHash});batchRunning=true;
 const allowed=new Set(ready.map(x=>x.key));
 try{for(let n=0;n<plan.nodes.length&&batchRunning&&active;n++){
  const now=await api(route('/batches'));const next=now.nodes.find(x=>x.state==='ready');
  if(!next||!allowed.has(next.key)){say('Lote conservado. Revisa las candidatas antes de continuar la siguiente etapa.');break;}
  await refresh();const result=await api(route(`/batches/${batch.id}:next`),'POST',{session});
  if(!result.jobId){say('Pendientes guardados para revisión.');break;}
  const job=await watch(result.jobId);if(!job||!['succeeded','awaiting_review'].includes(job.state)){say('Lote pausado: revisa la tarea antes de continuar.',true);break;}
 }}finally{batchRunning=false;}
}

const development=()=>p.developments.find(x=>x.id===p.activeDevelopment)?.data;
async function assetCard(parent,a){
 const c=card(a.entityId,`<p class="badge">${esc(a.kind)} · ${esc(a.approvalState)}</p>`);
 const checks={};for(const [key,label] of a.kind==='pcm'?[['contentHeard','Escuché el archivo completo'],['contentMatchesRequest','Coincide con el encargo (música sin habla/letra; voces con texto japonés correcto)']]:[['visualContinuity','Revisé personajes, lugar y estado físico'],...(a.kind==='veo_silent_validated'?[['mouthCoverage','La boca visible está sincronizada o revisé una cobertura alternativa sin diálogo visible']]:[])]){const labelNode=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.onchange=()=>checks[key]=input.checked;labelNode.append(input,document.createTextNode(label));c.append(labelNode);}
 buttons(c,[['Ver / escuchar',async()=>{const {url}=await api(route(`/assets/${a.id}/url`));const media=document.createElement(a.kind==='image'?'img':a.kind==='pcm'?'audio':'video');media.src=url;media.controls=true;media.playsInline=true;c.append(media);}],[a.approvalState==='approved'?'Usar esta versión aprobada':'Aprobar esta versión',()=>approve('assets',a.id,checks),true]]);parent.append(c);
}
async function shots(){
 const d=development();if(!d){screen.append(card('Aprueba el guion y las biblias primero.'));return;}
 const refs=card('Referencias de esta historia','<p>Genera y aprueba identidad, lugares y objetos antes de las tomas.</p>');
 for(const kind of ['characters','locations','props'])for(const e of d.bible[kind])buttons(refs,[[`Generar referencia: ${e.name}`,()=>paid('image',route('/assets:generate'),{operation:'image',entityId:e.id}),true]]);buttons(refs,[['Importar referencia o música de otra historia',()=>importAsset(),true]]);screen.append(refs);
 for(const a of p.assets.filter(a=>!d.shots.some(s=>s.id===a.entityId)))await assetCard(screen,a);
 for(const s of d.shots){const c=card(s.id,`<p>${esc(s.function)} · ${esc(s.treatment)}</p><p>${esc(s.prompt)}</p><p class="muted">${esc(d.utterances.filter(u=>u.shotId===s.id).map(u=>u.spanish).join(' '))}</p>`);
 buttons(c,[['Generar imagen',()=>paid('image',route('/assets:generate'),{operation:'image',entityId:s.id})],['Generar video',()=>paid('veo',route('/assets:generate'),{operation:'veo',entityId:s.id,seconds:8}),true],['Movimiento y capas',()=>visualEditor(s),true],['Preview de toma',()=>previewShots([s.id],c),true],['Preview de escena',()=>previewShots(d.shots.filter(x=>x.beatId===s.beatId).map(x=>x.id),c),true],['Comparar tomas contiguas',()=>compareShots(s,c),true]]);
 for(const u of d.utterances.filter(u=>u.shotId===s.id))buttons(c,[[`Voz: ${u.spanish.slice(0,45)}`,()=>paid('tts',route('/assets:generate'),{operation:'tts',entityId:u.id}),true]]);
 for(const a of p.assets.filter(a=>a.entityId===s.id))await assetCard(c,a);screen.append(c);}
}
async function importAsset(){
 const dialog=document.createElement('dialog');document.body.append(dialog);const box=card('Importación explícita','<p>Se crea una copia dentro de esta historia, con procedencia y revisión propia. Elige el recurso y su destino.</p>');dialog.append(box);
 const projects=await api('/projects'),from=document.createElement('select'),assets=document.createElement('select'),target=document.createElement('select');
 for(const [label,input] of [['Historia de origen',from],['Recurso aprobado',assets],['Ficha o música de destino',target]]){const l=document.createElement('label');l.textContent=label;l.append(input);box.append(l);}
 const others=projects.projects.filter(x=>x.id!==p.id);let source,sourceAssets=[];
 for(const q of others){const option=document.createElement('option');option.value=q.id;option.textContent=q.title;from.append(option);}
 function targets(){target.replaceChildren();const a=sourceAssets.find(x=>x.id===assets.value);if(!a)return;const dev=source.developments.find(x=>x.id===a.developmentId)?.data;const group=['characters','locations','props'].find(k=>dev?.bible[k].some(x=>x.id===a.entityId));const rows=group?development().bible[group]:development().musicRequests;for(const item of rows){const option=document.createElement('option');option.value=item.id;option.textContent=item.name||item.prompt.slice(0,80);target.append(option);}}
 async function load(){assets.replaceChildren();if(!from.value)return;source=await getProject(from.value);sourceAssets=source.assets.filter(a=>{if(a.approvalState!=='approved')return false;const d=source.developments.find(x=>x.id===a.developmentId)?.data;return d&&((a.kind==='image'&&['characters','locations','props'].some(k=>d.bible[k].some(x=>x.id===a.entityId)))||(a.kind==='pcm'&&d.musicRequests.some(x=>x.id===a.entityId)));});for(const a of sourceAssets){const option=document.createElement('option');option.value=a.id;option.textContent=a.entityId+' · '+a.kind;assets.append(option);}targets();}
 from.onchange=()=>load().catch(e=>say(e.message,true));assets.onchange=targets;await load();
 buttons(box,[['Copiar como candidata',async()=>{if(!assets.value||!target.value)throw new Error('Selecciona un recurso compatible y su destino.');const id=await paid('import',route('/imports'),{sourceProjectId:from.value,sourceAssetId:assets.value,targetId:target.value});if(id){dialog.close();dialog.remove();stage='Guion y biblias';await draw();say('Copia conservada con procedencia. Revisa la ficha y el archivo importados antes de aprobarlos.');}}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}
async function previewShots(ids,parent){
 const timeline=await mutate(route('/timeline:compile'),{}),shots=timeline.data.shots.filter(x=>ids.includes(x.id));
 const jobId=await paid('preview',route('/previews'),{timelineId:timeline.id,startFrame:Math.min(...shots.map(x=>x.startFrame)),endFrame:Math.max(...shots.map(x=>x.startFrame+x.frames))});
 if(jobId){const job=await api('/jobs/'+jobId);if(job.result?.previewId)await playPreview(job.result.previewId,parent);}
}
async function compareShots(shot,parent){
 const d=development(),index=d.shots.findIndex(x=>x.id===shot.id),view=document.createElement('div');view.className='grid';parent.append(view);
 for(const adjacent of d.shots.slice(Math.max(0,index-1),index+2)){
  const item=card(adjacent.id,`<p>${esc(adjacent.function)}</p>`);view.append(item);
  const images=p.assets.filter(a=>a.entityId===adjacent.id&&a.kind==='image'),approved=images.filter(a=>a.approvalState==='approved').at(-1),candidate=images.filter(a=>a.approvalState==='candidate').at(-1);
  for(const asset of [approved,candidate].filter(Boolean)){const image=document.createElement('img');image.src=(await api(route(`/assets/${asset.id}/url`))).url;image.alt=adjacent.id+' · '+asset.approvalState;const label=document.createElement('p');label.textContent=asset.approvalState==='approved'?'Aprobada':'Candidata';item.append(label,image);}
 }
}
async function sounds(){
 const d=development();if(!d){screen.append(card('Aprueba primero el guion.'));return;}
 for(const m of d.musicRequests){const c=card('Música',`<p>${esc(m.prompt)}</p><p>${m.seconds} segundos · pieza reutilizable</p>`);buttons(c,[['Generar pieza instrumental',()=>paid('music',route('/assets:generate'),{operation:'music',entityId:m.id})]]);screen.append(c);}
 for(const r of d.soundRequests){
  const c=card(r.name,`<p>${esc(r.description)}</p><p><strong>${r.seconds} s</strong> · Preparación ${r.preparationSeconds} s · Cola ${r.tailSeconds} s</p><p>${esc(r.perspective)}</p><details><summary>Prompt del efecto</summary><p>${esc(r.prompt)}</p></details>`);
  buttons(c,[['Copiar prompt',()=>navigator.clipboard.writeText(r.prompt),true],['Omitir con decisión editorial',async()=>{const reason=prompt('¿Por qué debe omitirse este sonido? Se conservará la decisión.');if(reason){await mutate(route(`/sound-requests/${r.id}/omit`),{reason});say('Omisión guardada para esta versión de guion.');}},true]]);
  const label=document.createElement('label');label.textContent='Subir efecto · MP3 y otros formatos de audio';const input=document.createElement('input');input.type='file';input.accept='audio/*';label.append(input);c.append(label);
  const progress=document.createElement('progress');progress.max=1;progress.value=0;c.append(progress);
  input.onchange=()=>uploadSound(r,input.files[0],progress).catch(e=>say(e.message,true));
  for(const cue of p.cues.filter(c=>c.requestId===r.id)){buttons(c,[['Ajuste manual',()=>openEditor(cue)],['Localizar con IA',()=>paid('analyze',route(`/cues/${cue.id}:analyze`)),true],['Usar propuesta IA',async()=>{await mutate(route(`/cues/${cue.id}/proposal:apply`),{});say('Propuesta aplicada como candidata.');},true]]);
   if(cue.analysisScan?.options.length>1)for(const [index,option] of cue.analysisScan.options.entries())buttons(c,[[`Contacto ${index+1}: ${option.seconds.toFixed(2)} s · ${option.description}`,()=>paid('analyze',route(`/cues/${cue.id}:analyze`),{occurrenceIndex:index,reason:'Usar exclusivamente el contacto elegido'}),true]]);
  }
  for(const a of p.assets.filter(a=>a.requestId===r.id))await assetCard(c,a);screen.append(c);
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
 const jobId=await paid('media',route(`/sound-requests/${r.id}/complete`),{assetId:sessionUpload.assetId});
 say(jobId?'Archivo recibido. Revisa el ataque propuesto y su contexto.':'Archivo conservado. Su preparación espera tu autorización.');
}

async function playPreview(id,parent){const d=await api(route(`/previews/${id}`));if(!d.url)throw new Error('Preview aún no disponible.');if(d.current===false){const stale=document.createElement('p');stale.className='error';stale.textContent='Versión anterior: cambiaron sus dependencias. Puedes compararla, pero no aprobar ajustes nuevos con ella.';parent.append(stale);}if(d.draftIssues?.length){const note=document.createElement('p');note.textContent='Borrador: '+d.draftIssues.join(' · ');parent.append(note);}const v=document.createElement('video');v.controls=true;v.playsInline=true;v.src=d.url;parent.append(v);return d;}
async function exportsView(){
 const mixCard=card('Mezcla del programa','<label><input id="normalize-program" type="checkbox"> Normalizar el programa completo a −16 LUFS / −1 dBTP</label><label><input id="duck-program" type="checkbox"> Atenuar música durante las voces</label><p>Se conservará el mismo contexto de mezcla en previews y final.</p>');
 buttons(mixCard,[['Aprobar política de mezcla',async()=>{await mutate(route('/mix-policy'),{normalize:$('#normalize-program').checked,duckMusic:$('#duck-program').checked});say('Política guardada. Recompila para escuchar el cambio.');}]]);screen.append(mixCard);
 const c=card('Revisar y exportar','<p>La preview y el final usan las mismas decisiones guardadas. Los recursos pendientes bloquean la exportación final.</p>');
 buttons(c,[['Aprobar traducción y tiempos de voz',async()=>{if(!confirm('¿Revisaste las voces definitivas y sus subtítulos españoles?'))return;const audioHashes=Object.fromEntries(p.assets.filter(a=>a.kind==='pcm'&&a.approvalState==='approved').map(a=>[a.id,a.sha256]));await mutate(route('/subtitles:approve'),{developmentId:p.activeDevelopment,audioHashes});}],['Compilar montaje',async()=>{const t=await mutate(route('/timeline:compile'),{});say('Montaje compilado. Revisa su preview antes de aprobar.');await draw();}],['Preview de 300 segundos',()=>paid('preview',route('/previews'))],['Exportar final',()=>paid('render',route('/renders'))]]);screen.append(c);
 for(const t of p.timelines){const e=card('Montaje '+t.id.slice(0,8),`<p>${esc(t.approvalState)}</p>`);buttons(e,[['Aprobar este montaje',()=>approve('timelines',t.id),true]]);screen.append(e);}
 for(const r of p.previews){const e=card(r.final?'Exportación final':'Vista previa',`<p>${r.startFrame/24}–${r.endFrame/24} segundos</p>`);buttons(e,[['Reproducir',()=>playPreview(r.id,e)]]);if(r.final)buttons(e,[['Descargar archivos',async()=>{const list=await api(route(`/exports/${r.id}`));for(const f of list.files){const a=document.createElement('a');a.href=f.url;a.textContent=f.name;a.className='button secondary';a.target='_blank';e.append(a);}}]]);screen.append(e);}
}
async function openEditor(initial){
 await refresh();let cue=p.cues.find(c=>c.id===initial.id),frames=[],framePos=0,framesId=null,previousPreview=null,currentPreview=null,correctionId=null;
 const box=$('#editor-content');box.replaceChildren();$('#editor').showModal();
 const title=document.createElement('p');title.textContent=cue.eventDescription;box.append(title);
 const image=document.createElement('img');image.className='frame';image.alt='Fotograma indexado del video aprobado';box.append(image);
 const info=document.createElement('p');info.className='frame-info';box.append(info);
 const frameInput=document.createElement('input');frameInput.type='number';frameInput.min=0;frameInput.value=0;const frameLabel=document.createElement('label');frameLabel.textContent='Inicio del intervalo de fotogramas';frameLabel.append(frameInput);box.append(frameLabel);
 function showFrame(){if(!frames.length)return;image.src=frames[framePos].url;info.textContent=`Fotograma fuente ${frames[framePos].index} · ${frames[framePos].seconds} s`;}
 async function save(patch){const result=await mutate(route(`/cues/${cue.id}`),{cueRevision:cue.revision,patch},'PATCH');cue=result.cue;correctionId=result.correctionId;status.textContent='Ajuste guardado como candidata. Prueba una nueva preview.';}
 buttons(box,[['Cargar fotogramas',async()=>{const jid=await paid('frames',route(`/shots/${cue.shotId}/frames`),{start:Number(frameInput.value),count:48});if(!jid)return;const job=await api('/jobs/'+jid);framesId=job.result?.framesId;if(!framesId)throw new Error('La extracción no terminó. Consulta Producción.');const r=await api(route(`/frames/${framesId}`));frames=r.frames;framePos=0;showFrame();}],['← Fotograma',()=>{framePos=Math.max(0,framePos-1);showFrame();},true],['Fotograma →',()=>{framePos=Math.min(frames.length-1,framePos+1);showFrame();},true],['El sonido debe coincidir aquí',async()=>{if(!frames.length)throw new Error('Carga primero los fotogramas indexados.');cue=await mutate(route(`/cues/${cue.id}/anchor`),{cueRevision:cue.revision,framesId,frameIndex:frames[framePos].index});status.textContent='Contacto seleccionado. Marca ahora el ataque del sonido.';}]]);
 const data=await api(route(`/assets/${cue.audioRevision}/waveform`));let selected=cue.sourceSyncSample,viewStart=0,viewEnd=data.samples;
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=180;canvas.className='wave';canvas.setAttribute('aria-label','Onda sonora; selecciona el ataque con el dedo');box.append(canvas);
 const sampleInfo=document.createElement('p');box.append(sampleInfo);
 function paint(){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,900,180);ctx.strokeStyle='#d9ed97';for(let x=0;x<900;x++){const idx=Math.min(data.peaks.length-1,Math.floor((viewStart+x/900*(viewEnd-viewStart))/data.binSamples));const peak=data.peaks[idx]||0;ctx.beginPath();ctx.moveTo(x,90-peak*85);ctx.lineTo(x,90+peak*85);ctx.stroke();}const marker=(selected-viewStart)/(viewEnd-viewStart)*900;ctx.strokeStyle='#ffaaaa';ctx.beginPath();ctx.moveTo(marker,0);ctx.lineTo(marker,180);ctx.stroke();sampleInfo.textContent=`Ataque: muestra ${selected} · ${(selected/48000).toFixed(4)} s`;}
 canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect();selected=Math.max(0,Math.min(data.samples-1,Math.round(viewStart+(e.clientX-r.left)/r.width*(viewEnd-viewStart))));paint();};paint();
 const audio=document.createElement('audio');audio.controls=true;audio.src=(await api(route(`/assets/${cue.audioRevision}/url`))).url;box.append(audio);
 buttons(box,[['Este es el golpe',()=>save({sourceSyncSample:selected})],['Ampliar onda',()=>{const span=Math.max(4800,(viewEnd-viewStart)/2);viewStart=Math.max(0,selected-span/2);viewEnd=Math.min(data.samples,viewStart+span);paint();},true],['Onda completa',()=>{viewStart=0;viewEnd=data.samples;paint();},true],['Escuchar zona',async()=>{audio.currentTime=Math.max(0,selected/48000-.25);await audio.play();const stop=()=>{if(audio.currentTime>selected/48000+.75){audio.pause();audio.removeEventListener('timeupdate',stop);}};audio.addEventListener('timeupdate',stop);},true]]);
 const attacks=document.createElement('select');attacks.innerHTML='<option value="">Elegir otro transitorio</option>'+data.attackCandidates.map(s=>`<option value="${s}">${(s/48000).toFixed(3)} s</option>`).join('');attacks.onchange=()=>{if(attacks.value){selected=Number(attacks.value);paint();}};box.append(attacks);
 buttons(box,[['Adelantar 1 fotograma',()=>save({offsetSamples:(cue.offsetSamples||0)-2000}),true],['Retrasar 1 fotograma',()=>save({offsetSamples:(cue.offsetSamples||0)+2000}),true]]);
 const fields=document.createElement('div');fields.innerHTML=`<label>Ganancia (dB)<input id="cue-gain" type="number" min="-60" max="12" value="${cue.gainDb||0}"></label><label>Entrada del archivo (segundos)<input id="cue-in" type="number" min="0" step="0.001" value="${cue.trimInSample/48000}"></label><label>Salida / cola (segundos)<input id="cue-out" type="number" min="0" step="0.001" value="${cue.trimOutSample/48000}"></label>`;box.append(fields);
 buttons(box,[['Guardar ganancia y recortes',()=>save({gainDb:Number($('#cue-gain').value),trimInSample:Math.round(Number($('#cue-in').value)*48000),trimOutSample:Math.round(Number($('#cue-out').value)*48000)})]]);
 const status=document.createElement('p');box.append(status);const player=document.createElement('video');player.controls=true;player.playsInline=true;box.append(player);
 buttons(box,[['Probar ajuste',async()=>{const t=await mutate(route('/timeline:compile'),{cueOverrides:{[cue.requestId]:cue.id}});const s=t.data.shots.find(s=>s.id===cue.shotId);const jid=await paid('preview',route('/previews'),{timelineId:t.id,startFrame:Math.max(0,s.startFrame-48),endFrame:Math.min(7200,s.startFrame+s.frames+72)});if(!jid)return;const job=await api('/jobs/'+jid);const rid=job.result?.previewId;if(!rid)throw new Error('Preview pendiente.');previousPreview=currentPreview;currentPreview=await api(route(`/previews/${rid}`));player.src=currentPreview.url;status.textContent='Preview muxada del ajuste actual.';}],['Comparar anterior / candidata',()=>{if(!previousPreview)throw new Error('Primero prueba dos ajustes para comparar.');player.pause();player.src=player.src===currentPreview.url?previousPreview.url:currentPreview.url;},true],['Deshacer',async()=>{if(!correctionId)throw new Error('No hay un ajuste nuevo que deshacer.');cue=await mutate(route(`/corrections/${correctionId}:undo`),{});correctionId=null;status.textContent='Ajuste anterior recuperado. Prepara su preview.';},true],['Aprobar y fijar',async()=>{if(!currentPreview)throw new Error('Prepara y escucha una preview de esta versión.');cue=await mutate(route(`/cues/${cue.id}:approve`),{previewId:currentPreview.id});status.textContent='Corrección aprobada y protegida frente al reanálisis automático.';}]]);
}
$('#close-editor').onclick=()=>{$('#editor').querySelectorAll('video,audio').forEach(m=>m.pause());$('#editor').close();};
document.addEventListener('play',e=>{if(e.target.matches('video,audio'))document.querySelectorAll('video,audio').forEach(m=>{if(m!==e.target)m.pause();});},true);
$('#back').onclick=async e=>{if(active){e.preventDefault();if(confirm('¿Pausar nuevas generaciones y volver a Animes?')){await lease(false);location.href='/';}}};
async function boot(){
 const c=await api('/config');
 if(!c.enabled||!c.configured){say('Cortos está en preparación. Falta activar y conectar su servicio; aquí no se simulan generaciones.');return;}
 const [firebase,authentication]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);authFns=authentication;auth=authentication.getAuth(firebase.initializeApp(c.firebase));
 $('#login').hidden=false;$('#signin').onclick=async()=>{try{await authentication.signInWithPopup(auth,new authentication.GoogleAuthProvider());}catch(e){say(e.code==='auth/popup-blocked'?'Abre esta página en Safari y permite la ventana de inicio de sesión.':'No se completó el inicio de sesión. Intenta entrar otra vez.',true);}};
 $('#account').onclick=()=>authentication.signOut(auth);
 authentication.onAuthStateChanged(auth,async u=>{user=u;$('#account').hidden=!u;$('#login').hidden=!!u;$('#workspace').hidden=!u;if(u){say('Sesión conectada. Tus decisiones se guardan en la nube.');try{const match=location.hash.match(/^#\/proyectos\/([a-zA-Z0-9_-]+)$/);if(match){p=await getProject(match[1]);await lease(false);stage='Ideas';}await draw();}catch(e){say(e.message,true);}}});
}
boot().catch(e=>say(e.message,true));

async function editDevelopment(entity){
 const dialog=document.createElement('dialog'),box=document.createElement('div');dialog.append(box);document.body.append(dialog);
 const patches=new Map(),labels={title:'Título',bible:'Biblias',dramatic:'Dirección dramática',visual:'Dirección visual',characters:'Personajes',locations:'Lugares',props:'Objetos',beats:'Unidades dramáticas',shots:'Tomas',utterances:'Intervenciones',soundRequests:'Efectos y ambientes',musicRequests:'Música',subtitles:'Subtítulos',spanish:'Español',japanese:'Japonés',acting:'Actuación',prompt:'Instrucción',frames:'Duración (fotogramas)',before:'Estado antes',after:'Estado después',treatment:'Tratamiento visual',camera:'Cámara',name:'Nombre',description:'Descripción',seconds:'Duración (segundos)',preparationSeconds:'Preparación',tailSeconds:'Cola',perspective:'Perspectiva',text:'Texto',layout:'Distribución',referencePrompt:'Referencia visual',voice:'Voz',direction:'Dirección de voz',japaneseReading:'Lectura japonesa',minFrames:'Mínimo de fotogramas',maxFrames:'Máximo de fotogramas',leadFrames:'Acción inicial (frames)',tailFrames:'Acción final (frames)',pauseBeforeFrames:'Pausa antes (frames)',pauseAfterFrames:'Pausa después (frames)',timingReason:'Razón de la duración',gainDb:'Ganancia (dB)',sourceInSample:'Recorte de entrada (muestras)',fadeInSamples:'Fundido de entrada (muestras)',fadeOutSamples:'Fundido de salida (muestras)'};
 const heading=document.createElement('h2');heading.textContent='Editar guion y biblias';box.append(heading);
 const explanation=document.createElement('p');explanation.textContent='Los cambios crean una candidata. Antes de guardar verás qué recursos necesitan revisión. Las versiones aprobadas se conservan.';box.append(explanation);
 function fields(parent,value,path=[]){
  for(const [key,current] of Object.entries(value)){
   if(key==='id')continue;
   const part=Array.isArray(value)?Number(key):key,next=[...path,part],name=labels[key]||key;
   if(current!==null&&typeof current==='object'){
    const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=Array.isArray(value)?(current.name||current.id||`Elemento ${Number(key)+1}`):name;group.append(summary);parent.append(group);fields(group,current,next);continue;
   }
   if(current===null)continue;
   const label=document.createElement('label');label.textContent=name;let input;
   if(key==='treatment'){input=document.createElement('select');for(const item of ['hold','camera2d','localized','veo']){const option=document.createElement('option');option.value=item;option.textContent={hold:'Ilustración sostenida',camera2d:'Cámara 2D',localized:'Animación localizada',veo:'Veo'}[item];input.append(option);}input.value=current;}
   else{input=document.createElement(typeof current==='string'?'textarea':'input');if(typeof current==='boolean'){input.type='checkbox';input.checked=current;}else if(typeof current==='number'){input.type='number';input.step='any';input.value=current;}else input.value=current;}
   input.onchange=()=>{const v=typeof current==='boolean'?input.checked:typeof current==='number'?Number(input.value):input.value;const k=JSON.stringify(next);if(v===current)patches.delete(k);else patches.set(k,{path:next,value:v});};label.append(input);parent.append(label);
  }
 }
 fields(box,entity.data);
 const order=card('Orden de tomas','<p>Mover una toma conserva su contenido. Revisa continuidad y anclas después de aprobar.</p>'),ordered=[...entity.data.shots];box.append(order);
 function drawOrder(){order.querySelectorAll('.shot-order').forEach(x=>x.remove());ordered.forEach((shot,index)=>{const row=document.createElement('div');row.className='shot-order';row.textContent=shot.id;buttons(row,[['↑',()=>move(index,-1),true],['↓',()=>move(index,1),true]]);order.append(row);});}
 function move(index,delta){const target=index+delta;if(target<0||target>=ordered.length)return;[ordered[index],ordered[target]]=[ordered[target],ordered[index]];patches.set('order',{path:['shots'],value:ordered});drawOrder();}drawOrder();
 const report=document.createElement('div');box.append(report);let confirmed;
 buttons(box,[['Revisar cambios',async()=>{const input={sourceHash:entity.dataHash,patches:[...patches.values()]};const result=await api(route(`/developments/${entity.id}/edits:preview`),'POST',input);confirmed={...input,impactHash:result.impactHash};report.replaceChildren();const detail=document.createElement('p');detail.textContent=`${result.report.changes.length} cambios. Recursos que necesitan revisión: ${result.report.assetsNeedingReview.map(x=>x.entityId+' ('+x.kind+')').join(', ')||'ninguno'}. No se genera contenido al guardar.`;report.append(detail);}],['Guardar candidata',async()=>{if(!confirmed||JSON.stringify(confirmed.patches)!==JSON.stringify([...patches.values()]))throw new Error('Revisa los cambios actuales antes de guardar.');await mutate(route(`/developments/${entity.id}/edits:save`),confirmed);dialog.close();dialog.remove();await draw();say('Candidata guardada. Revisa y aprueba cuando esté lista.');}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);
 dialog.showModal();
}

async function subtitlesView(){
 const data=await api(route('/subtitles'));
 screen.append(card('Subtítulos sobre la voz definitiva','<p>Los tiempos son relativos a cada intervención. Divide por unidades de sentido y deja libres los silencios. Guardar texto o tiempos no genera otra voz.</p>'));
 for(const row of data.rows){
  const c=card(row.utteranceId,`<p>${esc(row.japanese)}</p>${row.stale?'<p class="error">La voz cambió: revisa los tiempos.</p>':''}`);screen.append(c);
  const audio=document.createElement('audio');audio.controls=true;audio.src=(await api(route(`/assets/${row.audioRevision}/url`))).url;c.append(audio);
  const segments=structuredClone(row.segments),list=document.createElement('div');c.append(list);
  function drawRows(){list.replaceChildren();segments.forEach((segment,i)=>{
   const line=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`Bloque ${i+1}`;line.append(legend);
   for(const [key,label] of [['text','Español'],['startSample','Inicio (segundos)'],['endSample','Fin (segundos)'],['exceptionReason','Justificación si necesita exceder los límites de lectura']]){
    const field=document.createElement('label');field.textContent=label;const input=document.createElement(key==='text'||key==='exceptionReason'?'textarea':'input');if(key.endsWith('Sample')){input.type='number';input.min=0;input.step='.001';input.value=segment[key]/48000;input.onchange=()=>segment[key]=Math.round(Number(input.value)*48000);}else{input.value=segment[key]||'';input.onchange=()=>segment[key]=input.value;}field.append(input);line.append(field);
   }
   buttons(line,[['Inicio en el audio actual',()=>{segment.startSample=Math.round(audio.currentTime*48000);drawRows();},true],['Fin en el audio actual',()=>{segment.endSample=Math.round(audio.currentTime*48000);drawRows();},true],['Dividir aquí',()=>{const at=Math.round(audio.currentTime*48000);if(at<=segment.startSample||at>=segment.endSample)throw new Error('Sitúa el audio dentro del bloque.');const next={text:'',startSample:at,endSample:segment.endSample};segment.endSample=at;segments.splice(i+1,0,next);drawRows();},true],['Eliminar bloque',()=>{if(segments.length===1)throw new Error('Conserva al menos un bloque.');segments.splice(i,1);drawRows();},true]]);list.append(line);
  });}drawRows();
  const warnings=document.createElement('p');warnings.textContent=row.warnings.map(w=>`Bloque ${w.block}: ${w.issues.join(', ')}`).join(' · ');c.append(warnings);
  buttons(c,[['Reconocer japonés y consultar tiempos',async()=>{const jid=await paid('transcribe',route('/assets:generate'),{operation:'transcribe',entityId:row.utteranceId});if(!jid)return;const job=await api('/jobs/'+jid);if(job.result?.alignmentId){const record=await api(route(`/alignments/${job.result.alignmentId}`));const note=document.createElement('p');note.textContent=record.precisionNotice+' · '+record.words.map(w=>`${w.text}: ${(w.startSample/48000).toFixed(2)}–${(w.endSample/48000).toFixed(2)} s`).join(' · ');c.append(note);}},true],['Guardar subtítulos',async()=>{const result=await mutate(route(`/subtitles/${row.utteranceId}`),{audioRevision:row.audioRevision,audioHash:row.audioHash,segments});warnings.textContent=result.warnings.map(w=>`Bloque ${w.block}: ${w.issues.join(', ')}`).join(' · ')||'Sin conflictos de lectura.';say('Texto y tiempos guardados. Revisa la preview de la toma.');}],['Ver toma con subtítulos',async()=>{const t=await mutate(route('/timeline:compile'),{});const shot=t.data.shots.find(s=>s.id===row.shotId);const jid=await paid('preview',route('/previews'),{timelineId:t.id,startFrame:shot.startFrame,endFrame:shot.startFrame+shot.frames});if(jid){const job=await api('/jobs/'+jid);if(job.result?.previewId)await playPreview(job.result.previewId,c);}}]]);
 }
}

async function visualEditor(shot){
 const dialog=document.createElement('dialog');document.body.append(dialog);const box=card('Movimiento y capas','<p>La cámara reutiliza la imagen aprobada. Una variante localizada solo se genera cuando la solicitas; el montaje reutiliza su archivo.</p>');dialog.append(box);
 const fields={},field=(key,label,value,min,max,step='any')=>{const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=value;l.append(input);box.append(l);fields[key]=input;};
 const methodLabel=document.createElement('label');methodLabel.textContent='Tratamiento';const method=document.createElement('select');for(const [value,label] of [['hold','Ilustración sostenida'],['camera2d','Cámara 2D'],['localized','Variante localizada'],['veo','Veo']]){const option=document.createElement('option');option.value=value;option.textContent=label;method.append(option);}method.value=shot.treatment;methodLabel.append(method);box.append(methodLabel);
 for(const [end,label] of [['start','Inicio'],['end','Final']]){const values=shot.camera?.[end]||[1,.5,.5];field(end+'Zoom',label+' · zoom',values[0],1,2);field(end+'X',label+' · centro horizontal (%)',values[1]*100,0,100);field(end+'Y',label+' · centro vertical (%)',values[2]*100,0,100);}
 const base=p.assets.filter(a=>a.kind==='image'&&a.entityId===shot.id&&a.approvalState==='approved').at(-1);
 if(base){const image=document.createElement('img');image.src=(await api(route(`/assets/${base.id}/url`))).url;image.alt='Referencia de la toma para elegir región';box.append(image);}
 const promptField=document.createElement('textarea');promptField.placeholder='Ejemplo: párpados cerrados, conservar todo lo demás';const label=document.createElement('label');label.textContent='Cambio para una nueva variante';label.append(promptField);box.append(label);
 buttons(box,[['Generar variante con Gemini',async()=>{if(!promptField.value.trim())throw new Error('Describe la variante.');await paid('image',route('/assets:generate'),{operation:'image',entityId:shot.id,variantPrompt:promptField.value});dialog.close();dialog.remove();await draw();say('Variante creada. Revisa y aprueba su imagen antes de aplicar la máscara.');},true]]);
 const variants=p.assets.filter(a=>a.variantOf===shot.id&&a.approvalState==='approved'),layerRows=[];
 for(const variant of variants){const previous=shot.layers?.find(x=>x.assetRevision===variant.id);const row=card('Variante '+variant.id.slice(0,6)),use=document.createElement('input');use.type='checkbox';use.checked=!!previous;const label=document.createElement('label');label.append(use,document.createTextNode('Usar esta variante'));row.append(label);const image=document.createElement('img');image.src=(await api(route(`/assets/${variant.id}/url`))).url;image.alt='Variante regional aprobada';row.append(image);const inputs={};
  for(const [key,title,value,max] of [['x','Izquierda (%)',(previous?.mask.x??0)*100,100],['y','Arriba (%)',(previous?.mask.y??0)*100,100],['width','Ancho (%)',(previous?.mask.width??1)*100,100],['height','Alto (%)',(previous?.mask.height??1)*100,100],['startFrame','Primer fotograma',previous?.startFrame??0,shot.frames-1],['endFrame','Fotograma de salida',previous?.endFrame??shot.frames,shot.frames]]){const l=document.createElement('label');l.textContent=title;const input=document.createElement('input');input.type='number';input.min=0;input.max=max;input.value=value;input.step=key.endsWith('Frame')?'1':'.1';l.append(input);row.append(l);inputs[key]=input;}
  const note=document.createElement('p');note.textContent='Se superpone únicamente la región rectangular elegida durante este intervalo; comprueba sus bordes y continuidad en la preview.';row.append(note);const voice=document.createElement('select'),manual=document.createElement('option');manual.value='';manual.textContent='Intervalo manual';voice.append(manual);
  for(const u of development().utterances.filter(u=>u.shotId===shot.id)){const a=p.assets.filter(a=>a.entityId===u.id&&a.kind==='pcm'&&a.approvalState==='approved').at(-1);if(a){const option=document.createElement('option');option.value=a.id;option.textContent='Boca por actividad: '+u.spanish.slice(0,45);voice.append(option);}}
  voice.value=previous?.voiceBinding?.audioRevision||'';const voiceLabel=document.createElement('label');voiceLabel.textContent='Activar variante (apertura/cierre limitado, sin sincronía fonética garantizada)';voiceLabel.append(voice);row.append(voiceLabel);box.append(row);layerRows.push({variant,use,inputs,voice});
 }
 buttons(box,[['Guardar candidata visual',async()=>{const camera=Object.fromEntries(['start','end'].map(end=>[end,[Number(fields[end+'Zoom'].value),Number(fields[end+'X'].value)/100,Number(fields[end+'Y'].value)/100]]));const layers=layerRows.filter(x=>x.use.checked).map(({variant,inputs,voice})=>({...(voice.value?{voiceBinding:(()=>{const a=p.assets.find(a=>a.id===voice.value);return {utteranceId:a.entityId,audioRevision:a.id,audioHash:a.sha256};})()}:{}),assetRevision:variant.id,mask:Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(inputs[k].value)/100])),startFrame:Number(inputs.startFrame.value),endFrame:Number(inputs.endFrame.value),approved:true}));await mutate(route(`/shots/${shot.id}/visual:propose`),{treatment:method.value,camera,layers});dialog.close();dialog.remove();stage='Guion y biblias';await draw();say('Edición visual candidata. Revisa su alcance antes de aprobarla.');}],['Cerrar',()=>{dialog.close();dialog.remove();},true]]);dialog.showModal();
}
