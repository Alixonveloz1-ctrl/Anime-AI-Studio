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
