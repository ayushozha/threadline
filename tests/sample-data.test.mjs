import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSeed, seedForApp, SEED_VERSION, DEMO_QUESTION, DEMO_QUESTIONS } from '../app/static/sample-data.mjs';

const NOW = new Date('2026-11-14T19:00:00Z');
const MODES = ['memory', 'sight', 'hearing', 'mobility'];

test('each fictional mode keeps dialogue separate from sensors, completed actions and agent answers', () => {
  const ids = new Set();
  for (const mode of MODES) {
    const seed = sampleSeed(NOW, mode);
    assert.equal(seed.mode, mode);
    assert.ok(seed.persona);
    assert.equal(seed.question, DEMO_QUESTIONS[mode]);
    assert.equal(seed.archive.length, mode === 'memory' ? 7 : 4);
    assert.ok(seed.archive.flatMap(s => s.lines).length >= 20);
    assert.ok(seed.notes.every(n => n.sample && n.source === 'fictional' && n.context.startsWith('Fictional')));
    assert.ok(seed.notes.every(n => n.speaker === seed.persona));
    for (const session of seed.archive) {
      assert.equal(session.sample, true);
      assert.equal(session.source, 'fictional');
      assert.ok(new Date(session.endedAt) <= NOW);
      for (const line of session.lines) {
        assert.equal(line.provider, 'fictional');
        assert.equal(line.hr, null);
        assert.equal(line.activity, '');
        assert.equal(line.marked, false);
        assert.ok(new Date(line.at) <= NOW);
        assert.ok(!ids.has(line.id)); ids.add(line.id);
      }
    }
    assert.deepEqual([seed.tasks, seed.actions, seed.energyLog], [[], [], []]);
    assert.equal(seed.energy, null);
    assert.deepEqual(seed.days, {});
    assert.equal('answer' in seed, false);
  }
});

test('the repeated question and interrupted plan have dated source evidence, not a scripted answer', () => {
  const seed = sampleSeed(NOW);
  const plan = seed.notes.find(n => n.text.includes('make tea in my blue mug, then water'));
  const interruption = seed.notes.find(n => n.text.includes('phone is ringing'));
  const unknown = seed.notes.find(n => n.text.includes('do not remember whether I already made'));
  assert.ok(plan && interruption && unknown);
  assert.ok(new Date(plan.at) < new Date(interruption.at));
  assert.ok(new Date(interruption.at) < new Date(unknown.at));
  assert.ok(seed.notes.filter(n => n.text === 'Where are my glasses?').length >= 3);
  assert.ok(seed.notes.some(n => n.text.includes('Ask me first before sending Emma')));
  assert.match(DEMO_QUESTION, /cannot confirm/);
});

test('each mode has personal preferences and uncertainty appropriate to its demonstration', () => {
  const notes = mode => sampleSeed(NOW, mode).notes.map(n => n.text).join('\n');
  assert.match(notes('sight'), /have not supplied its picture yet/);
  assert.match(notes('sight'), /do not decide whether this food is safe/);
  assert.match(notes('hearing'), /My name is Alex/);
  assert.match(notes('hearing'), /courier has not confirmed/);
  assert.match(notes('mobility'), /Do not suggest that I stand up/);
  assert.match(notes('mobility'), /show the message first/);
});

test('chart illustrations are explicitly synthetic and not merged into dialogue or clinical inference', () => {
  for (const mode of MODES) {
    const seed = sampleSeed(NOW, mode);
    const days = Object.values(seed.demoHealth);
    assert.equal(days.length, 14);
    assert.ok(days.every(d => d.sample === true && d.source === 'fictional'));
    assert.ok(days.every(d => d.provenance.includes('not device measurements')));
    assert.ok(days.every(d => Number.isFinite(d.sleep_hours) && Number.isFinite(d.steps)));
    assert.ok(days.every(d => !('mood' in d) && !('agitation' in d) && !('csdd' in d) && !('fall_risk' in d)));
    assert.deepEqual(seed.days, {});
    assert.ok(seed.notes.every(n => !n.text.includes('bpm')));
  }
});

test('caller mutation cannot leak between modes or subsequent loads', () => {
  const first = sampleSeed(NOW, 'memory');
  first.notes[0].text = 'changed'; first.demoHealth[Object.keys(first.demoHealth)[0]].steps = -1;
  const next = sampleSeed(NOW, 'memory');
  assert.notEqual(next.notes[0].text, 'changed');
  assert.ok(Object.values(next.demoHealth).every(d => d.steps >= 0));
  assert.throws(() => sampleSeed(NOW, 'invalid'), RangeError);
});


test('regular app seed combines all modes with stable non-colliding IDs and explicit provenance', () => {
  const seed = seedForApp(NOW);
  assert.equal(seed.version, SEED_VERSION);
  assert.equal(seed.archive.length, 19);
  assert.equal(seed.archive.reduce((n, session) => n + session.lines.length, 0), 111);
  assert.equal(seed.notes.length, 77);
  assert.deepEqual([...new Set(seed.notes.map(n => n.exampleMode))].sort(), [...MODES].sort());
  assert.equal(new Set(seed.notes.map(n => n.id)).size, seed.notes.length);
  assert.equal(new Set(seed.archive.map(n => n.id)).size, seed.archive.length);
  assert.ok(seed.notes.every(n => n.source === 'seeded' && n.sample && n.seeded && n.context.includes(`${n.persona} · ${n.exampleMode}`)));
  assert.ok(seed.archive.every(s => s.source === 'seeded' && s.lines.every(n => n.provider === 'seeded' && n.source === 'seeded' && n.exampleMode === s.exampleMode)));
  assert.deepEqual(seed.actions, []); assert.deepEqual(seed.tasks, []);
  assert.equal('answer' in seed, false);
  assert.equal(Object.keys(seed.demoHealth).length, 14);
  assert.ok(Object.values(seed.demoHealth).every(d => d.source === 'seeded' && d.seeded && d.provenance.includes('not device measurements')));
  assert.deepEqual(seed.notes.map(n => n.id), seedForApp(NOW).notes.map(n => n.id));
  assert.ok(!seed.notes.some(n => sampleSeed(NOW, n.exampleMode).notes.some(example => example.id === n.id)));
});

test('regular app seed does not share mutable records with later seeds or individual scenarios', () => {
  const first = seedForApp(NOW), original = seedForApp(NOW);
  first.notes[0].text = 'edited locally'; first.archive[0].lines[0].text = 'edited transcript';
  first.demoHealth[Object.keys(first.demoHealth)[0]].steps = 99999;
  first.questions.memory = 'edited question'; first.routines.memory.push('edited routine');
  assert.deepEqual(seedForApp(NOW), original);
});


test('regular Memory history uses the chosen Evelyn and Emma names', () => {
  const seed = seedForApp(NOW);
  const memory = seed.notes.filter(n => n.exampleMode === 'memory');
  assert.ok(memory.every(n => n.persona === 'Evelyn' && n.speaker === 'Evelyn'));
  assert.ok(memory.some(n => n.text.includes('Emma')));
  assert.ok(memory.every(n => !/Meera|Priya/.test(n.text + n.context)));
  assert.ok(seed.archive.filter(s => s.exampleMode === 'memory').every(s => s.persona === 'Evelyn'));
});
