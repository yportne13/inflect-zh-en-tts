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

/**
 * Erhua char-pairs mined from the DataBaker gold annotations — keep in sync
 * with ERHUA_PAIRS in scripts/zh_frontend_ipa.py. "X儿" is actually pronounced
 * as one fused syllable [Xɻ]; e.g. 婴儿/女儿 are NOT listed and stay two
 * syllables. Only applied for gold-trained models (GOLD_TRAINED_MODEL).
 */
export const ERHUA_PAIRS: Record<string, string> = {
  会儿: 'huir4', 点儿: 'dianr3', 那儿: 'nar4', 事儿: 'shir4',
  劲儿: 'jinr4', 们儿: 'menr5', 特儿: 'ter4', 汉儿: 'hanr4',
  哪儿: 'nar3', 孩儿: 'hair2', 意儿: 'yir4', 这儿: 'zher4',
  玩儿: 'wanr2', 个儿: 'ger4', 范儿: 'fanr4', 味儿: 'weir4',
  门儿: 'menr2', 妇儿: 'fur4', 块儿: 'kuair4', 准儿: 'zhunr3',
  词儿: 'cir2', 摊儿: 'tanr1', 气儿: 'qir4', 道儿: 'daor4',
  院儿: 'yuanr4', 盹儿: 'dunr3', 俩儿: 'liar3', 根儿: 'genr1',
  明儿: 'mingr2', 堆儿: 'duir1', 眼儿: 'yanr3', 底儿: 'dir3',
  家儿: 'jiar1', 弯儿: 'wanr1', 鸡儿: 'jir1', 刃儿: 'renr4',
  皮儿: 'pir2', 棍儿: 'gunr4', 景儿: 'jingr3', 朵儿: 'duor3',
  礼儿: 'lir3', 头儿: 'tour2', 烂儿: 'lanr4', 对儿: 'duir4',
  格儿: 'ger2', 板儿: 'banr3', 枣儿: 'zaor3', 伙儿: 'huor3',
  欢儿: 'huanr1', 檐儿: 'yanr2', 法儿: 'far2', 天儿: 'tianr1',
  主儿: 'zhur3', 同儿: 'tongr4', 影儿: 'yingr3', 盖儿: 'gair4',
  活儿: 'huor2', 样儿: 'yangr4', 地儿: 'dir4', 妥儿: 'tuor3',
  核儿: 'her2', 妞儿: 'niur1',
};

/** IPA for a tone-less pinyin body: 'zhang' -> 'ʈʂaŋ', 'wan' -> 'uan'. */
function baseIpa(base: string): string {
  if (base in Y_W_TABLE) return Y_W_TABLE[base];
  if (base in SYLLABIC_NASALS) return SYLLABIC_NASALS[base];
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
  return `${ipaInitial}${ipaFinal}`;
}

/**
 * Convert one pinyin syllable such as `zhang3` into IPA plus its tone digit.
 * Handles gold-standard erhua fusion ('nar3' -> 'naɻ3'); 'er' itself is a
 * plain rime, not erhua.
 */
export function syllableToIpa(syllable: string): string {
  const match = syllable.match(/([0-5])$/);
  // pinyin-pro writes the neutral tone as 0; the model was trained with 5.
  const tone = !match ? '5' : match[1] === '0' ? '5' : match[1];
  const base = (match ? syllable.slice(0, match.index) : syllable)
    .replace(/ü/g, 'v')
    .replace(/u:/g, 'v')
    .toLowerCase();

  if (base.endsWith('r') && base !== 'er') {
    return `${baseIpa(base.slice(0, -1))}ɻ${tone}`;
  }
  return `${baseIpa(base)}${tone}`;
}
