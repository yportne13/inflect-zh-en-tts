/**
 * End-to-end deployment check for the two-stage rebuild, executed in the browser
 * runtime (onnxruntime-web, WASM backend) and compared against PyTorch:
 *
 *   tokens + durations
 *     -> velocity.onnx            (the acoustic half, one graph call per step)
 *     -> 10-step Euler loop in JS  (kept out of the graph so steps stay tunable)
 *     -> denormalise with the training mel stats
 *     -> vocoder.onnx             (the vocoder half)
 *     -> 24 kHz waveform
 *
 * The flow is stochastic, so the initial noise is dumped from the Python run and
 * reused here: with identical x0 the whole chain must be numerically identical
 * up to float error. That isolates integration/graph bugs from sampling noise.
 *
 * Usage:
 *   node scripts/check-two-stage.mjs <velocity.onnx> <vocoder.onnx> <dump-dir>
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';

ort.env.logLevel = 'error';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths =
  pathToFileURL(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist') + '/').href;

const [velocityPath, vocoderPath, dumpDir] = process.argv.slice(2);
if (!velocityPath || !vocoderPath || !dumpDir) {
  console.error('usage: node scripts/check-two-stage.mjs <velocity.onnx> <vocoder.onnx> <dump-dir>');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(join(dumpDir, 'meta.json'), 'utf8'));
const readF32 = (n) => {
  const b = readFileSync(join(dumpDir, n));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const readI64 = (n) => {
  const b = readFileSync(join(dumpDir, n));
  return new BigInt64Array(b.buffer, b.byteOffset, b.byteLength / 8);
};

const { frames, text_len: textLen, steps, samples } = meta;
const tokens = readI64('tokens.i64');
const durations = readI64('durations.i64');
const melMean = readF32('mel_mean.f32');
const melStd = readF32('mel_std.f32');
const refMel = readF32('ref_mel.f32');
const refWave = readF32('ref_wave.f32');
console.log(`case        : ${meta.id}  frames=${frames} text_len=${textLen} steps=${steps}`);

const velocity = await ort.InferenceSession.create(readFileSync(velocityPath), {
  executionProviders: ['wasm'],
});
const vocoder = await ort.InferenceSession.create(readFileSync(vocoderPath), {
  executionProviders: ['wasm'],
});

// ---- acoustic half: ONNX velocity field + JS Euler loop ----
let x = readF32('x0.f32').slice();
for (let k = 0; k < steps; k += 1) {
  const out = await velocity.run({
    x_t: new ort.Tensor('float32', x, [1, frames, 100]),
    t: new ort.Tensor('float32', Float32Array.of(k / steps), [1]),
    tokens: new ort.Tensor('int64', tokens, [1, textLen]),
    durations: new ort.Tensor('int64', durations, [1, textLen]),
  });
  const v = out.velocity.data;
  const next = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 1) next[i] = x[i] + v[i] / steps;
  x = next;
}
// denormalise: per-band stats, [frames, 100]
for (let f = 0; f < frames; f += 1) {
  for (let b = 0; b < 100; b += 1) {
    const idx = f * 100 + b;
    x[idx] = x[idx] * melStd[b] + melMean[b];
  }
}

// ---- vocoder half: [1, 100, frames] -> waveform ----
const melForVocoder = new Float32Array(100 * frames);
for (let f = 0; f < frames; f += 1) {
  for (let b = 0; b < 100; b += 1) melForVocoder[b * frames + f] = x[f * 100 + b];
}
const waveOut = await vocoder.run({ mel: new ort.Tensor('float32', melForVocoder, [1, 100, frames]) });
const wave = waveOut.waveform.data;

function compare(a, b, label) {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, maxErr = 0, noise = 0, signal = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]; sb += b[i]; sab += a[i] * b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i];
    maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
    noise += (a[i] - b[i]) ** 2;
    signal += a[i] * a[i];
  }
  const corr = (n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  const snr = 10 * Math.log10(signal / Math.max(noise, 1e-30));
  console.log(`${label.padEnd(14)}: len=${a.length}/${b.length} corr=${corr.toFixed(9)} `
    + `max_err=${maxErr.toExponential(3)} SNR=${snr.toFixed(2)} dB`);
  return { corr, maxErr, len: n === a.length && n === b.length };
}

const melCmp = compare(x, refMel, 'mel vs torch');
const waveCmp = compare(wave, refWave, 'wave vs torch');
const finite = Array.from(wave).every(Number.isFinite);
console.log(`waveform      : ${wave.length} samples (${(wave.length / 24000).toFixed(2)} s), finite=${finite}`);
console.log(`peak          : ${Math.max(...wave).toFixed(4)} / ${Math.min(...wave).toFixed(4)}`);

const ok = finite && melCmp.corr > 0.9999 && waveCmp.corr > 0.999 &&
  waveCmp.maxErr < 1e-3 && waveCmp.len;
console.log(ok ? 'PASS (full two-stage chain runs in the browser runtime and matches PyTorch)'
               : 'FAIL');
process.exit(ok ? 0 : 1);
