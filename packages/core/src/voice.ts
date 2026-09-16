/**
 * Voice defences — the pure, portable half.
 *
 * GOVERNING RULE: THE TRANSCRIPT IS A PROPOSAL, NEVER A COMMAND.
 * Nothing executes until a human has seen and confirmed the goal. Not even in
 * demo mode. Our output is not proofread before it acts — a bad transcript
 * becomes a real click on a real screen.
 *
 * Everything here is platform-agnostic on purpose: the filler blocklist, the
 * script check, the lexicon matching and the correction table are identical on
 * Android, where SpeechRecognizer replaces the Web Speech API. Only the capture
 * itself is platform-specific.
 */

/** Which locale was PINNED. Never auto-detected (defence 2). */
export type VoiceLocale = 'en-IN' | 'hi-IN' | 'en-US';

export const VOICE_LOCALES: readonly { id: VoiceLocale; label: string }[] = [
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi-IN', label: 'हिन्दी (भारत)' },
  { id: 'en-US', label: 'English (US)' },
];

// ─── Defence 1: hallucination on silence ───────────────────────────────────
//
// Speech models emit plausible filler when handed silence or room noise — the
// classic "thank you for watching" from a model trained on video. Three
// independent layers, and a discarded transcript can NEVER start a run. Failing
// closed is correct: the cost of a wrongly-discarded transcript is one repeat,
// and the cost of a wrongly-accepted one is a real tap on a real app.

/** Below this RMS the microphone heard a room, not a person. */
export const RMS_FLOOR = 0.012;

/** Under this much voiced audio there is not enough signal to trust. */
export const MIN_VOICED_MS = 400;

/** Recognition confidence below this is a guess, not a transcript. */
export const MIN_CONFIDENCE = 0.5;

/**
 * ONE extensible constant, as specified. Everything a speech model says when it
 * has heard nothing worth transcribing.
 */
export const FILLER_BLOCKLIST: readonly string[] = [
  'thank you for watching',
  'thanks for watching',
  'thank you',
  'thanks',
  'subscribe',
  'please subscribe',
  'like and subscribe',
  'you',
  'yeah',
  'okay',
  'ok',
  'hmm',
  'mm',
  'uh',
  'um',
  'ah',
  'oh',
  'bye',
  'hello',
  'hi',
  'test',
  'testing',
  'the',
  'a',
  'so',
  'and',
  'music',
  '[music]',
  '[silence]',
  '[inaudible]',
  'foreign',
  'shukriya',
  'dhanyavaad',
  'धन्यवाद',
  'नमस्ते',
];

export type RejectionReason =
  | 'too-quiet'
  | 'too-short'
  | 'low-confidence'
  | 'filler'
  | 'empty'
  | 'surprise-script';

export interface GateInput {
  readonly transcript: string;
  readonly confidence: number;
  /** Peak RMS observed while recording. */
  readonly peakRms: number;
  /** Milliseconds of audio above the RMS floor. */
  readonly voicedMs: number;
  readonly locale: VoiceLocale;
}

export interface GateVerdict {
  readonly accepted: boolean;
  readonly reason: RejectionReason | null;
  /** Shown to the user. Says what to do, not just what went wrong. */
  readonly detail: string;
}

function normalise(text: string): string {
  // Only for COMPARISON against the blocklist. The transcript itself is never
  // rewritten (defence 3).
  return text.toLowerCase().replace(/[.,!?;:"'()\-–—]/g, '').replace(/\s+/g, ' ').trim();
}

export function isFiller(transcript: string): boolean {
  const clean = normalise(transcript);
  if (clean === '') return true;
  if (FILLER_BLOCKLIST.includes(clean)) return true;
  // A transcript made only of blocklisted words is still filler:
  // "thanks, okay, um" is nobody's instruction.
  const words = clean.split(' ');
  return words.length <= 4 && words.every((w) => FILLER_BLOCKLIST.includes(w));
}

// ─── Defence 2: accent flipping the language ───────────────────────────────

export type UnicodeScript = 'latin' | 'devanagari' | 'other';

/** Which scripts a transcript actually contains. */
export function scriptsIn(text: string): Set<UnicodeScript> {
  const found = new Set<UnicodeScript>();
  for (const char of text) {
    if (/\p{Script=Latin}/u.test(char)) found.add('latin');
    else if (/\p{Script=Devanagari}/u.test(char)) found.add('devanagari');
    else if (/\p{L}/u.test(char)) found.add('other');
  }
  return found;
}

/** What the pinned locale is expected to produce. */
export function expectedScripts(locale: VoiceLocale): Set<UnicodeScript> {
  // hi-IN legitimately produces either: Hindi speakers dictate in Devanagari,
  // and Hinglish comes back in Latin. en-IN should not produce Devanagari.
  return locale === 'hi-IN' ? new Set<UnicodeScript>(['devanagari', 'latin']) : new Set<UnicodeScript>(['latin']);
}

/**
 * A script the pinned locale should not have produced means recognition
 * probably switched languages on an accent. It does not discard the transcript
 * — it forces the review step to be explicit about it.
 */
export function hasSurpriseScript(transcript: string, locale: VoiceLocale): boolean {
  const expected = expectedScripts(locale);
  for (const script of scriptsIn(transcript)) {
    if (!expected.has(script)) return true;
  }
  return false;
}

/** The energy, confidence and filler gates, in order. Pure and total. */
export function applyGates(input: GateInput): GateVerdict {
  if (input.transcript.trim() === '') {
    return { accepted: false, reason: 'empty', detail: 'Nothing was transcribed. Hold the mic and speak again.' };
  }
  if (input.peakRms < RMS_FLOOR) {
    return {
      accepted: false,
      reason: 'too-quiet',
      detail: 'That was too quiet to be sure of — the mic mostly heard the room. Try again, a little closer.',
    };
  }
  if (input.voicedMs < MIN_VOICED_MS) {
    return {
      accepted: false,
      reason: 'too-short',
      detail: `Only ${Math.round(input.voicedMs)}ms of speech. Hold the mic while you talk and say the whole goal.`,
    };
  }
  if (input.confidence > 0 && input.confidence < MIN_CONFIDENCE) {
    return {
      accepted: false,
      reason: 'low-confidence',
      detail: `Recognition was only ${Math.round(input.confidence * 100)}% sure. Say it again, a little slower.`,
    };
  }
  if (isFiller(input.transcript)) {
    return {
      accepted: false,
      reason: 'filler',
      detail: `Heard "${input.transcript.trim()}", which is what speech models produce from silence. Discarded rather than acted on.`,
    };
  }
  return { accepted: true, reason: null, detail: 'Accepted for review.' };
}

// ─── Defence 4: proper nouns ───────────────────────────────────────────────

export interface Substitution {
  readonly from: string;
  readonly to: string;
  /** 'correction' outranks 'lexicon' — a human said so once already. */
  readonly source: 'correction' | 'lexicon';
  /** Character offset in the ORIGINAL transcript, so the diff is revertible. */
  readonly at: number;
}

export interface MatchResult {
  readonly text: string;
  readonly substitutions: readonly Substitution[];
}

/** Levenshtein, capped: we only care about near-misses. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
    if (Math.min(...current) > cap) return cap + 1;
  }
  return previous[b.length] ?? cap + 1;
}

/**
 * Distance allowed, scaled to word length.
 *
 * Short words demand exactness — "cat" and "cart" are different words, and a
 * fuzzy match there is a guess dressed as a correction. Longer words get two
 * edits, because that is what a real mishearing of a proper noun looks like:
 * "Dekkan" for "Deccan" is two substitutions, and refusing it would make the
 * whole lexicon useless on exactly the names it exists to fix.
 *
 * Every substitution is shown as a revertible diff before anything runs, which
 * is what makes the looser threshold safe.
 */
function allowedDistance(word: string): number {
  if (word.length <= 4) return 0;
  if (word.length === 5) return 1;
  return 2;
}

/**
 * Fuzzy-matches transcript words against a lexicon of names that are actually
 * on screen, plus any learned corrections.
 *
 * NEVER applied to text destined for TypeText — a search query passes through
 * verbatim. That is enforced by only ever calling this on the GOAL, and the
 * goal is what the user confirms in review.
 */
export function applyLexicon(
  transcript: string,
  lexicon: readonly string[],
  corrections: ReadonlyMap<string, string>,
): MatchResult {
  const substitutions: Substitution[] = [];
  let offset = 0;

  const out = transcript
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) {
        offset += token.length;
        return token;
      }
      const at = offset;
      offset += token.length;

      const bare = token.replace(/[.,!?;:"']/g, '');
      const trailing = token.slice(bare.length);
      const key = bare.toLowerCase();

      // Learned corrections first: a human already ruled on this one.
      const corrected = corrections.get(key);
      if (corrected && corrected.toLowerCase() !== key) {
        substitutions.push({ from: bare, to: corrected, source: 'correction', at });
        return corrected + trailing;
      }

      if (bare.length < 4) return token;
      let best: { word: string; distance: number } | null = null;
      for (const candidate of lexicon) {
        const distance = editDistance(key, candidate.toLowerCase());
        if (distance === 0) return token;
        if (distance <= allowedDistance(bare) && (!best || distance < best.distance)) {
          best = { word: candidate, distance };
        }
      }
      if (best) {
        substitutions.push({ from: bare, to: best.word, source: 'lexicon', at });
        return best.word + trailing;
      }
      return token;
    })
    .join('');

  return { text: out, substitutions };
}

/**
 * Builds the lexicon from what is actually on screen plus known app names.
 * Single words only — multi-word names are matched by their distinctive word.
 */
export function buildLexicon(screenTexts: readonly string[], appNames: readonly string[] = []): string[] {
  const words = new Set<string>();
  for (const name of appNames) words.add(name);
  for (const text of screenTexts) {
    for (const word of text.split(/[\s,·•|/]+/)) {
      const bare = word.replace(/[.,!?;:"'()]/g, '');
      // Capitalised words of reasonable length are the proper nouns worth
      // matching; "the" and "of" are not, and numbers are never names.
      // Unicode property escapes rather than a Devanagari character range: the
      // range spans combining marks, which a character class handles wrongly.
      const looksLikeAName = /^\p{Lu}/u.test(bare) || /^\p{Script=Devanagari}/u.test(bare);
      if (bare.length >= 4 && looksLikeAName && !/\d/.test(bare)) words.add(bare);
    }
  }
  return [...words];
}

// ─── Defence 5: it never learns ────────────────────────────────────────────

export interface CorrectionEntry {
  readonly heard: string;
  readonly corrected: string;
  readonly hits: number;
  readonly locale: VoiceLocale;
  readonly updatedAt: number;
}

/**
 * Diffs what was proposed against what the user actually confirmed, and turns
 * each changed word into a learned correction.
 *
 * There is no separate "teach the app" flow, deliberately: the correction IS
 * the teaching. Fixing a word once in review is the whole interaction.
 */
export function diffCorrections(
  proposed: string,
  confirmed: string,
  locale: VoiceLocale,
  now: number,
): CorrectionEntry[] {
  const before = proposed.trim().split(/\s+/);
  const after = confirmed.trim().split(/\s+/);
  // Only same-length edits are safely attributable word-to-word. A user who
  // rewrote the whole sentence taught us nothing about any single word.
  if (before.length !== after.length) return [];

  const learned: CorrectionEntry[] = [];
  for (let i = 0; i < before.length; i += 1) {
    const heard = (before[i] ?? '').replace(/[.,!?;:"']/g, '').toLowerCase();
    const corrected = (after[i] ?? '').replace(/[.,!?;:"']/g, '');
    if (heard === '' || corrected === '') continue;
    if (heard === corrected.toLowerCase()) continue;
    // A completely different word is a rewrite, not a mishearing.
    if (editDistance(heard, corrected.toLowerCase(), 5) > 4) continue;
    learned.push({ heard, corrected, hits: 1, locale, updatedAt: now });
  }
  return learned;
}

/** Merges new learning into the stored table, incrementing hit counts. */
export function mergeCorrections(
  existing: readonly CorrectionEntry[],
  learned: readonly CorrectionEntry[],
): CorrectionEntry[] {
  const table = new Map(existing.map((e) => [`${e.locale}:${e.heard}`, e]));
  for (const entry of learned) {
    const key = `${entry.locale}:${entry.heard}`;
    const previous = table.get(key);
    table.set(
      key,
      previous
        ? { ...previous, corrected: entry.corrected, hits: previous.hits + 1, updatedAt: entry.updatedAt }
        : entry,
    );
  }
  return [...table.values()].sort((a, b) => b.hits - a.hits || b.updatedAt - a.updatedAt);
}

/** The correction map for one locale, highest-hit first. */
export function correctionsFor(entries: readonly CorrectionEntry[], locale: VoiceLocale): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.locale === locale && !map.has(entry.heard)) map.set(entry.heard, entry.corrected);
  }
  return map;
}
