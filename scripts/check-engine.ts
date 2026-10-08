/**
 * End-to-end check of the deployed demo assets.
 *
 * Loads the real `public/model/*` package and `public/en-lexicon.txt`, runs the
 * actual browser code path (createFrontend -> textToIds -> InflectEngine ->
 * encodeWav) under onnxruntime-web's WASM backend, and reports signal stats for
 * the produced waveform.
 *
 * This is the check that would catch an integration break — a symbol mismatch, a
 * renamed ONNX input, a bad tensor dtype — which the per-file parity checks
 * cannot see.
 *
 * Run: npm run check:engine
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';

import { encodeWav } from '../src/audio';
import { InflectEngine, type Provider } from '../src/engine';
import { createFrontend } from '../src/frontend';
import { installLexicon, unresolvedWords } from '../src/frontend/english';
import { loadSymbols, textToIds } from '../src/symbols';

ort.env.logLevel = 'error';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths =
  pathToFileURL(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist') + '/').href;

const PUBLIC = join(process.cwd(), 'public');
const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
};

function serve(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const relative = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(/^[/\\]+/, '');
    const path = join(PUBLIC, relative);
    if (!path.startsWith(PUBLIC)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(path);
      response.writeHead(200, {
        'content-type': MIME[extname(path)] ?? 'application/octet-stream',
        'content-length': String(body.length),
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function stats(audio: Float32Array, sampleRate: number) {
  let peak = 0;
  let sum = 0;
  let nonFinite = 0;
  let clipped = 0;
  for (let i = 0; i < audio.length; i += 1) {
    const value = audio[i];
    if (!Number.isFinite(value)) nonFinite += 1;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= 0.999) clipped += 1;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / Math.max(audio.length, 1));
  return {
    seconds: audio.length / sampleRate,
    peak,
    rms,
    rmsDbfs: 20 * Math.log10(Math.max(rms, 1e-8)),
    nonFinite,
    clippedFraction: clipped / Math.max(audio.length, 1),
  };
}

const cases: Array<[string, string]> = [
  ['zh-01', '你好，欢迎体验这个中英双语语音合成模型。'],
  ['zh-02', '妈麻马骂吗？行万里路，读万卷书。'],
  ['en-01', 'Hello world, this is a bilingual text to speech model.'],
  ['mix-01', '我今天读了一本关于 machine learning 的书，很有意思。'],
  ['num-01', 'The price is 359.9 yuan, about 50% off.'],
];

const provider = (process.env.PROVIDER ?? 'wasm') as Provider;
const { base, close } = await serve();

let failures = 0;
try {
  const modelBase = `${base}/model`;
  const symbols = await loadSymbols(`${modelBase}/symbols.json`);
  const frontend = createFrontend(symbols.symbols);
  const lexiconSize = installLexicon(readFileSync(join(PUBLIC, 'en-lexicon.txt'), 'utf8'));
  console.log(`symbols: ${symbols.symbols.length}   lexicon: ${lexiconSize} words   provider: ${provider}`);

  const engine = await InflectEngine.create(modelBase, provider, 24000, () => undefined);
  console.log('engine ready\n');

  for (const [id, text] of cases) {
    const phonemes = frontend.phonemize(frontend.normalize(text));
    const tokens = textToIds(symbols, phonemes);
    if (tokens.length === 0) {
      console.log(`${id}: FAIL — frontend produced no tokens`);
      failures += 1;
      continue;
    }
    const result = await engine.synthesize(tokens, { lengthScale: 1, noiseScale: 0.667, seed: 0 });
    const s = stats(result.audio, result.sampleRate);
    const unknown = [...new Set(phonemes.split('').filter((c) => c !== ' ' && !symbols.index.has(c)))];
    const ok = s.nonFinite === 0 && s.clippedFraction === 0 && s.seconds > 0.2 && s.rmsDbfs > -60 && unknown.length === 0;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(7)} tokens=${String(tokens.length).padStart(3)} ` +
        `frames=${String(result.frames).padStart(4)} ${s.seconds.toFixed(2)}s ` +
        `rms=${s.rmsDbfs.toFixed(1)}dBFS peak=${s.peak.toFixed(3)} ` +
        `nonFinite=${s.nonFinite} clipped=${s.clippedFraction.toFixed(3)}` +
        (unknown.length ? ` unknownSymbols=${JSON.stringify(unknown)}` : ''),
    );
    if (process.env.SAVE_WAV) writeFileSync(`${id}.wav`, encodeWav(result.audio, result.sampleRate));
  }

  const unresolved = unresolvedWords();
  if (unresolved.length > 0) {
    console.log(`\nnote: ${unresolved.length} word(s) fell back to letter-to-sound: ${unresolved.slice(0, 8).join(', ')}`);
  }
} finally {
  await close();
}

console.log(`\n${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exitCode = 1;
