// Recovery of existing Animes metadata only. Never calls a generation provider.
const {createHash}=require('node:crypto');
const {cfg}=require('./gcp');
const validId=id=>/^p[a-zA-Z0-9_-]{5,80}$/.test(id);
const paths=id=>({manifest:`${cfg.prefix}/project-manifests/${id}.json`,root:`${cfg.prefix}/projects/${id}/`,history:`${cfg.prefix}/projects/${id}/history/`});
function counts(data){return {characters:Array.isArray(data?.characters)?data.characters.length:0,scenes:Math.max(Array.isArray(data?.scenes)?data.scenes.length:0,Object.values(data?.episodes||{}).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0))};}
function checkManifest(raw,id){const value=JSON.parse(raw);if(value?.id!==id||!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw new Error('La copia no corresponde a este proyecto.');return value;}
function error(status,message){return Object.assign(new Error(message),{status});}
function client(token){
 const deadline=Date.now()+18000;
 const base=`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o`;
 async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
  if(!response.ok)throw error(response.status,`No se pudo ${options.method==='POST'?'guardar o recuperar':'leer'} el respaldo en Google Cloud (${response.status}).`);
  return response;
 }
 const object=(name,params={})=>base+'/'+encodeURIComponent(name)+'?'+new URLSearchParams(params);
 async function list(prefix,options={}){
  const items=[];let pageToken='';
  for(let page=0;page<10;page++){
   const q=new URLSearchParams({prefix,maxResults:'1000',fields:'items(name,generation,size,timeCreated,updated,timeDeleted,softDeleteTime,hardDeleteTime,restoreToken),nextPageToken',...options,...(pageToken?{pageToken}:{})});
   const data=await (await request(base+'?'+q)).json();items.push(...(data.items||[]));pageToken=data.nextPageToken;
   if(!pageToken)return {items,complete:true};
  }
  return {items,complete:false};
 }
 async function read(name,generation){return (await request(object(name,{alt:'media',...(generation?{generation}:{})}))).text();}
 async function meta(name,params={}){return (await request(object(name,params))).json();}
 async function write(name,raw,match){
  const q=new URLSearchParams({uploadType:'media',name,...(match!==undefined?{ifGenerationMatch:String(match)}:{})});
  return (await request(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(cfg.bucket)}/o?${q}`,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:raw})).json();
 }
 return {list,read,meta,write,request,base};
}
async function preserveManifest(token,id,manifest){
 if(!validId(id))throw error(400,'Proyecto inválido.');
 const c=client(token);let raw;
 if(manifest)raw=JSON.stringify(manifest);
 else{
  // The legacy reader treated any failed read as absence. Verify a genuine
  // 404 before allowing the first save; unreadable existing data is backed up.
  let metadata;try{metadata=await c.meta(paths(id).manifest);}catch(e){if(e.status===404)return;throw e;}
  raw=await c.read(paths(id).manifest,metadata.generation);
 }
 const hash=createHash('sha256').update(raw).digest('hex');
 try{await c.write(paths(id).history+hash+'.json',raw,0);}catch(e){if(e.status!==412)throw e;}
}
async function inspectProject(token,id,current){
 if(!validId(id))throw error(400,'Proyecto inválido.');
 const c=client(token),p=paths(id),warnings=[];
 const tasks=await Promise.allSettled([c.list(p.manifest,{versions:'true'}),c.list(p.manifest,{softDeleted:'true'}),c.list(p.root),c.meta(p.manifest)]);
 const rows=(index,label)=>{const task=tasks[index];if(task.status==='rejected'){warnings.push(`${label}: ${task.reason.message}`);return [];}if(task.value.complete===false)warnings.push(`${label}: quedan archivos por revisar.`);return task.value.items||[];};
 const versionRows=rows(0,'Versiones'),deleted=rows(1,'Copias retenidas'),objects=rows(2,'Archivos');
 const currentGeneration=tasks[3].status==='fulfilled'?String(tasks[3].value.generation):null;
 if(!currentGeneration)warnings.push('No se pudo comprobar la versión actual.');
 const candidates=[];
 for(const row of versionRows.filter(x=>x.name===p.manifest&&String(x.generation)!==currentGeneration))candidates.push({...row,key:'version:'+row.generation,source:'Versión anterior'});
 for(const row of objects.filter(x=>x.name.startsWith(p.history)&&/\/[a-f0-9]{64}\.json$/.test(x.name)))candidates.push({...row,key:'backup:'+row.name.slice(p.history.length,-5),source:'Respaldo conservado'});
 for(const row of deleted.filter(x=>x.name===p.manifest))candidates.push({...row,key:'deleted:'+row.generation+(row.restoreToken?':'+row.restoreToken:''),source:'Copia retenida por Google',unreadableUntilRestore:true});
 // Inspect a bounded set of the largest metadata snapshots, not media bodies.
 const readable=candidates.filter(x=>!x.unreadableUntilRestore).sort((a,b)=>Number(b.size)-Number(a.size)).slice(0,12);
 for(let i=0;i<readable.length;i+=4)await Promise.all(readable.slice(i,i+4).map(async row=>{
  try{row.counts=counts(checkManifest(await c.read(row.name,row.generation),id).data);}catch(e){row.readError=e.message;}
 }));
 candidates.sort((a,b)=>(b.counts?.scenes||0)-(a.counts?.scenes||0)||Number(b.size)-Number(a.size)||String(b.generation).localeCompare(String(a.generation)));
 const images=objects.filter(x=>!x.name.startsWith(p.history)&&/\.(png|jpe?g|webp)$/i.test(x.name)).length;
 const pointers=objects.filter(x=>x.name.startsWith(p.root+'cache/')&&/\/(ci|si|sia|sib|sic)_/.test(x.name)).length;
 const result={current:counts(current?.data),currentGeneration,images,imageReferences:pointers,warnings,candidates:candidates.map(x=>({key:x.key,source:x.source,date:x.timeCreated||x.updated,bytes:Number(x.size||0),counts:x.counts,unreadableUntilRestore:!!x.unreadableUntilRestore,readError:x.readError,expires:x.hardDeleteTime}))};
 console.info('[animes:recovery]',JSON.stringify({id,current:result.current,images,imageReferences:pointers,versions:candidates.length,readable:readable.filter(x=>x.counts).map(x=>x.counts),warnings}));
 return result;
}
async function restoreProject(token,id,key,expectedGeneration){
 if(!validId(id)||!/^\d+$/.test(String(expectedGeneration||'')))throw error(400,'Selecciona una copia desde el proyecto abierto.');
 const match=/^(version|deleted):(\d+)(?::([a-f0-9-]{36}))?$/.exec(String(key)),backup=/^backup:([a-f0-9]{64})$/.exec(String(key));
 if(!match&&!backup)throw error(400,'Copia inválida.');
 const c=client(token),p=paths(id),current=await c.meta(p.manifest);
 if(String(current.generation)!==String(expectedGeneration))throw error(409,'El proyecto cambió. Vuelve a buscar sus copias antes de recuperar.');
 const previous=checkManifest(await c.read(p.manifest,current.generation),id);
 let candidate;
 if(backup||match[1]==='version')candidate=checkManifest(await c.read(backup?p.history+backup[1]+'.json':p.manifest,backup?undefined:match[2]),id);
 else await c.meta(p.manifest,{generation:match[2],softDeleted:'true',...(match[3]?{restoreToken:match[3]}:{})});
 // Recovery never overwrites the only remaining copy. Abort if backup fails.
 await preserveManifest(token,id,previous);
 if(candidate){await c.write(p.manifest,JSON.stringify(candidate),current.generation);return candidate;}
 const q=new URLSearchParams({generation:match[2],ifGenerationMatch:String(current.generation),...(match[3]?{restoreToken:match[3]}:{})});
 const restored=await (await c.request(c.base+'/'+encodeURIComponent(p.manifest)+'/restore?'+q,{method:'POST'})).json();
 try{return checkManifest(await c.read(p.manifest,restored.generation),id);}catch(e){
  // Roll back only the generation we restored; never overwrite a later edit.
  await c.write(p.manifest,JSON.stringify(previous),restored.generation);
  throw error(422,'La copia recuperada no era legible. Se conservó la versión anterior.');
 }
}
module.exports={counts,inspectProject,restoreProject,preserveManifest};
