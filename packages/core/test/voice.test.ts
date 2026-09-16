/**
 * The five voice defences, each tested by name.
 *
 * These matter more than most tests in the repo: a bad transcript becomes a real
 * click on a real app, and nobody proofreads it in between.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGates,
  applyLexicon,
  buildLexicon,
  correctionsFor,
  diffCorrections,
  editDistance,
  expectedScripts,
  hasSurpriseScript,
  isFiller,
  mergeCorrections,
  MIN_CONFIDENCE,
  MIN_VOICED_MS,
  RMS_FLOOR,
  scriptsIn,
} from '../src/voice.js';
import type { CorrectionEntry, GateInput } from '../src/voice.js';

const good: GateInput = {
  transcript: 'biryani search karo aur pehla restaurant kholo',
  confidence: 0.92,
  peakRms: 0.08,
  voicedMs: 1800,
  locale: 'en-IN',
};

describe('defence 1 — hallucination on silence', () => {
  it('accepts a real instruction', () => {
    expect(applyGates(good)).toMatchObject({ accepted: true, reason: null });
  });

  it('rejects audio below the RMS floor', () => {
    const r = applyGates({ ...good, peakRms: RMS_FLOOR - 0.001 });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('too-quiet');
    expect(r.detail).toMatch(/heard the room/);
  });

  it('rejects under 400ms of voiced audio', () => {
    const r = applyGates({ ...good, voicedMs: MIN_VOICED_MS - 1 });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('too-short');
  });

  it('rejects low confidence', () => {
    const r = applyGates({ ...good, confidence: MIN_CONFIDENCE - 0.01 });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('low-confidence');
  });

  it('rejects the classic filler a model emits from silence', () => {
    for (const filler of ['thank you for watching', 'Thanks for watching.', 'you', 'um', '[music]', 'धन्यवाद']) {
      expect(isFiller(filler), filler).toBe(true);
    }
  });

  it('rejects a short transcript made only of filler words', () => {
    expect(isFiller('thanks okay um')).toBe(true);
  });

  it('does NOT reject a real goal that happens to contain a filler word', () => {
    expect(isFiller('ok now open the cart and check the total')).toBe(false);
    expect(isFiller('thank you page ka heading check karo')).toBe(false);
  });

  it('rejects an empty transcript', () => {
    expect(applyGates({ ...good, transcript: '   ' }).reason).toBe('empty');
  });

  it('fails CLOSED — every rejection is accepted:false, never a warning', () => {
    const rejections = [
      { ...good, peakRms: 0 },
      { ...good, voicedMs: 0 },
      { ...good, confidence: 0.1 },
      { ...good, transcript: 'thank you' },
      { ...good, transcript: '' },
    ];
    for (const input of rejections) expect(applyGates(input).accepted).toBe(false);
  });

  it('ignores confidence when the platform does not report it', () => {
    // Web Speech gives 0 for some engines; that is absence, not low confidence.
    expect(applyGates({ ...good, confidence: 0 }).accepted).toBe(true);
  });
});

describe('defence 2 — accent flipping the language', () => {
  it('identifies the scripts present', () => {
    expect([...scriptsIn('open the cart')]).toEqual(['latin']);
    expect([...scriptsIn('कार्ट खोलो')]).toEqual(['devanagari']);
    expect([...scriptsIn('cart खोलो')].sort()).toEqual(['devanagari', 'latin']);
  });

  it('expects Latin only for the English locales', () => {
    expect([...expectedScripts('en-IN')]).toEqual(['latin']);
    expect([...expectedScripts('en-US')]).toEqual(['latin']);
  });

  it('accepts either script for hi-IN, because Hinglish comes back in Latin', () => {
    const expected = expectedScripts('hi-IN');
    expect(expected.has('devanagari')).toBe(true);
    expect(expected.has('latin')).toBe(true);
  });

  it('flags Devanagari arriving from an English locale', () => {
    expect(hasSurpriseScript('कार्ट खोलो', 'en-IN')).toBe(true);
  });

  it('does not flag Hinglish in Latin from en-IN', () => {
    expect(hasSurpriseScript('biryani search karo', 'en-IN')).toBe(false);
  });

  it('does not flag Devanagari from hi-IN', () => {
    expect(hasSurpriseScript('पहले रेस्टोरेंट से एक आइटम कार्ट में डालो', 'hi-IN')).toBe(false);
  });
});

describe('defence 3 — code-switching is never normalised', () => {
  it('passes Hinglish through the gates untouched', () => {
    const hinglish = 'Tiffin kholo aur cart ka total check karo';
    const r = applyGates({ ...good, transcript: hinglish });
    expect(r.accepted).toBe(true);
  });

  it('never rewrites the transcript in the lexicon pass when nothing matches', () => {
    const hinglish = 'biryani search karo aur pehla restaurant kholo';
    const out = applyLexicon(hinglish, ['Deccan', 'Charminar'], new Map());
    expect(out.text).toBe(hinglish);
    expect(out.substitutions).toHaveLength(0);
  });

  it('leaves Devanagari alone', () => {
    const devanagari = 'कार्ट खोलो और टोटल चेक करो';
    expect(applyLexicon(devanagari, ['Deccan'], new Map()).text).toBe(devanagari);
  });
});

describe('defence 4 — proper nouns', () => {
  it('measures edit distance with a cap', () => {
    expect(editDistance('deccan', 'deccan')).toBe(0);
    expect(editDistance('decan', 'deccan')).toBe(1);
    expect(editDistance('completely', 'different', 3)).toBeGreaterThan(3);
  });

  it('corrects a near-miss on a name that is actually on screen', () => {
    const out = applyLexicon('open Dekkan Dastarkhwan', ['Deccan', 'Dastarkhwan'], new Map());
    expect(out.text).toContain('Deccan');
    expect(out.substitutions[0]).toMatchObject({ from: 'Dekkan', to: 'Deccan', source: 'lexicon' });
  });

  it('records the offset, so the diff is revertible', () => {
    const out = applyLexicon('open Dekkan now', ['Deccan'], new Map());
    const sub = out.substitutions[0];
    expect(sub?.at).toBe(5);
    expect('open Dekkan now'.slice(sub?.at ?? 0, (sub?.at ?? 0) + 6)).toBe('Dekkan');
  });

  it('requires exactness on short words, where a fuzzy match would be a guess', () => {
    const out = applyLexicon('go to cat', ['cart'], new Map());
    expect(out.substitutions).toHaveLength(0);
  });

  it('never substitutes a word that is already an exact lexicon entry', () => {
    expect(applyLexicon('open Deccan', ['Deccan', 'Dessan'], new Map()).substitutions).toHaveLength(0);
  });

  it('builds the lexicon from what is visible, not from a fixed list', () => {
    const lexicon = buildLexicon(['Deccan Dastarkhwan Biryani, Hyderabadi 4.5 32 min', 'the cart is empty'], ['Tiffin']);
    expect(lexicon).toContain('Deccan');
    expect(lexicon).toContain('Dastarkhwan');
    expect(lexicon).toContain('Tiffin');
    // Lowercase filler and numbers are not proper nouns.
    expect(lexicon).not.toContain('the');
    expect(lexicon).not.toContain('4.5');
  });

  it('gives a learned correction priority over a fuzzy match', () => {
    const corrections = new Map([['dekkan', 'Deccan Dastarkhwan']]);
    const out = applyLexicon('open Dekkan', ['Dekkanish'], corrections);
    expect(out.text).toContain('Deccan Dastarkhwan');
    expect(out.substitutions[0]?.source).toBe('correction');
  });
});

describe('defence 5 — it never learns', () => {
  it('learns from a single word the user fixed in review', () => {
    const learned = diffCorrections('open Dekkan now', 'open Deccan now', 'en-IN', 1000);
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({ heard: 'dekkan', corrected: 'Deccan', hits: 1, locale: 'en-IN' });
  });

  it('learns nothing from a full rewrite, which teaches nothing about a word', () => {
    expect(diffCorrections('open the cart', 'check the total is under 500', 'en-IN', 1)).toHaveLength(0);
  });

  it('ignores a replacement that is a different word rather than a mishearing', () => {
    expect(diffCorrections('open cart', 'open checkout', 'en-IN', 1)).toHaveLength(0);
  });

  it('increments the hit count when the same correction is made again', () => {
    const first = diffCorrections('open Dekkan', 'open Deccan', 'en-IN', 1);
    const merged = mergeCorrections(first, diffCorrections('open Dekkan', 'open Deccan', 'en-IN', 2));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.hits).toBe(2);
  });

  it('scopes corrections per locale', () => {
    const table: CorrectionEntry[] = [
      { heard: 'dekkan', corrected: 'Deccan', hits: 3, locale: 'en-IN', updatedAt: 1 },
      { heard: 'dekkan', corrected: 'डेक्कन', hits: 1, locale: 'hi-IN', updatedAt: 2 },
    ];
    expect(correctionsFor(table, 'en-IN').get('dekkan')).toBe('Deccan');
    expect(correctionsFor(table, 'hi-IN').get('dekkan')).toBe('डेक्कन');
    expect(correctionsFor(table, 'en-US').size).toBe(0);
  });

  it('is the whole demo moment: correct once, then it comes out right', () => {
    // 1. The model mishears.
    const heard = 'open Dekkan Dastarkhwan';
    // 2. The user fixes one word in review.
    const confirmed = 'open Deccan Dastarkhwan';
    const table = mergeCorrections([], diffCorrections(heard, confirmed, 'en-IN', 1));
    // 3. Said again, it comes out right without the user touching anything.
    const again = applyLexicon(heard, [], correctionsFor(table, 'en-IN'));
    expect(again.text).toBe(confirmed);
    expect(again.substitutions[0]?.source).toBe('correction');
  });
});
