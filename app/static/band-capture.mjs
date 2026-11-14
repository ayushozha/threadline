import { STREAM_BITS } from './vendor/vexo-open/js/src/codec.js';

// configure(audio:true) can be a no-op when the other physical link owns audio.
// Explicitly start this stream so this connection receives the microphone packets.
export async function claimBandAudio(band) {
  await band.command('STREAM_START', { mask: 1 << STREAM_BITS.audio });
}

export function queueBandAudio(queue, packet, maximum = 100) {
  const dropped = queue.length >= maximum;
  if (dropped) queue.shift();
  queue.push({ opus: packet.opus.slice(), time: packet.time ?? Date.now() });
  return dropped;
}

export function pcmWav(chunks, rate = 16000) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((c, index) => view.setUint8(at + index, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true); offset += 2; }
  return new Blob([buffer], { type: 'audio/wav' });
}
