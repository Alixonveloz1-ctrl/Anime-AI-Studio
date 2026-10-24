import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAnimes, pid, story, cloudWith} from './animes-page.mjs';

// The montage script, as the phone builds it before Cloud Run runs it.
// Verified end to end with real ffmpeg: before this, two narration cues at
// different sample rates came out 8.02 s instead of 5.73 s and the MP4 was cut.
test('Every narration and music cue is brought to one format before concatenating', async t => {
  const {w} = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')])});
  const script = w.buildMontarScript(
    [{audio:'narr_000.wav', planos:[{image:'img_000_1.png'}]}, {audio:'narr_001.wav', planos:[{image:'img_001_1.png'}]}],
    {vertical:true, hasMusic:true, musicVol:25, episodio:1});
  for (const cue of ['narr_000.wav', 'narr_001.wav']) {
    assert.match(script, new RegExp(`ffmpeg -y -v error -i ${cue} -ar 48000 -ac 1 -c:a pcm_s16le n_${cue}`),
      `${cue} is normalised first`);
    assert.match(script, new RegExp(`echo "file '\\$PWD/n_${cue}'" >> narr\\.txt`), `${cue} is listed by its normalised copy`);
    assert.doesNotMatch(script, new RegExp(`echo "file '\\$PWD/${cue}'" >> narr\\.txt`), `${cue} is not concatenated raw`);
  }
  assert.match(script, /for m in mus_\*\.wav; do ffmpeg -y -v error -i "\$m" -ar 48000 -ac 2 -c:a pcm_s16le "n_\$m"/);
  // Nothing is concatenated with mismatched headers any more.
  assert.doesNotMatch(script, /-i narr\.txt -c copy[\s\S]*?-i narr\.txt/);
});
