import test from "node:test";
import assert from "node:assert/strict";
import { wavBlob, seconds, sizeLabel, durationLabel, RATE } from "../app/static/audiostore.js";

test("wav files have a correct 16 kHz mono 16-bit header and keep every sample", async () => {
  const a = Int16Array.from([1, -2, 3]), b = Int16Array.from([32767, -32768]);
  const blob = wavBlob([a, b]);
  assert.equal(blob.type, "audio/wav");
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.slice(8, 16)), "WAVEfmt ");
  assert.equal(view.getUint32(4, true), 36 + 10);
  assert.equal(view.getUint16(20, true), 1);       // PCM
  assert.equal(view.getUint16(22, true), 1);       // mono
  assert.equal(view.getUint32(24, true), RATE);
  assert.equal(view.getUint32(28, true), RATE * 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual([...new Int16Array(bytes.buffer.slice(44))], [1, -2, 3, 32767, -32768]);
});

test("an empty recording is still a valid wav", async () => {
  assert.equal((await wavBlob([]).arrayBuffer()).byteLength, 44);
});

test("labels", () => {
  assert.equal(seconds({ bytes: RATE * 2 * 90 }), 90);
  assert.equal(durationLabel(90), "1:30");
  assert.equal(durationLabel(3725), "1:02:05");
  assert.equal(sizeLabel(500), "1 KB");
  assert.equal(sizeLabel(5 * 1024 ** 2), "5 MB");
  assert.equal(sizeLabel(3 * 1024 ** 3), "3.0 GB");
});
