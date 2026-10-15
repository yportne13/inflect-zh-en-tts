/**
 * Browser-side vocoder inference, shared by the demo page and the Node check
 * (`demo/scripts/check-vocoder-page.mjs`). Keeping it DOM-free means the exact
 * code path the page runs can be verified automatically.
 *
 * The mel convention is fixed by the acoustic half and by Vocos:
 *   100-band log-mel, 24 kHz, n_fft 1024, hop 256, fmax 12 kHz, safe_log.
 * Mel files are stored row-major as [frames, 100] float32; the graph wants
 * [1, 100, frames].
 */

/** Build the [1, 100, frames] input tensor from a [frames, 100] buffer. */
export function melTensor(ort, melFloats, frames) {
  const transposed = new Float32Array(100 * frames);
  for (let f = 0; f < frames; f += 1) {
    for (let b = 0; b < 100; b += 1) {
      transposed[b * frames + f] = melFloats[f * 100 + b];
    }
  }
  return new ort.Tensor('float32', transposed, [1, 100, frames]);
}

/**
 * Run one mel through the vocoder.
 * Returns { waveform, ms } where waveform is a Float32Array of 24 kHz samples.
 */
export async function renderMel(ort, session, melFloats, frames) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const out = await session.run({ mel: melTensor(ort, melFloats, frames) });
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const tensor = out.waveform;
  const data = tensor.data;
  if (tensor.type !== 'float32') {
    throw new Error(`unexpected vocoder output type ${tensor.type}`);
  }
  return { waveform: Float32Array.from(data), ms: t1 - t0 };
}

/** Fetch a float32 dump and a small manifest (used by the page and the check). */
export async function loadDump(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return new Float32Array(await res.arrayBuffer());
}
