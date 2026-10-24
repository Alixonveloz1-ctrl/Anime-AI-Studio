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
