const $=s=>document.querySelector(s), screen=$('#screen'), notice=$('#notice');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const genres=['acción','aventura','fantasía','isekai','drama','psicológico','terror','misterio','romance','comedia','comedia romántica','vida cotidiana','ciencia ficción','mecha','sobrenatural','supervivencia','deportes','videojuego/sistema'];
const subgenres=['absurdo','humor negro','sátira','tensión romántica','ecchi adulto no explícito','tragedia','venganza','suspenso','terror psicológico','fantasía oscura','misterio sobrenatural','rivalidad','entrenamiento/superación','sistema/progresión','exploración','relación laboral','familia','reencuentro','conflicto moral','apocalipsis','combate táctico'];
let auth,authFns,user,p,stage='Proyectos',budgetId,rates={},active=false,busy=false,heartbeatBusy=false;
const session=crypto.randomUUID(),device=localStorage.getItem('animeShorts:v2:device')||crypto.randomUUID();localStorage.setItem('animeShorts:v2:device',device);
const say=(s,error=false)=>{notice.textContent=s;notice.className=error?'error':'';};
function action(label,fn,secondary=false){const b=document.createElement('button');b.textContent=label;if(secondary)b.className='secondary';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){say(e.message,true);}finally{b.disabled=false;}};return b;}
function card(title,content=''){const e=document.createElement('article');e.className='card';e.innerHTML=`<h3>${esc(title)}</h3>${content}`;return e;}
function buttons(parent,items){const row=document.createElement('div');row.className='actions';items.forEach(([label,fn,secondary])=>row.append(action(label,fn,secondary)));parent.append(row);return row;}
async function api(path,method='GET',data,headers={}){
  const h={...headers};if(user)h.Authorization='Bearer '+await user.getIdToken();if(data)h['Content-Type']='application/json';if(p)h['If-Match']=String(p.revision);
  const r=await fetch('/api/shorts?path='+encodeURIComponent(path),{method,headers:h,body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||`Error ${r.status}`);return j;
}
const route=s=>`/projects/${p.id}${s}`;
async function refresh(){p=await api(route(''));}
async function mutate(path,data,method='POST'){busy=true;try{while(heartbeatBusy)await new Promise(r=>setTimeout(r,50));await refresh();const result=await api(path,method,data);await refresh();return result;}finally{busy=false;}}
async function lease(enable){if(!p)return;await refresh();const v=await api(route('/lease'),'POST',{session,device,active:enable});p={...p,revision:v.revision,lease:v.lease};active=enable;}
setInterval(async()=>{if(!active||busy||heartbeatBusy||!p)return;heartbeatBusy=true;try{const v=await api(route('/lease'),'POST',{session,device,heartbeat:true,active:true});p.revision=v.revision;p.lease=v.lease;}catch{active=false;say('Lote pausado por pérdida de sesión. Puedes continuar sin rehacer lo terminado.',true);}finally{heartbeatBusy=false;}},10000);
async function paid(operation,path,data={}){
  if(!budgetId)throw new Error('Primero autoriza un presupuesto en «Producción».');
  if(!Object.keys(rates).length){const cfg=await api(route('/budgets'));rates=cfg.rates;}
  const rate=rates[operation];if(!rate)throw new Error('Falta verificar la tarifa de esta operación. No se enviará ninguna generación.');
  if(!confirm(`Autorizar ${operation}: reserva máxima ${(rate.maxMicros/1e6).toFixed(4)} USD por esta tarea.${operation==='media'?' La carga también puede iniciar análisis visual con su propia reserva autorizada.':''} Tarifa verificada ${rate.verifiedDate}. ¿Continuar?`))return;
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
function navigation(){const nav=$('#steps');nav.replaceChildren();for(const s of ['Proyectos','Ideas','Guion y biblias','Producción','Tomas','Sonido','Exportar'])nav.append(action(s,async()=>{stage=s;await draw();},true));[...nav.children].forEach(b=>b.classList.toggle('active',b.textContent===stage));}
async function draw(){navigation();screen.replaceChildren();if(stage==='Proyectos')return projectList();if(!p){stage='Proyectos';return draw();}await refresh();if(stage==='Ideas')return ideas();if(stage==='Guion y biblias')return script();if(stage==='Producción')return production();if(stage==='Tomas')return shots();if(stage==='Sonido')return sounds();return exportsView();}
async function projectList(){
 const list=await api('/projects');const form=card('Nueva historia',`<label>Título<input id="title" placeholder="Título provisional"></label><label>Género principal<select id="genre">${genres.map(g=>`<option>${g}</option>`).join('')}</select></label><details><summary>Subgéneros opcionales</summary>${subgenres.map((g,i)=>`<label><input type="checkbox" class="subgenre" value="${g}" style="width:22px;min-height:22px"> ${g}</label>`).join('')}</details><label>Concepto opcional<textarea id="concept" placeholder="Una situación, un personaje, una emoción… Puedes dejarlo vacío."></textarea></label><label>Formato<select id="format"><option>16:9</option><option>9:16</option></select></label>`);
 buttons(form,[['Crear historia',async()=>{p=await api('/projects','POST',{title:$('#title').value,genre:$('#genre').value,subgenres:[...document.querySelectorAll('.subgenre:checked')].map(e=>e.value),concept:$('#concept').value,format:$('#format').value});stage='Ideas';location.hash=`/proyectos/${p.id}`;await draw();}]]);screen.append(form);
 const grid=document.createElement('div');grid.className='grid';screen.append(grid);
 for(const item of list.projects.filter(x=>!x.archived)){const c=card(item.title,`<p class="badge">${esc(item.genre)} · ${esc(item.stage)}</p>`);buttons(c,[['Abrir',async()=>{if(active)await lease(false);p=item;budgetId=null;stage='Ideas';location.hash=`/proyectos/${p.id}`;await draw();}],['Archivar',async()=>{p=item;await mutate(route(''),{archived:true},'PATCH');await draw();},true]]);grid.append(c);}
}
async function ideas(){
 const c=card(p.title,`<p>${esc(p.genre)} · ${esc(p.subgenres.join(', '))}</p><p>${esc(p.concept||'Concepto abierto')}</p>`);buttons(c,[['Generar tres ideas',()=>paid('ideas',route('/ideas:generate'))],['Configurar presupuesto',async()=>{stage='Producción';await draw();},true]]);screen.append(c);
 const batches=Object.groupBy(p.ideas||[],x=>x.batchId);for(const batch of Object.values(batches).reverse()){const grid=document.createElement('div');grid.className='grid';screen.append(grid);for(const i of batch){const d=i.data;candidates(grid,i,d,'ideas');}}
}
function candidates(parent,entity,d,kind){const c=card(d.title||'Propuesta',`<p>${esc(d.premise||'')}</p><p>${esc(d.initialSituation||'')}</p><p><strong>Conflicto:</strong> ${esc(d.obstacle||'')}</p><p><strong>Emoción:</strong> ${esc(d.emotionalProgression||'')}</p><p><strong>Cierre:</strong> ${esc(d.ending||'')}</p>`);buttons(c,[['Elegir',async()=>{await mutate(route(`/ideas/${entity.id}:select`),{});say('Idea elegida. Puedes desarrollar su guion.');stage='Guion y biblias';await draw();}],['Ajustar esta idea',()=>revise(kind,entity),true]]);parent.append(c);}
async function revise(kind,e){const instruction=prompt('¿Qué parte quieres corregir? Se conservará la versión anterior.');if(instruction)await paid('revise',route(`/revisions/${kind}/${e.id}:revise`),{instruction});}
async function approve(kind,id){await mutate(route(`/revisions/${kind}/${id}:approve`),{});say('Versión aprobada y conservada.');}
async function script(){
 const intro=card('Guion y biblias',`<p>Idea elegida: ${esc(p.ideas.find(i=>i.id===p.selectedIdea?.id)?.data.title||'Ninguna')}</p>`);buttons(intro,[['Desarrollar la idea elegida',()=>paid('develop',route('/develop'))]]);screen.append(intro);
 for(const e of [...p.developments].reverse()){
   const d=e.data,c=card(d.title,`<p class="badge">${esc(e.approvalState)} · revisión ${e.revision}</p>`);
   for(const s of d.shots){const scene=document.createElement('details');scene.innerHTML=`<summary>${esc(s.id)} · ${esc(s.function)} · ${(s.frames/24).toFixed(1)} s</summary><p>${esc(s.prompt)}</p>`;for(const u of d.utterances.filter(u=>u.shotId===s.id))scene.innerHTML+=`<p><strong>${esc(u.speakerId)} · ${esc(u.type)}</strong><br>${esc(u.spanish)}</p><details><summary>Japonés y actuación</summary><p>${esc(u.japanese)}</p><p>${esc(u.acting)}</p></details>`;c.append(scene);}
   const b=document.createElement('details');b.innerHTML=`<summary>Biblias de esta historia</summary><pre>${esc(JSON.stringify(d.bible,null,2))}</pre>`;c.append(b);
   if(e.review){const r=document.createElement('details');r.innerHTML=`<summary>Revisión y límites observados</summary><pre>${esc(JSON.stringify(e.review,null,2))}</pre>`;c.append(r);}
   buttons(c,[['Aprobar guion y biblias',()=>approve('developments',e.id)],['Corregir una parte',()=>revise('developments',e),true]]);screen.append(c);
 }
}
async function production(){
 const cfg=await api(route('/budgets'));rates=cfg.rates;const valid=cfg.budgets.filter(b=>b.expires>Date.now()/1000);if(!budgetId&&valid.length)budgetId=valid.at(-1).id;
 const c=card('Autorización de producción',`<p>Elige un límite. Cada tarea solicita confirmación y reserva su coste conservador. Las llamadas ya aceptadas pueden facturarse aunque pauses.</p><label>Límite en USD<input type="number" id="budget" min="0.01" step="0.01" placeholder="Sin presupuesto autorizado"></label><p class="muted">Generación y render requieren tarifas verificadas en el servidor.</p>`);
 buttons(c,[['Autorizar límite',async()=>{const value=Number($('#budget').value);if(!(value>0))throw new Error('Indica un importe.');if(!confirm(`¿Autorizas hasta ${value.toFixed(2)} USD durante 24 horas para esta historia?`))return;const b=await mutate(route('/budgets'),{limitMicros:Math.round(value*1e6),operations:['ideas','develop','revise','image','veo','tts','music','analyze','review','transcribe','media','preview','render','frames']});budgetId=b.id;await draw();}],['Pausar nuevas generaciones',async()=>{await lease(false);say('Pausado. Se conserva lo completado.');},true],['Continuar sesión',async()=>{await lease(true);say('Sesión activa. Solo se despacharán tareas autorizadas.');},true]]);
 for(const b of valid){const row=document.createElement('p');row.textContent=`Autorizado: $${(b.limit/1e6).toFixed(2)} · reservado: $${(b.reserved/1e6).toFixed(4)} · contabilizado: $${(b.spent/1e6).toFixed(4)}`;c.append(row);}
 screen.append(c);
 const jobs=await api(route('/jobs'));for(const j of jobs.jobs){const item=card(j.operation,`<p>${esc(j.state)}</p>`);buttons(item,[['Consultar resultado',()=>watch(j.id),true]]);if(j.result?.previewId)buttons(item,[['Reproducir resultado',()=>playPreview(j.result.previewId,item)]]);screen.append(item);}
}
const development=()=>p.developments.find(x=>x.id===p.activeDevelopment)?.data;
async function assetCard(parent,a){
 const c=card(a.entityId,`<p class="badge">${esc(a.kind)} · ${esc(a.approvalState)}</p>`);
 buttons(c,[['Ver / escuchar',async()=>{const {url}=await api(route(`/assets/${a.id}/url`));const media=document.createElement(a.kind==='image'?'img':a.kind==='pcm'?'audio':'video');media.src=url;media.controls=true;media.playsInline=true;c.append(media);}],['Aprobar esta versión',()=>approve('assets',a.id),true]]);parent.append(c);
}
async function shots(){
 const d=development();if(!d){screen.append(card('Aprueba el guion y las biblias primero.'));return;}
 const refs=card('Referencias de esta historia','<p>Genera y aprueba identidad, lugares y objetos antes de las tomas.</p>');
 for(const kind of ['characters','locations','props'])for(const e of d.bible[kind])buttons(refs,[[`Generar referencia: ${e.name}`,()=>paid('image',route('/assets:generate'),{operation:'image',entityId:e.id}),true]]);screen.append(refs);
 for(const a of p.assets.filter(a=>!d.shots.some(s=>s.id===a.entityId)))await assetCard(screen,a);
 for(const s of d.shots){const c=card(s.id,`<p>${esc(s.function)} · ${esc(s.treatment)}</p><p>${esc(s.prompt)}</p><p class="muted">${esc(d.utterances.filter(u=>u.shotId===s.id).map(u=>u.spanish).join(' '))}</p>`);
 buttons(c,[['Generar imagen',()=>paid('image',route('/assets:generate'),{operation:'image',entityId:s.id})],['Generar video',()=>paid('veo',route('/assets:generate'),{operation:'veo',entityId:s.id,seconds:8}),true]]);
 for(const u of d.utterances.filter(u=>u.shotId===s.id))buttons(c,[[`Voz: ${u.spanish.slice(0,45)}`,()=>paid('tts',route('/assets:generate'),{operation:'tts',entityId:u.id}),true]]);
 for(const a of p.assets.filter(a=>a.entityId===s.id))await assetCard(c,a);screen.append(c);}
}
async function sounds(){
 const d=development();if(!d){screen.append(card('Aprueba primero el guion.'));return;}
 for(const m of d.musicRequests){const c=card('Música',`<p>${esc(m.prompt)}</p><p>${m.seconds} segundos · pieza reutilizable</p>`);buttons(c,[['Generar pieza instrumental',()=>paid('music',route('/assets:generate'),{operation:'music',entityId:m.id})]]);screen.append(c);}
 for(const r of d.soundRequests){
  const c=card(r.name,`<p>${esc(r.description)}</p><p><strong>${r.seconds} s</strong> · Preparación ${r.preparationSeconds} s · Cola ${r.tailSeconds} s</p><p>${esc(r.perspective)}</p><details><summary>Prompt del efecto</summary><p>${esc(r.prompt)}</p></details>`);
  buttons(c,[['Copiar prompt',()=>navigator.clipboard.writeText(r.prompt),true]]);
  const label=document.createElement('label');label.textContent='Subir efecto · MP3 y otros formatos de audio';const input=document.createElement('input');input.type='file';input.accept='audio/*';label.append(input);c.append(label);
  const progress=document.createElement('progress');progress.max=1;progress.value=0;c.append(progress);
  input.onchange=()=>uploadSound(r,input.files[0],progress).catch(e=>say(e.message,true));
  for(const cue of p.cues.filter(c=>c.requestId===r.id))buttons(c,[['Ajuste manual',()=>openEditor(cue)],['Localizar con IA',()=>paid('analyze',route(`/cues/${cue.id}:analyze`)),true],['Usar propuesta IA',async()=>{await mutate(route(`/cues/${cue.id}/proposal:apply`),{});say('Propuesta aplicada como candidata.');},true]]);
  for(const a of p.assets.filter(a=>a.requestId===r.id))await assetCard(c,a);screen.append(c);
 }
}
const uploads=new Map();
async function uploadSound(r,file,progress){
 if(!file)return;if(file.size>250*1024*1024)throw new Error('Máximo 250 MB.');
 const key=r.id+':'+file.name+':'+file.size+':'+file.lastModified;
 let sessionUpload=uploads.get(key);
 if(!sessionUpload){
  // Stable cloud session key. Bounded reads keep iPhone memory usage low.
  const sample=new Uint8Array(await new Blob([key,file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]).arrayBuffer());
  const fileKey=[...new Uint8Array(await crypto.subtle.digest('SHA-256',sample))].map(x=>x.toString(16).padStart(2,'0')).join('');
  await refresh();sessionUpload=await api(route(`/sound-requests/${r.id}/upload-session`),'POST',{mime:file.type||'audio/mpeg',size:file.size,fileKey});uploads.set(key,sessionUpload);
 }
 let offset=0;const query=await fetch(sessionUpload.uploadUrl,{method:'PUT',headers:{'Content-Range':`bytes */${file.size}`}});
 if(query.status===308){const range=query.headers.get('Range');offset=range?Number(range.split('-')[1])+1:0;}else if(query.ok)offset=file.size;else throw new Error('No se pudo recuperar la carga.');
 while(offset<file.size){const end=Math.min(offset+8*1024*1024,file.size);const resp=await fetch(sessionUpload.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type||'audio/mpeg','Content-Range':`bytes ${offset}-${end-1}/${file.size}`},body:file.slice(offset,end)});if(!(resp.ok||resp.status===308))throw new Error('Carga interrumpida. Selecciona otra vez el mismo archivo para continuar.');offset=end;progress.value=offset/file.size;}
 await paid('media',route(`/sound-requests/${r.id}/complete`),{assetId:sessionUpload.assetId});say('Archivo recibido. Revisa el ataque propuesto y su contexto.');
}
async function playPreview(id,parent){const d=await api(route(`/previews/${id}`));if(!d.url)throw new Error('Preview aún no disponible.');if(d.draftIssues?.length){const note=document.createElement('p');note.textContent='Borrador: '+d.draftIssues.join(' · ');parent.append(note);}const v=document.createElement('video');v.controls=true;v.playsInline=true;v.src=d.url;parent.append(v);return d;}
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
 $('#login').hidden=false;$('#signin').onclick=()=>authentication.signInWithRedirect(auth,new authentication.GoogleAuthProvider());
 $('#account').onclick=()=>authentication.signOut(auth);
 authentication.onAuthStateChanged(auth,async u=>{user=u;$('#account').hidden=!u;$('#login').hidden=!!u;$('#workspace').hidden=!u;if(u){say('Sesión conectada. Tus decisiones se guardan en la nube.');try{const match=location.hash.match(/^#\/proyectos\/([a-zA-Z0-9_-]+)$/);if(match){p=await api('/projects/'+match[1]);await lease(false);stage='Ideas';}await draw();}catch(e){say(e.message,true);}}});
}
boot().catch(e=>say(e.message,true));
