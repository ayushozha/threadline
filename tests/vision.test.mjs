import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisionController } from '../app/static/vision.mjs';

function fixture() {
  const saved = Object.fromEntries(['document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map(k => [k, globalThis[k]]));
  const realNow = Date.now, timeouts = new Map(), intervals = new Map(), canvases = [], calls = [], results = [], statuses = [];
  let now = 0, id = 0, pixel = 0;
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => { const key = ++id; timeouts.set(key, { fn, at: now + delay }); return key; };
  globalThis.clearTimeout = key => timeouts.delete(key);
  globalThis.setInterval = (fn, delay) => { const key = ++id; intervals.set(key, { fn, delay, at: now + delay }); return key; };
  globalThis.clearInterval = key => intervals.delete(key);
  globalThis.document = { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32 * 18 * 4).fill(pixel) }) }), toDataURL: (type, quality) => { canvas.quality = quality; return `data:${type};base64,ZmFrZQ==`; } };
    canvases.push(canvas); return canvas;
  } };
  const context = { active: true, allowed: true, scope: 1, transcript: [{ id: 'n-1', text: 'Synthetic words', at: new Date().toISOString(), source: 'vexo', extra: 'excluded' }] };
  let respond = async () => ({ answer: 'Visible object', sources: [] });
  const controller = createVisionController({ getContext: () => context, request: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body), at: now }); return respond(); }, onResult: (data, frames) => results.push({ data, frames }), onStatus: status => statuses.push(status) });
  return { controller, context, calls, results, statuses, canvases, video: { readyState: 2, videoWidth: 1920, videoHeight: 1080 },
    setResponder(fn) { respond = fn; }, setPixel(value) { pixel = value; },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const entries = [...timeouts].map(([id, timer]) => ({ id, timer, interval: false })).concat([...intervals].map(([id, timer]) => ({ id, timer, interval: true })));
        const next = entries.filter(e => e.timer.at <= end).sort((a, b) => a.timer.at - b.timer.at)[0];
        if (!next) break;
        now = next.timer.at;
        if (next.interval) next.timer.at += next.timer.delay; else timeouts.delete(next.id);
        next.timer.fn(); await Promise.resolve(); await Promise.resolve();
      }
      now = end; await Promise.resolve(); await Promise.resolve();
    },
    restore() { controller.stop(); Object.assign(globalThis, saved); Date.now = realNow; },
  };
}

test('samples at bounded dimensions, keeps three JPEGs, strips UI data from request', async () => {
  const f = fixture(); try {
    f.controller.start(f.video); await f.advance(13000); await f.controller.analyze('Where are the keys?');
    const call = f.calls.at(-1);
    assert.equal(f.canvases[0].width, 640); assert.equal(f.canvases[0].height, 360); assert.equal(f.canvases[0].quality, .65);
    assert.equal(call.url, '/api/vision'); assert.equal(call.body.frames.length, 3);
    assert.ok(call.body.frames.every(frame => frame.data === 'ZmFrZQ==' && !('dataUrl' in frame)));
    assert.deepEqual(Object.keys(call.body.transcript[0]), ['id', 'text', 'at', 'source']);
    assert.equal(f.results.at(-1).frames[0].dataUrl, 'data:image/jpeg;base64,ZmFrZQ==');
  } finally { f.restore(); }
});

test('queue is debounced, single flight, and changed scenes are throttled', async () => {
  const f = fixture(); try {
    let release; f.setResponder(() => new Promise(resolve => { release = resolve; }));
    f.controller.start(f.video); f.controller.queueCheck('latest question');
    await f.advance(3999); assert.equal(f.calls.length, 0);
    await f.advance(1); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.question, 'latest question');
    f.controller.queueCheck('next question'); await f.advance(8000); assert.equal(f.calls.length, 1);
    release({ answer: 'first' }); await Promise.resolve(); await Promise.resolve();
    f.setResponder(async () => ({ answer: 'second' })); await f.advance(4000);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.question, 'next question');
    assert.ok(f.calls[1].at - f.calls[0].at >= 4000);
  } finally { f.restore(); }
});

test('consent, readiness, stop and scope changes suppress sending or stale results', async () => {
  const f = fixture(); try {
    f.context.allowed = false; f.controller.start(f.video); await f.advance(6000); assert.equal(f.calls.length, 0);
    f.context.allowed = true; f.video.readyState = 0; await f.controller.analyze(); assert.equal(f.calls.length, 0);
    f.video.readyState = 2; let release; f.setResponder(() => new Promise(resolve => { release = resolve; }));
    const pending = f.controller.analyze(); await Promise.resolve(); assert.equal(f.calls.length, 1);
    f.context.scope = 2; release({ answer: 'stale' }); await pending; assert.equal(f.results.length, 0);
    f.controller.start(f.video); const stopped = f.controller.analyze(); await Promise.resolve(); const signal = f.calls.at(-1).options.signal;
    f.controller.stop(); assert.equal(signal.aborted, true); release({ answer: 'also stale' }); await stopped;
    assert.equal(f.results.length, 0); await f.advance(20000); assert.equal(f.calls.length, 2);
  } finally { f.restore(); }
});

test('quiet scene produces one automatic request until it changes', async () => {
  const f = fixture(); try {
    f.controller.start(f.video); await f.advance(30000); assert.equal(f.calls.length, 1);
    f.setPixel(100); await f.advance(8000); assert.equal(f.calls.length, 2);
    assert.ok(f.calls[1].at - f.calls[0].at >= 12000);
  } finally { f.restore(); }
});

test('a scene change during the throttle interval is checked when it opens', async () => {
  const f = fixture(); try {
    f.controller.start(f.video); await f.advance(4000); assert.equal(f.calls.length, 1);
    f.setPixel(100); await f.advance(7000); assert.equal(f.calls.length, 1);
    await f.advance(5000); assert.equal(f.calls.length, 2);
  } finally { f.restore(); }
});

test('request includes only twelve recent transcript lines and rejects oversized encoded JPEGs', async () => {
  const f = fixture(); try {
    f.context.transcript = Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: 'fixture' }));
    f.controller.start(f.video); await f.advance(4000);
    assert.equal(f.calls[0].body.transcript.length, 12); assert.equal(f.calls[0].body.transcript[0].id, '8');
    f.controller.stop();
    f.canvases[0].toDataURL = () => 'data:image/jpeg;base64,' + 'a'.repeat(500 * 1024 + 1);
    f.controller.start(f.video); await f.advance(6000); assert.equal(f.calls.length, 1);
    assert.ok(f.statuses.includes('Camera frame is too large.'));
  } finally { f.restore(); }
});

test('network timeout releases the request slot even if the transport ignores abort', async () => {
  const f = fixture(); try {
    f.setResponder(() => new Promise(() => {})); f.controller.start(f.video);
    const first = f.controller.analyze(); await Promise.resolve(); assert.equal(f.calls.length, 1);
    await f.advance(50000); await first; assert.equal(f.calls[0].options.signal.aborted, true);
    f.setResponder(async () => ({ answer: 'recovered' })); await f.controller.analyze();
    assert.equal(f.calls.length, 2); assert.equal(f.results.at(-1).data.answer, 'recovered');
  } finally { f.restore(); }
});
