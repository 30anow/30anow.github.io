// The QR code on a venue's door sign (renderSign in site.mjs), drawn by
// the encoder vendored in ./vendor/QRCode: QRCode for JavaScript by
// Kazuhiko Arase, in the Node port qrcode-terminal ships - the one Expo's
// own CLI prints its "scan to open" code with. Copied byte for byte and
// left alone (vendor/QRCode/NOTICE.md); all this site needs from it is
// the matrix, and this file is the only one that touches it.
//
// Three guards stand in front of it, because a printed sign that does not
// scan is the worst thing this site could ship. The vendored byte mode
// writes charCodeAt(i) as one byte, so a character outside printable
// ASCII would be encoded as something other than the text on the page;
// the reader below knows versions 1 to 10, whose last byte-mode capacity
// at level M is 213 characters; and every code is read back by that
// reader before qrSvg draws it (checkedMatrix), so a code that is not the
// link, whatever the cause, is never drawn. A link that fails the first
// two gets a RangeError, a code that fails the third an Error, and
// share-cards.mjs warns and writes no sign rather than a wrong one.
//
// The reader (readQr) is written from the specification and shares
// nothing with vendor/QRCode - its own level-M tables, its own GF(256),
// its own walk - and that is the point of it: the encoder is vendored
// code nobody here wrote, and a second opinion that cannot share its
// mistakes is what makes the read-back worth anything. scripts/qr.test.mjs
// proves the reader on the five example doors and on both ends of every
// version, under the mask the encoder picks and each of the eight forced
// ones, and proves that qrSvg refuses a code the reader rejects.
import QRCode from './vendor/QRCode/index.js';
import QRErrorCorrectLevel from './vendor/QRCode/QRErrorCorrectLevel.js';

/** Byte-mode capacity of version 10 at level M, the largest code the reader below checks. */
export const QR_MAX_BYTES = 213;

/** Printable ASCII only: the vendored byte mode writes charCodeAt, one byte per character. */
export const QR_TEXT = /^[\x20-\x7e]+$/;

/**
 * The modules of a level-M code for `text`, as rows of booleans (true is
 * dark). The version is the smallest that fits and the mask the encoder's
 * own choice - or `mask` (0 to 7) when given, which the test uses to read
 * every mask back.
 */
export function qrMatrix(text, { mask } = {}) {
  if (typeof text !== 'string' || !QR_TEXT.test(text)) {
    throw new RangeError('QR text must be printable ASCII');
  }
  if (text.length > QR_MAX_BYTES) {
    throw new RangeError(`QR text is ${text.length} characters; at most ${QR_MAX_BYTES} fit`);
  }
  let q = new QRCode(-1, QRErrorCorrectLevel.M);
  q.addData(text);
  q.make();
  if (mask !== undefined) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new RangeError(`mask ${mask} is not 0 to 7`);
    const forced = new QRCode(q.typeNumber, QRErrorCorrectLevel.M);
    forced.addData(text);
    forced.makeImpl(false, mask);
    q = forced;
  }
  return q.modules.map((row) => row.map(Boolean));
}

// ---------------------------------------------------------------------------
// The reader: a second opinion on every code, sharing nothing with the
// encoder above. What it checks, in order: the 15 format bits (both copies
// agree, their BCH remainder is zero), the version bits on a code of
// version 7 or more, the zigzag walk over exactly the data modules (the
// bit count must be the version's codewords plus its remainder bits, so a
// function module taken for data shows up), unmasking, de-interleaving
// into blocks, every block's Reed-Solomon syndromes over GF(256) with the
// polynomial 0x11d, the byte-mode header, the text, and the terminator and
// 0xEC/0x11 padding after it.
// ---------------------------------------------------------------------------

/**
 * Level M, versions 1 to 10, from the specification's tables: data
 * codewords per block, error-correction codewords per block, alignment
 * pattern centres, and the remainder bits after the last codeword.
 * Exported so the test can hold it against the capacities the
 * specification prints.
 */
export const QR_SPEC = {
  1: { data: [16], ec: 10, align: [], spare: 0 },
  2: { data: [28], ec: 16, align: [6, 18], spare: 7 },
  3: { data: [44], ec: 26, align: [6, 22], spare: 7 },
  4: { data: [32, 32], ec: 18, align: [6, 26], spare: 7 },
  5: { data: [43, 43], ec: 24, align: [6, 30], spare: 7 },
  6: { data: [27, 27, 27, 27], ec: 16, align: [6, 34], spare: 7 },
  7: { data: [31, 31, 31, 31], ec: 18, align: [6, 22, 38], spare: 0 },
  8: { data: [38, 38, 39, 39], ec: 22, align: [6, 24, 42], spare: 0 },
  9: { data: [36, 36, 36, 37, 37], ec: 22, align: [6, 26, 46], spare: 0 },
  10: { data: [43, 43, 43, 43, 44], ec: 26, align: [6, 28, 50], spare: 0 },
};

// The eight mask formulas of the specification, by their three-bit number.
const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

// GF(256) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Whether the codeword (data then EC, highest degree first) is zero at alpha^0 .. alpha^(ec-1). */
function syndromesZero(block, ec) {
  for (let s = 0; s < ec; s += 1) {
    let acc = 0;
    for (const byte of block) acc = mul(acc, EXP[s]) ^ byte;
    if (acc !== 0) return false;
  }
  return true;
}

/** The remainder of `value` divided by the BCH generator `gen`, over GF(2). */
function bchRemainder(value, gen) {
  const top = 31 - Math.clz32(gen);
  let v = value;
  while (v !== 0 && 31 - Math.clz32(v) >= top) v ^= gen << (31 - Math.clz32(v) - top);
  return v;
}
const G15 = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1, the format generator
const G18 = 0x1f25; // x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1, the version generator
const FORMAT_MASK = 0x5412;

/**
 * Read a matrix of booleans back: { version, level, mask, mode, text,
 * clean, bits, expectedBits, tail }. Throws on a code the reader cannot
 * follow (not square, a version past 10, format or version bits whose
 * copies disagree or fail their check, a light dark module, a mode other
 * than byte); every other defect shows up in the fields, which
 * checkedMatrix below and the test judge one by one.
 */
export function readQr(m) {
  const n = m.length;
  if (!m.every((row) => row.length === n)) throw new Error('not square');
  const v = (n - 17) / 4;
  const spec = QR_SPEC[v];
  if (!spec) throw new Error(`version ${v} is outside 1 to 10`);

  // Format bits: one copy beside the top-left finder, read down column 8
  // then along row 8; the other split between the top-right and
  // bottom-left corners. The two must agree, the BCH remainder must be
  // zero once the fixed mask is taken off, and the dark module sits
  // between them.
  let first = 0;
  let second = 0;
  for (let i = 0; i < 15; i += 1) {
    const r1 = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    if (m[r1][8]) first |= 1 << i;
    const c2 = i < 8 ? n - 1 - i : i === 8 ? 7 : 14 - i;
    if (m[8][c2]) second |= 1 << i;
  }
  if (first !== second) throw new Error('the two copies of the format bits differ');
  const unmasked = first ^ FORMAT_MASK;
  if (bchRemainder(unmasked, G15) !== 0) throw new Error('format bits fail their BCH check');
  const level = unmasked >> 13;
  const mask = (unmasked >> 10) & 7;
  if (m[n - 8][8] !== true) throw new Error('the dark module is light');

  // Version bits, on version 7 and up: two 6x3 blocks that must agree,
  // name this version and pass their own BCH check.
  if (v >= 7) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 18; i += 1) {
      if (m[Math.floor(i / 3)][(i % 3) + n - 11]) a |= 1 << i;
      if (m[(i % 3) + n - 11][Math.floor(i / 3)]) b |= 1 << i;
    }
    if (a !== b) throw new Error('the two copies of the version bits differ');
    if (a >> 12 !== v) throw new Error('version bits name another version');
    if (bchRemainder(a, G18) !== 0) throw new Error('version bits fail their BCH check');
  }

  // Function modules, which the walk skips.
  const isFunction = (r, c) => {
    if (r <= 8 && c <= 8) return true; // top-left finder, separator, format
    if (r <= 8 && c >= n - 8) return true; // top-right finder, separator, format
    if (r >= n - 8 && c <= 8) return true; // bottom-left finder, separator, format, dark module
    if (r === 6 || c === 6) return true; // timing
    if (v >= 7 && ((r <= 5 && c >= n - 11 && c <= n - 9) || (c <= 5 && r >= n - 11 && r <= n - 9))) return true;
    for (const ar of spec.align) {
      for (const ac of spec.align) {
        // The three centres that would sit on a finder are not drawn.
        if ((ar === 6 && ac === 6) || (ar === 6 && ac === n - 7) || (ar === n - 7 && ac === 6)) continue;
        if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
      }
    }
    return false;
  };

  // The zigzag: two columns at a time from the right, up then down,
  // skipping column 6 whole; every data module unmasked as it is read.
  const bits = [];
  let row = n - 1;
  let step = -1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let k = 0; k < 2; k += 1) {
        const c = col - k;
        if (!isFunction(row, c)) bits.push((m[row][c] ? 1 : 0) ^ (MASKS[mask](row, c) ? 1 : 0));
      }
      row += step;
      if (row < 0 || row >= n) {
        row -= step;
        step = -step;
        break;
      }
    }
  }

  // Codewords, de-interleaved: every block's data in turn, a byte at a
  // time, then every block's EC the same way.
  const total = spec.data.reduce((a, b) => a + b, 0) + spec.data.length * spec.ec;
  const words = [];
  for (let i = 0; i < total; i += 1) {
    let w = 0;
    for (let b = 0; b < 8; b += 1) w = (w << 1) | bits[i * 8 + b];
    words.push(w);
  }
  const blocks = spec.data.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...spec.data); i += 1) {
    spec.data.forEach((d, k) => {
      if (i < d) blocks[k].push(words[at++]);
    });
  }
  for (let i = 0; i < spec.ec; i += 1) spec.data.forEach((_, k) => blocks[k].push(words[at++]));
  const clean = blocks.every((b) => syndromesZero(b, spec.ec));

  // Byte mode: 0100, the count (8 bits through version 9, 16 from 10),
  // the bytes, a terminator of up to four zero bits, zero bits to the next
  // byte, then 0xEC and 0x11 by turns to the end.
  const data = blocks.flatMap((b, k) => b.slice(0, spec.data[k]));
  const stream = data.flatMap((w) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (w >> s) & 1));
  let pos = 0;
  const take = (len) => {
    let out = 0;
    for (let i = 0; i < len; i += 1) out = (out << 1) | stream[pos++];
    return out;
  };
  const mode = take(4);
  if (mode !== 4) throw new Error(`mode ${mode} is not byte mode`);
  const len = take(v < 10 ? 8 : 16);
  let text = '';
  for (let i = 0; i < len; i += 1) text += String.fromCharCode(take(8));
  let tail = true;
  for (let i = 0; i < Math.min(4, stream.length - pos); i += 1) if (take(1) !== 0) tail = false;
  while (pos % 8 !== 0) if (take(1) !== 0) tail = false;
  for (let k = 0; pos < stream.length; k += 1) if (take(8) !== (k % 2 === 0 ? 0xec : 0x11)) tail = false;

  return { version: v, level, mask, mode, text, clean, bits: bits.length, tail, expectedBits: total * 8 + spec.spare };
}

/**
 * The matrix for `text`, read back by the reader and handed over only
 * when it is `text` in every respect the reader can judge: level M, byte
 * mode, the data walk the version's length, every block's syndromes
 * zero, the text itself, and the terminator and padding after it. Throws
 * an Error naming the first fault otherwise (and the guards' RangeError
 * before any of that), so a code that is not the link is never drawn.
 */
function checkedMatrix(text) {
  const m = qrMatrix(text);
  let got;
  try {
    got = readQr(m);
  } catch (e) {
    throw new Error(`the code for ${JSON.stringify(text)} did not read back: ${e.message}`);
  }
  const fault =
    got.text !== text
      ? 'reads back as other text'
      : !got.clean
        ? 'has a block with a non-zero Reed-Solomon syndrome'
        : got.bits !== got.expectedBits
          ? `has ${got.bits} data modules where its version has ${got.expectedBits}`
          : got.level !== 0
            ? 'is not level M'
            : !got.tail
              ? 'ends in the wrong terminator or padding'
              : null;
  if (fault) throw new Error(`the code for ${JSON.stringify(text)} ${fault}`);
  return m;
}

/**
 * Why no sign can carry `text`, in the words qrSvg would throw - or null
 * when its code reads back as it should. For the run's log: share-cards.mjs
 * asks this when renderSign answers null, so the line says which guard
 * refused (not printable ASCII, past the cap, or a code the reader would
 * not pass) rather than guessing.
 */
export function qrProblem(text) {
  try {
    checkedMatrix(text);
    return null;
  } catch (e) {
    return e.message;
  }
}

/**
 * The code as one inline SVG: a white square with the quiet zone (four
 * modules each side, the standard's minimum) and one black path of the
 * dark modules, each row's runs as rectangles. The viewBox is in modules,
 * so the page's CSS sets the printed size; crispEdges keeps the modules
 * square at any scale. No script, no external reference, nothing to fetch.
 * The matrix is the checked one: a code that did not read back as `text`
 * throws here and is never drawn.
 */
export function qrSvg(text, { quiet = 4 } = {}) {
  const m = checkedMatrix(text);
  const n = m.length + 2 * quiet;
  const runs = [];
  for (let r = 0; r < m.length; r += 1) {
    for (let c = 0; c < m.length; c += 1) {
      if (!m[r][c]) continue;
      let len = 1;
      while (c + len < m.length && m[r][c + len]) len += 1;
      runs.push(`M${c + quiet} ${r + quiet}h${len}v1h-${len}z`);
      c += len - 1;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${n}" height="${n}" fill="#fff"/>` +
    `<path d="${runs.join('')}" fill="#000"/>` +
    `</svg>`
  );
}
