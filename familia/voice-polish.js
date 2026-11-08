/**
 * Voice polish: one sound for every voice a kid hears.
 *
 * Family recordings (the family page, in the browser), Mo's cloud voice
 * (supabase/functions/speak) and the native-speaker lesson voices
 * (scripts/voice/polish-files.mjs) all go through polishVoice(), so they play
 * at the same loudness with the silence trimmed:
 *
 *   1. A gentle low cut (80 Hz) for fan, AC and traffic rumble.
 *   2. Trim the silence at the start and end (trimSilence: every voice file has at
 *      most MAX_START_SILENCE_S before the voice and MAX_END_SILENCE_S after it).
 *   3. Quiet the gaps between words a little (at most 10 dB), never the
 *      voice itself, so TV and room noise drop without a robotic sound.
 *   4. Bring the spoken parts to VOICE_LEVEL_DB, with a soft limit on peaks.
 *
 * Plain JavaScript with no imports: it runs in browsers, Deno and Node.
 * Input and output are mono Float32Array samples (-1..1).
 */

/** Loudness of the spoken parts for every voice (dBFS, average power of the voiced 20 ms frames). */
export const VOICE_LEVEL_DB = -24;
/** Peaks never go above this (dBFS). */
export const PEAK_CEILING_DB = -1;
/** Silence kept around the voice while polishing, before the final trim (trimSilence). */
export const PADDING_S = 0.16;
/** The most silence any voice file may have before and after the voice. */
export const MAX_START_SILENCE_S = 0.1;
export const MAX_END_SILENCE_S = 0.15;
/** What a trim leaves: a little inside those limits, so no first or last sound is clipped. */
const KEEP_START_S = 0.08;
const KEEP_END_S = 0.12;

const FRAME_S = 0.02;
const MIN_SPEECH_FRAMES = 3; // 60 ms above the threshold counts as voice (not a click)
const HOLD_FRAMES = 4; // gaps stay open 80 ms around the voice (soft consonants, word endings)
const MAX_GAP_REDUCTION_DB = 10;
const FADE_S = 0.01;

const dbOf = (power) => 10 * Math.log10(power + 1e-12);
const linOf = (db) => Math.pow(10, db / 20);

/** Low cut (second-order high-pass, Q 0.707). */
function lowCut(x, sampleRate, hz = 80) {
  const w = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0;
  const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Polishes one recording. Returns null when no voice is found (keep the
 * original then), otherwise the new samples and what was done.
 *
 * @param {Float32Array} input mono samples
 * @param {number} sampleRate
 * @param {{ levelDb?: number, paddingS?: number }} [options]
 * @returns {{ samples: Float32Array, startS: number, endS: number, gainDb: number, levelDb: number } | null}
 */
export function polishVoice(input, sampleRate, options = {}) {
  const target = options.levelDb ?? VOICE_LEVEL_DB;
  const padding = Math.round((options.paddingS ?? PADDING_S) * sampleRate);
  const frame = Math.max(1, Math.round(FRAME_S * sampleRate));
  const x = lowCut(input, sampleRate);

  // Loudness of each 20 ms frame
  const frames = Math.floor(x.length / frame);
  if (frames < MIN_SPEECH_FRAMES) return null;
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += x[i] * x[i];
    db[f] = dbOf(sum / frame);
  }

  // Background noise = the quietest tenth; voice = clearly above it
  const sorted = Array.from(db).sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = Math.max(noise + 12, -50);
  const loud = Array.from(db, (d) => d > threshold);

  // Voice = runs of at least MIN_SPEECH_FRAMES loud frames
  const voiced = new Array(frames).fill(false);
  for (let f = 0; f < frames; ) {
    if (!loud[f]) { f++; continue; }
    let end = f;
    while (end < frames && loud[end]) end++;
    if (end - f >= MIN_SPEECH_FRAMES) for (let k = f; k < end; k++) voiced[k] = true;
    f = end;
  }
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return null;

  const start = Math.max(0, first * frame - padding);
  const end = Math.min(x.length, (last + 1) * frame + padding);

  // Level of the spoken parts
  let power = 0, count = 0;
  for (let f = first; f <= last; f++) {
    if (voiced[f]) { power += Math.pow(10, db[f] / 10); count++; }
  }
  const levelDb = dbOf(power / count);

  // Gap gain per frame: open around the voice, gently lower elsewhere
  const open = new Array(frames).fill(false);
  for (let f = 0; f < frames; f++) {
    if (!voiced[f]) continue;
    for (let k = Math.max(0, f - HOLD_FRAMES); k <= Math.min(frames - 1, f + HOLD_FRAMES); k++) open[k] = true;
  }
  const frameGain = Array.from(db, (d, f) =>
    open[f] ? 1 : linOf(-Math.min(MAX_GAP_REDUCTION_DB, Math.max(0, threshold - d + 3))),
  );

  // Smooth the gap gain sample by sample (opens in 5 ms, closes in 60 ms)
  const attack = Math.exp(-1 / (0.005 * sampleRate));
  const release = Math.exp(-1 / (0.06 * sampleRate));
  const out = new Float32Array(end - start);
  let g = frameGain[Math.min(frames - 1, Math.floor(start / frame))];
  let peak = 0;
  for (let i = start; i < end; i++) {
    const want = frameGain[Math.min(frames - 1, Math.floor(i / frame))];
    const k = want > g ? attack : release;
    g = want + (g - want) * k;
    const v = x[i] * g;
    out[i - start] = v;
    peak = Math.max(peak, Math.abs(v));
  }

  // Loudness, with peaks allowed 6 dB into the soft limiter at most
  const ceiling = linOf(PEAK_CEILING_DB);
  let gainDb = Math.max(-15, Math.min(20, target - levelDb));
  if (peak > 0) gainDb = Math.min(gainDb, 20 * Math.log10((ceiling * 2) / peak));
  const gain = linOf(gainDb);
  const knee = 0.6;
  const fade = Math.max(1, Math.round(FADE_S * sampleRate));
  for (let i = 0; i < out.length; i++) {
    let v = out[i] * gain;
    const a = Math.abs(v);
    if (a > knee) v = Math.sign(v) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
    if (i < fade) v *= i / fade;
    if (out.length - 1 - i < fade) v *= (out.length - 1 - i) / fade;
    out[i] = v;
  }

  return { samples: trimSilence(out, sampleRate).samples, startS: start / sampleRate, endS: end / sampleRate, gainDb, levelDb };
}

/**
 * How much silence is before and after the voice, in seconds (null: no voice found).
 * A sound is 30 ms or more within 40 dB of the file's loudest moment and clearly
 * above any background noise, or any moment at all within 30 dB of the loudest. The one measure used by the trim, the audit and the test.
 *
 * @param {Float32Array} samples mono samples
 * @param {number} sampleRate
 * @returns {{ startS: number, endS: number, durationS: number } | null}
 */
export function measureSilence(samples, sampleRate) {
  const frame = Math.max(1, Math.round(0.01 * sampleRate));
  const frames = Math.floor(samples.length / frame);
  if (frames < 3) return null;
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i] * samples[i];
    db[f] = dbOf(sum / frame);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const peak = sorted[sorted.length - 1];
  const noise = sorted[Math.floor(sorted.length * 0.05)];
  if (peak < -55) return null;
  const threshold = Math.max(peak - 40, Math.min(noise + 10, peak - 35), -60);
  const clear = peak - 30; // Even one frame this loud is a real sound (a plosive, a short syllable), never silence
  let first = -1, last = -1;
  for (let f = 0; f < frames; ) {
    if (db[f] <= threshold) { f++; continue; }
    let end = f, loud = false;
    while (end < frames && db[end] > threshold) { loud = loud || db[end] > clear; end++; }
    if (end - f >= 3 || loud) { if (first < 0) first = f; last = end - 1; }
    f = end;
  }
  if (first < 0) return null;
  const durationS = samples.length / sampleRate;
  return { startS: (first * frame) / sampleRate, endS: Math.max(0, durationS - ((last + 1) * frame) / sampleRate), durationS };
}

/**
 * Cuts the dead air at either end, down to the limits above, and never into the voice.
 * Only the side that is over its limit changes. Used by polishVoice, the mixed
 * "everyone together" lines and scripts/voice/silence-audit.mjs.
 *
 * @param {Float32Array} samples mono samples
 * @param {number} sampleRate
 * @returns {{ samples: Float32Array, cutStartS: number, cutEndS: number }}
 */
export function trimSilence(samples, sampleRate) {
  // Cutting can change what counts as the quiet floor: measure again until it's inside the limits
  let current = trimOnce(samples, sampleRate);
  for (let i = 0; i < 3 && (current.cutStartS || current.cutEndS); i++) {
    const again = trimOnce(current.samples, sampleRate);
    if (!again.cutStartS && !again.cutEndS) break;
    current = { samples: again.samples, cutStartS: current.cutStartS + again.cutStartS, cutEndS: current.cutEndS + again.cutEndS };
  }
  return current;
}

function trimOnce(samples, sampleRate) {
  const m = measureSilence(samples, sampleRate);
  if (!m) return { samples, cutStartS: 0, cutEndS: 0 };
  const cutStartS = m.startS > MAX_START_SILENCE_S ? m.startS - KEEP_START_S : 0;
  const cutEndS = m.endS > MAX_END_SILENCE_S ? m.endS - KEEP_END_S : 0;
  if (!cutStartS && !cutEndS) return { samples, cutStartS: 0, cutEndS: 0 };
  const from = Math.round(cutStartS * sampleRate);
  const to = samples.length - Math.round(cutEndS * sampleRate);
  const out = samples.slice(from, to);
  // A soft edge where the cut was made (no click)
  const fade = Math.max(1, Math.round(0.005 * sampleRate));
  if (cutStartS) for (let i = 0; i < fade && i < out.length; i++) out[i] *= i / fade;
  if (cutEndS) for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
  return { samples: out, cutStartS, cutEndS };
}

/** Mono 16-bit WAV bytes. */
export function encodeWav(samples, sampleRate) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Samples from 16-bit little-endian mono PCM (OpenAI's "pcm" voice format). */
export function fromPcm16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Mono samples and sample rate from a WAV file (16-bit, 24-bit or 32-bit float; channels are mixed). */
export function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let at = 12, format = 0, channels = 1, sampleRate = 0, bits = 16;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      const width = bits / 8, n = Math.floor(size / (width * channels));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          if (format === 3 && bits === 32) sum += view.getFloat32(p, true);
          else if (bits === 16) sum += view.getInt16(p, true) / 0x8000;
          else if (bits === 24) sum += ((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) << 8 >> 8) / 0x800000;
          else throw new Error(`unsupported WAV: ${bits}-bit`);
        }
        out[i] = sum / channels;
      }
      return { samples: out, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error('WAV has no audio');
}
