const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// api/script.js with Vertex stubbed: how each upstream outcome reaches the app.
function handlerWith(vertex){
 const module={exports:{}},signals=[];
 vm.runInNewContext(fs.readFileSync('api/script.js','utf8'),{module,console,Date,JSON,Math,Number,AbortSignal,
  fetch:async(url,options)=>{signals.push(options.signal);return vertex(options);},
  require:path=>{assert.equal(path,'./_lib/gcp');return {cfg:{scriptModel:'gemini-fixture',scriptLocation:'global'},auth:async()=>({projectId:'p',token:'t'}),vertexUrl:()=>'https://vertex.invalid/generate',begin:async()=>false,fail:(res,e)=>res.status(500).json({error:e.message})};}});
 return {signals,call:async()=>{const res={status(n){this.code=n;return this;},json(d){this.data=JSON.parse(JSON.stringify(d));return this;}};await module.exports({body:{messages:[{role:'user',parts:[{text:'hola'}]}]}},res);return res;}};
}
const reply=(status,body)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status});
test('A Vertex call that runs past the deadline answers JSON timeout instead of being killed by Vercel',async()=>{
 const h=handlerWith(()=>{throw Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});});
 const r=await h.call();
 assert.equal(r.code,504);assert.equal(r.data.timeout,true);assert.match(r.data.error,/más de 50 s/);
 assert.ok(h.signals[0] instanceof AbortSignal,'the Vertex request carries a deadline');
});
test('Vertex overload keeps its status and is marked retryable',async()=>{
 for(const status of [429,500,503]){const r=await handlerWith(()=>reply(status,{error:{message:'The model is overloaded.'}})).call();
  assert.equal(r.code,status);assert.equal(r.data.retryable,true);assert.match(r.data.error,new RegExp(`\\) ${status}: The model is overloaded`));}
});
test('A request Vertex rejects is not retryable',async()=>{
 const r=await handlerWith(()=>reply(400,{error:{message:'Invalid argument'}})).call();assert.equal(r.code,400);assert.equal(r.data.retryable,false);
});
test('A non-JSON Vertex error page still becomes a clear JSON error',async()=>{
 const r=await handlerWith(()=>reply(502,'<html>Bad gateway</html>')).call();assert.equal(r.code,502);assert.equal(r.data.retryable,true);assert.match(r.data.error,/Bad gateway/);
});
test('A normal answer is returned as text',async()=>{
 const r=await handlerWith(()=>reply(200,{candidates:[{content:{parts:[{thought:true,text:'pensando'},{text:'{"ok":1}'}]}}]})).call();
 assert.equal(r.code,200);assert.equal(r.data.text,'{"ok":1}');
});
