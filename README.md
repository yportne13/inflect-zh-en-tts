# Inflect 中英双语 TTS — 浏览器本地推理 Demo

A **bilingual (Mandarin + English) text-to-speech demo that runs entirely in the
browser**. No server, no API key, no audio upload — the whole text-to-waveform
stack is 9.36 M parameters and executes locally through
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) on **WASM** by
default, with an optional **WebGPU** backend.

[**▶ Live demo**](https://yportne13.github.io/inflect-zh-en-tts/)

> **声明：本项目完全由 AI 完成** —— 包括模型的中文适配、中英双语微调、训练管线、
> 文本前端移植、ONNX 导出以及这个浏览器 Demo 的全部代码，均由 AI 独立编写与调试，
> 人类只负责提出需求与验收。

---

## 这是什么

在 [Inflect v2](https://github.com/owenawsong/Inflect) 的 **Micro** 基座
（9.36 M 参数，Apache-2.0）上做中文适配，再混入英文数据微调，得到一个中英共用
一套权重、共用一个混合音色的端到端 TTS 模型，并把它完整搬进浏览器。

| | |
|---|---|
| 参数量 | 9.36 M（含波形解码器） |
| 采样率 | 24 kHz 单声道 |
| 模型体积 | FP32 ONNX ≈ 37 MB（duration 7 MB + decode 30 MB） |
| 推理 | ONNX Runtime Web · WASM（默认）· WebGPU（可选） |
| 语言 | 普通话 + 英语，**混排句子可自动路由** |

> 当前权重是 **DataBaker 金标拼音**训练的中英双语模型
> （`bilingual2-gold-10000`，Micro 基座，10000 步）。中文部分来自 DataBaker
> BZNSYP 上约 12 小时的适配训练，英文部分来自 LJSpeech 的 6 小时子集。
> 在 100 句中文 + 50 句英文的 held-out 基准上，中文 CER **0.282**、英文 CER
> **0.096**（对比上一版 step-3000 的 0.446 / 0.188）。

## 架构

```
text
 ├─ 中文片段 → pinyin-pro →「声母+韵母 IPA + 声调数字」
 ├─ 英文片段 → 离线 eSpeak 词典 → IPA（含重音标记）
 └─ 数字/标点 → 归一化
        ↓ 音素串 → 符号表 → token ids（add_blank）
   duration.onnx  → m_p_exp / logs_p_exp / y_mask
   decode.onnx    → 24 kHz waveform
```

模型被切成两张 ONNX 图：`duration`（文本 → 时长/隐变量分布）和 `decode`
（分布 + 噪声 → 波形）。中间的采样在 JS 里完成（`zp_noise` 用可复现的
种子随机数生成）。

### 两个前端的细节

**中文**：模型训练时用的是「声母 IPA + 韵母 IPA + 声调数字 1–5」，一个音节一个
token。浏览器里用 `pinyin-pro` 取拼音（注意它把轻声写成 `0`，这里映射成 `5`），
再套用与训练完全一致的映射表。

**英文**：训练用的是 **eSpeak NG en-us IPA**，而 eSpeak 没法在浏览器里跑。
早期版本用 CMUdict 近似，实测与训练分布差得很远（音素串字符级编辑距离
**18.6%**，逐词只有 **21.3%** 完全一致）——等于给模型喂了另一种输入分布。

现在改为**离线预生成词典**：`scripts/build_en_lexicon.py` 用**与训练完全相同的
eSpeak 后端**逐词合成，再叠加从连续语流里挖掘的读音覆盖（eSpeak 在句中会弱化
功能词：`in` → ɪn 而非 ˈɪn，`a` → ɐ 而非 ˈeɪ）。运行时只做查表，词表外的词走
字母到音素的回退规则。

| 英文前端 | 音素串字符级 ED | 逐词完全一致 |
|---|---|---|
| CMUdict 近似（旧） | 18.6% | 21.3% |
| **eSpeak 离线词典（现）** | **5.0%** | **50.6%** |

（在 50 句 held-out 英文上测，这些句子已从词典挖掘语料中排除。）

产物 `public/en-lexicon.txt`（13.6 万词，约 3.1 MB）比它替代掉的 CMUdict 包
（4.6 MB）更小，且只在输入含拉丁字母时才下载。重新生成：

```bash
python scripts/build_en_lexicon.py
```

数字按 eSpeak 的方式读：`359.9` → *three hundred fifty nine point nine*、
`50%` → *fifty percent*、`1st` → *first*。标点也会保留（训练时
`preserve_punctuation=True`，标点是一个真实输入 token，会影响韵律）。

> 剩余差异来自 eSpeak 的**上下文相关**行为（clitic 合并、闪音 `ɾ`、功能词弱化），
> 静态词表无法完全复现。

## 本地运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产出静态站点到 dist/
npm run preview  # 预览构建结果
```

首次合成会下载约 **37 MB** 的 ONNX 权重（+ 约 28 MB 的 WASM 运行时，仅 WASM 后端需要）。

### 浏览器要求

- **WebGPU**：Chrome/Edge 113+，Safari 18+
- **WASM 回退**：任何支持 WebAssembly SIMD 的现代浏览器

## 目录

```
src/
  frontend/      中英双语文本前端（路由 / 拼音 / eSpeak 词典 / 数字）
  engine.ts      ONNX Runtime Web 会话与合成流程
  symbols.ts     符号表与 token 化
  audio.ts       WAV 编码
  main.ts        UI
public/model/    duration.onnx · decode.onnx · symbols.json · config.json
public/en-lexicon.txt  英文发音词典（13.6 万词，离线 eSpeak 生成）
```

## 模型来源与许可

- 基座：**Inflect-Micro-v2**（© Owen Song，Apache-2.0）
- 中文数据：**DataBaker BZNSYP**（标贝科技开源语料，仅研究用途）
- 英文数据：**LJSpeech**（public domain）
- 适配工具链：**owenawsong/Inflect** `finetune`（Apache-2.0）
- 本仓库代码：Apache-2.0

## 已知限制

- 这是 **9.36 M 小模型**做「新语言 + 新音色」适配，官方把这类适配标为
  **实验性质量**：能听懂、声调正确，但离录音棚音色有明显距离。
- **中英共用一个混合音色**（两个数据集是不同说话人），既不像原中文声也不像英文声。
- 英文走离线 eSpeak 词典，与训练分布的差距已从 18.6% 降到 5.0%（音素串字符级编辑距离）；
  剩余差异来自 eSpeak 的上下文行为（clitic 合并、闪音、功能词弱化），词表外的词用规则回退。
- 声码器对量化敏感：int8 后处理量化会显著掉质（实测相关系数从 ~1.0 掉到 0.68），
  所以这里发布的是 FP32 权重。
- 未做长文本切分（仅演示用）；超长输入会一次性推理，速度与内存都会变差。
