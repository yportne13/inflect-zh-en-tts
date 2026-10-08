/**
 * Bilingual text frontend: Mandarin runs become pinyin-derived IPA, English
 * runs become CMUdict-derived IPA, everything else passes through as
 * punctuation. Output uses the same alphabet the model was trained on.
 *
 * NOTE: this file is intentionally ASCII-only (CJK keys use \u escapes) so it
 * survives any tooling that mishandles UTF-8 on Windows.
 */

import { pinyin } from 'pinyin-pro';
import { englishToIpa } from './english';
import { ERHUA_PAIRS, syllableToIpa } from './mandarin';
import { PHRASE_TONE_OVERRIDES } from './phraseTones';
import { normalizeNumbers } from './numbers';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CHUNK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const HAS_LATIN = /[A-Za-z]/;

const PUNCTUATION_MAP: Record<string, string> = {
  '\u3002': '.', // ideographic full stop
  '\uFF0C': ',', // fullwidth comma
  '\u3001': ',', // ideographic enumeration comma
  '\uFF01': '!', // fullwidth exclamation
  '\uFF1F': '?', // fullwidth question
  '\uFF1B': ';', // fullwidth semicolon
  '\uFF1A': ':', // fullwidth colon
  '\u2026': '.', // horizontal ellipsis
  '\u2014': '-', // em dash
  '\uFF0D': '-', // fullwidth minus
  '\uFF5E': '', // fullwidth tilde
  '\u201C': '"', // left double quotation
  '\u201D': '"', // right double quotation
  '\u2018': "'", // left single quotation
  '\u2019': "'", // right single quotation
  '\u300A': '', // left angle bracket (book title)
  '\u300B': '', // right angle bracket (book title)
  '\uFF08': '(', // fullwidth left paren
  '\uFF09': ')', // fullwidth right paren
  '\u3010': '', // left black lenticular bracket
  '\u3011': '', // right black lenticular bracket
  '\u00B7': '', // middle dot
  '~': '-',
};

export interface Frontend {
  normalize(text: string): string;
  phonemize(text: string): string;
}

/**
 * Flip to `true` when deploying a model trained on gold-standard readings
 * (DataBaker pinyin.jsonl: tone sandhi + erhua fusion), i.e.
 * exports/bilingual2-gold-10000-onnx — which is what public/model now holds.
 * The previously deployed bilingual-00003000 model was trained on citation
 * tones without erhua fusion, so this gate had to stay `false` until the swap.
 */
const GOLD_TRAINED_MODEL = true;
export { GOLD_TRAINED_MODEL };

/**
 * Apply phrase-tone overrides (pypinyin phrase-dict behavior) with longest
 * match first, mirroring how pypinyin segments phrases at prepare time.
 * Returns one syllable per chunk character.
 */
function applyPhraseOverrides(chunk: string, syllables: string[]): string[] {
  const phrases = Object.keys(PHRASE_TONE_OVERRIDES).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let position = 0;
  while (position < chunk.length) {
    let matched = false;
    for (const phrase of phrases) {
      if (phrase.length > 1 && chunk.startsWith(phrase, position)) {
        out.push(...PHRASE_TONE_OVERRIDES[phrase]);
        position += phrase.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(syllables[position]);
      position += 1;
    }
  }
  return out;
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
        // toneSandhi is gated by GOLD_TRAINED_MODEL together with erhua
        // fusion: both must flip together when the gold-trained model ships.
        const syllables = pinyin(chunk, {
          toneType: 'num',
          type: 'array',
          v: true,
          toneSandhi: GOLD_TRAINED_MODEL,
        }) as string[];
        if (syllables.length !== chunk.length) {
          // Defensive: alignment lost, process without phrase/erhua handling.
          for (const syllable of syllables) {
            const ipa = syllableToIpa(syllable);
            if (ipa && [...ipa].every((character) => allowed.has(character))) tokens.push(ipa);
          }
        } else {
          // Phrase overrides replicate pypinyin's citation-era phrase dict
          // for the CURRENT deployed model; with sandhi enabled (gold mode)
          // pinyin-pro's own sandhi is closer to the gold labels, so the
          // overrides must not fire there.
          const effective = GOLD_TRAINED_MODEL
            ? syllables
            : applyPhraseOverrides(chunk, syllables);
          // pypinyin reads the suffix-er character as "er2" (its dict
          // overrides only a few phrases like "yihuir" to er5, covered by the
          // phrase overrides); pinyin-pro marks it neutral (er0). Restore
          // pypinyin's convention.
          const normalized = effective.map((syllable) => (syllable === 'er0' ? 'er2' : syllable));
          for (let index = 0; index < normalized.length; index += 1) {
            const pair = index > 0 ? chunk.slice(index - 1, index + 1) : '';
            const fused = GOLD_TRAINED_MODEL ? ERHUA_PAIRS[pair] : undefined;
            if (fused) {
              // Replace the base char's token with the fused reading and drop
              // the standalone er syllable, mirroring the Python frontend.
              const fusedIpa = syllableToIpa(fused);
              if (
                fusedIpa &&
                [...fusedIpa].every((character) => allowed.has(character)) &&
                tokens.length > 0
              ) {
                tokens[tokens.length - 1] = fusedIpa;
              }
              continue;
            }
            const ipa = syllableToIpa(normalized[index]);
            if (ipa && [...ipa].every((character) => allowed.has(character))) tokens.push(ipa);
          }
        }
      } else if (HAS_LATIN.test(chunk)) {
        const ipa = englishToIpa(chunk);
        if (ipa) {
          // Keep whatever the inventory supports instead of discarding the whole
          // span: one unexpected symbol used to silence an entire English clause.
          const dropped = [...new Set([...ipa])].filter(
            (character) => character !== ' ' && !allowed.has(character),
          );
          if (dropped.length > 0) {
            console.warn('English IPA symbols not in the model inventory (dropped):', dropped);
          }
          const kept = [...ipa]
            .filter((character) => character === ' ' || allowed.has(character))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (kept) tokens.push(kept);
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
