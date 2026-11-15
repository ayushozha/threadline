import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSeed, DEMO_QUESTION } from '../app/static/sample-data.mjs';

test('fictional history preserves its source and does not invent recorded sensor data or actions', () => {
  const seed = sampleSeed(new Date('2026-11-14T19:00:00Z'));
  assert.equal(seed.archive.length, 7);
  assert.ok(seed.archive.flatMap(s => s.lines).length >= 30);
  assert.equal(new Set(seed.notes.map(n => n.id)).size, seed.notes.length);
  assert.ok(seed.notes.every(n => n.sample && n.source === 'fictional' && n.context.startsWith('Fictional')));
  for (const line of seed.archive.flatMap(s => s.lines)) {
    assert.equal(line.provider, 'fictional');
    assert.equal(line.hr, null);
    assert.equal(line.activity, '');
    assert.equal(line.marked, false);
  }
  assert.deepEqual([seed.tasks, seed.actions, seed.energyLog], [[], [], []]);
  assert.equal(seed.energy, null);
  assert.deepEqual(seed.days, {});
});

test('the interrupted plan is recoverable from dated source notes without a scripted answer', () => {
  const seed = sampleSeed(new Date('2026-11-14T19:00:00Z'));
  const plan = seed.notes.find(n => n.text.includes('make tea in my blue mug, then water'));
  const interruption = seed.notes.find(n => n.text.includes('phone is ringing'));
  const unknown = seed.notes.find(n => n.text.includes('do not remember whether I already made'));
  assert.ok(plan && interruption && unknown);
  assert.ok(new Date(plan.at) < new Date(interruption.at));
  assert.ok(new Date(interruption.at) < new Date(unknown.at));
  assert.ok(seed.notes.some(n => n.text.includes('Ask me first before sending Priya')));
  assert.match(DEMO_QUESTION, /cannot confirm/);
  assert.equal('answer' in seed, false);
});
