/**
 * Verify the browser half of the stochastic acoustic model: the ONNX graph runs
 * the velocity field, the Euler loop lives in JS. This executes that exact split
 * under onnxruntime-web (the browser runtime) and compares against PyTorch's own
 * sampler on identical inputs -- same initial noise, same step count -- so a
 * mismatch means the JS integration or the graph is wrong, not that sampling is
 * stochastic.
 *
 * Usage: node scripts/check-flow-sampler.mjs <velocity.onnx> <dump-dir>
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
  console.error('usage: node scripts/check-flow-sampler.mjs <velocity.onnx> <dump-dir>');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(join(dumpDir, 'meta.json'), 'utf8'));
const readF32 = (name) => {
  const b = readFileSync(join(dumpDir, name));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const readI64 = (name) => {
  const b = readFileSync(join(dumpDir, name));
  return new BigInt64Array(b.buffer, b.byteOffset, b.byteLength / 8);
};

const { frames, text_len: textLen, steps } = meta;
const x0 = readF32('x0.f32').slice();          // [frames, 100] flattened
const tokens = readI64('tokens.i64');
const durations = readI64('durations.i64');
const ref = readF32('ref_mel.f32');
console.log(`case          : ${meta.id}  frames=${frames} text_len=${textLen} steps=${steps}`);

const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  executionProviders: ['wasm'],
});

let x = Float32Array.from(x0);
for (let k = 0; k < steps; k += 1) {
  const feeds = {
    x_t: new ort.Tensor('float32', x, [1, frames, 100]),
    t: new ort.Tensor('float32', Float32Array.of(k / steps), [1]),
    tokens: new ort.Tensor('int64', tokens, [1, textLen]),
    durations: new ort.Tensor('int64', durations, [1, textLen]),
  };
  const out = await session.run(feeds);
  const v = out.velocity.data;
  const next = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 1) next[i] = x[i] + v[i] / steps;
  x = next;
}

let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0, maxErr = 0, noise = 0, signal = 0;
for (let i = 0; i < x.length; i += 1) {
  const a = ref[i], b = x[i];
  sumA += a; sumB += b; sumAB += a * b; sumAA += a * a; sumBB += b * b;
  maxErr = Math.max(maxErr, Math.abs(a - b));
  noise += (a - b) ** 2;
  signal += a * a;
}
const corr = (x.length * sumAB - sumA * sumB) /
  Math.sqrt((x.length * sumAA - sumA * sumA) * (x.length * sumBB - sumB * sumB));
const snr = 10 * Math.log10(signal / Math.max(noise, 1e-30));
const finite = x.every(Number.isFinite);
console.log(`mel shape     : ${x.length} values (${frames}x100)`);
console.log(`all finite    : ${finite}`);
console.log(`correlation   : ${corr.toFixed(9)}   (vs PyTorch sampler, identical x0)`);
console.log(`max abs error : ${maxErr.toExponential(3)}`);
console.log(`SNR           : ${snr.toFixed(2)} dB`);
const ok = finite && corr > 0.9999 && maxErr < 1e-3;
console.log(ok ? 'PASS (JS Euler loop + ONNX velocity field match PyTorch)'
               : 'FAIL');
process.exit(ok ? 0 : 1);
