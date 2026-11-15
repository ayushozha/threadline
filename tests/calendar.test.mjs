import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, timeLabel, dayKey } from '../app/static/calendar.mjs';
const now = new Date('2026-11-14T12:00:00');

test('groups a 7-day agenda by local day with Today and Tomorrow labels', () => {
  const at = (d, h) => new Date(2026, 10, d, h).toISOString();
  const events = [
    { title: 'Dentist', start: at(14, 15), end: at(14, 16), all_day: false },
    { title: 'Trip', start: '2026-11-15', end: '2026-11-17', all_day: true },
    { title: 'Physio', start: at(18, 9), end: at(18, 10), all_day: false },
    { title: 'Far away', start: at(30, 9), end: at(30, 10), all_day: false },
  ];
  const g = groupByDay(events, now);
  assert.equal(g.length, 7);
  assert.deepEqual(g.map((x) => x.label).slice(0, 2), ['Today', 'Tomorrow']);
  assert.equal(g[0].key, dayKey(now));
  assert.deepEqual(g[0].events.map((e) => e.title), ['Dentist']);
  assert.deepEqual(g[1].events.map((e) => e.title), ['Trip']);
  assert.deepEqual(g[2].events.map((e) => e.title), ['Trip']);
  assert.deepEqual(g[3].events, []);
  assert.deepEqual(g[4].events.map((e) => e.title), ['Physio']);
  assert.ok(!g.some((x) => x.events.some((e) => e.title === 'Far away')));
});

test('time label says All day for all-day events', () => {
  assert.equal(timeLabel({ all_day: true, start: '2026-11-14', end: '2026-11-15' }), 'All day');
  assert.match(timeLabel({ all_day: false, start: '2026-11-14T15:00:00Z', end: '2026-11-14T16:00:00Z' }), /–/);
});
