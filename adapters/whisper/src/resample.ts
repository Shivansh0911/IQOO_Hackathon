/**
 * Audio preparation for Whisper. Pure, and therefore tested.
 *
 * Whisper wants exactly one thing: mono PCM at 16kHz as Float32 in -1..1. A
 * microphone gives none of that reliably — Chrome hands us 48kHz, sometimes
 * stereo, at whatever the device does. Getting this wrong does not throw; it
 * produces confident transcriptions of nonsense, which is the worst failure
 * mode available. So the conversion is a pure function with tests rather than
 * three lines inlined next to the model call.
 */

/** What Whisper's feature extractor expects. Not negotiable. */
export const WHISPER_SAMPLE_RATE = 16_000;

/**
 * Averages interleaved channels down to mono.
 *
 * Averaging rather than taking channel 0: a laptop with a stereo array
 * microphone can put most of the voice in either channel, and picking one is a
 * coin flip on how loud the result is.
 */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;

  const out = new Float32Array(first.length);
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Linear resample to 16kHz.
 *
 * Linear interpolation, not a windowed sinc: speech recognition is robust to
 * the aliasing this leaves behind, and a proper filter is a lot of code to
 * maintain for no measurable gain in transcript quality. Stated plainly rather
 * than left for someone to discover.
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === WHISPER_SAMPLE_RATE || input.length === 0) return input;
  if (!Number.isFinite(inputRate) || inputRate <= 0) return new Float32Array(0);

  const ratio = inputRate / WHISPER_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = position - lower;
    out[i] = (input[lower] ?? 0) * (1 - weight) + (input[upper] ?? 0) * weight;
  }
  return out;
}

/** Seconds of audio, for the "too short to be an instruction" check. */
export function durationSeconds(samples: Float32Array, rate = WHISPER_SAMPLE_RATE): number {
  return rate > 0 ? samples.length / rate : 0;
}

/**
 * Whisper hallucinates on silence — famously, it emits things like "Thank you."
 * or subtitle credits when given nothing. So we refuse to transcribe audio that
 * carries no speech rather than letting the model invent an instruction, which
 * is a category of bug the rest of this project exists to prevent.
 */
export function hasEnoughSignal(samples: Float32Array, floor: number): boolean {
  if (samples.length === 0) return false;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak >= floor;
}

/**
 * Whisper's known non-speech outputs.
 *
 * When it is given near-silence or noise it does not return an empty string; it
 * returns one of a small set of stock phrases, because those appear in its
 * training subtitles. Treating them as a transcript would hand the planner an
 * instruction nobody said.
 */
const HALLUCINATION_PATTERNS: readonly RegExp[] = [
  /^\s*thank you\.?\s*$/i,
  /^\s*thanks for watching[.!]?\s*$/i,
  /^\s*subtitles? by.*$/i,
  /^\s*amara\.org.*$/i,
  /^\s*\[\s*(music|silence|blank_audio|inaudible|applause)\s*\]\s*$/i,
  /^\s*\(\s*(music|silence|buzzing|clicking)\s*\)\s*$/i,
  /^\s*you\s*$/i,
  /^\s*[.…,!?-]*\s*$/,
];

/** True when the transcript is one of Whisper's stock non-speech outputs. */
export function looksHallucinated(transcript: string): boolean {
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(transcript));
}
