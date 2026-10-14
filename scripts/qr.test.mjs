// node --test scripts/qr.test.mjs - no dependencies, runs in the Action
// before the generator. A printed sign that does not scan is the worst
// thing this site could ship, and the encoder is vendored code nobody
// here wrote; so scripts/qr.mjs carries a READER of its own, written from
// the specification and sharing nothing with vendor/QRCode - its own
// level-M tables, its own GF(256), its own walk - and qrSvg reads every
// code back through it before drawing it. This file proves that reader:
// every fixture (the five example doors and both ends of every version)
// reads back under the mask the encoder picks and under each of the
// eight forced ones, the reader tells a wrong code from a right one, and
// qrSvg refuses a code the reader rejects, which is what the read-back in
// the run is worth.
//
// What the reader checks, in order: the 15 format bits (both copies agree,
// their BCH remainder is zero, level is M), the version bits on a code of
// version 7 or more, the zigzag walk over exactly the data modules (the
// bit count must be the version's codewords plus its remainder bits, so a
// function module taken for data fails here), unmasking, de-interleaving
// into blocks, every block's Reed-Solomon syndromes over GF(256) with the
// polynomial 0x11d, the byte-mode header, the text, and the terminator and
// 0xEC/0x11 padding after it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import QRCode from './vendor/QRCode/index.js';
import { QR_MAX_BYTES, QR_SPEC, QR_TEXT, qrMatrix, qrProblem, qrSvg, readQr } from './qr.mjs';
import { doorUrl } from './site.mjs';

// The reader's table, held here against the capacities the specification
// prints (the first test): a wrong entry would fail every fixture of that
// version, but the capacity check names the entry.
const SPEC = QR_SPEC;

/** Byte-mode characters a version holds at level M: its data bits less the 4-bit mode and the count field. */
const capacity = (v) => Math.floor((SPEC[v].data.reduce((a, b) => a + b, 0) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

/** The smallest version that holds `len` characters, by the table above. */
const versionFor = (len) => Number(Object.keys(SPEC).find((v) => capacity(Number(v)) >= len));

/** `n` characters that walk the whole printable range, spaces and quotes included. */
const ascii = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(0x20 + ((i * 7) % 95))).join('');

const DOORS = [
  'The Red Bar',
  "AJ's Grayton Beach",
  'Old Florida Fish House',
  'Hope on the Beach - Orange Street',
  'The Pavilion at Watersound Town Center',
].map(doorUrl);

// Each version's first and last byte count, so every size the sign can be
// is read at both edges, plus the two the plan named.
const SIZES = [14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213];
const FIXTURES = [...DOORS, ...SIZES.map(ascii)];

/** The reader's verdict on one matrix, against the text it should carry. */
function check(m, text, mask) {
  const got = readQr(m);
  assert.equal(got.bits, got.expectedBits, `walked ${got.bits} data bits, the version has ${got.expectedBits}`);
  assert.equal(got.level, 0, 'level is not M');
  assert.equal(got.mode, 4, 'mode is not byte');
  assert.equal(got.version, versionFor(text.length), 'not the smallest version that fits');
  assert.equal(got.clean, true, 'a block has a non-zero Reed-Solomon syndrome');
  assert.equal(got.tail, true, 'the terminator or the padding is wrong');
  assert.equal(got.text, text);
  if (mask !== undefined) assert.equal(got.mask, mask, 'the format bits name another mask');
  return got;
}

describe('the vendored encoder, read back by a reader of its own', () => {
  it('holds exactly as many characters as the level-M table says, and the guard knows the last one', () => {
    // The specification's byte-mode capacities at level M, versions 1 to 10.
    assert.deepEqual(
      Object.keys(SPEC).map((v) => capacity(Number(v))),
      [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
    );
    assert.equal(capacity(10), QR_MAX_BYTES);
    assert.equal(QR_MAX_BYTES, 213);
    // Each size in the list sits at one edge of a version.
    for (const n of SIZES) assert.ok(n === 213 || capacity(versionFor(n)) === n || capacity(versionFor(n) - 1) === n - 1, `${n}`);
  });

  for (const text of FIXTURES) {
    const label = DOORS.includes(text) ? text : `${text.length} characters`;
    it(`reads ${label} back under the mask the encoder picks`, () => {
      const got = check(qrMatrix(text), text);
      assert.ok(got.mask >= 0 && got.mask <= 7);
    });

    it(`reads ${label} back under each of the eight forced masks`, () => {
      for (let mask = 0; mask < 8; mask += 1) check(qrMatrix(text, { mask }), text, mask);
    });
  }

  it('reads the door links of the five venues at the versions their lengths need', () => {
    // The Red Bar's is 67 characters (version 5, 37 modules), the
    // Pavilion's 127 (version 8, 49 modules, past the first version with
    // version bits), none within 80 characters of the cap.
    for (const url of DOORS) {
      assert.ok(url.length <= QR_MAX_BYTES - 80, `${url} is ${url.length} characters`);
      assert.match(url, QR_TEXT);
    }
    assert.equal(DOORS[0].length, 67);
    assert.equal(qrMatrix(DOORS[0]).length, 37);
    assert.equal(DOORS[4].length, 127);
    assert.equal(qrMatrix(DOORS[4]).length, 49);
  });

  it('tells a wrong code from a right one', () => {
    // The reader is only worth what it refuses. Flip one data module
    // inside the text and the syndromes catch it and the text changes;
    // flip the very first one, the mode nibble, and the reader stops;
    // flip a format module and the two copies disagree; another venue's
    // link under the same mask reads as that link.
    const text = DOORS[0];
    const m = qrMatrix(text, { mask: 3 });
    const n = m.length;
    const flipped = m.map((row) => row.slice());
    flipped[n - 10][n - 1] = !flipped[n - 10][n - 1];
    const got = readQr(flipped);
    assert.equal(got.clean, false);
    assert.notEqual(got.text, text);
    const mode = m.map((row) => row.slice());
    mode[n - 1][n - 1] = !mode[n - 1][n - 1];
    assert.throws(() => readQr(mode), /is not byte mode/);
    const format = m.map((row) => row.slice());
    format[0][8] = !format[0][8];
    assert.throws(() => readQr(format), /copies of the format bits differ/);
    assert.notEqual(readQr(qrMatrix(DOORS[1], { mask: 3 })).text, text);
  });
});

describe('the shape every scanner looks for first', () => {
  const finder = (r, c) => r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);

  for (const text of [DOORS[0], ascii(14), ascii(213)]) {
    it(`${text.length} characters: 17 + 4v modules, three finders with their separators, the timing lines and the dark module`, () => {
      const m = qrMatrix(text);
      const n = m.length;
      assert.equal((n - 17) % 4, 0);
      assert.ok(n >= 21 && n <= 57);
      for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        for (let r = 0; r < 7; r += 1) {
          for (let c = 0; c < 7; c += 1) assert.equal(m[r0 + r][c0 + c], finder(r, c), `finder at ${r0},${c0} module ${r},${c}`);
        }
      }
      // The separators: a light line around each finder.
      for (let i = 0; i < 8; i += 1) {
        assert.equal(m[7][i], false);
        assert.equal(m[i][7], false);
        assert.equal(m[7][n - 1 - i], false);
        assert.equal(m[i][n - 8], false);
        assert.equal(m[n - 8][i], false);
        assert.equal(m[n - 1 - i][7], false);
      }
      // Timing: dark at even positions between the finders, both ways.
      for (let i = 8; i < n - 8; i += 1) {
        assert.equal(m[6][i], i % 2 === 0, `timing row at ${i}`);
        assert.equal(m[i][6], i % 2 === 0, `timing column at ${i}`);
      }
      assert.equal(m[n - 8][8], true);
    });
  }
});

describe('the guard in front of the encoder', () => {
  it('refuses a character outside printable ASCII, which the byte mode would write as something else', () => {
    for (const bad of ['Café', 'Bud & Alley’s', 'a\tb', 'a\nb', '', 'x\u0000', 'émigré']) {
      assert.throws(() => qrMatrix(bad), RangeError, JSON.stringify(bad));
      assert.throws(() => qrSvg(bad), RangeError, JSON.stringify(bad));
    }
    assert.throws(() => qrMatrix(null), RangeError);
    assert.throws(() => qrMatrix(42), RangeError);
  });

  it('refuses the 214th character and takes the 213th', () => {
    assert.throws(() => qrMatrix(ascii(214)), RangeError);
    assert.throws(() => qrSvg(ascii(214)), RangeError);
    assert.equal(qrMatrix(ascii(213)).length, 57);
  });

  it('refuses a mask that is not one of the eight', () => {
    for (const mask of [-1, 8, 1.5, '3']) assert.throws(() => qrMatrix(DOORS[0], { mask }), RangeError);
  });
});

describe('the read-back in front of the drawing', () => {
  // qrSvg hands every code to the reader before it draws it. The encoder
  // below is the vendored one, so the only way to make it wrong is to make
  // it wrong: patch its prototype for one test (put back in finally;
  // nothing in vendor/ changes) so the code it builds has one data module
  // flipped, and the drawing refuses it where the matrix alone would not.
  const withFlip = (where, fn) => {
    const make = QRCode.prototype.make;
    QRCode.prototype.make = function flipped() {
      make.call(this);
      const [r, c] = where(this.modules.length);
      this.modules[r][c] = !this.modules[r][c];
    };
    try {
      return fn();
    } finally {
      QRCode.prototype.make = make;
    }
  };

  it('draws nothing for a code that does not read back as the text, and says so', () => {
    const text = DOORS[0];
    withFlip((n) => [n - 10, n - 1], () => {
      // The matrix itself comes out (the guards passed) - and is wrong.
      assert.notEqual(readQr(qrMatrix(text)).text, text);
      assert.throws(() => qrSvg(text), { name: 'Error', message: `the code for ${JSON.stringify(text)} reads back as other text` });
      assert.equal(qrProblem(text), `the code for ${JSON.stringify(text)} reads back as other text`);
    });
    // Put back, the same text draws and has no problem.
    assert.match(qrSvg(text), /^<svg /);
    assert.equal(qrProblem(text), null);
  });

  it('refuses a code the reader cannot follow at all, with the reader\'s reason', () => {
    // A format module flipped: the two copies disagree before any text is read.
    withFlip(() => [0, 8], () => {
      assert.throws(() => qrSvg(DOORS[1]), /did not read back: the two copies of the format bits differ/);
      assert.match(qrProblem(DOORS[1]), /^the code for ".*" did not read back: the two copies of the format bits differ$/);
    });
    // A padding module flipped, past the text: the text reads, the tail does not.
    withFlip((n) => [9, n - 9], () => {
      const got = readQr(qrMatrix(ascii(14)));
      assert.ok(!got.clean || !got.tail || got.text !== ascii(14));
      assert.throws(() => qrSvg(ascii(14)), { name: 'Error' });
      assert.match(qrProblem(ascii(14)), /^the code for /);
    });
  });

  it('names the guard that refused, in the words the log carries', () => {
    assert.equal(qrProblem('Café'), 'QR text must be printable ASCII');
    assert.equal(qrProblem(ascii(214)), 'QR text is 214 characters; at most 213 fit');
    assert.equal(qrProblem(null), 'QR text must be printable ASCII');
    for (const text of FIXTURES) assert.equal(qrProblem(text), null, text);
  });

  it('reads every example door back as part of drawing it: the SVG is of the checked matrix', () => {
    for (const text of DOORS) {
      const svg = qrSvg(text);
      const n = qrMatrix(text).length;
      assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
    }
  });
});

describe('the SVG the sign carries', () => {
  const text = DOORS[1];
  const svg = qrSvg(text);

  it('is one element with the quiet zone in its viewBox, one path, no script and nothing to fetch', () => {
    const n = qrMatrix(text).length;
    assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"`));
    assert.equal(svg.match(/<path /g).length, 1);
    assert.equal(svg.match(/<rect /g).length, 1);
    assert.doesNotMatch(svg, /<script|<image|href=|src=|url\(/);
    assert.equal(svg.split('http').length, 2); // the namespace, nothing else
    assert.match(svg, /<\/svg>$/);
  });

  it('draws exactly the dark modules, offset by the quiet zone', () => {
    // Rebuild the matrix from the path's runs and compare it module for
    // module, so the drawing is the code and not a picture of one.
    const m = qrMatrix(text);
    const n = m.length;
    const d = /<path d="([^"]*)"/.exec(svg)[1];
    const drawn = Array.from({ length: n }, () => new Array(n).fill(false));
    let runs = 0;
    for (const [, x, y, len] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      runs += 1;
      for (let i = 0; i < Number(len); i += 1) drawn[Number(y) - 4][Number(x) - 4 + i] = true;
    }
    assert.ok(runs > 0);
    assert.equal(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, ''), '', 'the path has something other than runs in it');
    assert.deepEqual(drawn, m);
  });

  it('takes a smaller quiet zone when asked, and reads the same', () => {
    const n = qrMatrix(text).length;
    assert.match(qrSvg(text, { quiet: 1 }), new RegExp(`viewBox="0 0 ${n + 2} ${n + 2}"`));
  });
});
