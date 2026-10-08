/**
 * English part of the bilingual frontend.
 *
 * The model was trained on eSpeak NG en-us IPA, but eSpeak cannot run in the
 * browser. Earlier this file approximated it with CMUdict -> ARPAbet -> a
 * hand-written IPA table; measured against the training frontend that
 * approximation disagreed on 18.6% of phone characters and only 21.3% of words
 * came out identical, i.e. the browser fed the model a different input
 * distribution than it had learned.
 *
 * Instead we now ship the real thing: `public/en-lexicon.txt` is generated
 * offline by `scripts/build_en_lexicon.py` using the *same* eSpeak backend as
 * `scripts/bilingual_frontend_ipa.py`, plus overrides mined from connected
 * speech (eSpeak reduces function words in context: `in` -> ɪn, `a` -> ɐ).
 * That brings the disagreement down to 5.0% of phone characters and 50.6% of
 * words on the held-out benchmark.
 *
 * Words missing from the lexicon fall back to a small letter-to-sound table.
 */

type Lexicon = Map<string, string>;

let lexicon: Lexicon | null = null;

/** Words the lexicon could not resolve during the last phonemize() call. */
const unresolved = new Set<string>();
export function unresolvedWords(): string[] {
  return [...unresolved];
}

/**
 * Install a lexicon from raw `word\tIPA` text. Split out from `loadLexicon` so
 * Node-based checks (demo/scripts/verify-frontend.ts) can read the asset from
 * disk instead of over HTTP.
 */
export function installLexicon(text: string): number {
  const table: Lexicon = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    // trimEnd() guards against CRLF assets: a stray \r would make every IPA
    // string contain an unknown symbol and silence the whole English side.
    table.set(line.slice(0, tab), line.slice(tab + 1).trimEnd());
  }
  if (table.size === 0) throw new Error('lexicon parsed to zero entries');
  lexicon = table;
  return table.size;
}

/**
 * Fetch and parse the pronunciation lexicon. The asset is ~3.1 MB of
 * `word\tIPA` lines, smaller than the CMUdict package it replaces, and is only
 * fetched when the input actually contains Latin text.
 *
 * `VITE_LEXICON_URL` points that fetch at a CDN/mirror instead of this origin,
 * which matters on mainland-China networks (same pattern as VITE_MODEL_BASE /
 * VITE_ORT_BASE). It is resolved inside the function on purpose: the Node-based
 * golden check only calls installLexicon(), so the Vite-only `import.meta.env`
 * expression is never evaluated outside a browser build.
 */
export async function loadLexicon(url?: string): Promise<void> {
  if (lexicon) return;
  const configured = url ?? (import.meta.env.VITE_LEXICON_URL as string | undefined);
  // A mirror is an optimisation, never a single point of failure: fall back to
  // the copy Vite ships on this origin if it is unreachable.
  const candidates = configured ? [configured, 'en-lexicon.txt'] : ['en-lexicon.txt'];
  let lastError: unknown = null;
  for (const target of candidates) {
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      installLexicon(await response.text());
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Failed to load the English lexicon (tried ${candidates.join(', ')}): ${String(lastError)}`,
  );
}

export function lexiconSize(): number {
  return lexicon?.size ?? 0;
}

/** Crude letter-to-sound fallback for words missing from the lexicon. */
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

/** Convert one English word (or contraction) into eSpeak IPA. */
export function wordToIpa(word: string): string {
  const key = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!key) return '';
  const entry = lexicon?.get(key);
  if (entry) return entry;
  unresolved.add(key);
  return letterToSound(key);
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
const ORDINAL_ONES = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth',
  'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth',
  'seventieth', 'eightieth', 'ninetieth'];

function under1000(value: number): string[] {
  const words: string[] = [];
  if (value >= 100) {
    words.push(ONES[Math.floor(value / 100)], 'hundred');
    value %= 100;
  }
  if (value >= 20) {
    words.push(TENS[Math.floor(value / 10)]);
    value %= 10;
  }
  if (value > 0) words.push(ONES[value]);
  return words;
}

/** Cardinal spelling of a non-negative integer, e.g. 359 -> "three hundred fifty nine". */
function cardinal(digits: string): string[] {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed === '0') return ['zero'];
  const groups: string[] = [];
  for (let end = trimmed.length; end > 0; end -= 3) {
    groups.unshift(trimmed.slice(Math.max(0, end - 3), end));
  }
  const words: string[] = [];
  groups.forEach((group, position) => {
    const value = Number(group);
    if (value === 0) return;
    words.push(...under1000(value));
    const scale = SCALES[groups.length - 1 - position];
    if (scale) words.push(scale);
  });
  return words;
}

/** Ordinal spelling, e.g. 21 -> "twenty first", 12 -> "twelfth". */
function ordinal(value: number): string[] {
  if (value < 20) return [ORDINAL_ONES[value]];
  const tens = Math.floor(value / 10);
  const rest = value % 10;
  if (rest === 0) return [ORDINAL_TENS[tens]];
  return [TENS[tens], ORDINAL_ONES[rest]];
}

const PUNCTUATION = new Set([...'.,!?;:\'"-()[]{}—…«»']);

const NUMBER = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|st|nd|rd|th)?/gi;

/**
 * Expand numbers the way eSpeak does, so the browser matches the training
 * distribution: `359.9` -> "three hundred fifty nine point nine",
 * `50%` -> "fifty percent", `12,345` -> "twelve thousand three hundred forty
 * five", `1st` -> "first". The previous implementation read digits one at a
 * time ("three five nine"), which is not what the model was trained on.
 */
export function spellNumbers(text: string): string {
  return text.replace(NUMBER, (_match, integer: string, fraction?: string, suffix?: string) => {
    const bare = integer.replace(/,/g, '');
    const lower = (suffix ?? '').toLowerCase();
    let words: string[];
    if (lower && lower !== '%') {
      words = ordinal(Number(bare));
    } else {
      words = cardinal(bare);
      if (fraction) {
        words.push('point');
        for (const digit of fraction) words.push(ONES[Number(digit)]);
      }
      if (lower === '%') words.push('percent');
    }
    return ` ${words.join(' ')} `;
  });
}

/**
 * Phonemize a run of English text, preserving punctuation in place.
 *
 * Punctuation is a real input token to this model (the training frontend runs
 * eSpeak with `preserve_punctuation=True`), and it drives prosody. The earlier
 * version extracted only `[A-Za-z']` runs, so commas and full stops inside a
 * Latin span were silently dropped.
 */
export function englishToIpa(text: string): string {
  const expanded = spellNumbers(text);
  let out = '';
  for (const piece of expanded.match(/[A-Za-z][A-Za-z']*|[^A-Za-z]+/g) ?? []) {
    if (/[A-Za-z]/.test(piece)) {
      const ipa = wordToIpa(piece);
      if (ipa) out += (out ? ' ' : '') + ipa;
      continue;
    }
    // eSpeak attaches punctuation to the preceding word ("wˈɜːld,"), so append
    // without a separator instead of emitting a standalone token.
    for (const character of piece) {
      if (character !== ' ' && PUNCTUATION.has(character)) out += character;
    }
  }
  return out;
}
