/**
 * Verify an fp16 ONNX graph with the exact runtime the browser uses
 * (onnxruntime-web, WASM backend) instead of onnxruntime's Python CPU provider.
 *
 * This matters because the fp16 conversion keeps graph inputs fp32 but the
 * output comes back as float16, and whether that is usable depends on how
 * ort-web materialises the tensor — which only ort-web itself can answer.
 *
 * Usage: node scripts/check-onnx-fp16.mjs <model-dir>
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';

ort.env.logLevel = 'error';
ort.env.wasm.numThreads = 1;
// Windows needs a file:// URL here; a bare path makes the ESM loader throw
// ERR_UNSUPPORTED_ESM_URL_SCHEME.
ort.env.wasm.wasmPaths =
  pathToFileURL(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist') + '/').href;

const modelDir = process.argv[2] ?? 'public/model';

/**
 * Base models this repo ships with, and therefore the latent channel counts a
 * decode graph can declare. Micro is 192, Nano 128. `session.inputMetadata` is
 * not populated by this ort-web version, so the count is discovered by probing
 * rather than read from metadata.
 */
const CHANNEL_CANDIDATES = [192, 128, 96, 192, 256, 80];

function makeInputs(channels, frames) {
  // Deterministic pseudo-random input so both graphs see identical data.
  let state = 123456789;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const gaussian = () => {
    const u = Math.max(next(), 1e-9);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const fill = (scale) => {
    const data = new Float32Array(channels * frames);
    for (let i = 0; i < data.length; i += 1) data[i] = gaussian() * scale;
    return data;
  };
  return {
    m_p_exp: new ort.Tensor('float32', fill(0.5), [1, channels, frames]),
    logs_p_exp: new ort.Tensor('float32', fill(0.3), [1, channels, frames]),
    y_mask: new ort.Tensor('float32', new Float32Array(frames).fill(1), [1, 1, frames]),
    zp_noise: new ort.Tensor('float32', fill(1.0), [1, channels, frames]),
    noise_scale: new ort.Tensor('float32', Float32Array.of(0.667), []),
  };
}

/**
 * Find the channel count that runs. A wrong count fails with
 * "Got invalid dimensions for input: m_p_exp", which is unambiguous, so probing
 * is safe: it cannot silently produce a wrong-shape pass.
 */
async function resolveChannels(session, frames = 96) {
  for (const channels of CHANNEL_CANDIDATES) {
    try {
      const out = await session.run(makeInputs(channels, frames));
      if (out.waveform) return channels;
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!message.includes('m_p_exp')) throw error;
    }
  }
  throw new Error(`no channel count in ${JSON.stringify(CHANNEL_CANDIDATES)} runs on this graph`);
}

/** Convert a float16 tensor payload into float32. */
function toFloat32(tensor) {
  const type = tensor.type;
  const data = tensor.data;
  if (type === 'float32') return Float32Array.from(data);
  if (type === 'float16') {
    if (typeof Float16Array !== 'undefined' && data instanceof Float16Array) {
      return Float32Array.from(data);
    }
    // ort-web exposes float16 payloads as Uint16Array bit patterns.
    const raw = data instanceof Uint16Array ? data : new Uint16Array(data.buffer ?? data);
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      const h = raw[i];
      const sign = (h & 0x8000) ? -1 : 1;
      const exponent = (h >> 10) & 0x1f;
      const mantissa = h & 0x3ff;
      if (exponent === 0) out[i] = sign * Math.pow(2, -14) * (mantissa / 1024);
      else if (exponent === 0x1f) out[i] = mantissa ? NaN : sign * Infinity;
      else out[i] = sign * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
    }
    return out;
  }
  throw new Error(`unexpected tensor type ${type}`);
}

async function run(name) {
  const bytes = readFileSync(join(modelDir, name));
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  const channels = await resolveChannels(session);
  const out = await session.run(makeInputs(channels, 96));
  const tensor = out.waveform;
  return { tensor, values: toFloat32(tensor), channels };
}

const fp32 = await run('decode.onnx');
console.log(`decode.onnx      : output type=${fp32.tensor.type} dims=${fp32.tensor.dims} samples=${fp32.values.length} channels=${fp32.channels}`);

let fp16;
try {
  fp16 = await run('decode-fp16.onnx');
  console.log(`decode-fp16.onnx : output type=${fp16.tensor.type} dims=${fp16.tensor.dims} samples=${fp16.values.length}`);
} catch (error) {
  console.log(`decode-fp16.onnx : FAILED to run under ort-web wasm -> ${error}`);
  process.exit(2);
}

const a = fp32.values;
const b = fp16.values;
if (a.length !== b.length) {
  console.log(`FAIL: length mismatch ${a.length} vs ${b.length}`);
  process.exit(1);
}
let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0, maxErr = 0, noise = 0;
for (let i = 0; i < a.length; i += 1) {
  sumA += a[i]; sumB += b[i]; sumAB += a[i] * b[i]; sumAA += a[i] * a[i]; sumBB += b[i] * b[i];
  maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
  noise += (a[i] - b[i]) ** 2;
}
const n = a.length;
const corr = (n * sumAB - sumA * sumB) / Math.sqrt((n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB));
const signal = a.reduce((s, v) => s + v * v, 0);
const snr = 10 * Math.log10(signal / Math.max(noise, 1e-30));
console.log(`peak             : fp32=${Math.max(...a.map(Math.abs)).toFixed(4)} fp16=${Math.max(...b.map(Math.abs)).toFixed(4)}`);
console.log(`correlation      : ${corr.toFixed(6)}`);
console.log(`max abs error    : ${maxErr.toExponential(3)}`);
console.log(`SNR              : ${snr.toFixed(2)} dB`);
const ok = Number.isFinite(corr) && corr > 0.999 && maxErr < 0.01;
console.log(ok ? 'PASS (usable under ort-web wasm)' : 'FAIL (parity outside tolerance)');
process.exit(ok ? 0 : 1);
