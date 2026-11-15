import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, formatBits, pickVersion, qrPath, rsRemainder, penalty } from '../app/static/qr.mjs';
import { parsePairing, frameSize, backoffMs, rate } from '../app/static/phone.mjs';
import { badgeText, displayUrl } from '../app/static/phonecam.mjs';

test('Reed-Solomon ECC matches the ISO 18004 "HELLO WORLD" 1-M example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format information bits match the standard table', () => {
  assert.equal(formatBits('M', 0), 0b101010000010010);
  assert.equal(formatBits('L', 0), 0b111011111000100);
  assert.equal(formatBits('L', 7), 0b110100101110110);
  assert.equal(formatBits('M', 5), 0b100000011001110);
});

test('version selection by byte length', () => {
  assert.equal(pickVersion(5, 'M'), 1);
  assert.equal(pickVersion(14, 'M'), 1);
  assert.equal(pickVersion(15, 'M'), 2);
  assert.equal(pickVersion(92, 'M'), 6);
  assert.equal(pickVersion(213, 'M'), 10);
  assert.equal(pickVersion(214, 'M'), 0);
});

const readFormat = (m) => {
  // first copy: (8,0..5), (8,7), (8,8), (7,8), (5..0,8) as (x,y) with bit 0 first
  const at = (x, y) => (m[y][x] ? 1 : 0);
  const bits = [0, 1, 2, 3, 4, 5].map((i) => at(8, i)).concat([at(8, 7), at(8, 8), at(7, 8)], [5, 4, 3, 2, 1, 0].map((x) => at(x, 8)));
  return bits.reduce((v, b, i) => v | (b << i), 0);
};

test('"HELLO" encodes as a 21x21 version 1 symbol with finders, timing and format info', () => {
  const qr = encodeQR('HELLO');
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(qr.ecc, 'M');
  assert.equal(qr.modules.length, 21);
  assert.ok(qr.modules.every((row) => row.length === 21));
  const m = qr.modules;
  for (const [cx, cy] of [[3, 3], [17, 3], [3, 17]]) {
    assert.equal(m[cy][cx], true); // finder centre
    assert.equal(m[cy - 3][cx - 3], true); // outer ring corner
    assert.equal(m[cy - 2][cx - 2], false); // light ring
  }
  for (let i = 8; i <= 12; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(m[21 - 8][8], true); // dark module
  assert.equal(readFormat(m), formatBits('M', qr.mask));
});

test('every mask gives a valid symbol and the chosen one has the lowest penalty', () => {
  const url = 'https://threadline.example.com/static/phone.html?c=123456&k=0123456789abcdef0123456789abcdef';
  const best = encodeQR(url);
  assert.equal(best.version, 6);
  const scores = [...Array(8).keys()].map((k) => { const q = encodeQR(url, { mask: k }); assert.equal(readFormat(q.modules), formatBits('M', k)); return penalty(q.modules); });
  assert.equal(penalty(best.modules), Math.min(...scores));
});

test('falls back to ECC L when M cannot fit, then errors past version 10', () => {
  assert.equal(encodeQR('y'.repeat(260)).ecc, 'L');
  assert.throws(() => encodeQR('z'.repeat(400)), /too long/);
});

test('qrPath draws one square per dark module, offset by the margin', () => {
  const qr = encodeQR('HELLO');
  const dark = qr.modules.flat().filter(Boolean).length;
  const path = qrPath(qr, 4);
  assert.equal(path.split('M').length - 1, dark);
  assert.ok(path.startsWith('M4 4h1v1h-1z')); // top-left finder corner
});

test('phone page reads the pairing from the link', () => {
  assert.deepEqual(parsePairing('?c=123456&k=0123456789abcdef0123456789abcdef'), { code: '123456', key: '0123456789abcdef0123456789abcdef' });
  assert.equal(parsePairing('?c=12345&k=0123456789abcdef0123456789abcdef'), null);
  assert.equal(parsePairing('?c=123456&k=nothex'), null);
  assert.equal(parsePairing(''), null);
});

test('phone frames are 640 px wide, keep orientation and never upscale', () => {
  assert.deepEqual(frameSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(frameSize(720, 1280), { width: 640, height: 1138 });
  assert.deepEqual(frameSize(480, 360), { width: 480, height: 360 });
  assert.equal(frameSize(0, 0), null);
});

test('retry backoff and fps', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffMs), [0, 500, 1000, 2000, 4000, 5000, 5000]);
  assert.equal(rate([1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500], 5500), 2);
  assert.equal(rate([0], 10000), 0);
});

test('dashboard card labels', () => {
  assert.equal(badgeText(null), 'Not connected');
  assert.equal(badgeText({ live: true, fps: 2 }), 'Live · 2.0 fps');
  assert.equal(badgeText({ live: false, at: null }), 'Waiting for the phone…');
  assert.equal(badgeText({ live: false, at: 1 }), 'Offline · phone stopped sending');
  assert.equal(displayUrl('https://a.example/static/phone.html?c=123456&k=deadbeef'), 'a.example/static/phone.html?c=123456&k=…');
});
