import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=(await fs.readFile(new URL('../../../auth/client.mjs',import.meta.url),'utf8')).replaceAll('export ','');
test('Overlapping token notifications mount the same studio only once',async t=>{
 const dom=new JSDOM('<button data-studio-signout>Salir</button>',{url:'https://fixture.invalid/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;let notify,release,mounts=0;
 const waiting=new Promise(r=>release=r),user={uid:'owner',getIdToken:async()=>'fixture-token'};
 w.fixtureClient={auth:{currentUser:user},sdk:{onIdTokenChanged:(auth,callback)=>{notify=callback;}}};
 w.fetch=async()=>new Response('{}');
 w.eval(source+'\nclient=Promise.resolve(window.fixtureClient);window.protect=protectPage;');
 await w.protect(async()=>{mounts++;await waiting;},e=>{throw e;});
 const notifications=[notify(user),notify(user),notify(user)];
 await new Promise(r=>setTimeout(r,10));
 assert.equal(mounts,1,'Token refresh must not append another form');
 release();await Promise.all(notifications);await notify(user);
 assert.equal(mounts,1,'A later refresh preserves the mounted form and draft');
});

// A phone loses the network for a moment while the page opens. The studio used
// to stay empty for good: the sync threw before mounting and nothing retried.
test('A failed session sync still opens the studio once the network comes back',async t=>{
 const dom=new JSDOM('<button data-studio-signout>Salir</button>',{url:'https://fixture.invalid/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;let notify,mounts=0,fail=true;const errors=[];
 const user={uid:'owner',getIdToken:async()=>'fixture-token'};
 w.fixtureClient={auth:{currentUser:user},sdk:{onIdTokenChanged:(auth,callback)=>{notify=callback;}}};
 w.fetch=async()=>fail?new Response(JSON.stringify({error:'Servicio no disponible'}),{status:503}):new Response('{}');
 const original=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>original(fn,ms>=2000?1:ms,...args);
 w.eval(source+'\nclient=Promise.resolve(window.fixtureClient);window.protect=protectPage;');
 await w.protect(()=>{mounts++;},e=>errors.push(e));
 await notify(user);
 assert.equal(mounts,0,'nothing is mounted without a server session');
 assert.match(errors.at(-1).message,/Servicio no disponible/,'the owner is told why');
 fail=false;
 for(let n=0;n<400&&!mounts;n++)await new Promise(r=>original(r,5));
 assert.equal(mounts,1,'the studio opens by itself when the sync works');
 await notify(user);
 assert.equal(mounts,1,'and it is not mounted twice afterwards');
});

// Access really denied is an answer: retrying it forever would hammer the API.
test('A refused session is reported once and not retried',async t=>{
 const dom=new JSDOM('<button data-studio-signout>Salir</button>',{url:'https://fixture.invalid/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;let notify,mounts=0,calls=0;const errors=[];
 const user={uid:'owner',getIdToken:async()=>'fixture-token'};
 w.fixtureClient={auth:{currentUser:user},sdk:{onIdTokenChanged:(auth,callback)=>{notify=callback;}}};
 w.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'Esta cuenta no tiene acceso.'}),{status:403});};
 const original=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>original(fn,ms>=2000?1:ms,...args);
 w.eval(source+'\nclient=Promise.resolve(window.fixtureClient);window.protect=protectPage;');
 await w.protect(()=>{mounts++;},e=>errors.push(e));
 await notify(user);
 const after=calls;
 await new Promise(r=>original(r,60));
 assert.equal(calls,after,'no retry loop against a refusal');
 assert.equal(mounts,0);assert.equal(errors.length,1);
});
