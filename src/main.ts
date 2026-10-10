import { encodeWav } from './audio';
import { concatAudio, splitText } from './chunk';
import { InflectEngine, type Provider } from './engine';
import { createFrontend, type Frontend } from './frontend';
import { loadLexicon } from './frontend/english';
import { loadSymbols, textToIds, type SymbolTable } from './symbols';

/**
 * Model picker. `public/models.json` lists the exported models, each pointing at
 * its own directory of symbols.json / config.json / *.onnx, so adding a model is
 * a manifest entry plus its files - no code change. VITE_MODELS_URL overrides
 * where the manifest comes from, which is what a CDN build needs.
 */
interface ModelEntry {
  id: string;
  label: string;
  path: string;
  note?: string;
  default?: boolean;
}

const MODELS_URL = (import.meta.env.VITE_MODELS_URL as string | undefined) || 'models.json';
const FALLBACK_MODEL: ModelEntry = {
  id: 'gold',
  label: 'Micro 9.4M · 部署版（推荐）',
  path: 'model',
  note: '中文 CER 0.282 / 英文 0.096',
  default: true,
};
const RING_CIRCUMFERENCE = 2 * Math.PI * 20;
const STORAGE_KEY = 'inflect.model';

const dom = {
  model: document.getElementById('model') as HTMLSelectElement,
  modelNote: document.getElementById('modelNote') as HTMLParagraphElement,
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

let models: ModelEntry[] = [FALLBACK_MODEL];
let selected: ModelEntry = FALLBACK_MODEL;
/** Everything below is per-model and must be dropped when the picker changes. */
let symbols: SymbolTable | null = null;
let frontend: Frontend | null = null;
let engine: InflectEngine | null = null;
let engineProvider: Provider | null = null;
let loadedModelId: string | null = null;
let lexiconReady = false;
let sampleRate = 24000;

/** Resolve a manifest `path` against wherever the manifest itself came from. */
function modelUrl(entry: ModelEntry, file: string): string {
  if (/^(https?:)?\/\//.test(entry.path) || entry.path.startsWith('/')) {
    return `${entry.path.replace(/\/+$/, '')}/${file}`;
  }
  const base = MODELS_URL.replace(/\/+$/, '').replace(/[^/]*$/, '');
  return `${base}${entry.path.replace(/\/+$/, '')}/${file}`;
}

const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode: selection just is not remembered */
    }
  },
};

async function loadModels(): Promise<void> {
  try {
    const response = await fetch(MODELS_URL);
    if (!response.ok) throw new Error(String(response.status));
    const parsed = await response.json();
    const entries = Array.isArray(parsed?.models) ? parsed.models : [];
    if (!entries.length) throw new Error('manifest has no models');
    models = entries.map((entry: ModelEntry) => ({
      ...entry,
      path: (entry.path || '').replace(/^\.?\//, ''),
    }));
  } catch (error) {
    console.warn('models.json unavailable, falling back to the single bundled model:', error);
    models = [FALLBACK_MODEL];
  }

  dom.model.textContent = '';
  for (const entry of models) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    dom.model.append(option);
  }

  const remembered = safeStorage.get(STORAGE_KEY);
  const initial = models.find((entry) => entry.id === remembered)
    ?? models.find((entry) => entry.default)
    ?? models[0];
  dom.model.value = initial.id;
  selectModel(initial, { persist: false });
}

function selectModel(entry: ModelEntry, options: { persist?: boolean } = {}): void {
  selected = entry;
  symbols = null;
  frontend = null;
  engine = null;
  engineProvider = null;
  lexiconReady = false;
  sampleRate = 24000;
  loadedModelId = null;
  dom.modelNote.textContent = entry.note ?? '';
  dom.modelNote.hidden = !entry.note;
  if (options.persist !== false) safeStorage.set(STORAGE_KEY, entry.id);
  setStatus(`已选择 ${entry.label}（首次合成会下载该模型的权重）`);
  if (dom.audio) {
    dom.audio.hidden = true;
    dom.download.hidden = true;
  }
  dom.stats.textContent = '';
}


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
  // Drop the spinning state too, so a later showProgress() cannot render a
  // stale indeterminate ring before it sets its own label.
  dom.progress.classList.remove('indeterminate');
}

/** Yield so the browser can paint before a blocking inference call. */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function prepare(): Promise<void> {
  // Symbols and the frontend are per-model: each package ships its own
  // symbols.json, and the frontend is built from it.
  if (!symbols || loadedModelId !== selected.id) {
    showProgress('读取模型符号表…', null);
    await yieldToRenderer();
    symbols = await loadSymbols(modelUrl(selected, 'symbols.json'));
    frontend = createFrontend(symbols.symbols);
    sampleRate = 24000;
    try {
      const config = await (await fetch(modelUrl(selected, 'config.json'))).json();
      sampleRate = config?.data?.sampling_rate ?? sampleRate;
    } catch {
      /* config is optional */
    }
    loadedModelId = selected.id;
  }
  const provider = dom.provider.value as Provider;
  if (!engine || engineProvider !== provider) {
    engine = await InflectEngine.create(modelUrl(selected, ''), provider, sampleRate, ({ label, fraction }) => {
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

    // The English pronunciation lexicon is only fetched when the input actually
    // has Latin text.
    if (/[A-Za-z]/.test(text) && !lexiconReady) {
      showProgress('加载英文发音词典（eSpeak 离线词典，约 3 MB）…', null);
      await yieldToRenderer();
      await loadLexicon();
      lexiconReady = true;
    }

    showProgress('分析文本 → 音素…', null);
    await yieldToRenderer();
    // Split long input at sentence/clause boundaries: the model is trained on
    // single sentences, and one giant pass degrades prosody and memory alike.
    const chunks = splitText(text);
    const prepared = chunks
      .map((chunk) => {
        const phonemes = frontend!.phonemize(frontend!.normalize(chunk));
        return { phonemes, tokens: phonemes ? textToIds(symbols!, phonemes) : [] };
      })
      .filter((item) => item.tokens.length > 0);

    dom.phonemes.textContent = prepared.map((item) => item.phonemes).join(' ') || '(没有可朗读的内容)';
    if (prepared.length === 0) {
      hideProgress();
      setStatus('前端没有产生音素', 'error');
      return;
    }

    const parts: Float32Array[] = [];
    let frames = 0;
    let milliseconds = 0;
    let sampleRate = 24000;
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const label = prepared.length > 1 ? `第 ${index + 1}/${prepared.length} 段` : '合成中';
      setStatus(`${label}：${item.tokens.length} 个 token（${engineProvider}）`);
      showProgress(`${label} · 准备推理…`, null);
      await yieldToRenderer();
      const result = await engine!.synthesize(
        item.tokens,
        {
          lengthScale: 1 / Number(dom.speed.value),
          noiseScale: Number(dom.variation.value),
          seed: Number(dom.seed.value),
        },
        { onStage: (stage) => showProgress(`${label} · ${stage}`, null) },
      );
      parts.push(result.audio);
      frames += result.frames;
      milliseconds += result.milliseconds;
      sampleRate = result.sampleRate;
    }

    showProgress('编码 WAV…', null);
    await yieldToRenderer();
    const audio = concatAudio(parts, sampleRate);
    const blob = encodeWav(audio, sampleRate);
    const url = URL.createObjectURL(blob);
    dom.audio.src = url;
    dom.download.href = url;
    dom.download.download = 'inflect-zh-en.wav';

    hideProgress();
    dom.audio.play().catch(() => undefined);
    const seconds = audio.length / sampleRate;
    dom.stats.textContent =
      `${seconds.toFixed(2)} 秒音频 · ${frames} 帧 · ${prepared.length} 段 · ` +
      `合成耗时 ${(milliseconds / 1000).toFixed(2)} 秒 · RTF ${(
        milliseconds / 1000 / seconds
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
dom.model.addEventListener('change', () => {
  const entry = models.find((candidate) => candidate.id === dom.model.value);
  if (entry) selectModel(entry);
});
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

void loadModels();
