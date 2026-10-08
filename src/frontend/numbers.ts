/** Convert Arabic numerals inside Mandarin text into their spoken form. */

const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千'];
const BIG_UNITS = ['', '万', '亿', '万亿']; // covers up to 10^16 - 1

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

/**
 * Read a non-negative integer the way cn2an does: 26 -> 二十六, 10005 -> 一万零五.
 * Returns the original decimal string when the value is out of the safe range
 * (>= 1e16, where Number precision fails) so callers can read it digit by digit.
 */
export function integerToChinese(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `负${integerToChinese(-value)}`;
  if (value === 0) return '零';
  if (value >= 1e16) return String(value);

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

/**
 * Read a decimal string like cn2an: the integer part as a whole number and the
 * fractional part digit by digit (26.5 -> 二十六点五). Out-of-range integer
 * parts fall back to digit-by-digit.
 */
function decimalToChinese(digits: string): string {
  const [whole, frac] = digits.split('.');
  const wholeRead = integerToChinese(Number(whole));
  const wholePart = wholeRead === String(Number(whole)) ? digitByDigit(whole) : wholeRead;
  return `${wholePart}点${digitByDigit(frac)}`;
}

/** Replace numbers with their reading; 4-digit years are read digit by digit. */
export function normalizeNumbers(text: string): string {
  const withNegative = text.replace(/(?<!\d)-(\d+(?:\.\d+)?)/g, '负$1');
  return withNegative.replace(/(\d+(?:\.\d+)?)(%?)/g, (match, digits: string, percent: string, offset: number) => {
    const after = text.slice(offset + match.length, offset + match.length + 1);
    if (percent) {
      return digits.includes('.') ? `百分之${decimalToChinese(digits)}` : `百分之${integerToChinese(Number(digits))}`;
    }
    if (after === '年' && /^\d{4}$/.test(digits)) return digitByDigit(digits);
    if (digits === '0' && after === '点') return '零';
    if (digits.includes('.')) return decimalToChinese(digits);
    const value = Number(digits);
    const read = integerToChinese(value);
    return read === String(value) ? digitByDigit(digits) : read;
  });
}
