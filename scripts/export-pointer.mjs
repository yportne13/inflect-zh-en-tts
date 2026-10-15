/**
 * Single source of truth for "which exported graph is the SHIPPED one".
 *
 * This project has now shipped the wrong graph five separate times, always the
 * same way: a script hardcodes an export directory, someone re-exports to a new
 * directory, and the check keeps validating the OLD graph while reporting PASS.
 * `exports/vocoder-current.json` was introduced as the pointer that fixes it, but
 * the demo's npm checks still hardcoded `vocoder-vc1-onnx`, so `npm run
 * check:vocoder` was happily validating the superseded 6.7M model.
 *
 * Any check that needs the shipped vocoder should pass the literal string
 * `current` instead of a path; this module turns that into the real file and
 * fails loudly (rather than silently falling back) when the pointer is missing or
 * names a directory that does not exist.
 *
 * Override for one-off experiments: set INFLECT_VOCODER_ONNX.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

function readPointer(kind) {
  const pointer = join(REPO, 'exports', `${kind}-current.json`);
  if (!existsSync(pointer)) {
    throw new Error(
      `no ${kind} export pointer at ${pointer}; run scripts/publish_vocoder.ps1 `
      + `(or pass an explicit graph path instead of "current")`);
  }
  // PowerShell writes a BOM, so strip it before JSON.parse
  return JSON.parse(readFileSync(pointer, 'utf8').replace(/^\uFEFF/, ''));
}

export function resolveExportDir(kind) {
  const raw = readPointer(kind);
  const dir = isAbsolute(raw.dir) ? raw.dir : join(REPO, raw.dir);
  if (!existsSync(dir)) throw new Error(`${kind} pointer names a missing dir: ${dir}`);
  return dir;
}

export function resolveVocoderOnnx(name = 'vocoder.onnx') {
  if (process.env.INFLECT_VOCODER_ONNX) return process.env.INFLECT_VOCODER_ONNX;
  const path = join(resolveExportDir('vocoder'), name);
  if (!existsSync(path)) throw new Error(`vocoder pointer resolved to a missing graph: ${path}`);
  return path;
}

/** `current` -> the shipped graph, anything else -> the literal path. */
export function graphArg(value, fallback) {
  if (!value) return fallback;
  if (value !== 'current') return value;
  return resolveVocoderOnnx(process.env.INFLECT_VOCODER_FP16 ? 'vocoder-fp16.onnx' : 'vocoder.onnx');
}

export function describeShippedVocoder() {
  const raw = readPointer('vocoder');
  return `step ${raw.step} (${raw.dir})`;
}
