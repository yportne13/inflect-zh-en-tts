/**
 * Verify OUR trained vocoder (mel -> waveform) under the exact runtime the
 * browser uses: onnxruntime-web's WASM backend.
 *
 * `check-onnx-fp16.mjs` does this for the shipped VITS decode graph; the
 * two-stage rebuild needs the same evidence for the new vocoder, because a graph
 * that only runs under Python's onnxruntime is not a browser deliverable.
 *
 * Input is a REAL 100-band log-mel (hz-001 from the shared cache) and the
 * reference output comes from Python onnxruntime on the same file, so this is a
 * cross-runtime parity check rather than a self-consistency check.
 *
 * Usage: node scripts/check-vocoder-onnx.mjs <vocoder.onnx> <dump-dir>
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';

ort.env.logLevel = 'error';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths =
  pathToFileURL(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist') + '/').href;

const modelPath = process.argv[2];
const dumpDir = process.argv[3];
if (!modelPath || !dumpDir) {
  console.error('usage: node scripts/check-vocoder-onnx.mjs <vocoder.onnx> <dump-dir>');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(join(dumpDir, 'meta.json'), 'utf8'));
const melBytes = readFileSync(join(dumpDir, 'mel.f32'));
const refBytes = readFileSync(join(dumpDir, 'ref_wave.f32'));
const mel = new Float32Array(melBytes.buffer, melBytes.byteOffset, melBytes.byteLength / 4);
const ref = new Float32Array(refBytes.buffer, refBytes.byteOffset, refBytes.byteLength / 4);
console.log(`case          : ${meta.id}  mel ${meta.mel_shape} -> wave ${meta.wave_shape}`);

const modelBytes = readFileSync(modelPath);
const session = await ort.InferenceSession.create(modelBytes, {
  executionProviders: ['wasm'],
});
const feeds = { mel: new ort.Tensor('float32', mel, meta.mel_shape) };
const out = await session.run(feeds);
const tensor = out.waveform;
const raw = tensor.data;
const got = tensor.type === 'float32' ? Float32Array.from(raw) : null;
if (!got) {
  console.error(`FAIL: unexpected output type ${tensor.type}`);
  process.exit(1);
}
console.log(`output        : type=${tensor.type} dims=${JSON.stringify(tensor.dims)} samples=${got.length}`);

const n = Math.min(got.length, ref.length);
let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0, maxErr = 0, noise = 0, signal = 0;
for (let i = 0; i < n; i += 1) {
  const a = ref[i], b = got[i];
  sumA += a; sumB += b; sumAB += a * b; sumAA += a * a; sumBB += b * b;
  maxErr = Math.max(maxErr, Math.abs(a - b));
  noise += (a - b) ** 2;
  signal += a * a;
}
const corr = (n * sumAB - sumA * sumB) / Math.sqrt((n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB));
const snr = 10 * Math.log10(signal / Math.max(noise, 1e-30));
const finite = got.every(Number.isFinite);
const peak = Math.max(...got.map(Math.abs));
console.log(`length        : ort-web ${got.length} vs python ${ref.length} ${got.length === ref.length ? '(match)' : '(MISMATCH)'}`);
console.log(`all finite    : ${finite}`);
console.log(`peak          : ${peak.toFixed(4)} (python ${Math.max(...ref.map(Math.abs)).toFixed(4)})`);
console.log(`correlation   : ${corr.toFixed(9)}`);
console.log(`max abs error : ${maxErr.toExponential(3)}`);
console.log(`SNR           : ${snr.toFixed(2)} dB`);
// The absolute tolerance has to scale with the signal: an fp16 graph quantises
// proportionally to amplitude, so a fixed 1e-3 flips PASS/FAIL purely because a
// newer checkpoint happens to output louder audio (observed 6.8e-4 -> 1.1e-3
// with peak 0.37 -> 0.50, correlation unchanged at 0.999999).
const tol = Math.max(1e-3, 0.01 * peak);
const ok = finite && got.length === ref.length && corr > 0.9999 && maxErr < tol;
console.log(ok ? `PASS (runs under ort-web wasm with cross-runtime parity; tol ${tol.toExponential(1)})`
               : `FAIL (tol ${tol.toExponential(1)})`);
process.exit(ok ? 0 : 1);
