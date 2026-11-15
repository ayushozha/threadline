// Small QR code encoder: byte mode, error correction L or M, versions 1–10 (up to 213 bytes at M, 271 at L).
// Follows ISO/IEC 18004 (same structure as Nayuki's reference implementation). No dependencies, no DOM.

// Per version: [ecc codewords per block, [blocks, data codewords per block], ...more groups]
const BLOCKS = {
  L: [null, [7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]],
    [24, [2, 97]], [30, [2, 116]], [18, [2, 68], [2, 69]]],
  M: [null, [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]],
    [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]],
};
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const FORMAT_ECC = { L: 1, M: 0 };
export const MAX_VERSION = 10;

/* GF(256) arithmetic, primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed–Solomon generator polynomial of the given degree (coefficients, highest first, leading 1 omitted). */
export function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly.slice(1);
}

/** ECC codewords for data (remainder of data(x)·x^n divided by the generator). */
export function rsRemainder(data, degree) {
  const gen = rsGenerator(degree), rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift(); rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i], factor);
  }
  return rem;
}

function capacity(version, ecc) {
  const [, ...groups] = BLOCKS[ecc][version];
  return groups.reduce((n, [blocks, size]) => n + blocks * size, 0);
}

/** Smallest version whose data capacity fits the bytes in byte mode, or 0 if none up to MAX_VERSION. */
export function pickVersion(byteLength, ecc = "M") {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const bits = 4 + (v < 10 ? 8 : 16) + 8 * byteLength;
    if (bits <= capacity(v, ecc) * 8) return v;
  }
  return 0;
}

function dataCodewords(bytes, version, ecc) {
  const cap = capacity(version, ecc), bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data, version, ecc) {
  const [eccLen, ...groups] = BLOCKS[ecc][version], blocks = [];
  let k = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { const d = data.slice(k, k + size); k += size; blocks.push({ d, e: rsRemainder(d, eccLen) }); }
  const out = [], longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 15-bit format information (ECC level + mask, BCH coded, XOR 0x5412). */
export function formatBits(ecc, mask) {
  const data = (FORMAT_ECC[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function build(version, ecc, codewords, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (bits) => {
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // dark module
  };
  drawFormat(0); // reserve
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const f = MASKS[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) m[y][x] = !m[y][x];
  drawFormat(formatBits(ecc, mask));
  return m;
}

/** ISO penalty score (lower is better) used to pick the mask. */
export function penalty(m) {
  const size = m.length;
  let score = 0, dark = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= size; i++) {
      if (!pat.every((p, k) => get(i + k) === p)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k));
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || !get(i + 7 + k));
      if (lightBefore || lightAfter) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => m[y][x]);
  for (let x = 0; x < size; x++) line((y) => m[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  for (const row of m) for (const c of row) if (c) dark++;
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

/** Encodes text (UTF-8) as a QR code: { version, size, ecc, mask, modules: boolean[][] (row, column; true = dark) }. */
export function encodeQR(text, { ecc = "M", mask = -1 } = {}) {
  if (!BLOCKS[ecc]) throw new Error("ECC level must be L or M.");
  const bytes = [...new TextEncoder().encode(String(text))];
  let level = ecc, version = pickVersion(bytes.length, level);
  if (!version && level === "M") { level = "L"; version = pickVersion(bytes.length, level); }
  if (!version) throw new Error("Text is too long for a QR code up to version 10.");
  const codewords = interleave(dataCodewords(bytes, version, level), version, level);
  let best = null;
  for (let k = 0; k < 8; k++) {
    if (mask >= 0 && k !== mask) continue;
    const modules = build(version, level, codewords, k), score = mask >= 0 ? 0 : penalty(modules);
    if (!best || score < best.score) best = { score, modules, mask: k };
  }
  return { version, size: version * 4 + 17, ecc: level, mask: best.mask, modules: best.modules };
}

/** SVG path data drawing every dark module as a 1×1 square, offset by a quiet-zone margin. */
export function qrPath(qr, margin = 4) {
  const parts = [];
  qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`); }));
  return parts.join("");
}
