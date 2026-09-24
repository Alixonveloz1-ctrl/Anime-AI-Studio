const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectProject,restoreProject,preserveManifest}=require('../../api/_lib/project-recovery');
process.env.GCS_OUTPUT_BUCKET='fixture-bucket';process.env.GCS_PREFIX='anime-studio';
const id='p12345678',name=`anime-studio/project-manifests/${id}.json`,root=`anime-studio/projects/${id}/`;
const full={id,data:{universe:{title:'Original'},characters:[{id:'c1'}],episodes:{1:[{id:'s1',narration:'Texto conservado',imagePromptA:'Plano conservado'}]}}};
const empty={id,data:{universe:{title:'Original'},characters:[],episodes:{1:[]}}};
function storage(t,{failBackup=false,failList=false,invalidDeleted=false}={}){
 const original=global.fetch,calls=[],objects=new Map([[name,JSON.stringify(empty)]]),history=new Map([['2',JSON.stringify(full)],['3',JSON.stringify(invalidDeleted?{id:'foreign'}:full)]]);let generation='4';
 const meta=(n,g,size)=>({name:n,generation:g,size:String(size||100),timeCreated:'2026-09-24T00:00:00Z'});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 global.fetch=async(input,options={})=>{
  const u=new URL(input),method=options.method||'GET';calls.push({u,method,body:options.body});assert.equal(u.hostname,'storage.googleapis.com');assert.equal(options.headers.Authorization,'Bearer fixture');
  if(u.pathname.startsWith('/upload/')){
   const n=u.searchParams.get('name'),match=u.searchParams.get('ifGenerationMatch');assert.ok(n===name||n.startsWith(root+'history/'),'Writes remain in this project');
   if(n.startsWith(root+'history/')&&failBackup)return json({},403);
   if(match==='0'&&objects.has(n)||n===name&&match!==generation)return json({},412);
   objects.set(n,options.body);if(n===name)generation=String(Number(generation)+1);return json(meta(n,generation));
  }
  if(u.pathname==='/storage/v1/b/fixture-bucket/o'){
   if(failList)return json({},403);
   const prefix=u.searchParams.get('prefix');assert.ok(prefix===name||prefix===root,'No bucket-wide search');
   if(u.searchParams.has('softDeleted'))return json({items:[meta(name,'3',1000)]});
   if(u.searchParams.has('versions')){
    if(!u.searchParams.has('pageToken'))return json({items:[meta(name,'2',1000)],nextPageToken:'next'});
    return json({items:[meta(name,generation),meta(name+'.foreign','22')]});
   }
   return json({items:[meta(root+'media/sia_'+id+'_s1.png','8'),meta(root+'cache/sia_'+id+'_s1.txt','9')]});
  }
  const encoded=u.pathname.slice('/storage/v1/b/fixture-bucket/o/'.length),restoring=encoded.endsWith('/restore'),n=decodeURIComponent(restoring?encoded.slice(0,-8):encoded);
  if(restoring){assert.equal(method,'POST');assert.equal(options.body,undefined);if(u.searchParams.get('ifGenerationMatch')!==generation)return json({},412);objects.set(name,history.get(u.searchParams.get('generation')));generation=String(Number(generation)+1);return json(meta(name,generation));}
  if(u.searchParams.get('alt')==='media')return new Response(u.searchParams.has('generation')&&u.searchParams.get('generation')!==generation?history.get(u.searchParams.get('generation')):objects.get(n),{status:200});
  if(u.searchParams.get('softDeleted')==='true')return json(meta(name,'3'));
  return json(meta(n,generation));
 };
 t.after(()=>{global.fetch=original;});return {calls,objects};
}
test('Reads real GCS contract pages, previous JSON and image counts without writes',async t=>{
 const s=storage(t),r=await inspectProject('fixture',id,empty);
 assert.equal(r.images,1);assert.equal(r.imageReferences,1);assert.equal(r.current.scenes,0);assert.equal(r.currentGeneration,'4');
 assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].key,'version:2');assert.equal(r.candidates[0].counts.scenes,1);
 assert.ok(s.calls.some(c=>c.u.searchParams.get('pageToken')==='next'));assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('A permission failure remains a warning, never proof of absent backups',async t=>{
 storage(t,{failList:true});const r=await inspectProject('fixture',id,empty);assert.equal(r.warnings.length,3);assert.match(r.warnings[0],/403/);
});
test('Opening a prior version backs up the current exact JSON before conditional restore',async t=>{
 const s=storage(t);const r=await restoreProject('fixture',id,'version:2','4');assert.deepEqual(r,full);
 const writes=s.calls.filter(c=>c.method==='POST');assert.equal(writes.length,2);assert.ok(writes[0].u.searchParams.get('name').startsWith(root+'history/'));assert.equal(writes[0].body,JSON.stringify(empty));assert.equal(writes[1].u.searchParams.get('ifGenerationMatch'),'4');assert.deepEqual(JSON.parse(s.objects.get(name)),full);
});
test('A concurrent project change prevents all recovery writes',async t=>{
 const s=storage(t);await assert.rejects(restoreProject('fixture',id,'version:2','1'),e=>e.status===409);assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('Backup failure aborts recovery before touching the current project',async t=>{
 const s=storage(t,{failBackup:true});await assert.rejects(restoreProject('fixture',id,'version:2','4'),e=>e.status===403);assert.equal(s.objects.get(name),JSON.stringify(empty));assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});
test('Retained soft-deleted version uses restore API, no body, current-generation condition',async t=>{
 const s=storage(t);assert.deepEqual(await restoreProject('fixture',id,'deleted:3','4'),full);assert.ok(s.calls.find(c=>c.u.pathname.endsWith('/restore')));
});
test('An invalid retained snapshot rolls back only its own restored generation',async t=>{
 const s=storage(t,{invalidDeleted:true});await assert.rejects(restoreProject('fixture',id,'deleted:3','4'),e=>e.status===422);assert.deepEqual(JSON.parse(s.objects.get(name)),empty);assert.equal(s.calls.at(-1).u.searchParams.get('ifGenerationMatch'),'5');
});
test('Backup is content-addressed and repeated saves cannot overwrite that backup',async t=>{
 const s=storage(t);await preserveManifest('fixture',id,full);await preserveManifest('fixture',id,full);assert.equal([...s.objects.keys()].filter(k=>k.startsWith(root+'history/')).length,1);assert.ok(s.calls.every(c=>c.u.searchParams.get('ifGenerationMatch')==='0'));
});
test('Recovery rejects object paths and foreign identifiers before storage access',async t=>{
 const s=storage(t);for(const key of ['../secret','backup:../../other','deleted:x','version:2:other'])await assert.rejects(restoreProject('fixture',id,key,'4'));await assert.rejects(inspectProject('fixture','../other',empty));assert.equal(s.calls.length,0);
});
test('Legacy projectSave preserves the previous manifest before its existing upload',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),order=[];
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/upload-url.js','utf8'),{module,Buffer,console,require:path=>path==='./_lib/gcp'?{cfg:{bucket:'fixture',prefix:'anime-studio'},begin:async()=>false,auth:async()=>({token:'fixture'}),gcsReadText:async()=>JSON.stringify(full),gcsUpload:async()=>order.push('upload'),fail:(res,e)=>res.status(500).json({error:e.message})}:{preserveManifest:async(token,pid,old)=>{assert.equal(token,'fixture');assert.equal(pid,id);assert.equal(JSON.stringify(old),JSON.stringify(full));order.push('backup');}}});
 const res={status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
 await module.exports({body:{action:'projectSave',id,data:empty.data}},res);assert.equal(res.code,200,JSON.stringify(res.data));assert.deepEqual(order,['backup','upload']);
});
test('A null legacy read is verified and backed up, not mistaken for a new project',async t=>{
 const s=storage(t);await preserveManifest('fixture',id,null);const writes=s.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].body,JSON.stringify(empty));
});
