import { encodeWav } from './audio';
import { InflectEngine, type Provider } from './engine';
import { createFrontend, type Frontend } from './frontend';
import { loadDictionary } from './frontend/english';
import { loadSymbols, textToIds, type SymbolTable } from './symbols';

const MODEL_BASE = 'model';
const RING_CIRCUMFERENCE = 2 * Math.PI * 20;

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
  progress: document.getElementById('progress') as HTMLDivElement,
  progressLabel: document.getElementById('progressLabel') as HTMLDivElement,
  progressDetail: document.getElementById('progressDetail') as HTMLDivElement,
  ringValue: document.getElementById('ringValue') as unknown as SVGCircleElement,
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

/** Show the ring; `fraction === null` switches it to a spinning indeterminate. */
function showProgress(label: string, fraction: number | null): void {
  dom.progress.hidden = false;
  dom.progress.classList.toggle('indeterminate', fraction === null);
  dom.progressLabel.textContent = label;
  if (fraction === null) {
    dom.progressDetail.textContent = '计算中，请稍候…';
  } else {
    const clamped = Math.max(0, Math.min(1, fraction));
    dom.ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
    dom.progressDetail.textContent = `${Math.round(clamped * 100)}%`;
  }
}

function hideProgress(): void {
  dom.progress.hidden = true;
}

/** Yield so the browser can paint before a blocking inference call. */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function prepare(): Promise<void> {
  if (!symbols) {
    showProgress('读取模型符号表…', null);
    await yieldToRenderer();
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
    engine = await InflectEngine.create(MODEL_BASE, provider, sampleRate, ({ label, fraction }) => {
      showProgress(label, fraction);
      setStatus(label);
    });
    engineProvider = provider;
  }
}

async function run(): Promise<void> {
  dom.run.disabled = true;
  try {
    const text = dom.text.value.trim();
    if (!text) {
      setStatus('请先输入要合成的文本', 'error');
      return;
    }

    await prepare();

    // The CMU dictionary is only fetched when the input actually has Latin text.
    if (/[A-Za-z]/.test(text) && !dictionaryReady) {
      showProgress('加载英文发音词典（CMUdict，约 4 MB）…', null);
      await yieldToRenderer();
      await loadDictionary();
      dictionaryReady = true;
    }

    showProgress('分析文本 → 音素…', null);
    await yieldToRenderer();
    const phonemes = frontend!.phonemize(frontend!.normalize(text));
    dom.phonemes.textContent = phonemes || '(没有可朗读的内容)';
    if (!phonemes) {
      hideProgress();
      setStatus('前端没有产生音素', 'error');
      return;
    }

    const tokens = textToIds(symbols!, phonemes);
    setStatus(`合成中：${tokens.length} 个 token（${engineProvider}）`);
    showProgress('准备推理…', null);
    await yieldToRenderer();

    const result = await engine!.synthesize(
      tokens,
      {
        lengthScale: 1 / Number(dom.speed.value),
        noiseScale: Number(dom.variation.value),
        seed: Number(dom.seed.value),
      },
      { onStage: (label) => showProgress(label, null) },
    );

    showProgress('编码 WAV…', null);
    await yieldToRenderer();
    const blob = encodeWav(result.audio, result.sampleRate);
    const url = URL.createObjectURL(blob);
    dom.audio.src = url;
    dom.download.href = url;
    dom.download.download = 'inflect-zh-en.wav';

    hideProgress();
    dom.audio.play().catch(() => undefined);
    const seconds = result.audio.length / result.sampleRate;
    dom.stats.textContent =
      `${seconds.toFixed(2)} 秒音频 · ${result.frames} 帧 · ` +
      `合成耗时 ${(result.milliseconds / 1000).toFixed(2)} 秒 · RTF ${(
        result.milliseconds / 1000 / seconds
      ).toFixed(2)}`;
    setStatus('完成');
  } catch (error) {
    console.error(error);
    hideProgress();
    setStatus(`失败：${error instanceof Error ? error.message : String(error)}`, 'error');
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
