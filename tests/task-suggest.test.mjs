import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestTasks } from '../app/static/task-suggest.mjs';

const { scenarios } = JSON.parse(readFileSync(new URL('../app/static/scenarios/scenarios.json', import.meta.url)));
const today = '2026-11-14';

test('scenario library turns into concrete, sourced tasks', () => {
  const out = suggestTasks({ scenarios, today, mode: 'memory' });
  assert.ok(out.length > 0 && out.length <= 8);
  assert.equal(out[0].title, 'Check the stove is off before sitting down');
  for (const s of out) {
    assert.ok(s.id && s.title && s.why && s.source);
    assert.equal(typeof s.big, 'boolean');
    assert.match(s.due, /^\d{4}-\d{2}-\d{2}$/);
  }
  const mob = suggestTasks({ scenarios, today, mode: 'mobility', limit: 20 }).map(s => s.title);
  assert.ok(mob.includes('Fix the folded rug in the hallway'));
  assert.ok(mob.includes('Put a lowered-kerb route in the map'));
});

test('health nudges are factual and come first; care and routine follow', () => {
  const out = suggestTasks({
    scenarios, today, healthLatest: { sleep_hours: 5 + 28 / 60, steps: 9000 },
    careHistory: [{ status: 'ok', summary: 'Resting', next_step: 'Offer a glass of water', at: '2026-11-14T10:00:00Z' }, { next_step: '' }],
    routine: ['Morning pills with breakfast'],
  });
  assert.equal(out[0].source, 'Apple Health');
  assert.equal(out[0].why, 'Short sleep last night (5 h 28 m)');
  assert.ok(!out.some(s => s.id === 'health-steps'));
  assert.ok(out.some(s => s.source === 'Care agent' && s.title === 'Offer a glass of water'));
  assert.ok(out.some(s => s.source === 'Care routine' && s.title === 'Morning pills with breakfast'));
});

test('dedupes against existing titles and caps the list', () => {
  const out = suggestTasks({ scenarios, today, mode: 'memory', existingTitles: ['check the stove is off before sitting down'], routine: ['A', 'a', 'B'] });
  assert.ok(!out.some(s => s.title.toLowerCase() === 'check the stove is off before sitting down'));
  assert.equal(out.filter(s => s.title.toLowerCase() === 'a').length, 1);
  assert.ok(out.length <= 8);
  assert.deepEqual(suggestTasks({}), []);
});
