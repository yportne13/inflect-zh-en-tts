/** Convert Arabic numerals inside Mandarin text into their spoken form. */

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千'];
const BIG_UNITS = ['', '万', '亿'];

function sectionToChinese(section: number): string {
  const digits = String(section).split('').map(Number);
  let out = '';
  let zeroPending = false;
  for (let i = 0; i < digits.length; i += 1) {
    const digit = digits[i];
    const unit = UNITS[digits.length - 1 - i];
    if (digit === 0) {
      zeroPending = true;
      continue;
    }
    if (zeroPending && out.length > 0) out += '零';
    zeroPending = false;
    out += DIGITS[digit] + unit;
  }
  return out;
}

export function integerToChinese(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value);
  if (value === 0) return '零';

  const sections: number[] = [];
  let rest = value;
  while (rest > 0) {
    sections.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }

  let out = '';
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const section = sections[i];
    if (section === 0) {
      if (out && !out.endsWith('零')) out += '零';
      continue;
    }
    if (out && section < 1000 && !out.endsWith('零')) out += '零';
    out += sectionToChinese(section) + BIG_UNITS[i];
  }
  return out.replace(/^一十/, '十').replace(/零+$/, '');
}

function digitByDigit(value: string): string {
  return value
    .split('')
    .map((character) => (character === '.' ? '点' : DIGITS[Number(character)]))
    .join('');
}

/** Replace numbers with their reading; 4-digit years are read digit by digit. */
export function normalizeNumbers(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)(%?)/g, (match, digits: string, percent: string, offset: number) => {
    const after = text.slice(offset + match.length, offset + match.length + 1);
    if (percent) {
      return digits.includes('.')
        ? `百分之${digitByDigit(digits)}`
        : `百分之${integerToChinese(Number(digits))}`;
    }
    if (after === '年' && /^\d{4}$/.test(digits)) return digitByDigit(digits);
    if (digits === '0' && after === '点') return '零';
    if (digits.includes('.')) return digitByDigit(digits);
    return integerToChinese(Number(digits));
  });
}
