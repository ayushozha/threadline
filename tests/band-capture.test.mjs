import test from 'node:test';
import assert from 'node:assert/strict';
import { Band, SimTransport } from '../app/static/vendor/vexo-open/js/src/index.js';
import { claimBandAudio, queueBandAudio, pcmWav } from '../app/static/band-capture.mjs';

test('recording claims audio already running on another physical link', async () => {
  const transport = new SimTransport(73);
  const band = await Band.connect(73, { transport });
  try {
    transport.otherProgramStarts('audio');
    await band.configure({ events: true, battery: true });
    let heard = 0;
    band.on('audio', () => heard++);
    await band.configure({ audio: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(heard, 0, 'reproduces globally enabled but unowned audio');
    await claimBandAudio(band);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.ok(heard > 0, 'explicit ownership must deliver audio on this connection');
    await band.configure({ audio: false });
    const stopped = heard;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(heard, stopped, 'Stop releases the microphone stream');
  } finally { await band.disconnect(); }
});

test('network recovery buffer retains order without unlimited audio retention', () => {
  const queue = [];
  const bytes = new Uint8Array([1]);
  assert.equal(queueBandAudio(queue, { opus: bytes, time: 10 }, 2), false);
  bytes[0] = 9;
  queueBandAudio(queue, { opus: new Uint8Array([2]), time: 20 }, 2);
  assert.deepEqual([...queue[0].opus], [1], 'buffer owns the received bytes');
  assert.equal(queueBandAudio(queue, { opus: new Uint8Array([3]), time: 30 }, 2), true);
  assert.deepEqual(queue.map(packet => packet.time), [20, 30]);
});

test('fallback WAV preserves mono PCM samples and sample rate', async () => {
  const blob = pcmWav([new Float32Array([-1, 0, 1])]);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 6); assert.equal(view.getInt16(44, true), -32767);
  assert.equal(view.getInt16(46, true), 0); assert.equal(view.getInt16(48, true), 32767);
});
