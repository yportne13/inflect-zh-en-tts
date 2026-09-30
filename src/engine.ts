/**
 * ONNX Runtime Web driver for the exported Inflect graphs.
 *
 * The exported model is split into two graphs:
 *   duration.onnx : tokens, lengths, length_scale -> m_p_exp, logs_p_exp, y_mask
 *   decode.onnx   : m_p_exp, logs_p_exp, y_mask, zp_noise, noise_scale -> waveform
 */

import * as ort from 'onnxruntime-web';

export type Provider = 'webgpu' | 'wasm';

export interface SynthesisResult {
  sampleRate: number;
  audio: Float32Array;
  frames: number;
  milliseconds: number;
}

export interface EngineProgress {
  (message: string): void;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class InflectEngine {
  private constructor(
    private readonly duration: ort.InferenceSession,
    private readonly decode: ort.InferenceSession,
    public readonly provider: Provider,
    public readonly sampleRate: number,
  ) {}

  static async create(
    modelBase: string,
    provider: Provider,
    sampleRate: number,
    progress: EngineProgress,
  ): Promise<InflectEngine> {
    ort.env.logLevel = 'error';
    // The WASM runtime is bundled by Vite as an asset, so no wasmPaths override
    // is needed; only the thread policy is configured here.
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    };
    progress(`loading duration graph (${provider})...`);
    const duration = await ort.InferenceSession.create(`${modelBase}/duration.onnx`, options);
    progress(`loading decoder graph (${provider})...`);
    const decode = await ort.InferenceSession.create(`${modelBase}/decode.onnx`, options);
    progress('models ready');
    return new InflectEngine(duration, decode, provider, sampleRate);
  }

  /** Run the full text-to-waveform path for one token sequence. */
  async synthesize(
    tokens: number[],
    options: { lengthScale?: number; noiseScale?: number; seed?: number } = {},
  ): Promise<SynthesisResult> {
    const started = performance.now();
    const lengthScale = options.lengthScale ?? 1.0;
    const noiseScale = options.noiseScale ?? 0.667;

    const tokenTensor = new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
    const lengthTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(tokens.length)]), [1]);
    const scaleTensor = new ort.Tensor('float32', Float32Array.of(lengthScale), []);

    const durationOut = await this.duration.run({
      tokens: tokenTensor,
      lengths: lengthTensor,
      length_scale: scaleTensor,
    });

    const mPe = durationOut.m_p_exp as ort.Tensor;
    const logsPe = durationOut.logs_p_exp as ort.Tensor;
    const mask = durationOut.y_mask as ort.Tensor;
    const channels = mPe.dims[1] as number;
    const frames = mPe.dims[2] as number;

    const rng = mulberry32(options.seed ?? 0);
    const noise = new Float32Array(channels * frames);
    for (let i = 0; i < noise.length; i += 1) noise[i] = gaussian(rng);

    const decodeOut = await this.decode.run({
      m_p_exp: mPe,
      logs_p_exp: logsPe,
      y_mask: mask,
      zp_noise: new ort.Tensor('float32', noise, [1, channels, frames]),
      noise_scale: new ort.Tensor('float32', Float32Array.of(noiseScale), []),
    });

    const waveform = decodeOut.waveform as ort.Tensor;
    const audio = Float32Array.from(waveform.data as Float32Array);
    return {
      sampleRate: this.sampleRate,
      audio,
      frames,
      milliseconds: performance.now() - started,
    };
  }
}
