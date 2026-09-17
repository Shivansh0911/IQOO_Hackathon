/**
 * Audio preparation, and the refusal to transcribe silence.
 *
 * Getting the sample rate or channel count wrong does not throw — it makes
 * Whisper confidently transcribe nonsense, and a confident wrong instruction is
 * the one output this whole project exists to prevent. So this is tested rather
 * than trusted.
 */

import { describe, expect, it } from 'vitest';
import {
  WHISPER_SAMPLE_RATE,
  durationSeconds,
  hasEnoughSignal,
  looksHallucinated,
  resampleTo16k,
  toMono,
} from '../src/resample.js';

/** A sine at `hz`, to check resampling keeps the shape rather than the samples. */
const tone = (hz: number, seconds: number, rate: number): Float32Array => {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

describe('toMono', () => {
  it('returns the single channel untouched', () => {
    const mono = new Float32Array([0.1, -0.2, 0.3]);
    expect(toMono([mono])).toBe(mono);
  });

  it('averages channels rather than picking one', () => {
    // Picking channel 0 is a coin flip on a stereo array mic: the voice can be
    // mostly in either channel, so one choice halves the level at random.
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([0, 0, -1]);
    expect([...toMono([left, right])]).toEqual([0.5, 0, -1]);
  });

  it('survives no channels at all', () => {
    expect(toMono([]).length).toBe(0);
  });
});

describe('resampleTo16k', () => {
  it('passes 16kHz audio through unchanged', () => {
    const input = tone(440, 0.1, WHISPER_SAMPLE_RATE);
    expect(resampleTo16k(input, WHISPER_SAMPLE_RATE)).toBe(input);
  });

  it('converts a 48kHz second into 16000 samples', () => {
    // Chrome hands us 48kHz. Whisper's feature extractor assumes 16k, and
    // getting this wrong shifts every pitch by a third of an octave.
    const input = tone(440, 1, 48_000);
    expect(resampleTo16k(input, 48_000).length).toBe(16_000);
  });

  it('converts a 44.1kHz second to within a sample of 16000', () => {
    const out = resampleTo16k(tone(440, 1, 44_100), 44_100);
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
  });

  it('keeps the waveform recognisable, not just the length', () => {
    // A resample that returned zeros or garbage would still pass a length
    // check, so assert the energy survived.
    const out = resampleTo16k(tone(440, 0.5, 48_000), 48_000);
    let peak = 0;
    for (const s of out) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeGreaterThan(0.9);
  });

  it('refuses a nonsense input rate instead of producing garbage', () => {
    expect(resampleTo16k(tone(440, 0.1, 48_000), 0).length).toBe(0);
    expect(resampleTo16k(tone(440, 0.1, 48_000), Number.NaN).length).toBe(0);
  });

  it('handles empty input', () => {
    expect(resampleTo16k(new Float32Array(0), 48_000).length).toBe(0);
  });
});

describe('durationSeconds', () => {
  it('reports seconds at the Whisper rate', () => {
    expect(durationSeconds(new Float32Array(32_000))).toBeCloseTo(2);
  });
});

describe('hasEnoughSignal', () => {
  it('rejects digital silence', () => {
    expect(hasEnoughSignal(new Float32Array(16_000), 0.012)).toBe(false);
  });

  it('rejects audio below the floor', () => {
    const quiet = new Float32Array(16_000).fill(0.005);
    expect(hasEnoughSignal(quiet, 0.012)).toBe(false);
  });

  it('accepts speech-level audio', () => {
    expect(hasEnoughSignal(tone(200, 0.5, 16_000), 0.012)).toBe(true);
  });

  it('rejects nothing at all', () => {
    expect(hasEnoughSignal(new Float32Array(0), 0.012)).toBe(false);
  });
});

describe('looksHallucinated', () => {
  it('catches what Whisper actually emits for silence', () => {
    // These are not hypothetical: they are the stock outputs the model produces
    // from near-silence, because they appear throughout its training subtitles.
    for (const text of [
      'Thank you.',
      'thank you',
      'Thanks for watching!',
      'Subtitles by the Amara.org community',
      '[BLANK_AUDIO]',
      '[ Music ]',
      '(buzzing)',
      'You',
      '...',
      '',
      '   ',
    ]) {
      expect(looksHallucinated(text), JSON.stringify(text)).toBe(true);
    }
  });

  it('lets real instructions through', () => {
    for (const text of [
      'biryani search karo',
      'add an item and check the cart total',
      'thank you for adding the item to my cart',
      'check that the results say biryani',
    ]) {
      expect(looksHallucinated(text), text).toBe(false);
    }
  });

  it('does not treat a goal that merely contains "you" as noise', () => {
    // The bare-"you" pattern is anchored for exactly this reason.
    expect(looksHallucinated('can you search for biryani')).toBe(false);
  });
});
