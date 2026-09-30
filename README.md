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

> 当前仓库里的权重是**中英双语微调的中间 checkpoint（step 3000 / 6000）**，
> 训练完成后会替换为最终版本。中文部分来自 DataBaker BZNSYP 上约 12 小时的
> 适配训练，英文部分来自 LJSpeech 的 6 小时子集。

## 架构

```
text
 ├─ 中文片段 → pinyin-pro →「声母+韵母 IPA + 声调数字」
 ├─ 英文片段 → CMUdict    → ARPAbet → IPA（含重音标记）
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

**英文**：训练时用的是 eSpeak NG 的 IPA，但 eSpeak 没法在浏览器里跑，所以改用
CMUdict（13 万词）取 ARPAbet，再映射到同一套 IPA 字母表，并补上 eSpeak 风格
的重音标记（`ˈ`/`ˌ`）与长音（`iː`、`uː`、`ɑː`…）。词表外的词走一套简易
字母到音素的回退规则。

> 因此英文读音与训练时的 eSpeak 音素**不完全一致**，是这套实现里最大的近似。
> 数字按位拼读（`359.9` → *three five nine point nine*），因为模型没在英文数字上训练过。

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
  frontend/      中英双语文本前端（路由 / 拼音 / CMUdict / 数字）
  engine.ts      ONNX Runtime Web 会话与合成流程
  symbols.ts     符号表与 token 化
  audio.ts       WAV 编码
  main.ts        UI
public/model/    duration.onnx · decode.onnx · symbols.json · config.json
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
- 英文走 CMUdict 近似，读音与训练时的 eSpeak 音素不完全一致；词表外的词用规则回退。
- 声码器对量化敏感：int8 后处理量化会显著掉质（实测相关系数从 ~1.0 掉到 0.68），
  所以这里发布的是 FP32 权重。
- 未做长文本切分（仅演示用）；超长输入会一次性推理，速度与内存都会变差。
