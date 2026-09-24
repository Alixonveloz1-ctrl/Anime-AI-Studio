const test=require('node:test'),assert=require('node:assert/strict');
async function call(path,env={}){const {handleShortsRequest}=await import('../../shorts/gateway.mjs');const r=await handleShortsRequest(new Request('https://preview.example/api/shorts?path='+encodeURIComponent(path)),env);return {status:r.status,result:await r.json()};}
test('A005 disabled independent',async()=>{const r=await call('/projects',{SHORTS_ENABLED:'false'});assert.equal(r.status,503);assert.equal(r.result.code,'SHORTS_DISABLED')});
test('A086 preview refuses production configuration',async()=>{const r=await call('/projects',{SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',VERCEL_ENV:'preview',SHORTS_ENVIRONMENT:'production'});assert.equal(r.result.code,'PREVIEW_ISOLATION')});
test('A079 rejects path traversal before fetch',async()=>{const r=await call('/projects/../internal',{SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',VERCEL_ENV:'preview',SHORTS_ENVIRONMENT:'preview'});assert.equal(r.status,400)});
test('A008 rejects external service destination',async()=>{const r=await call('/health',{SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://metadata.google.internal'});assert.equal(r.status,503)});
test('U003 production refuses a preview service',async()=>{const r=await call('/projects',{SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',VERCEL_ENV:'production',SHORTS_ENVIRONMENT:'preview'});assert.equal(r.result.code,'PRODUCTION_ISOLATION')});
test('U003 production forwards only to its configured Cortos service',async()=>{const original=global.fetch;let destination;global.fetch=async url=>{destination=String(url);return new Response('{"projects":[]}',{headers:{'content-type':'application/json'}})};try{const r=await call('/projects',{SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',VERCEL_ENV:'production',SHORTS_ENVIRONMENT:'production'});assert.equal(r.status,200);assert.equal(destination,'https://example.run.app/projects')}finally{global.fetch=original}});
test('Application revision reaches the installed worker only on writes; reads are unconditional',async()=>{
 const {handleShortsRequest}=await import('../../shorts/gateway.mjs'),original=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push(options);return new Response('{}',{headers:{'content-type':'application/json'}})};
 const env={SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',SHORTS_ENVIRONMENT:'production',VERCEL_ENV:'production'};
 try{
  for(const method of ['GET','POST','PATCH']){
   const r=await handleShortsRequest(new Request('https://app.invalid/api/shorts?path=/projects/p', {method,headers:{'X-Shorts-Revision':'7',Authorization:'Bearer fixture-only'},...(method!=='GET'?{body:'{}'}:{})}),env);
   assert.equal(r.status,200);assert.equal(calls.at(-1).headers['if-match'],method==='GET'?undefined:'7');assert.equal(calls.at(-1).headers.authorization,'Bearer fixture-only');
  }
  const invalid=await handleShortsRequest(new Request('https://app.invalid/api/shorts?path=/projects/p',{method:'POST',headers:{'X-Shorts-Revision':'*'},body:'{}'}),env);assert.equal(invalid.status,400);assert.equal(calls.length,3);
 }finally{global.fetch=original;}
});
test('Job diagnostics expose only bounded operational metadata, never texts, tokens or URLs',async()=>{
 const {handleShortsRequest}=await import('../../shorts/gateway.mjs'),original=global.fetch,info=console.info,logs=[];
 const env={SHORTS_ENABLED:'true',SHORTS_PRODUCTION_URL:'https://example.run.app',SHORTS_ENVIRONMENT:'production',VERCEL_ENV:'production'};
 console.info=(...args)=>logs.push(args.join(' '));
 const job={id:'job',operation:'ideas',state:'queued',payload:{secret:'story-secret'},session:'session-secret',owner:'owner-secret',providerCalls:[{kind:'text',state:'rejected',url:'signed-url-secret'}],result:{code:'PROVIDER_QUOTA',error:'story-secret'}};
 global.fetch=async()=>new Response(JSON.stringify({jobs:[job]}),{headers:{'content-type':'application/json'}});
 try{
  const r=await handleShortsRequest(new Request('https://app.invalid/api/shorts?path=/projects/p/jobs',{headers:{Authorization:'Bearer token-secret'}}),env);
  assert.deepEqual(await r.json(),{jobs:[job]});assert.equal(logs.length,1);assert.match(logs[0],/PROVIDER_QUOTA/);assert.doesNotMatch(logs[0],/secret/);
  logs.length=0;await handleShortsRequest(new Request('https://app.invalid/api/shorts?path=/projects/p/jobs'),env);assert.equal(logs.length,0);
 }finally{global.fetch=original;console.info=info;}
});
