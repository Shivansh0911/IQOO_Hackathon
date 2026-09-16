import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@origo/core';
import {
  assemblePrompt,
  buildUserPrompt,
  formatHistory,
  HISTORY_WINDOW,
  SYSTEM_PROMPT,
  SECTION_ADDRESSING,
} from '../src/prompt.js';
import type { PlanRequest, StepSummary } from '../src/planner.js';

const SCREEN = '[{"i":0,"role":"edit","desc":"Search","ed":1},{"i":1,"role":"btn","text":"Cart","clk":1}]';

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  goal: 'search for biryani',
  screenJson: SCREEN,
  history: [],
  ...over,
});

const step = (n: number, over: Partial<StepSummary> = {}): StepSummary => ({
  step: n,
  action: `Tap(${n})`,
  outcome: 'ok',
  note: 'opened something',
  ...over,
});

describe('the system prompt', () => {
  it('is deterministic — the same constant every time', () => {
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it('defines all seven actions with their exact JSON shapes', () => {
    // Targeted actions lead with "node" (measured: it makes the model commit to
    // an element before an action); the three untargeted ones lead with "type".
    for (const type of ['Tap', 'TypeText', 'Scroll', 'Assert']) {
      expect(SYSTEM_PROMPT).toContain(`"type":"${type}"`);
    }
    for (const type of ['PressKey', 'Wait', 'Finish']) {
      expect(SYSTEM_PROMPT).toContain(`{"type":"${type}"`);
    }
  });

  it('states the addressing rule explicitly', () => {
    expect(SYSTEM_PROMPT).toContain(SECTION_ADDRESSING);
    expect(SYSTEM_PROMPT).toMatch(/ONLY by its "i" number/);
    expect(SYSTEM_PROMPT).toMatch(/Never use CSS selectors, coordinates/);
  });

  it('names the flag each action requires, so a rejection is avoidable', () => {
    expect(SYSTEM_PROMPT).toContain('Tap only elements with "clk":1.');
    expect(SYSTEM_PROMPT).toContain('TypeText only into elements with "ed":1.');
    expect(SYSTEM_PROMPT).toContain('Scroll only elements with "scr":1.');
  });

  it('caps Wait at the value the validator actually enforces', () => {
    expect(SYSTEM_PROMPT).toContain('"maxMs":<1-5000>');
  });

  it('teaches the Assert grammar the evaluator implements', () => {
    expect(SYSTEM_PROMPT).toContain('"!Sold out"');
    expect(SYSTEM_PROMPT).toContain('"<500"');
  });

  it('warns that Pass without a passed Assert becomes Blocked', () => {
    expect(SYSTEM_PROMPT).toMatch(/no passed Assert is recorded as "Blocked"/);
  });

  it('demands exactly one JSON object and no prose', () => {
    expect(SYSTEM_PROMPT).toMatch(/EXACTLY ONE JSON object/);
    expect(SYSTEM_PROMPT).toMatch(/No prose, no markdown, no code fences, no repetition/);
  });

  // Measured: the model echoed an ELEMENT back instead of writing an ACTION on
  // two of five screens. The prompt now distinguishes input from output
  // explicitly, in the first section and again immediately before generation.
  it('distinguishes the INPUT element shape from the OUTPUT action shape', () => {
    expect(SYSTEM_PROMPT).toMatch(/That is INPUT/);
    expect(SYSTEM_PROMPT).toMatch(/That is your OUTPUT/);
    expect(SYSTEM_PROMPT).toMatch(/NEVER reply with an element/);
  });

  it('says each field name appears once, because the model duplicated "reason"', () => {
    expect(SYSTEM_PROMPT).toMatch(/Use each field name ONCE/);
    expect(SYSTEM_PROMPT).toMatch(/appears exactly ONCE/);
  });

  describe('code-switching examples', () => {
    it('includes a Hinglish goal, untranslated', () => {
      expect(SYSTEM_PROMPT).toContain('Tiffin kholo aur check karo cart ka total 500 se kam hai');
    });

    it('includes a Devanagari-script goal, untransliterated', () => {
      expect(SYSTEM_PROMPT).toContain('पहले रेस्टोरेंट से एक आइटम कार्ट में डालो');
    });

    it('covers a tap, a type-then-tap, an assert and a Finish(Blocked)', () => {
      expect(SYSTEM_PROMPT).toContain('{"node":11,"type":"TypeText","text":"pizza"');
      expect(SYSTEM_PROMPT).toContain('{"node":3,"type":"Tap","reason":"open the Lotus Cafe listing"}');
      expect(SYSTEM_PROMPT).toContain('{"node":24,"type":"Assert","expect":"<500"');
      expect(SYSTEM_PROMPT).toContain('{"node":16,"type":"Scroll"');
      expect(SYSTEM_PROMPT).toContain('"verdict":"Blocked"');
    });

    // Measured: with every example answering node 1, the model replied node 1 on
    // all fifteen calls regardless of the screen. A few-shot block teaches the
    // shape of the answer AND any constant in it.
    it('varies the answer index widely, never repeats one, and never uses 0', () => {
      // Only the ANSWER lines, not the element lists.
      const answered = [...SYSTEM_PROMPT.matchAll(/^\{"node":(\d+),/gm)].map((m) => Number(m[1]));
      expect(answered.length).toBeGreaterThanOrEqual(4);
      expect(new Set(answered).size).toBe(answered.length);
      expect(answered).not.toContain(0);
      // Spread matters as much as uniqueness: 1,2,3 still teaches "pick a small
      // number". These are 11, 3, 24, 7, 16.
      expect(Math.max(...answered) - Math.min(...answered)).toBeGreaterThan(10);
    });

    it('puts "node" first in every targeted action shape', () => {
      for (const type of ['Tap', 'TypeText', 'Scroll', 'Assert']) {
        expect(SYSTEM_PROMPT).toContain(`{"node":<i>,"type":"${type}"`);
      }
      // The three untargeted actions have no node to put first.
      for (const type of ['PressKey', 'Wait', 'Finish']) {
        expect(SYSTEM_PROMPT).toContain(`{"type":"${type}"`);
      }
    });

    // The Gate 2 harness caught a 1B model copying an example's phrasing
    // verbatim instead of reading the screen. These two assertions are the
    // regression guard for that: examples must not share a goal, and must not
    // use the vocabulary our real goals use.
    it('gives every example a DISTINCT goal, so there is no pattern to copy', () => {
      const goals = [...SYSTEM_PROMPT.matchAll(/^GOAL: (.+)$/gm)].map((m) => m[1]);
      expect(goals.length).toBeGreaterThanOrEqual(5);
      expect(new Set(goals).size).toBe(goals.length);
    });

    it('keeps the English examples away from the vocabulary of our real goals', () => {
      // The Hinglish and Devanagari examples legitimately use real words — that
      // is the point of them. The ENGLISH examples must not, because those are
      // the ones a model pattern-matches against an English goal.
      const goals = [...SYSTEM_PROMPT.matchAll(/^GOAL: (.+)$/gm)].map((m) => m[1] ?? '');
      const englishGoals = goals.filter((g) => !/[ऀ-ॿ]/.test(g) && !/karo|kholo/.test(g));
      expect(englishGoals.length).toBeGreaterThanOrEqual(3);
      for (const goal of englishGoals) {
        expect(goal.toLowerCase()).not.toContain('biryani');
      }
    });
  });
});

describe('history compression', () => {
  it('says so plainly when there is no history', () => {
    expect(formatHistory([])).toContain('this is the first action');
  });

  it('shows every step while inside the window', () => {
    const lines = formatHistory([step(1), step(2), step(3)]);
    expect(lines).toContain('1. Tap(1) -> ok');
    expect(lines).toContain('3. Tap(3) -> ok');
    expect(lines).not.toContain('omitted');
  });

  it('collapses older steps to a count once past the window', () => {
    const history = Array.from({ length: 10 }, (_, i) => step(i + 1));
    const lines = formatHistory(history);
    expect(lines).toContain('(4 earlier steps omitted)');
    expect(lines).toContain('5. Tap(5) -> ok');
    expect(lines).not.toContain('1. Tap(1)');
    expect(lines.split('\n').filter((l) => /^\d+\./.test(l))).toHaveLength(HISTORY_WINDOW);
  });

  it('uses the singular for exactly one omitted step', () => {
    expect(formatHistory(Array.from({ length: 7 }, (_, i) => step(i + 1)))).toContain('(1 earlier step omitted)');
  });

  it('carries the outcome, so the model can see what failed', () => {
    const lines = formatHistory([step(1, { outcome: 'rejected', note: 'node 99 does not exist' })]);
    expect(lines).toContain('-> rejected (node 99 does not exist)');
  });
});

describe('the user prompt', () => {
  it('is pure — identical input gives an identical string', () => {
    expect(buildUserPrompt(request())).toBe(buildUserPrompt(request()));
  });

  it('carries the goal exactly as given, in whatever script it arrived in', () => {
    const hinglish = 'biryani search karo aur pehla restaurant kholo';
    expect(buildUserPrompt(request({ goal: hinglish }))).toContain(hinglish);
    const devanagari = 'कार्ट खोलो';
    expect(buildUserPrompt(request({ goal: devanagari }))).toContain(devanagari);
  });

  it('puts the goal immediately before the element list, both at the end', () => {
    // Measured: the element list was the part being ignored. History now comes
    // first and the goal sits adjacent to the list it must be answered from.
    const user = buildUserPrompt(request());
    const goalAt = user.indexOf('GOAL\n');
    expect(user.indexOf('HISTORY')).toBeLessThan(goalAt);
    expect(goalAt).toBeLessThan(user.indexOf('ELEMENT LIST'));
    expect(user.trimEnd().endsWith('Reply with ONE object.')).toBe(true);
  });

  it('includes the screen JSON verbatim', () => {
    expect(buildUserPrompt(request())).toContain(SCREEN);
  });

  it('omits the correction block when there is no error', () => {
    expect(buildUserPrompt(request())).not.toContain('YOUR LAST REPLY WAS REJECTED');
  });

  it('feeds the validator message back verbatim on a retry', () => {
    const lastError = 'Node 99 does not exist. Valid indices are 0 to 14.';
    const user = buildUserPrompt(request({ lastError }));
    expect(user).toContain('YOUR LAST REPLY WAS REJECTED');
    expect(user).toContain(lastError);
    // The correction must sit immediately before the list it refers to.
    expect(user.indexOf(lastError)).toBeLessThan(user.indexOf('ELEMENT LIST'));
  });

  it('injects the reflection turn when the screen is stuck', () => {
    const user = buildUserPrompt(request({ reflection: 'Tap(3) has not changed anything twice.' }));
    expect(user).toContain('THE SCREEN HAS NOT CHANGED');
    expect(user).toContain('Choose a DIFFERENT approach');
  });

  it('can carry both a reflection and a correction', () => {
    const user = buildUserPrompt(request({ reflection: 'stuck', lastError: 'bad index' }));
    expect(user).toContain('THE SCREEN HAS NOT CHANGED');
    expect(user).toContain('YOUR LAST REPLY WAS REJECTED');
  });
});

// MEASURED, with a real BPE tokenizer:
//   system prompt   ~960 tokens  (grew when the input/output distinction and a
//                                 sixth example were added to fix a measured
//                                 87% invalid-output rate — worth every token)
//   screen          358-600      (Gate 1 measurements on real Tiffin)
//   history+goal    ~100-200
//   => typical ~1540, worst ~2470 (the index digest costs ~40 tokens and buys
//      back the thing the model was ignoring)
//
// The examples section is the single most expensive block and it stays: it is
// what a 1B model actually learns the output shape from, and the Devanagari
// example is costly in BPE precisely because non-Latin script tokenises badly —
// which is the same reason a model that has never seen it in-context handles it
// poorly. We pay the tokens deliberately.
describe('size budget', () => {
  it('keeps the whole prompt affordable for a 1B model on a typical screen', () => {
    const { estimatedTokens } = assemblePrompt(request(), estimateTokens);
    expect(estimatedTokens).toBeLessThan(1600);
  });

  it('stays bounded on our worst measured screen with full history', () => {
    const worstScreen = JSON.stringify(
      Array.from({ length: 32 }, (_, i) => ({ i, role: 'btn', text: `Menu item number ${i} with a long name`, clk: 1 })),
    );
    const { estimatedTokens } = assemblePrompt(
      request({ screenJson: worstScreen, history: Array.from({ length: 12 }, (_, i) => step(i + 1)) }),
      estimateTokens,
    );
    expect(estimatedTokens).toBeLessThan(2600);
  });

  it('history compression is what keeps a long run bounded', () => {
    const short = assemblePrompt(request({ history: [step(1)] }), estimateTokens).estimatedTokens;
    const long = assemblePrompt(
      request({ history: Array.from({ length: 24 }, (_, i) => step(i + 1)) }),
      estimateTokens,
    ).estimatedTokens;
    // 24 steps must not cost 24 steps' worth of tokens.
    expect(long - short).toBeLessThan(120);
  });
});
