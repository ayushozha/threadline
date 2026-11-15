import test from 'node:test';
import assert from 'node:assert/strict';
import { createTapGesture, ACCESS_MODES } from '../app/static/modes.mjs';

function harness() {
  let now = 0, callback; const calls = [];
  const gesture = createTapGesture(value => calls.push(value), { clock: () => now, later: fn => { callback = fn; return 1; }, cancel: () => { callback = null; } });
  return { calls, gesture, tick: ms => { now += ms; }, flush: () => { callback?.(); callback = null; } };
}
test('native double waits for third tap; three singles resolve only to assistance', () => {
  const h = harness(); h.gesture.push('single'); h.tick(100); h.gesture.push('double');
  assert.deepEqual(h.calls, []); h.tick(100); h.gesture.push('single'); h.flush();
  assert.deepEqual(h.calls, ['sos']);
  const singles = harness(); singles.gesture.push('single'); singles.gesture.push('single'); singles.gesture.push('single'); singles.flush();
  assert.deepEqual(singles.calls, ['sos']);
});
test('isolated double invokes double action; stale taps and cleared gestures do not request help', () => {
  const h = harness(); h.gesture.push('double'); h.flush(); assert.deepEqual(h.calls, ['double']);
  h.gesture.push('single'); h.tick(1000); h.gesture.push('single'); h.flush(); assert.deepEqual(h.calls, ['double']);
  h.gesture.push('double'); h.gesture.clear(); h.flush(); assert.deepEqual(h.calls, ['double']);
});
test('four modes expose distinct assistance questions with no dosing or navigation instructions', () => {
  assert.equal(new Set(Object.values(ACCESS_MODES).map(m => m.question)).size, 4);
  assert.match(ACCESS_MODES.sight.description, /not safe-navigation/);
  assert.match(ACCESS_MODES.mobility.description, /No fall-risk prediction/);
});
