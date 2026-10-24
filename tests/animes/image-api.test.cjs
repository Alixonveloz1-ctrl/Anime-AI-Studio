const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// api/image.js with Vertex stubbed and a virtual clock: each Vertex call takes
// `seconds` of virtual time, so the 60 s budget can be checked without waiting.
function handlerWith({location='global',seconds=20,answers}){
 let now=1_000_000;const calls=[];
 const FakeDate=class extends Date{static now(){return now;}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/image.js','utf8'),{module,console,Buffer,JSON,Math,Number,String,Array,Object,AbortSignal,Date:FakeDate,
  fetch:async(url,options)=>{
   const started=now;now+=seconds*1000;
   const body=JSON.parse(options.body),text=body.contents[0].parts.filter(p=>p.text).map(p=>p.text).join('\n');
   calls.push({url,at:(started-1_000_000)/1000,text,images:body.contents[0].parts.filter(p=>p.inlineData).length});
   const a=answers(calls.length,url);
   if(a==='timeout')throw Object.assign(new Error('aborted'),{name:'TimeoutError'});
   return new Response(a.raw!==undefined?a.raw:JSON.stringify(a),{status:a.status||200});
  },
  require:p=>p==='./_lib/gcp'?{cfg:{imageModel:'nano-fixture',imageRegions:['us-central1','europe-west4','us-east4'],bucket:'',prefix:'anime-studio'},
   auth:async()=>({sa:{},projectId:'p',token:'t'}),imageModelLocation:()=>location,vertexUrl:(pr,region)=>`https://vertex.invalid/${region}`,
   gcsUpload:async()=>{},signedUrl:()=>'',begin:async()=>false,fail:(res,e)=>res.status(500).json({error:e.message})}
   :require(path.join(__dirname,'../../api',p))});
 return {calls,elapsed:()=>(now-1_000_000)/1000,call:async(extra={})=>{
  const res={status(n){this.code=n;return this;},json(d){this.data=JSON.parse(JSON.stringify(d));return this;}};
  await module.exports({body:{prompt:'Ana stands at the workshop door in a sheer dress',continuityRef:{img:'x'.repeat(200)},...extra}},res);return res;}};
}
const blocked={candidates:[{finishReason:'IMAGE_SAFETY'}]};
const image={candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'iVBORw0KGgo='}}]}}]};
test('A shot blocked twice stops before 60 s and says from which rescue step to go on',async()=>{
 const h=handlerWith({seconds:20,answers:()=>blocked});const r=await h.call();
 assert.equal(h.calls.length,2,'the third generation would not fit');assert.ok(h.elapsed()<=52,`elapsed ${h.elapsed()} s`);
 assert.equal(r.data.siguienteNivel,2);assert.equal(r.data.bloqueado,true);
});
test('The continuation starts at that step: softened text and no previous frame',async()=>{
 const h=handlerWith({seconds:20,answers:()=>image});const r=await h.call({desdeNivel:2});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].images,0,'the previous frame is dropped at step 2');
 assert.equal(r.data.rescate,2);assert.ok(r.data.imageData);
});
test('A Vertex call that would pass the budget is cut and reported as a timeout, in JSON',async()=>{
 const h=handlerWith({seconds:55,answers:()=> 'timeout'});const r=await h.call();
 assert.equal(r.code,200);assert.equal(r.data.timeout,true);assert.match(r.data.error,/más de 50 s/);
});
test('A regional text-only answer is a refusal: no region rotation and never "sin capacidad"',async()=>{
 const h=handlerWith({location:'us-central1',seconds:5,answers:()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'I can not draw that.'}]}}]})});
 const r=await h.call();
 assert.equal(r.data.sinCapacidad,undefined);assert.match(r.data.error,/bloqueado \[STOP: respondió sólo con texto\]/);
 // One call per rescue step: the refusal is the same in every region, so no rotation.
 assert.equal(h.calls.length,3);
});
test('Real capacity errors still rotate regions while there is time',async()=>{
 const h=handlerWith({location:'us-central1',seconds:5,answers:n=>n<3?{status:429,error:{message:'Resource exhausted'}}:image});
 const r=await h.call();assert.ok(r.data.imageData);assert.equal(new Set(h.calls.map(c=>c.url)).size,3);
});
test('A non-JSON page from Vertex does not crash the function',async()=>{
 const h=handlerWith({seconds:5,answers:()=>({raw:'<html>Bad gateway</html>',status:502})});const r=await h.call();
 assert.ok(r.data.error);assert.notEqual(r.code,500);
});
