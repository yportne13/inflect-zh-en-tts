/**
 * Long-input handling.
 *
 * The model is trained on single sentences (median ~4 s), and running a whole
 * paragraph through it in one pass both degrades prosody and blows up memory:
 * the decoder allocates one latent frame per output frame, so cost grows with
 * the square-ish of the input. The demo used to hand the entire textarea to the
 * model at once, which is why long inputs were documented as unsupported.
 *
 * Here the text is split at natural boundaries into synthesis-sized chunks, each
 * chunk is synthesized independently, and the waveforms are concatenated with a
 * short pause plus a fade at every seam so no click is audible.
 */

/** Sentence-final punctuation, kept with the sentence it ends. */
const SENTENCE_END = /(?<=[。！？!?；;…\n])/;
/** Secondary boundaries used when a single sentence is still too long. */
const CLAUSE_END = /(?<=[，,、：:])/;

export const DEFAULT_MAX_CHARS = 60;
/** Silence inserted between chunks, in seconds. */
export const CHUNK_GAP_SECONDS = 0.12;
/** Fade applied at each chunk edge, in seconds, to avoid seam clicks. */
const FADE_SECONDS = 0.005;

function hardSplit(segment: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = segment;
  while (rest.length > maxChars) {
    // Prefer whitespace so Latin words are not cut in half.
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars / 2) cut = maxChars;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

function pack(segments: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const segment of segments) {
    if (!segment) continue;
    if (current && current.length + segment.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += segment;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Split text into chunks of at most `maxChars`, breaking on sentence
 * boundaries first, then clauses, then whitespace, then a hard cut.
 */
export function splitText(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed.split(SENTENCE_END).filter((part) => part.trim().length > 0);

  const expanded: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      expanded.push(sentence);
      continue;
    }
    const clauses = sentence.split(CLAUSE_END).filter((part) => part.trim().length > 0);
    for (const clause of clauses) {
      if (clause.length <= maxChars) expanded.push(clause);
      else expanded.push(...hardSplit(clause, maxChars));
    }
  }
  return pack(expanded, maxChars);
}

/** Apply a linear fade to the first and last `fade` samples of `audio`. */
function fadeEdges(audio: Float32Array, fade: number): void {
  const count = Math.min(fade, Math.floor(audio.length / 2));
  for (let i = 0; i < count; i += 1) {
    const gain = i / count;
    audio[i] *= gain;
    audio[audio.length - 1 - i] *= gain;
  }
}

/**
 * Concatenate synthesized chunks with a short pause between them. A gap is only
 * inserted where chunks were split, never at the very start or end.
 */
export function concatAudio(
  parts: Float32Array[],
  sampleRate: number,
  gapSeconds = CHUNK_GAP_SECONDS,
): Float32Array {
  const usable = parts.filter((part) => part.length > 0);
  if (usable.length === 0) return new Float32Array(0);
  if (usable.length === 1) return usable[0];

  const gap = Math.round(gapSeconds * sampleRate);
  const fade = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const total = usable.reduce((sum, part) => sum + part.length, 0) + gap * (usable.length - 1);

  const out = new Float32Array(total);
  let offset = 0;
  usable.forEach((part, index) => {
    const copy = part.slice();
    fadeEdges(copy, fade);
    out.set(copy, offset);
    offset += copy.length;
    if (index < usable.length - 1) offset += gap;
  });
  return out;
}
