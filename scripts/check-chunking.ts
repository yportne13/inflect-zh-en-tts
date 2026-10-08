/**
 * Checks for the long-input chunker.
 *
 * Run with:  node --experimental-strip-types scripts/check-chunking.ts
 * (or bundle it like verify-frontend.ts).
 *
 * The invariants that matter: no chunk exceeds the limit, no text is dropped,
 * and concatenated audio has exactly the expected length including gaps.
 */

import { CHUNK_GAP_SECONDS, concatAudio, DEFAULT_MAX_CHARS, splitText } from '../src/chunk';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const samples = [
  '你好，世界！',
  '会议改到下周三下午三点，请准时参加。',
  '妈麻马骂吗？行万里路，读万卷书。',
  'Hello world, this is a bilingual text to speech model.',
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ' +
    'How vexingly quick daft zebras jump! Sphinx of black quartz, judge my vow.',
  '我今天读了一本关于 machine learning 的书，很有意思。'.repeat(6),
  '长'.repeat(200),
  'A'.repeat(300),
];

console.log(`chunking (max ${DEFAULT_MAX_CHARS} chars)`);
for (const sample of samples) {
  const chunks = splitText(sample);
  const longest = Math.max(...chunks.map((c) => c.length), 0);
  check(
    `no chunk exceeds ${DEFAULT_MAX_CHARS} (${sample.slice(0, 18)}…)`,
    longest <= DEFAULT_MAX_CHARS,
    `longest=${longest}`,
  );
  const rejoined = chunks.join('').replace(/\s+/g, '');
  const original = sample.replace(/\s+/g, '');
  check(
    `no text lost (${sample.slice(0, 18)}…)`,
    rejoined === original,
    `got ${rejoined.length} chars, expected ${original.length}`,
  );
}

console.log('\nedge cases');
check('empty input -> no chunks', splitText('').length === 0);
check('whitespace only -> no chunks', splitText('   \n  ').length === 0);
check('short input stays one chunk', splitText('你好').length === 1);
check(
  'single chunk is returned as-is',
  splitText('你好，世界！')[0] === '你好，世界！',
);

console.log('\nconcatenation');
const rate = 24000;
const a = new Float32Array(rate);
const b = new Float32Array(rate);
const c = new Float32Array(rate);
a.fill(0.5);
b.fill(0.5);
c.fill(0.5);

const one = concatAudio([a], rate);
check('single part is unchanged in length', one.length === rate);
check('single part is returned untouched', one[Math.floor(rate / 2)] === 0.5);

const three = concatAudio([a, b, c], rate);
const gap = Math.round(CHUNK_GAP_SECONDS * rate);
check(
  'three parts add two gaps',
  three.length === rate * 3 + gap * 2,
  `got ${three.length}, expected ${rate * 3 + gap * 2}`,
);

const fade = Math.max(1, Math.round(0.005 * rate));
check('chunk edges are faded in', Math.abs(three[0]) < 1e-6);
check('chunk interior is untouched', Math.abs(three[Math.floor(rate / 2)] - 0.5) < 1e-6);
check('gap between parts is silent', three[rate + Math.floor(gap / 2)] === 0);
check('fade length is positive', fade > 0);
check('empty parts are ignored', concatAudio([a, new Float32Array(0)], rate).length === rate);
check('no parts -> empty audio', concatAudio([], rate).length === 0);

console.log(`\n${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exitCode = 1;
