/**
 * Sanity-check the TypeScript frontend: every emitted phoneme must exist in the
 * model's symbol inventory, and token ids must be in range.
 *
 * Chinese rows can also be compared against the Python frontend the model was
 * trained with (pypinyin); pinyin-pro is expected to agree on common text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFrontend } from '../src/frontend';
import { loadDictionary } from '../src/frontend/english';

const symbols: string[] = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'model', 'symbols.json'), 'utf8'),
).symbols;
const frontend = createFrontend(symbols);

const SAMPLES = [
  '你好，世界！',
  '妈麻马骂吗',
  '行万里路，读万卷书。',
  'This is a text to speech model.',
  '你好，欢迎体验这个中英双语语音合成模型。Hello world, this is a demo.',
  'The price is 359.9 yuan, about 50% off.',
];

await loadDictionary();

const index = new Map<string, number>();
symbols.forEach((symbol, position) => {
  if (!index.has(symbol)) index.set(symbol, position);
});

let failures = 0;
for (const text of SAMPLES) {
  const normalized = frontend.normalize(text);
  const phonemes = frontend.phonemize(normalized);
  const unknown = [...new Set([...phonemes])].filter((character) => character !== ' ' && !index.has(character));
  const ids: number[] = [];
  for (const character of phonemes) {
    const id = index.get(character);
    if (id !== undefined) ids.push(id);
  }
  const inRange = ids.every((id) => id >= 0 && id < symbols.length);
  if (unknown.length > 0 || !inRange) failures += 1;
  console.log(JSON.stringify({ text, phonemes, tokens: ids.length, unknown, inRange }));
}

console.log(`\n${failures === 0 ? 'OK' : 'FAILURES: ' + failures} (${SAMPLES.length} samples)`);
