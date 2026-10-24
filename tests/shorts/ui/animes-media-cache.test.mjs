import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, other, story, cloudWith, until} from './animes-page.mjs';

// Generated media lives in the bucket; the device copy is a cache. What happens
// when the bucket write or delete does not go through.
const json = (value, status=200) => new Response(JSON.stringify(value), {status});

test('A clip whose upload failed is kept, is not pruned away, and is uploaded later', async t => {
  let offline = true;
  const p = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')], [other, story('Otro', 'otro')]),
    hooks:{assetPut:() => offline ? new Response('', {status:503}) : undefined}});
  const {w} = p;
  const key = `sa_${pid}_s1`;
  await assert.rejects(w.dbSet(key, 'audio/wav|UklGRg=='), /no se pudo guardar|No se pudo guardar/i);
  assert.equal(await w.localDbGet(key), 'audio/wav|UklGRg==', 'the paid clip is still on the device');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('anime_media_pendientes')), [key]);
  // Opening another anime prunes this device's cache.
  await w.switchProject(other);
  assert.equal(await w.localDbGet(key), 'audio/wav|UklGRg==', 'an unuploaded clip survives the prune');
  // The connection comes back.
  offline = false;
  await w.subirMediosPendientes();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('anime_media_pendientes')), []);
  assert.equal(p.bucket.get('cache:'+key), 'audio/wav|UklGRg==');
});

test('A delete the bucket refused is never reported as done', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]),
    hooks:{assetDelete:() => json({error:'GCS 503'}, 503)}});
  const {w} = p;
  const key = `sia_${pid}_s1`;
  await w.localDbSet(key, 'gs://fixture-bucket/old.png');
  await assert.rejects(w.dbDel(key), /No se pudo borrar/);
});

test('Regenerating an episode stops rather than putting the new story on old media', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]),
    hooks:{assetList:() => json({keys:[`sia_${pid}_s1`]}), assetDelete:() => json({error:'GCS 503'}, 503)}});
  const {w} = p;
  await w.localDbSet(`sia_${pid}_s1`, 'gs://fixture-bucket/old.png');
  await assert.rejects(w.borrarMaterialDelEpisodio(), /no se guarda encima de ellos/);
});

test('A listing the bucket could not answer is not treated as an empty project', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')]),
    hooks:{assetList:() => json({error:'GCS 503'}, 503)}});
  await assert.rejects(p.w.dbKeys(), /No se pudo leer la lista/);
});

// A cache entry of a narration holds the whole audio in base64. Asking whether
// each scene already has one downloaded all of them: megabytes of mobile data
// to decide between «Audio» and «Reproducir».
test('Drawing the scenes never downloads an audio to find out it exists', async t => {
  const scenes = Array.from({length:12}, (_, i) => ({id:'s'+(i+1), num:i+1, act:'Inicio',
    narration:'La escena número '+(i+1)+'.', imagePromptA:'A shot'}));
  const anime = story('Anime', 'texto');
  anime.episodes = {1:scenes};
  const audio = 'audio/wav|' + 'A'.repeat(120_000);
  const media = Object.fromEntries(scenes.map(s => ['cache:sa_'+pid+'_'+s.id, audio]));
  const p = await openAnimes(t, {cloud:cloudWith([pid, anime]), media});
  await until(() => p.w.document.querySelectorAll('#scenesList .scene-card').length === 12);
  await until(() => p.w.document.querySelectorAll('#scenesList .scene-actions button').length >= 24);
  const buttons = [...p.w.document.querySelectorAll('#scenesList .scene-actions button')].map(b => b.textContent.trim());
  assert.equal(buttons.filter(t => /Reproducir/.test(t)).length, 12, 'every scene offers its audio: '+buttons.slice(0, 4));
  assert.deepEqual(p.assetGets.filter(k => k.startsWith('sa_')), [], 'no narration was downloaded');
  assert.equal(p.assetLists.length, 1, 'one listing answers for the whole episode');
  // And what this device generates is known at once, without another listing.
  await p.w.dbSet('sa_'+pid+'_nueva', 'audio/wav|UklGRg==');
  assert.equal(await p.w.dbHas('sa_'+pid+'_nueva'), true);
  assert.equal(p.assetLists.length, 1);
});

// The clip of each shot is cut to its share of that scene's narration. The
// measurement was cached by scene id alone, and scene ids repeat in every
// episode: episode 2 was cut to the length of episode 1's narration.
test('The length of a scene is its own, not the one of the same scene in another episode', async t => {
  const corta = 'Mira eso.';
  const larga = 'Caminamos despacio por el andén mientras el tren se alejaba. '.repeat(6);
  const anime = story('Anime', corta);
  anime.episodes = {1:[{id:'s1', num:1, act:'Inicio', narration:corta, imagePromptA:'A shot'}],
                    2:[{id:'s1', num:1, act:'Inicio', narration:larga, imagePromptA:'A shot'}]};
  const p = await openAnimes(t, {cloud:cloudWith([pid, anime])});
  const {w} = p;
  const escena = () => w.testPage.getState().scenes[0];
  const uno = await w.sceneAudioSeconds(escena());
  w.switchEpisode(2);
  assert.equal(w.testPage.getState().currentEpisode, 2);
  const dos = await w.sceneAudioSeconds(escena());
  assert.ok(dos > uno + 5, `episode 2 measured ${dos}s, episode 1 ${uno}s`);
  w.switchEpisode(1);
  assert.equal(await w.sceneAudioSeconds(escena()), uno, 'and going back gives the first one again');
});
