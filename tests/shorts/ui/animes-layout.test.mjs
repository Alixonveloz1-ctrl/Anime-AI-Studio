import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openAnimes, pid, story, cloudWith} from './animes-page.mjs';

// The studio is one 100dvh scroll container with a fixed tab bar at the bottom.
// Measured with the iPhone profile in real Chromium: with the top bar placed
// before it, the container ran from 38 px to 702 px of a 664 px screen, so its
// last 38 px could never be scrolled into view.
test('The top bar is inside the scroll container, so the studio fits the screen', async t => {
  const {w} = await openAnimes(t, {cloud:cloudWith([pid, story('Anime', 'texto')])});
  const nav = w.document.querySelector('nav[aria-label="Secciones"]');
  assert.ok(nav, 'the Salir / Cortos bar exists');
  assert.equal(nav.parentElement, w.document.querySelector('.app'), 'inside the scroll container, not above it');
  assert.equal(nav.previousElementSibling, null, 'and at the top of it');
});

test("The scroll container reserves the iPhone's bottom safe area", () => {
  const css = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  // The tab bar grows with the home-indicator inset, so the padding must too.
  assert.match(css, /\.app \{[^}]*padding:16px 14px calc\(110px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.nav \{[^}]*padding:8px 0 calc\(8px \+ env\(safe-area-inset-bottom\)\)/);
});
