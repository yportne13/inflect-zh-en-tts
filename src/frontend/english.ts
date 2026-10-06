/**
 * English part of the bilingual frontend.
 *
 * The model consumes eSpeak-style IPA, but eSpeak cannot run in the browser, so
 * we approximate it: CMUdict gives ARPAbet, which we map onto the same IPA
 * alphabet (including eSpeak's length marks and stress placement). Out-of-dict
 * words fall back to a small letter-to-sound table.
 */

type Dict = Record<string, string>;

/**
 * The CMU dictionary is ~4.6 MB, so it is code-split and fetched on demand
 * instead of being bundled into the main chunk. VITE_DICTIONARY_URL points that
 * fetch at a CDN; it must serve the package as an ES module with CORS.
 */
const DICTIONARY_URL = import.meta.env.VITE_DICTIONARY_URL as string | undefined;

let dictionary: Dict | null = null;

export async function loadDictionary(): Promise<void> {
  if (dictionary) return;
  const module: { dictionary: Dict } = DICTIONARY_URL
    ? await import(/* @vite-ignore */ DICTIONARY_URL)
    : await import('cmu-pronouncing-dictionary');
  dictionary = module.dictionary;
}

/** Stressed/unstressed IPA for each ARPAbet phone, matching eSpeak's choices. */
const ARPABET: Record<string, { stressed: string; unstressed: string }> = {
  AA: { stressed: 'ɑː', unstressed: 'ɑ' },
  AE: { stressed: 'æ', unstressed: 'æ' },
  AH: { stressed: 'ʌ', unstressed: 'ə' },
  AO: { stressed: 'ɔː', unstressed: 'ɔ' },
  AW: { stressed: 'aʊ', unstressed: 'aʊ' },
  AY: { stressed: 'aɪ', unstressed: 'aɪ' },
  B: { stressed: 'b', unstressed: 'b' },
  CH: { stressed: 'tʃ', unstressed: 'tʃ' },
  D: { stressed: 'd', unstressed: 'd' },
  DH: { stressed: 'ð', unstressed: 'ð' },
  EH: { stressed: 'ɛ', unstressed: 'ɛ' },
  ER: { stressed: 'ɜː', unstressed: 'ɚ' },
  EY: { stressed: 'eɪ', unstressed: 'eɪ' },
  F: { stressed: 'f', unstressed: 'f' },
  G: { stressed: 'ɡ', unstressed: 'ɡ' },
  HH: { stressed: 'h', unstressed: 'h' },
  IH: { stressed: 'ɪ', unstressed: 'ɪ' },
  IY: { stressed: 'iː', unstressed: 'i' },
  JH: { stressed: 'dʒ', unstressed: 'dʒ' },
  K: { stressed: 'k', unstressed: 'k' },
  L: { stressed: 'l', unstressed: 'l' },
  M: { stressed: 'm', unstressed: 'm' },
  N: { stressed: 'n', unstressed: 'n' },
  NG: { stressed: 'ŋ', unstressed: 'ŋ' },
  OW: { stressed: 'oʊ', unstressed: 'oʊ' },
  OY: { stressed: 'ɔɪ', unstressed: 'ɔɪ' },
  P: { stressed: 'p', unstressed: 'p' },
  R: { stressed: 'ɹ', unstressed: 'ɹ' },
  S: { stressed: 's', unstressed: 's' },
  SH: { stressed: 'ʃ', unstressed: 'ʃ' },
  T: { stressed: 't', unstressed: 't' },
  TH: { stressed: 'θ', unstressed: 'θ' },
  UH: { stressed: 'ʊ', unstressed: 'ʊ' },
  UW: { stressed: 'uː', unstressed: 'u' },
  V: { stressed: 'v', unstressed: 'v' },
  W: { stressed: 'w', unstressed: 'w' },
  Y: { stressed: 'j', unstressed: 'j' },
  Z: { stressed: 'z', unstressed: 'z' },
  ZH: { stressed: 'ʒ', unstressed: 'ʒ' },
};

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

/** Crude letter-to-sound fallback for words missing from CMUdict. */
const FALLBACK: Array<[RegExp, string]> = [
  [/^tch/, 'tʃ'],
  [/^ch/, 'tʃ'],
  [/^sh/, 'ʃ'],
  [/^th/, 'θ'],
  [/^ph/, 'f'],
  [/^wh/, 'w'],
  [/^qu/, 'kw'],
  [/^ck/, 'k'],
  [/^ng/, 'ŋ'],
  [/^ee/, 'iː'],
  [/^oo/, 'uː'],
  [/^ou/, 'aʊ'],
  [/^ow/, 'oʊ'],
  [/^ai/, 'eɪ'],
  [/^ay/, 'eɪ'],
  [/^oi/, 'ɔɪ'],
  [/^oy/, 'ɔɪ'],
  [/^ar/, 'ɑːɹ'],
  [/^er/, 'ɜːɹ'],
  [/^ir/, 'ɜːɹ'],
  [/^or/, 'ɔːɹ'],
];

const LETTER_IPA: Record<string, string> = {
  a: 'æ',
  b: 'b',
  c: 'k',
  d: 'd',
  e: 'ɛ',
  f: 'f',
  g: 'ɡ',
  h: 'h',
  i: 'ɪ',
  j: 'dʒ',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  o: 'ɔ',
  p: 'p',
  q: 'k',
  r: 'ɹ',
  s: 's',
  t: 't',
  u: 'ʌ',
  v: 'v',
  w: 'w',
  x: 'ks',
  y: 'i',
  z: 'z',
};

function letterToSound(word: string): string {
  let rest = word.toLowerCase().replace(/[^a-z]/g, '');
  let out = '';
  while (rest.length > 0) {
    const rule = FALLBACK.find(([pattern]) => pattern.test(rest));
    if (rule) {
      out += rule[1];
      rest = rest.replace(rule[0], '');
      continue;
    }
    const character = rest[0];
    out += LETTER_IPA[character] ?? '';
    rest = rest.slice(1);
  }
  return out;
}

function arpabetToIpa(pronunciation: string): string {
  const phones = pronunciation.trim().split(/\s+/);
  let out = '';
  phones.forEach((phone) => {
    if (!phone) return;
    const stress = phone.match(/[012]$/)?.[0] ?? '0';
    const base = phone.replace(/[012]$/, '');
    const entry = ARPABET[base];
    if (!entry) return;
    const ipa = stress === '1' || stress === '2' ? entry.stressed : entry.unstressed;
    if (VOWELS.has(base) && stress === '1') out += `ˈ${ipa}`;
    else if (VOWELS.has(base) && stress === '2') out += `ˌ${ipa}`;
    else out += ipa;
  });
  return out;
}

/** Convert one English word (or contraction) into IPA. */
export function wordToIpa(word: string): string {
  const key = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!key) return '';
  const entry = dictionary?.[key];
  if (entry) {
    const ipa = arpabetToIpa(entry);
    if (ipa) return ipa;
  }
  return letterToSound(key);
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Spell Arabic numerals digit by digit ("9.36" -> "nine point three six").
 * The model has no emoji/numeral training, but spelled digits are ordinary
 * words, so this stays in distribution and avoids silently dropping numbers.
 */
export function spellDigits(text: string): string {
  return text.replace(/\d+(?:[.,]\d+)*/g, (run) =>
    run
      .split('')
      .map((character) => (/\d/.test(character) ? DIGIT_WORDS[Number(character)] : ' point '))
      .join(' '),
  );
}

/** Phonemize a run of English text: words separated by spaces. */
export function englishToIpa(text: string): string {
  const words = spellDigits(text).match(/[A-Za-z][A-Za-z']*/g) ?? [];
  return words
    .map((word) => wordToIpa(word))
    .filter((ipa) => ipa.length > 0)
    .join(' ');
}
