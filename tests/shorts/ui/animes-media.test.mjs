import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, story, cloudWith} from './animes-page.mjs';

// How the page reads /api/image answers (see tests/animes/image-api.test.cjs
// for the server side of the same contract).
const json = (value, status=200) => new Response(JSON.stringify(value), {status});

test("Vercel's plain-text 60 s page becomes a readable error, not a JSON parse error", async t => {
  const {w} = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]),
    imageAnswer:() => new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n', {status:504})});
  await assert.rejects(w.generateImage('Kaito at the door', null, null, {}), e => /más de 60 s/.test(e.message) && !/JSON|expected pattern/.test(e.message));
});

test('When the server runs out of time between rescue steps, the next step goes in a new request', async t => {
  const {w, imageCalls} = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]),
    imageAnswer:(body, n) => n === 1
      ? json({error:'bloqueado [IMAGE_SAFETY] — se sigue rescatando en otra petición', bloqueado:true, siguienteNivel:2})
      : json({imageData:'iVBORw0KGgo=', imageMimeType:'image/png', rescate:body.desdeNivel})});
  assert.equal(await w.generateImage('Kaito at the door', null, null, {}), 'iVBORw0KGgo=');
  assert.equal(imageCalls.length, 2);
  assert.equal(imageCalls[1].desdeNivel, 2);
  assert.equal(imageCalls[1].prompt, imageCalls[0].prompt, 'same shot, continued');
  assert.match(w.document.querySelector('#toast').textContent, /Bloqueada: salió quitando el registro sugerente/);
});
