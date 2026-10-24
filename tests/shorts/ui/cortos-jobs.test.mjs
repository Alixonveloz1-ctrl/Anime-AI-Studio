import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../../../cortos/presentation.mjs';

// What the owner can do with a job in each state (server side: tests/shorts/test_engine_release.py).
test('An uncertain job offers "Cerrar sin repetir" and never "Continuar"', () => {
  const actions = presentation.taskActions({state:'submitted_unknown', providerCalls:[{state:'submitted_unknown'}]});
  assert.deepEqual({...actions}, {cancel:false, recover:false, inspect:true, close:true});
});
test('A closed job offers nothing and no longer counts as pending', () => {
  const closed = {state:'failed', settled:true, result:{code:'CLOSED_UNCERTAIN'}};
  assert.deepEqual({...presentation.taskActions(closed)}, {cancel:false, recover:false, inspect:false, close:false});
  assert.equal(presentation.unresolved(closed), false, 'a new request for the same thing is possible again');
});
test('A job running inside the service can be checked, so a dead one can be released', () => {
  assert.equal(presentation.taskActions({state:'running', executionMode:'service'}).inspect, true);
  assert.equal(presentation.taskActions({state:'cancel_requested', executionMode:'service'}).inspect, true);
  assert.equal(presentation.taskActions({state:'running'}).inspect, false);
});

// A dialog covers #notice at the top of the page, so a failure reported from
// inside one looked like the tap had done nothing at all.
test('A failure inside a dialog is shown inside that dialog', async () => {
  const {JSDOM} = await import('jsdom');
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(new URL('../../../cortos/index.html', import.meta.url), 'utf8');
  let source = await fs.readFile(new URL('../../../cortos/studio.mjs', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace('export async function mountStudio', 'async function mountStudio').replace('export {api,say};', '');
  const dom = new JSDOM(html, {url:'https://fixture.invalid/cortos/', runScripts:'outside-only'});
  const w = dom.window;
  try {
    w.fetch = async () => new Response('{}');
    w.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
    w.eval(source + '\nwindow.testSay=say;window.testAction=action;');
    const dialog = w.document.createElement('dialog');
    w.document.body.append(dialog);
    dialog.showModal();
    const button = w.testAction('Guardar candidata', () => { throw new Error('Revisa los cambios actuales antes de guardar.'); });
    dialog.append(button);
    await button.onclick();
    const inside = dialog.querySelector('.dialog-notice');
    assert.ok(inside, 'the dialog says what happened');
    assert.equal(inside.textContent, 'Revisa los cambios actuales antes de guardar.');
    assert.equal(inside.className, 'dialog-notice error');
    // The page-level notice still carries it for when the dialog is closed.
    assert.equal(w.document.querySelector('#notice').textContent, 'Revisa los cambios actuales antes de guardar.');
  } finally { dom.window.close(); }
});
