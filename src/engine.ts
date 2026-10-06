/**
 * ONNX Runtime Web driver for the exported Inflect graphs.
 *
 * The exported model is split into two graphs:
 *   duration.onnx : tokens, lengths, length_scale -> m_p_exp, logs_p_exp, y_mask
 *   decode.onnx   : m_p_exp, logs_p_exp, y_mask, zp_noise, noise_scale -> waveform
 *
 * Weights are fetched with streaming progress so the UI can show a real
 * download percentage instead of an opaque spinner.
 */

import * as ort from 'onnxruntime-web';

export type Provider = 'webgpu' | 'wasm';

export interface SynthesisResult {
  sampleRate: number;
  audio: Float32Array;
  frames: number;
  milliseconds: number;
}

/** `fraction` is null while a step has no measurable progress. */
export interface EngineProgress {
  label: string;
  fraction: number | null;
}

export interface SynthesisHooks {
  onStage?: (label: string) => void;
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

/**
 * Let the browser paint once. ONNX Runtime Web executes WASM synchronously on
 * the main thread, so without this the stage label would never appear before
 * the UI freezes.
 */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

async function fetchWithProgress(
  url: string,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(1);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastBucket = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) {
      // Report at most ~100 times so the renderer is not flooded.
      const bucket = Math.floor((loaded / total) * 100);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        onProgress(loaded / total);
      }
    }
  }
  const model = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    model.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);
  return model;
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
    onProgress: (progress: EngineProgress) => void,
  ): Promise<InflectEngine> {
    ort.env.logLevel = 'error';
    // Vite bundles the ~28 MB ONNX Runtime WASM binary as an asset on this
    // origin, so it is normally fetched from here. VITE_ORT_BASE points that
    // fetch at a mirror instead, which matters on mainland-China networks.
    const ortBase = import.meta.env.VITE_ORT_BASE as string | undefined;
    if (ortBase) {
      ort.env.wasm.wasmPaths = `${ortBase.replace(/\/+$/, '')}/`;
    }
    // Without cross-origin isolation SharedArrayBuffer is unavailable, so the
    // runtime itself falls back to single-threaded execution.
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);

    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    };

    const durationLabel = '下载时长模型 duration.onnx';
    onProgress({ label: durationLabel, fraction: 0 });
    const durationBytes = await fetchWithProgress(`${modelBase}/duration.onnx`, (fraction) =>
      onProgress({ label: durationLabel, fraction }),
    );

    const decodeLabel = '下载波形解码器 decode.onnx';
    onProgress({ label: decodeLabel, fraction: 0 });
    const decodeBytes = await fetchWithProgress(`${modelBase}/decode.onnx`, (fraction) =>
      onProgress({ label: decodeLabel, fraction }),
    );

    // Graph compilation has no measurable progress, so the ring goes
    // indeterminate here.
    onProgress({ label: `初始化 ${provider.toUpperCase()} 推理会话`, fraction: null });
    const duration = await ort.InferenceSession.create(durationBytes, options);
    const decode = await ort.InferenceSession.create(decodeBytes, options);

    onProgress({ label: '模型就绪', fraction: 1 });
    return new InflectEngine(duration, decode, provider, sampleRate);
  }

  /** Run the full text-to-waveform path for one token sequence. */
  async synthesize(
    tokens: number[],
    options: { lengthScale?: number; noiseScale?: number; seed?: number } = {},
    hooks: SynthesisHooks = {},
  ): Promise<SynthesisResult> {
    const started = performance.now();
    const lengthScale = options.lengthScale ?? 1.0;
    const noiseScale = options.noiseScale ?? 0.667;

    const tokenTensor = new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
    const lengthTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(tokens.length)]), [1]);
    const scaleTensor = new ort.Tensor('float32', Float32Array.of(lengthScale), []);

    hooks.onStage?.('① 预测时长与隐变量…');
    await yieldToRenderer();
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

    hooks.onStage?.(`② 生成波形（${frames} 帧）…`);
    await yieldToRenderer();
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
