import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, story, cloudWith, until} from './animes-page.mjs';

// Episode music (see tests/animes/music-api.test.cjs for the server side).
const json = (value, status=200) => new Response(JSON.stringify(value), {status});
const ACTS = ['cold_open', 'act1', 'act2', 'clímax', 'resolución'];
// One scene per act, so episodeActs() returns all five, accents included.
const scored = () => {
  const base = story('Anime', 'texto');
  return {...base,
    universe:{...base.universe, musicBriefs:Object.fromEntries(ACTS.map(a => [a, {prompt:'tense strings for '+a, negative:''}]))},
    episodes:{1:ACTS.map((act, i) => ({id:'s'+(i+1), num:i+1, act, narration:'Narración del acto '+act, imagePromptA:'A shot'}))}};
};
const pointer = body => json({clips:[{audioUri:`gs://fixture-bucket/anime-studio/projects/${pid}/media/${body.storageKey}.wav`, audioUrl:'https://signed.invalid/cue.wav', mimeType:'audio/wav'}]});

test('Every act is composed and kept, including "clímax" and "resolución"', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, scored()]), musicAnswer:pointer});
  const {w, musicCalls} = p;
  await p.press('btnGenerarMusica', 60000);
  assert.equal(p.modal(), '', 'no failures reported');
  assert.equal(musicCalls.length, 5, `requests: ${musicCalls.length}`);
  // The bucket key is ASCII: the accented ones were refused by the key check.
  assert.deepEqual(musicCalls.map(c => c.storageKey), ACTS.map(a => w.musicKey(a)));
  for (const key of musicCalls.map(c => c.storageKey)) assert.match(key, /^[a-zA-Z0-9_.-]+$/);
  assert.ok(musicCalls.every(c => c.studioProjectId === pid), 'the cue is written into this project');
  // Each cue is stored as a pointer, never as megabytes of base64.
  for (const act of ACTS) {
    const stored = await w.dbGetStored(w.musicKey(act));
    assert.match(stored, /^gs:\/\/fixture-bucket\/.*\.wav$/, `${act}: ${String(stored).slice(0, 40)}`);
  }
  assert.match(w.document.querySelector('#toast').textContent, /Música: 5 listas/);
});

test('The player gets a signed URL for a stored cue, and still plays an old base64 one', async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, scored()]), musicAnswer:pointer});
  const {w} = p;
  // Seeded before composing: the signed URL of a cue is cached on first use.
  for (const act of ACTS) p.bucket.set(`gs://fixture-bucket/anime-studio/projects/${pid}/media/${w.musicKey(act)}.wav`, 'RIFFbytes');
  await p.press('btnGenerarMusica', 60000);
  await w.renderMusic();
  const players = [...w.document.querySelectorAll('#musicList audio')];
  assert.equal(players.length, 5);
  assert.ok(players.every(a => a.getAttribute('src').startsWith('https://fixture.invalid/object/')), players[0]?.getAttribute('src')?.slice(0, 60));
  await w.dbSet(w.musicKey('act1'), 'audio/wav|UklGRg==');
  await w.renderMusic();
  assert.match([...w.document.querySelectorAll('#musicList audio')][1].getAttribute('src'), /^data:audio\/wav;base64,/);
});

test("Vercel's plain-text 60 s page is reported as such instead of a JSON parse error", async t => {
  const p = await openAnimes(t, {cloud:cloudWith([pid, scored()]),
    musicAnswer:() => new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n', {status:504})});
  await p.press('btnGenerarMusica', 60000);
  assert.match(p.modal(), /pista\(s\) de música no se pudieron generar/);
  assert.match(p.modal(), /más de 60 s/);
  assert.doesNotMatch(p.modal(), /JSON|expected pattern/);
});
