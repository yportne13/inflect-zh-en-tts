/**
 * Bilingual text frontend: Mandarin runs become pinyin-derived IPA, English
 * runs become CMUdict-derived IPA, everything else passes through as
 * punctuation. Output uses the same alphabet the model was trained on.
 */

import { pinyin } from 'pinyin-pro';
import { englishToIpa } from './english';
import { syllableToIpa } from './mandarin';
import { normalizeNumbers } from './numbers';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CHUNK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const HAS_LATIN = /[A-Za-z]/;
const PUNCTUATION_MAP: Record<string, string> = {
  '。': '.',
  '，': ',',
  '、': ',',
  '！': '!',
  '？': '?',
  '；': ';',
  '：': ':',
  '…': '.',
  '—': '-',
  '－': '-',
  '～': '',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '《': '',
  '》': '',
  '（': '(',
  '）': ')',
  '【': '',
  '】': '',
  '·': '',
  '~': '-',
};

export interface Frontend {
  normalize(text: string): string;
  phonemize(text: string): string;
}

export function createFrontend(symbols: readonly string[]): Frontend {
  const allowed = new Set(symbols);

  function normalize(text: string): string {
    let value = text.normalize('NFKC');
    if (CJK.test(value)) value = normalizeNumbers(value);
    value = value
      .split('')
      .map((character) => PUNCTUATION_MAP[character] ?? character)
      .join('');
    return value.replace(/\s+/g, ' ').trim();
  }

  function phonemize(text: string): string {
    const tokens: string[] = [];
    for (const chunk of text.match(CHUNK) ?? []) {
      if (CJK.test(chunk)) {
        const syllables = pinyin(chunk, { toneType: 'num', type: 'array', v: true }) as string[];
        for (const syllable of syllables) {
          const ipa = syllableToIpa(syllable);
          if (ipa && [...ipa].every((character) => allowed.has(character))) tokens.push(ipa);
        }
      } else if (HAS_LATIN.test(chunk)) {
        const ipa = englishToIpa(chunk);
        if (ipa && [...ipa].every((character) => allowed.has(character))) {
          tokens.push(ipa);
        } else if (ipa) {
          const dropped = ipa.split('').filter((character) => !allowed.has(character));
          console.warn('English IPA dropped (symbols not in the model inventory):', [...new Set(dropped)]);
        }
      } else {
        for (const character of chunk) {
          if (allowed.has(character) && character !== ' ') tokens.push(character);
        }
      }
    }
    return tokens.join(' ').replace(/\s+/g, ' ').trim();
  }

  return { normalize, phonemize };
}
