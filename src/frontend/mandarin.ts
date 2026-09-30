/**
 * Mandarin part of the bilingual frontend.
 *
 * Mirrors the Python frontend the model was trained with: pinyin (with tone)
 * -> IPA initial + IPA final + tone digit, one syllable per token.
 */

const IPA_INITIALS: Record<string, string> = {
  b: 'p',
  p: 'pʰ',
  m: 'm',
  f: 'f',
  d: 't',
  t: 'tʰ',
  n: 'n',
  l: 'l',
  g: 'k',
  k: 'kʰ',
  h: 'x',
  j: 'tɕ',
  q: 'tɕʰ',
  x: 'ɕ',
  zh: 'ʈʂ',
  ch: 'ʈʂʰ',
  sh: 'ʂ',
  r: 'ʐ',
  z: 'ts',
  c: 'tsʰ',
  s: 's',
  '': '',
};

const IPA_FINALS: Record<string, string> = {
  a: 'a',
  o: 'o',
  e: 'ɤ',
  ê: 'ɛ',
  i: 'i',
  u: 'u',
  v: 'y',
  er: 'ɚ',
  ai: 'ai',
  ei: 'ei',
  ao: 'au',
  ou: 'ou',
  an: 'an',
  en: 'ən',
  ang: 'aŋ',
  eng: 'əŋ',
  ong: 'uŋ',
  ia: 'ia',
  io: 'yo',
  ie: 'iɛ',
  iao: 'iau',
  iu: 'iou',
  ian: 'iɛn',
  in: 'in',
  iang: 'iaŋ',
  ing: 'iŋ',
  iong: 'iuŋ',
  ua: 'ua',
  uo: 'uo',
  uai: 'uai',
  ui: 'uei',
  uan: 'uan',
  un: 'uən',
  uang: 'uaŋ',
  ueng: 'uəŋ',
  ve: 'yɛ',
  van: 'yɛn',
  vn: 'yn',
};

/** y-/w- spellings map whole-syllable; they do not split into initial+final. */
const Y_W_TABLE: Record<string, string> = {
  yi: 'i',
  ya: 'ia',
  yo: 'io',
  ye: 'iɛ',
  yao: 'iau',
  you: 'iou',
  yan: 'iɛn',
  yin: 'in',
  yang: 'iaŋ',
  ying: 'iŋ',
  yong: 'iuŋ',
  yu: 'y',
  yue: 'yɛ',
  yuan: 'yɛn',
  yun: 'yn',
  wu: 'u',
  wa: 'ua',
  wo: 'uo',
  wai: 'uai',
  wei: 'uei',
  wan: 'uan',
  wen: 'uən',
  wang: 'uaŋ',
  weng: 'uəŋ',
};

const SYLLABIC_NASALS: Record<string, string> = { n: 'n', ng: 'ŋ', m: 'm' };

const INITIAL_KEYS = Object.keys(IPA_INITIALS)
  .filter((key) => key.length > 0)
  .sort((a, b) => b.length - a.length);

/** After these initials an orthographic "i" is the apical vowel [ɨ]. */
const APICAL = new Set(['z', 'c', 's', 'zh', 'ch', 'sh', 'r']);
const LABIAL = new Set(['b', 'p', 'm', 'f']);

function splitSyllable(base: string): [string, string] {
  for (const initial of INITIAL_KEYS) {
    if (base.startsWith(initial)) {
      let final = base.slice(initial.length);
      if (['j', 'q', 'x'].includes(initial) && final.startsWith('u')) {
        final = 'v' + final.slice(1);
      }
      return [initial, final];
    }
  }
  return ['', base];
}

/** Convert one pinyin syllable such as `zhang3` into IPA plus its tone digit. */
export function syllableToIpa(syllable: string): string {
  const match = syllable.match(/([0-5])$/);
  // pinyin-pro writes the neutral tone as 0; the model was trained with 5.
  const tone = !match ? '5' : match[1] === '0' ? '5' : match[1];
  const base = (match ? syllable.slice(0, match.index) : syllable)
    .replace(/ü/g, 'v')
    .replace(/u:/g, 'v')
    .toLowerCase();

  if (base in Y_W_TABLE) return `${Y_W_TABLE[base]}${tone}`;
  if (base in SYLLABIC_NASALS) return `${SYLLABIC_NASALS[base]}${tone}`;

  const [initial, final] = splitSyllable(base);
  const ipaInitial = IPA_INITIALS[initial] ?? '';
  let ipaFinal: string;
  if (APICAL.has(initial) && final === 'i') {
    ipaFinal = 'ɨ';
  } else if (LABIAL.has(initial) && final === 'o') {
    ipaFinal = 'uo';
  } else {
    ipaFinal = IPA_FINALS[final] ?? '';
  }
  return `${ipaInitial}${ipaFinal}${tone}`;
}
