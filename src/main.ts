import { encodeWav } from './audio';
import { InflectEngine, type Provider } from './engine';
import { createFrontend, type Frontend } from './frontend';
import { loadDictionary } from './frontend/english';
import { loadSymbols, textToIds, type SymbolTable } from './symbols';

const MODEL_BASE = 'model';

const dom = {
  provider: document.getElementById('provider') as HTMLSelectElement,
  speed: document.getElementById('speed') as HTMLInputElement,
  speedOut: document.getElementById('speedOut') as HTMLOutputElement,
  variation: document.getElementById('variation') as HTMLInputElement,
  variationOut: document.getElementById('variationOut') as HTMLOutputElement,
  seed: document.getElementById('seed') as HTMLInputElement,
  text: document.getElementById('text') as HTMLTextAreaElement,
  run: document.getElementById('run') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLParagraphElement,
  phonemes: document.getElementById('phonemes') as HTMLPreElement,
  audio: document.getElementById('audio') as HTMLAudioElement,
  download: document.getElementById('download') as HTMLAnchorElement,
  stats: document.getElementById('stats') as HTMLParagraphElement,
};

let symbols: SymbolTable | null = null;
let frontend: Frontend | null = null;
let engine: InflectEngine | null = null;
let engineProvider: Provider | null = null;
let dictionaryReady = false;
let sampleRate = 24000;

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  dom.status.textContent = message;
  dom.status.dataset.kind = kind;
}

async function prepare(): Promise<void> {
  if (!symbols) {
    setStatus('loading symbols...');
    symbols = await loadSymbols(`${MODEL_BASE}/symbols.json`);
    frontend = createFrontend(symbols.symbols);
    try {
      const config = await (await fetch(`${MODEL_BASE}/config.json`)).json();
      sampleRate = config?.data?.sampling_rate ?? sampleRate;
    } catch {
      /* config is optional */
    }
  }
  const provider = dom.provider.value as Provider;
  if (!engine || engineProvider !== provider) {
    engine = await InflectEngine.create(MODEL_BASE, provider, sampleRate, (message) => setStatus(message));
    engineProvider = provider;
  }
}

async function run(): Promise<void> {
  dom.run.disabled = true;
  try {
    const text = dom.text.value.trim();
    if (!text) {
      setStatus('enter some text first', 'error');
      return;
    }
    await prepare();
    // The CMU dictionary is only fetched when the input actually has Latin text.
    if (/[A-Za-z]/.test(text) && !dictionaryReady) {
      setStatus('loading English dictionary...');
      await loadDictionary();
      dictionaryReady = true;
    }
    const phonemes = frontend!.phonemize(frontend!.normalize(text));
    dom.phonemes.textContent = phonemes || '(nothing to speak)';
    if (!phonemes) {
      setStatus('frontend produced no phonemes', 'error');
      return;
    }
    const tokens = textToIds(symbols!, phonemes);
    setStatus(`synthesizing ${tokens.length} tokens on ${engineProvider}...`);
    const result = await engine!.synthesize(tokens, {
      lengthScale: 1 / Number(dom.speed.value),
      noiseScale: Number(dom.variation.value),
      seed: Number(dom.seed.value),
    });
    const blob = encodeWav(result.audio, result.sampleRate);
    const url = URL.createObjectURL(blob);
    dom.audio.src = url;
    dom.download.href = url;
    dom.download.download = 'inflect-zh-en.wav';
    dom.audio.play().catch(() => undefined);
    const seconds = result.audio.length / result.sampleRate;
    dom.stats.textContent =
      `${seconds.toFixed(2)} s audio · ${result.frames} frames · ` +
      `${result.milliseconds.toFixed(0)} ms synthesis · RTF ${(result.milliseconds / 1000 / seconds).toFixed(2)}`;
    setStatus('done');
  } catch (error) {
    console.error(error);
    setStatus(`failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    dom.run.disabled = false;
  }
}

dom.run.addEventListener('click', () => void run());
dom.speed.addEventListener('input', () => {
  dom.speedOut.textContent = Number(dom.speed.value).toFixed(2);
});
dom.variation.addEventListener('input', () => {
  dom.variationOut.textContent = Number(dom.variation.value).toFixed(2);
});
dom.audio.addEventListener('loadeddata', () => {
  dom.audio.hidden = false;
  dom.download.hidden = false;
});
