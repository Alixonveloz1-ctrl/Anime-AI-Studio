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

// Web Audio is not in jsdom: a decoder that turns any clip into 0.1 s of silence.
const silence = (length=2400) => ({sampleRate:24000, numberOfChannels:1, length, duration:length/24000, getChannelData:() => new Float32Array(length)});
class FakeAudioContext {
  async decodeAudioData() { return silence(); }
  close() {}
}
class FakeOfflineAudioContext {
  constructor(channels, length) { this.length = length; this.destination = {}; }
  createBufferSource() { return {connect() {}, start() {}}; }
  async startRendering() { return silence(this.length); }
}
const withWebAudio = w => Object.assign(w, {AudioContext:FakeAudioContext, OfflineAudioContext:FakeOfflineAudioContext});
const castScene = lines => ({...story('Anime', 'texto'), universe:{...story('Anime', 'texto').universe, storyMode:'cast'},
  characters:[{id:'hero', name:'Akira', role:'Protagonista', gender:'male'}],
  episodes:{1:[{id:'s1', num:1, narration:lines.join(' '), imagePromptA:'A shot',
    interventions:lines.map(text => ({type:'dialogue', speakerId:'hero', text}))}]}});

test('Cast mode: a quota pause on one line does not pay again for the lines already made', async t => {
  const {w, audioCalls} = await openAnimes(t, {cloud:cloudWith([pid, castScene(['Primera frase de la escena.', 'Segunda frase de la escena.', 'Tercera frase.'])]),
    audioAnswer:(body, n) => n === 2
      ? json({error:'Resource exhausted: quota exceeded (429)'}, 429)
      : json({audioData:'UklGRg==', mimeType:'audio/wav'})});
  withWebAudio(w);
  w.testPage.esperasDeCuota.fill(0.1);   // the real pauses are minutes long
  const scene = w.testPage.getState().scenes[0];
  const result = await w.generarAudioDeEscena(scene);
  assert.ok(result.audioData);
  assert.deepEqual(audioCalls.map(c => c.text), ['Primera frase de la escena.', 'Segunda frase de la escena.', 'Segunda frase de la escena.', 'Tercera frase.']);
});

test('Cast mode: a one-word line such as "Sí" is voiced instead of failing the scene', async t => {
  const {w, audioCalls} = await openAnimes(t, {cloud:cloudWith([pid, castScene(['¿Vienes conmigo?', 'Sí'])]),
    audioAnswer:() => json({audioData:'UklGRg==', mimeType:'audio/wav'})});
  withWebAudio(w);
  await w.generarAudioDeEscena(w.testPage.getState().scenes[0]);
  assert.deepEqual(audioCalls.map(c => c.text), ['¿Vienes conmigo?', 'Sí.']);
});
