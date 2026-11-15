import test from 'node:test';
import assert from 'node:assert/strict';
import { functionCalls, parseArgs } from '../app/static/realtime.mjs';

test('response.done function calls become page actions', () => {
  const ev = { type: 'response.done', response: { output: [
    { type: 'message', content: [] },
    { type: 'function_call', name: 'add_to_cart', call_id: 'c1', arguments: '{"id":"milk","qty":2}' },
    { type: 'function_call', name: 'checkout', call_id: 'c2', arguments: '' },
  ] } };
  assert.deepEqual(functionCalls(ev), [
    { call_id: 'c1', action: { id: 'milk', qty: 2, type: 'add_to_cart' } },
    { call_id: 'c2', action: { type: 'checkout' } },
  ]);
});

test('bad arguments and the type field cannot be spoofed', () => {
  assert.deepEqual(parseArgs('{oops'), {});
  const [c] = functionCalls({ response: { output: [{ type: 'function_call', name: 'set_mode', call_id: 'x', arguments: '{"type":"emergency","mode":"sight"}' }] } });
  assert.equal(c.action.type, 'set_mode');
  assert.deepEqual(functionCalls({}), []);
});
