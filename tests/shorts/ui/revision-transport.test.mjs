import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionTransport } from '../../../cortos/revision-transport.mjs';
const url = path => '/api/shorts?path=' + encodeURIComponent(path);
const write = (revision, data = {}, extras = {}) => ({method:'POST',headers:{'X-Shorts-Revision':String(revision),'Idempotency-Key':'same-key'},body:JSON.stringify(data),...extras});
const lease = {session:'page-one',device:'phone',active:true,heartbeat:true};
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('a generation queued behind its own heartbeat uses the acknowledged revision once',async()=>{
  const wait=deferred(), calls=[];
  const send=revisionTransport(async (input,init)=>{
    calls.push({path:new URL(input,'http://localhost').searchParams.get('path'),headers:new Headers(init.headers),body:init.body});
    if(calls.length===1){await wait.promise;return json({id:'p1',revision:8,lease});}
    return json({jobId:'j1'},202);
  });
  const beat=send(url('/projects/p1/lease'),write(7,lease));
  const generate=send(url('/projects/p1/assets:generate'),write(7,{operation:'image'}));
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  wait.resolve();await beat;await generate;
  assert.equal(calls.length,2);assert.equal(calls[1].headers.get('X-Shorts-Revision'),'8');
  assert.equal(calls[1].headers.get('Idempotency-Key'),'same-key');
  assert.deepEqual(JSON.parse(calls[1].body),{operation:'image'});
});

test('several acknowledged heartbeats repair an older read without skipping an editorial revision',async()=>{
  let actual=4;const seen=[];
  const send=revisionTransport(async(input,init)=>{
    const rev=Number(new Headers(init.headers).get('X-Shorts-Revision'));seen.push(rev);
    if(input.includes('lease'))return json({id:'p1',revision:++actual,lease});
    return json({error:'changed',code:'REVISION_CONFLICT'},409);
  });
  await send(url('/projects/p1/lease'),write(4,lease));
  await send(url('/projects/p1/lease'),write(4,lease));
  actual++;
  assert.equal((await send(url('/projects/p1/assets:generate'),write(4))).status,409);
  assert.deepEqual(seen,[4,5,6]);
});

test('a successful editorial write does not authorize silently replacing another edit',async()=>{
  const revisions=[];
  const send=revisionTransport(async(_,init)=>{revisions.push(new Headers(init.headers).get('X-Shorts-Revision'));return json({id:'p1',revision:9,lease});});
  await send(url('/projects/p1/generators'),write(8));
  await send(url('/projects/p1/characters/c1/voice'),write(8));
  assert.deepEqual(revisions,['8','8']);
});

test('a lease from a different session, project or unexpected revision is not trusted',async()=>{
  for(const wrong of [{id:'p2',revision:8,lease},{id:'p1',revision:8,lease:{...lease,session:'other'}},{id:'p1',revision:12,lease}]){
    const seen=[];
    const send=revisionTransport(async(_,init)=>{seen.push(new Headers(init.headers).get('X-Shorts-Revision'));return json(wrong);});
    await send(url('/projects/p1/lease'),write(7,lease));await send(url('/projects/p1/assets:generate'),write(7));
    assert.deepEqual(seen,['7','7']);
  }
});

test('a failed or unreadable lease never advances the revision or retries a generation',async()=>{
  for(const response of [json({error:'conflict'},409),new Response('not-json')]){
    const calls=[];
    const send=revisionTransport(async(_,init)=>{calls.push(new Headers(init.headers).get('X-Shorts-Revision'));return calls.length===1?response:json({jobId:'j1'},202);});
    await send(url('/projects/p1/lease'),write(5,lease));await send(url('/projects/p1/assets:generate'),write(5));
    assert.deepEqual(calls,['5','5']);
  }
});

test('job revisions, Animes requests and reads retain their original headers',async()=>{
  const calls=[];const send=revisionTransport(async(input,init)=>{calls.push({input,init});return json({});});
  const job=write(2),animes=write(3),read={headers:{Authorization:'test'}};
  await send(url('/jobs/j1:cancel'),job);await send('/api/image',animes);await send(url('/projects/p1'),read);
  assert.equal(calls[0].init,job);assert.equal(calls[1].init,animes);assert.equal(calls[2].init,read);
});

test('projects have separate queues and lease revision histories',async()=>{
  const wait=deferred(), seen=[];
  const send=revisionTransport(async(input,init)=>{seen.push(input);if(input.includes('p1'))await wait.promise;return json({});});
  const first=send(url('/projects/p1/lease'),write(1,lease));
  await send(url('/projects/p2/generators'),write(1));assert.equal(seen.length,2);wait.resolve();await first;
});

test('aborting a queued generation rejects immediately and never calls the provider route later',async()=>{
  const wait=deferred(),controller=new AbortController();let calls=0;
  const send=revisionTransport(async()=>{calls++;await wait.promise;return json({});});
  const first=send(url('/projects/p1/lease'),write(1,lease));
  const second=send(url('/projects/p1/assets:generate'),write(1,{}, {signal:controller.signal}));
  controller.abort();await assert.rejects(second);wait.resolve();await first;
  await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});

test('an aborted or hung response body releases the queue and establishes no lease transition',async()=>{
  const controller=new AbortController();const seen=[];
  const send=revisionTransport(async(_,init)=>{
    seen.push(new Headers(init.headers).get('X-Shorts-Revision'));
    if(seen.length===1)return {ok:true,clone:()=>({json:()=>new Promise(()=>{})})};
    return json({});
  });
  const first=send(url('/projects/p1/lease'),write(2,lease,{signal:controller.signal}));
  await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(first);
  await send(url('/projects/p1/assets:generate'),write(2));assert.deepEqual(seen,['2','2']);
});

test('transport errors release the queue without automatic resubmission',async()=>{
  let calls=0;const send=revisionTransport(async()=>{if(++calls===1)throw new Error('offline');return json({});});
  await assert.rejects(send(url('/projects/p1/assets:generate'),write(1)),/offline/);
  assert.equal(calls,1);await send(url('/projects/p1/generators'),write(1));assert.equal(calls,2);
});
