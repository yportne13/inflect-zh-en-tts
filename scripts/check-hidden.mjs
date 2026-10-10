/**
 * Guard the `hidden` attribute against class rules that set their own display.
 *
 * This is a regression check for a real bug: `.progress { display: flex }`
 * silently overrode the user-agent `display: none` that `[hidden]` provides, so
 * `hideProgress()` set the attribute while the panel stayed on screen, spinning
 * "计算中，请稍候…" under the finished audio. The attribute selector and a class
 * selector have equal specificity, so the guard only works because it carries
 * `!important` - which is what this asserts, rather than merely that the rule
 * exists.
 *
 * Run: node scripts/check-hidden.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Comments are stripped first: the prose in this very file mentions selector
// names inside backticks, and a brace inside a comment would break the matcher.
const cssSource = readFileSync(join('src', 'styles.css'), 'utf8');
const css = process.env.CHECK_HIDDEN_CSS
  ? process.env.CHECK_HIDDEN_CSS
  : cssSource.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
  const pattern = new RegExp(
    `(?:^|\\})\\s*(?:[^{}]*?\\s)?${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'm',
  );
  const match = css.match(pattern);
  return match ? match[1].trim() : null;
}

const guard = ruleBody('[hidden]');
if (guard === null) {
  console.log('FAIL: no [hidden] rule in styles.css');
  process.exit(1);
}
if (!/display\s*:\s*none/.test(guard)) {
  console.log(`FAIL: [hidden] does not set display:none -> ${guard}`);
  process.exit(1);
}
if (!/!important/.test(guard)) {
  console.log(
    'FAIL: [hidden] lacks !important. An attribute selector and a class selector have equal\n' +
    '      specificity, so without it the later rule in the file wins and the element stays\n' +
    '      visible - which is the original bug.',
  );
  process.exit(1);
}

// Prove the guard is load-bearing: at least one displayed element uses `hidden`.
// Pass the raw selector; ruleBody does the escaping.
const progress = ruleBody('.progress');
if (progress === null || !/display\s*:\s*(flex|grid|block)/.test(progress)) {
  console.log('FAIL: .progress does not set a display value, so the guard is untested');
  process.exit(1);
}

// And prove the check can actually fail, so it is not vacuously green: a copy of
// the stylesheet without the guard must report FAIL.
const { execFileSync } = await import('node:child_process');
const broken = css.replace(/\s*!important/g, '');
try {
  const out = execFileSync(process.execPath, [import.meta.filename, '--selftest-broken'], {
    encoding: 'utf8',
    env: { ...process.env, CHECK_HIDDEN_CSS: broken },
  });
  console.log('FAIL: removing !important still passed ->', out.trim());
  process.exit(1);
} catch {
  /* expected: the broken stylesheet must fail */
}

console.log(`[hidden]  -> ${guard}`);
console.log(`.progress -> ${progress}`);
console.log('PASS (elements toggled with .hidden are actually hidden)');
