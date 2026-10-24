const {test}=require('node:test'),assert=require('node:assert/strict');
const store=require('../../api/_lib/project-store');
process.env.GCS_OUTPUT_BUCKET='fixture-bucket';process.env.GCS_PREFIX='anime-studio';
const id='p12345678',name=`anime-studio/project-manifests/${id}.json`,root=`anime-studio/projects/${id}/`;
const manifest=(narration,updated=1000)=>JSON.stringify({version:1,id,name:'Anime',created:1,updated,data:{universe:{title:'Anime'},characters:[],episodes:{1:[{id:'s1',narration}]}}});
const body=(narration,extra={})=>({id,name:'Anime',created:1,updated:2000,data:{universe:{title:'Anime'},characters:[],episodes:{1:[{id:'s1',narration}]}},...extra});
// In-memory GCS JSON API: object generations, ifGenerationMatch and failures.
function storage(t,{initial=manifest('nube'),fail={}}={}){
 const original=global.fetch,calls=[],objects=new Map(),versions=new Map();let next=7;
 const put=(n,raw)=>{const g=String(next++);objects.set(n,{raw,generation:g});versions.set(n+'#'+g,raw);return g;};
 if(initial!==null)put(name,initial);
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 global.fetch=async(input,options={})=>{
  const u=new URL(input),method=options.method||'GET';calls.push({u,method,body:options.body});
  assert.equal(options.headers.Authorization,'Bearer fixture');
  for(const [pattern,status] of Object.entries(fail))if(u.href.includes(pattern))return json({},status);
  if(u.pathname.startsWith('/upload/')){
   const n=u.searchParams.get('name'),match=u.searchParams.get('ifGenerationMatch');
   assert.ok(n===name||n.startsWith(root+'history/'),'Writes stay inside this project');
   const current=objects.get(n)?.generation||'0';
   if(match!==null&&match!==current)return json({error:{code:412}},412);
   return json({name:n,generation:put(n,options.body)});
  }
  if(u.pathname==='/storage/v1/b/fixture-bucket/o')return json({items:[...objects.keys()].filter(k=>k.startsWith(u.searchParams.get('prefix'))).map(k=>({name:k}))});
  const n=decodeURIComponent(u.pathname.slice('/storage/v1/b/fixture-bucket/o/'.length)),o=objects.get(n);
  if(!o)return json({},404);
  if(u.searchParams.get('alt')==='media'){
   const g=u.searchParams.get('generation');const raw=g?versions.get(n+'#'+g):o.raw;
   return raw===undefined?json({},404):new Response(raw);
  }
  return json({name:n,generation:o.generation});
 };
 t.after(()=>{global.fetch=original;});
 return {calls,objects,current:()=>JSON.parse(objects.get(name).raw),generation:()=>objects.get(name).generation,history:()=>[...objects.keys()].filter(k=>k.startsWith(root+'history/'))};
}

test('Reading returns the manifest together with its exact generation',async t=>{
 const s=storage(t);const r=await store.getProject('fixture',id);
 assert.equal(r.generation,'7');assert.equal(r.project.data.episodes[1][0].narration,'nube');
 assert.ok(s.calls.some(c=>c.u.searchParams.get('generation')==='7'),'content read pinned to that generation');
});
test('A save based on the current generation writes conditionally and returns the new one',async t=>{
 const s=storage(t);const saved=await store.saveProject('fixture',id,body('edit',{baseGeneration:'7'}));
 assert.equal(s.current().data.episodes[1][0].narration,'edit');assert.equal(saved.generation,s.generation());
 const write=s.calls.find(c=>c.method==='POST'&&c.u.searchParams.get('name')===name);
 assert.equal(write.u.searchParams.get('ifGenerationMatch'),'7');
 assert.equal(s.history().length,1,'the replaced version is kept in history first');
});
test('A save based on an older generation is rejected and nothing is written',async t=>{
 const s=storage(t);
 await assert.rejects(store.saveProject('fixture',id,body('stale tab',{baseGeneration:'3'})),e=>e.status===409&&e.conflict&&e.generation==='7');
 assert.equal(s.current().data.episodes[1][0].narration,'nube');assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('Two saves from the same base: the second one cannot overwrite the first',async t=>{
 const s=storage(t);
 await store.saveProject('fixture',id,body('primero',{baseGeneration:'7'}));
 await assert.rejects(store.saveProject('fixture',id,body('segundo',{baseGeneration:'7'})),e=>e.status===409);
 assert.equal(s.current().data.episodes[1][0].narration,'primero');
});
test('A write that races another save between read and upload becomes a conflict',async t=>{
 const s=storage(t);const realFetch=global.fetch;let raced=false;
 global.fetch=async(input,options={})=>{
  if(!raced&&String(input).includes('/upload/')&&new URL(input).searchParams.get('name')===name){raced=true;await realFetch(`https://storage.googleapis.com/upload/storage/v1/b/fixture-bucket/o?uploadType=media&name=${encodeURIComponent(name)}`,{method:'POST',headers:{Authorization:'Bearer fixture'},body:manifest('otro dispositivo')});}
  return realFetch(input,options);
 };
 await assert.rejects(store.saveProject('fixture',id,body('tarde',{baseGeneration:'7'})),e=>e.status===409&&e.conflict);
 assert.equal(s.current().data.episodes[1][0].narration,'otro dispositivo');
});
test('force overwrites only after the user chose it, and still keeps the other version',async t=>{
 const s=storage(t);await store.saveProject('fixture',id,body('mi version',{baseGeneration:'3',force:true}));
 assert.equal(s.current().data.episodes[1][0].narration,'mi version');assert.equal(s.history().length,1);
});
test('Pages without a generation still cannot go back in time',async t=>{
 const s=storage(t,{initial:manifest('nube',5000)});
 await assert.rejects(store.saveProject('fixture',id,body('viejo',{updated:4000})),e=>e.status===409);
 await store.saveProject('fixture',id,body('recuperado',{updated:undefined}));
 assert.equal(s.current().data.episodes[1][0].narration,'recuperado','recovery saves without a timestamp still work');
});
test('A new project is created only if it does not exist yet',async t=>{
 const s=storage(t,{initial:null});const saved=await store.saveProject('fixture',id,body('nuevo',{baseGeneration:'0'}));
 assert.ok(saved.generation);assert.equal(s.history().length,0);
 const write=s.calls.find(c=>c.method==='POST');assert.equal(write.u.searchParams.get('ifGenerationMatch'),'0');
 await assert.rejects(store.saveProject('fixture',id,body('otro nuevo',{baseGeneration:'0'})),e=>e.status===409);
});
test('A failed read is an error, never an absent project or an unconditional write',async t=>{
 const s=storage(t,{fail:{'fields=generation':503}});
 await assert.rejects(store.getProject('fixture',id),e=>e.status===503);
 await assert.rejects(store.saveProject('fixture',id,body('x',{baseGeneration:'7'})),e=>e.status===503);
 assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('Oversized project.json is refused before touching storage writes',async t=>{
 const s=storage(t);const big=body('x',{baseGeneration:'7'});big.data.blob='a'.repeat(3.6*1024*1024);
 await assert.rejects(store.saveProject('fixture',id,big),e=>e.status===413);assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('The list reports manifests it could not read instead of hiding them',async t=>{
 const s=storage(t);const other='p87654321',otherName=`anime-studio/project-manifests/${other}.json`;
 s.objects.set(otherName,{raw:JSON.stringify({id:other,name:'B',updated:1,data:{}}),generation:'1'});
 const realFetch=global.fetch;
 global.fetch=async(input,options)=>String(input).includes(encodeURIComponent(name))&&String(input).includes('alt=media')?new Response('{}',{status:503}):realFetch(input,options);
 const r=await store.listProjects('fixture');
 assert.deepEqual(r.projects.map(p=>p.id),[other]);assert.deepEqual(r.unreadable,[id]);
});
test('A transient read error is retried once before being reported',async t=>{
 storage(t);let failures=1;const realFetch=global.fetch;
 global.fetch=async(input,options)=>String(input).includes('alt=media')&&failures-->0?new Response('{}',{status:503}):realFetch(input,options);
 const r=await store.listProjects('fixture');assert.deepEqual(r.projects.map(p=>p.id),[id]);assert.deepEqual(r.unreadable,[]);
});
test('The endpoint delegates project actions and returns conflicts as 409 with the current generation',async t=>{
 const fs=require('node:fs'),vm=require('node:vm');const module={exports:{}};
 const conflict=Object.assign(new Error('cambió'),{status:409,conflict:true,generation:'9',updated:5});
 vm.runInNewContext(fs.readFileSync('api/upload-url.js','utf8'),{module,Buffer,console,require:path=>path==='./_lib/gcp'
  ?{cfg:{bucket:'fixture',prefix:'anime-studio'},begin:async()=>false,auth:async()=>({token:'fixture'}),fail:(res,e)=>res.status(500).json({error:e.message})}
  :{saveProject:async(token,pid,b)=>{assert.equal(token,'fixture');assert.equal(pid,id);assert.equal(b.baseGeneration,'3');throw conflict;}}});
 const res={status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
 await module.exports({body:{action:'projectSave',id,baseGeneration:'3',data:{}}},res);
 assert.equal(res.code,409);assert.deepEqual(JSON.parse(JSON.stringify(res.data)),{error:'cambió',conflict:true,generation:'9',updated:5});
});
