const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// api/music.js with Vertex and GCS stubbed. A 30 s 48 kHz stereo cue is about
// 5.5 MB, i.e. 7.3 MB as base64, far over Vercel's 4.5 MB body limit, so it
// must not travel through the function.
const CLIP=Buffer.alloc(30*48000*2*2+44,0x41).toString('base64');
function handlerWith({vertex,bucket='fixture-bucket'}={}){
 const uploads=[],module_={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/music.js','utf8'),{module:module_,console,JSON,Math,Number,String,Array,Object,Buffer,Date,AbortSignal,
  fetch:async(url,options)=>vertex(options),
  require:()=>({cfg:{musicModel:'lyria-fixture',musicLocation:'us-central1',bucket,prefix:'anime-studio'},
   auth:async()=>({sa:{},projectId:'p',token:'t'}),vertexUrl:()=>'https://vertex.invalid/predict',
   gcsUpload:async(token,b,path,body,mime)=>{uploads.push({path,bytes:body.length,mime});},
   signedUrl:()=>'https://signed.invalid/cue.wav',begin:async()=>false,fail:(res,e)=>res.status(500).json({error:e.message})})});
 return {uploads,call:async(extra={})=>{
  const res={status(n){this.code=n;return this;},json(d){this.data=d;this.size=JSON.stringify(d).length;return this;}};
  await module_.exports({body:{prompt:'tense strings',...extra}},res);return res;}};
}
const ok=data=>new Response(JSON.stringify(data),{status:200});
const cue=()=>ok({predictions:[{bytesBase64Encoded:CLIP,mimeType:'audio/wav'}]});

test('With a storage key the cue stays in the bucket and only a pointer is returned',async()=>{
 const h=handlerWith({vertex:cue});
 const r=await h.call({studioProjectId:'p1792809911082',storageKey:'mus_p1792809911082_ep1_climax'});
 assert.equal(r.code,200);
 assert.ok(r.size<2048,`response ${r.size} bytes`);
 assert.ok(r.size<4.5*1024*1024,'inside the 4.5 MB body limit');
 assert.equal(r.data.clips[0].audioUri,'gs://fixture-bucket/anime-studio/projects/p1792809911082/media/mus_p1792809911082_ep1_climax.wav');
 assert.equal(r.data.clips[0].audioData,undefined,'the base64 does not travel');
 assert.deepEqual(h.uploads,[{path:'anime-studio/projects/p1792809911082/media/mus_p1792809911082_ep1_climax.wav',bytes:30*48000*2*2+44,mime:'audio/wav'}]);
});
test('Without a storage key the old base64 answer is kept, and it is what broke',async()=>{
 const r=await handlerWith({vertex:cue}).call();
 assert.ok(r.data.clips[0].audioData);
 assert.ok(r.size>4.5*1024*1024,`old answer ${(r.size/1048576).toFixed(2)} MB: over the limit`);
});
test('An accented or malformed storage key is refused before any paid call',async()=>{
 for(const key of ['mus_p1792809911082_ep1_clímax','../secret','ab']){
  const h=handlerWith({vertex:()=>assert.fail('no paid call')});
  const r=await h.call({studioProjectId:'p1792809911082',storageKey:key});
  assert.equal(r.code,400);assert.deepEqual(h.uploads,[]);
 }
});
test('A cue that takes longer than the deadline answers JSON, not a killed function',async()=>{
 const r=await handlerWith({vertex:()=>{throw Object.assign(new Error('aborted'),{name:'TimeoutError'});}}).call({});
 assert.equal(r.code,504);assert.equal(r.data.timeout,true);assert.match(r.data.error,/más de 52 s/);
});
test('Vertex overload keeps its status and says it is worth retrying',async()=>{
 const r=await handlerWith({vertex:()=>new Response(JSON.stringify({error:{message:'The model is overloaded.'}}),{status:503})}).call();
 assert.equal(r.code,503);assert.equal(r.data.retryable,true);
});
test('A non-JSON page from Vertex becomes a clear error, not a crash',async()=>{
 const r=await handlerWith({vertex:()=>new Response('<html>Bad gateway</html>',{status:502})}).call();
 assert.equal(r.code,502);assert.match(r.data.error,/Bad gateway/);
});
test('The bucket must be configured before a cue is paid for',async()=>{
 const h=handlerWith({vertex:()=>assert.fail('no paid call'),bucket:''});
 const r=await h.call({studioProjectId:'p1792809911082',storageKey:'mus_x_act1'});
 assert.equal(r.code,500);assert.equal(r.data.configError,true);
});
