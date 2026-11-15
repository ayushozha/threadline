import test from 'node:test';
import assert from 'node:assert/strict';
import { createUtteranceCollector, createSerialQueue } from '../app/static/transcript-flow.mjs';

const settled = () => new Promise(resolve => setImmediate(resolve));

test('split intent becomes one utterance with the first fragment metadata', () => {
  const collector = createUtteranceCollector();
  assert.deepEqual(collector.push({ text: 'Remind me to', speaker: 0, at: 'first', source: 'vexo' }), []);
  assert.deepEqual(collector.push({ text: 'call the library tomorrow.', speaker: 0, at: 'second' }, true), [
    { text: 'Remind me to call the library tomorrow.', speaker: 0, at: 'first', source: 'vexo' },
  ]);
  assert.equal(collector.flush(), null);
});

test('speaker boundaries emit both completed utterances without merging voices', () => {
  const collector = createUtteranceCollector(segment => `${segment.source}:${segment.speaker}`);
  collector.push({ text: 'My plan', source: 'vexo', speaker: 0 });
  assert.deepEqual(collector.push({ text: 'Their plan', source: 'vexo', speaker: 1 }, true).map(x => x.text), ['My plan', 'Their plan']);
  collector.push({ text: 'Same numeric speaker, other device', source: 'watch', speaker: 0 });
  assert.equal(collector.flush().source, 'watch');
});

test('non-ASCII text survives idle/Stop flush and empty end markers', () => {
  const collector = createUtteranceCollector();
  collector.push({ text: 'भोलि मलाई', speaker: null });
  collector.push({ text: 'फोन गर्न सम्झाऊ।', speaker: null });
  assert.equal(collector.flush().text, 'भोलि मलाई फोन गर्न सम्झाऊ।');
  collector.push({ text: '明日電話してください。', speaker: null });
  assert.equal(collector.push({ text: ' ' }, true)[0].text, '明日電話してください。');
  collector.push({ text: 'discard this session', speaker: 0 });
  collector.reset();
  assert.equal(collector.flush(), null);
});

test('line IDs merge without duplicates or modifying input metadata', () => {
  const collector = createUtteranceCollector(), first = ['line-a'];
  collector.push({ text: 'Remind me', speaker: 0, lineIds: first, id: 'first' });
  const [utterance] = collector.push({ text: 'to call', speaker: 0, lineIds: ['line-a', 'line-b'], id: 'second' }, true);
  assert.deepEqual(utterance.lineIds, ['line-a', 'line-b']);
  assert.deepEqual(first, ['line-a']); assert.equal(utterance.id, 'first');
});

test('flushes before joined fragments exceed the request limit', () => {
  const collector = createUtteranceCollector(), first = 'a'.repeat(3000), second = 'b'.repeat(1000);
  collector.push({ text: first, speaker: 0, lineIds: ['a'] });
  assert.deepEqual(collector.push({ text: second, speaker: 0, lineIds: ['b'] }, true).map(x => [x.text.length, x.lineIds]), [[3000, ['a']], [1000, ['b']]]);
});

test('back-to-back items run in order with no overlap or replacement', async () => {
  const done = [], errors = [];
  let concurrent = 0, maximum = 0;
  const queue = createSerialQueue(async item => {
    concurrent++; maximum = Math.max(maximum, concurrent);
    await Promise.resolve();
    done.push(item); concurrent--;
  }, { onError: error => errors.push(error) });
  for (let i = 0; i < 100; i++) assert.equal(queue.enqueue(i), true);
  await settled();
  assert.deepEqual(done, Array.from({ length: 100 }, (_, i) => i));
  assert.equal(maximum, 1); assert.deepEqual(errors, []);
  assert.equal(queue.length, 0); assert.equal(queue.running, false);
});

test('overflow is explicit and clear removes waiting work without aborting active work', async () => {
  let release;
  const done = [], gate = new Promise(resolve => { release = resolve; });
  const queue = createSerialQueue(async item => { if (item === 1) await gate; done.push(item); }, { max: 2 });
  assert.equal(queue.enqueue(1), true);
  assert.equal(queue.running, true);
  assert.equal(queue.enqueue(2), true); assert.equal(queue.enqueue(3), true);
  assert.equal(queue.enqueue(4), false); assert.equal(queue.length, 2);
  assert.equal(queue.clear(), 2); assert.equal(queue.running, true);
  assert.equal(queue.enqueue(5), true);
  release(); await settled();
  assert.deepEqual(done, [1, 5]); assert.equal(queue.running, false);
});

test('worker and error-handler failures cannot strand later items', async () => {
  const done = [], errors = [];
  const queue = createSerialQueue(item => {
    if (item === 'bad') throw new Error('synthetic failure');
    done.push(item);
  }, { onError: (error, item) => { errors.push([error.message, item]); throw new Error('reporting failed'); } });
  queue.enqueue('bad'); queue.enqueue('next');
  await settled();
  assert.deepEqual(errors, [['synthetic failure', 'bad']]);
  assert.deepEqual(done, ['next']); assert.equal(queue.running, false);
  assert.equal(queue.enqueue('later'), true); await settled();
  assert.deepEqual(done, ['next', 'later']);
});
