// Conditional recovery controls for Animes; no provider calls or story rewriting.
window.animeRecovery=(()=>{
 const counts=data=>({characters:Array.isArray(data?.characters)?data.characters.length:0,scenes:Math.max(Array.isArray(data?.scenes)?data.scenes.length:0,Object.values(data?.episodes||{}).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0))});
 const records=new Map();let sequence=0;
 function invalidate(id){const host=document.getElementById('animes-recovery');if(host&&host.dataset.projectId!==id){sequence++;host.remove();}}
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
 const weight=data=>{const n=counts(data);return n.scenes*1000+n.characters;};
 function remember(id,remote){
  const local=read('proj_'+id),backup=read('anime_recovery_'+id);
  const retained=[local,backup].filter(x=>x&&typeof x==='object').sort((a,b)=>weight(b)-weight(a))[0];
  // Retain before the normal cloud cache write. This namespace is not pruned.
  if(retained&&weight(retained)>weight(remote)){
   try{localStorage.setItem('anime_recovery_'+id,JSON.stringify(retained));}catch{}
   records.set(id,{local:retained,remote});
  }else records.set(id,{remote});
 }
 async function request(body){
  const r=await fetch('/api/upload-url',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok)throw new Error(value.error||'No se pudo comprobar el contenido guardado.');return value;
 }
 function button(parent,label,fn){const b=document.createElement('button');b.className='btn-sec';b.textContent=label;b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){const msg=document.createElement('p');msg.textContent=e.message;parent.append(msg);}finally{b.disabled=false;}};parent.append(b);return b;}
 function note(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);return p;}
 async function present(state,openProject){
  const current=++sequence,id=state.projectId;document.getElementById('animes-recovery')?.remove();
  const record=records.get(id),n=counts(state);
  if(!id||!state.universe||n.scenes>0&&!record?.local)return;
  const host=document.createElement('section');host.id='animes-recovery';host.dataset.projectId=id;host.className='card';
  const heading=document.createElement('h2');heading.textContent='Contenido guardado';host.append(heading);
  note(host,'Comprobando las copias y los archivos de este proyecto…');document.querySelector('.app > .header').after(host);
  let report;
  try{report=await request({action:'projectRecovery',id});}catch(e){if(current!==sequence)return;host.replaceChildren(heading);note(host,e.message);button(host,'Volver a comprobar',()=>present(state,openProject));return;}
  if(current!==sequence)return;
  const meaningful=report.images||report.imageReferences||report.candidates?.some(x=>x.counts?.scenes||x.unreadableUntilRestore)||record?.local||report.warnings?.length;
  if(!meaningful){host.remove();return;}
  host.replaceChildren(heading);
  note(host,n.scenes?`Hay una copia del teléfono con contenido adicional.`:'La copia abierta no contiene escenas. No es una recuperación completa.');
  if(report.images||report.imageReferences)note(host,`${report.images} imágenes y ${report.imageReferences} referencias de imagen encontradas en la carpeta del proyecto. No se regenerará ninguna.`);
  if(record?.local){const local=record.local,n=counts(local);button(host,`Recuperar copia del teléfono (${n.scenes} escenas)`,async()=>{
   if(!confirm('¿Recuperar esta copia del teléfono? Se conservará un respaldo de la copia actual de Google Cloud.'))return;
   await request({action:'projectSave',id,name:local.universe?.title,data:local});records.delete(id);await openProject(id);
  });}
  button(host,'Revisar copias guardadas',async()=>{
   const dialog=document.createElement('dialog');dialog.className='modal';dialog.style.cssText='background:var(--bg-card);color:var(--text);border:1px solid var(--border);max-height:80vh;overflow:auto';document.body.append(dialog);
   const title=document.createElement('h3');title.textContent='Recuperar este proyecto';dialog.append(title);
   note(dialog,'Cada copia conserva su fecha. Antes de recuperar una, guardaremos un respaldo de la versión actual.');
   for(const warning of report.warnings||[])note(dialog,warning);
   const candidates=report.candidates||[];
   if(!candidates.length)note(dialog,'No se encontraron versiones anteriores disponibles en esta consulta. Las imágenes por sí solas no permiten reconstruir el guion original.');
   let shown=0;const more=button(dialog,'Ver más copias',()=>page());
   function page(){for(const row of candidates.slice(shown,shown+8)){
    const box=document.createElement('div');box.className='card';dialog.insertBefore(box,more);
    note(box,`${row.source} · ${row.date?new Date(row.date).toLocaleString():'Fecha no disponible'}`);
    note(box,row.counts?`${row.counts.characters} personajes · ${row.counts.scenes} escenas`:`${Math.round(row.bytes/1024)} KB · contenido pendiente de comprobar`);
    if(row.unreadableUntilRestore)note(box,'Google permite leer esta copia después de restaurarla. Su contenido aún no está verificado.');
    if(row.readError)note(box,row.readError);
    const b=button(box,'Recuperar esta copia',async()=>{
     if(!confirm('¿Recuperar esta versión? La copia actual quedará respaldada y no se modificarán las imágenes.'))return;
     await request({action:'projectRecover',id,key:row.key,expectedGeneration:report.currentGeneration});dialog.close();dialog.remove();await openProject(id);
    });b.disabled=!report.currentGeneration||!!row.readError;
   }shown+=8;more.hidden=shown>=candidates.length;}
   page();button(dialog,'Cerrar',()=>{dialog.close();dialog.remove();});dialog.showModal();
  });
 }
 return {remember,present,counts,invalidate,hasRetained:id=>!!records.get(id)?.local};
})();
