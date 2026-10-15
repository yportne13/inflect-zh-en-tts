/**
 * Verify the demo page's exact inference path against PyTorch, without a browser.
 *
 * The page is the Vite entry `vocoder.html` (it imports onnxruntime-web so the
 * runtime WASM gets bundled as a same-origin asset, exactly like the main app;
 * a purely static page could not do that because the repo gitignores
 * public/ort/). This script imports the same `vocoder-infer.mjs` the page does
 * and runs the same four mel dumps through the same fp16 ONNX graph under
 * onnxruntime-web (WASM), comparing with the reference waveforms Python produced
 * from the checkpoint. So the browser code path is covered by an automated check
 * even though no browser is available here.
 *
 * It also checks that every relative URL the page mentions resolves. Relative
 * matters: GitHub Pages serves the site from /inflect-zh-en-tts/, so an absolute
 * "/vocoder/..." would 404 in production while working on a local dev server.
 *
 * Usage: node scripts/check-vocoder-page.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { loadDump, renderMel } from '../public/vocoder/vocoder-infer.mjs';

ort.env.logLevel = 'error';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths =
  pathToFileURL(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist') + '/').href;

const root = join(process.cwd(), 'public', 'vocoder');
const manifest = JSON.parse(readFileSync(join(root, 'mel', 'manifest.json'), 'utf8'));
const modelPath = process.argv[2] ?? join(root, 'vocoder-fp16.onnx');

// page URLs are relative to the site root; static files live in public/, but a
// ref that already points at ./public/... is a source module Vite bundles
const toFs = (url) => url.startsWith('./public/')
  ? join(process.cwd(), url.slice(2))
  : join(process.cwd(), 'public', url.replace(/^\.\//, ''));
const html = readFileSync(join(process.cwd(), 'vocoder.html'), 'utf8');
const refs = [...html.matchAll(/['"`](\.{1,2}\/[^'"`]+)['"`]/g)].map((m) => m[1]);
const missing = [];
for (const ref of new Set(refs)) {
  if (ref.endsWith('/')) continue;                     // directory links (./ ./compare/)
  // template literals such as ./compare/audio/real/${item.id}.wav cannot be
  // resolved literally -- substitute a real sample id first
  const concrete = ref.replace(/\$\{[^}]+\}/g, manifest.items[0].id);
  if (!existsSync(toFs(concrete))) missing.push(ref);
}
console.log(`page refs     : ${new Set(refs).size} relative URL(s), missing=${missing.length}`
  + (missing.length ? ` -> ${missing.join(', ')}` : ''));
if (missing.length) process.exit(1);

const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  executionProviders: ['wasm'],
});
console.log(`model         : ${modelPath}`);

// the page fetches these with fetch(); in Node we shim fetch over the files
const origFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const bytes = readFileSync(join(process.cwd(), url));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

let worst = 1;
for (const item of manifest.items) {
  const mel = await loadDump(`public/vocoder/mel/${item.id}.f32`);
  const ref = await loadDump(`public/vocoder/mel/${item.id}.ref.f32`);
  if (mel.length !== item.frames * 100) throw new Error(`${item.id}: mel length ${mel.length}`);
  const { waveform, ms } = await renderMel(ort, session, mel, item.frames);
  if (waveform.length !== item.samples) {
    console.log(`${item.id}: FAIL length ${waveform.length} != ${item.samples}`);
    process.exit(1);
  }
  let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, maxErr = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const a = ref[i], b = waveform[i];
    sa += a; sb += b; sab += a * b; saa += a * a; sbb += b * b;
    maxErr = Math.max(maxErr, Math.abs(a - b));
  }
  const n = ref.length;
  const corr = (n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  const rms = Math.sqrt(waveform.reduce((s, v) => s + v * v, 0) / waveform.length);
  worst = Math.min(worst, corr);
  console.log(`${item.id}  frames=${String(item.frames).padStart(4)}  ${String(item.samples).padStart(7)} samples  `
    + `${ms.toFixed(0).padStart(4)} ms  rms=${rms.toFixed(4)} (ref ${item.rms.toFixed(4)})  `
    + `corr=${corr.toFixed(9)}  max_err=${maxErr.toExponential(2)}`);
}
globalThis.fetch = origFetch;
const ok = worst > 0.9999;
console.log(ok ? `PASS (page inference path matches PyTorch, worst corr ${worst.toFixed(9)})` : `FAIL (worst corr ${worst})`);
process.exit(ok ? 0 : 1);
