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
