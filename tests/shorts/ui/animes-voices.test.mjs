import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, story, cloudWith, until} from './animes-page.mjs';

// Narration and per-character voices.
const voice = (lang, etiqueta, genero) => ({lang, familia:'chirp3hd', etiqueta, genero, name:`${lang}-Chirp3-HD-${etiqueta}`});
const VOICES = [voice('es-ES','Kore','female'), voice('es-ES','Charon','male'), voice('es-ES','Puck','male'),
                voice('es-US','Charon','male'), voice('es-US','Kore','female')];
const castProject = () => {
  const base = story('Anime', 'texto');
  return {...base, universe:{...base.universe, storyMode:'cast'},
    characters:[{id:'c1', name:'Akira', role:'Protagonista', gender:'male'},
                {id:'c2', name:'Ren', role:'Rival', gender:'male'},
                {id:'c3', name:'Mei', role:'Aliada', gender:'female'}]};
};
// The voice list arrives from the network AFTER restaurarAjustes() has run.
const withVoices = (t, local) => openAnimes(t, {cloud:cloudWith([pid, castProject()]), local, voices:VOICES});

test('The saved narration language and voice survive a reload', async t => {
  const p = await withVoices(t, {ajustes_estudio:JSON.stringify({voiceLang:'es-ES', voiceSelect:'gcp_es-ES-Chirp3-HD-Kore'})});
  const {w} = p;
  await until(() => w.document.getElementById('voiceLang').options.length > 1);
  assert.equal(w.document.getElementById('voiceLang').value, 'es-ES', 'not reset to the es-US placeholder');
  assert.match(w.document.getElementById('voiceSelect').value, /es-ES.*Kore/);
});

test('"Automática" gives a character a voice none of the others has', async t => {
  // es-ES has three voices, two of them male, so a free one exists.
  const p = await withVoices(t, {ajustes_estudio:JSON.stringify({voiceLang:'es-ES', voiceSelect:'gcp_es-ES-Chirp3-HD-Kore'})});
  const {w} = p;
  await until(() => w.document.getElementById('voiceLang').options.length > 1);
  const chars = () => w.testPage.getState().characters;
  // Everyone shares one voice, as an older build could leave them.
  for (const ch of chars()) ch.voice = 'gcp_es-ES-Chirp3-HD-Charon';
  w.setCharacterVoice('c2', '');
  const used = [w.document.getElementById('voiceSelect').value, ...chars().filter(c => c.id !== 'c2').map(c => c.voice)];
  assert.ok(chars().find(c => c.id === 'c2').voice, 'a voice was chosen');
  assert.ok(!used.includes(chars().find(c => c.id === 'c2').voice), 'and nobody else was using it');
});

test('The bulk reference button draws in the selected style, like the single one', async t => {
  const p = await withVoices(t, {});
  const {w, imageCalls} = p;
  w.document.getElementById('estiloAnime').value = 'realista';
  const bulk = w.document.getElementById('btnAllCharacterRefs');
  await bulk.onclick?.() ?? bulk.click();
  await until(() => imageCalls.length > 0, 20000);
  const single = w.estiloCore('realista');
  assert.ok(imageCalls[0].styleSpec.includes(single.slice(0, 60)), 'the chosen style, not a forced japon_2d');
});
