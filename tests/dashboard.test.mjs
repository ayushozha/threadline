import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, reportText } from '../app/static/dashboard.mjs';
const now = new Date('2026-11-14T12:00:00');

test('empty dashboard keeps assessment, mood, and agitation unknown without prescribing care', () => {
  const model = buildModel({ now });
  assert.equal(model.status, 'unknown');
  assert.equal(model.tiles.find(t => t.label === 'Agitated evenings').value, '—');
  assert.equal(model.tiles.find(t => t.label === 'Mood').value, '—');
  assert.deepEqual(model.actions, []);
  const report = reportText(model, 'Doctor');
  assert.match(report, /not provided/);
  assert.doesNotMatch(report, /probable.*depression|caregiver-rated|Sent from/);
});

test('poor sleep and low activity alone do not create a diagnosis, advice or care status', () => {
  const model = buildModel({ now, health: { '2026-11-14': { sleep_hours: 3, steps: 100 } } });
  assert.equal(model.status, 'unknown');
  assert.deepEqual(model.actions, []);
  assert.equal(model.csdd, null);
  assert.ok(model.moodAvg.every(v => v === null));
});

test('recorded and fictional transcript counts retain their provenance', () => {
  const model = buildModel({ now, transcripts: [
    { source: 'vexo', lines: [{ text: 'a' }] },
    { source: 'fictional', sample: true, lines: [{ text: 'b' }, { text: 'c' }] },
  ] });
  assert.deepEqual(model.insights.map(x => [x.big, x.text]), [
    ['1', 'saved transcript lines · recorded or imported'],
    ['2', 'example conversation lines'],
  ]);
});

test('dashboard shows only supplied open tasks and the latest agent suggestion', () => {
  const model = buildModel({ now, tasks: [{ title: 'Call Priya', done: false }, { title: 'Finished', done: true }],
    careHistory: [{ status: 'needs_attention', next_step: 'Ask whether help is wanted.' }] });
  assert.equal(model.status, 'needs_attention');
  assert.deepEqual(model.actions.map(a => a.text), ['Latest agent suggestion: Ask whether help is wanted.', 'Saved task: Call Priya']);
});

test('one missing mood observation stays missing and agitation uses logged denominator', () => {
  const model = buildModel({ now, mood: { days: [{ date: '2026-11-14', morning: 0.2, agitation: 2 }], weeks: [] } });
  assert.equal(model.moodAvg.at(-1), null);
  assert.equal(model.tiles.find(t => t.label === 'Agitated evenings').value, '1 / 1');
});
