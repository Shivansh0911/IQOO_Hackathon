/**
 * Prompt assembly. Pure, deterministic, unit-tested.
 *
 * Every section is a named constant so that at hour 22 on site, tuning the
 * prompt means editing one labelled block, not hunting through string
 * concatenation with a head full of caffeine.
 *
 * The audience is a 1B-2B instruct model reading a ~400-token screen. Every
 * sentence here is either load-bearing or deleted. Small models follow SHORT,
 * CONCRETE, REPEATED rules and ignore long prose, so the shapes are shown rather
 * than described, and the one rule that matters most — address nodes by `i`
 * only — is stated three times in three places on purpose.
 */

import { MAX_WAIT_MS } from '@origo/core';
import type { PlanRequest, StepSummary } from './planner.js';

// ─── Section 1: who the model is and the single hard output rule ───────────
export const SECTION_ROLE = `You drive a phone app to complete one goal.
You see the screen as a JSON list of elements. You choose ONE action at a time.

Reply with EXACTLY ONE JSON object and nothing else.
No prose. No markdown. No code fences. No explanation before or after.`;

// ─── Section 2: the addressing rule — the safety property, stated first ────
export const SECTION_ADDRESSING = `ADDRESSING
Refer to an element ONLY by its "i" number from the ELEMENT LIST you were just given.
Never use CSS selectors, coordinates, XPath, or element names.
If the element you want is not in the list, it is not on the screen: scroll, or Finish.`;

// ─── Section 3: the seven actions, shown as exact shapes ───────────────────
export const SECTION_ACTIONS = `ACTIONS - use exactly one of these shapes
{"type":"Tap","node":<i>,"reason":"<why>"}
{"type":"TypeText","node":<i>,"text":"<text>","reason":"<why>"}
{"type":"Scroll","node":<i>,"direction":"down"|"up"|"left"|"right","reason":"<why>"}
{"type":"PressKey","key":"Back"|"Home"|"Enter","reason":"<why>"}
{"type":"Wait","maxMs":<1-${MAX_WAIT_MS}>,"reason":"<why>"}
{"type":"Assert","node":<i>,"expect":"<expectation>","reason":"<why>"}
{"type":"Finish","verdict":"Pass"|"Fail"|"Blocked","reason":"<why>"}

Tap only elements with "clk":1.
TypeText only into elements with "ed":1.
Scroll only elements with "scr":1.
"reason" is short and in English. It is shown to the user.`;

// ─── Section 4: the Assert grammar — evaluated in code, so it must be exact ─
export const SECTION_ASSERT = `ASSERT - how to write "expect"
"Cart"        passes if the element's text contains "Cart" (case-insensitive)
"!Sold out"   passes if the element's text does NOT contain "Sold out"
"<500"        compares the first number in the element's text: also <= > >= =
Example: to check a total is under 500, Assert on the element showing the total with "<500".`;

// ─── Section 5: how a run ends — the Assert rule is policy, not a suggestion ─
export const SECTION_FINISHING = `FINISHING
Verify before you finish. A run that checks nothing has proved nothing:
a Finish with verdict "Pass" and no passed Assert is recorded as "Blocked".
Use Fail when you verified the expectation and it was wrong.
Use Blocked when the goal cannot be done on this app.`;

// ─── Section 6: few-shots ──────────────────────────────────────────────────
//
// Four shapes the model must get right, plus code-switching. The Hinglish and
// Devanagari examples are here from day one because our users speak that way and
// a model that has seen it once in-context handles it far better than one that
// has not. The transcript reaches the model exactly as spoken — never
// translated, never transliterated.
//
// MEASURED LESSON, from the Gate 2 harness. An earlier version used the SAME
// goal ("search for biryani") for the first two examples, to teach that the
// right action depends on the screen. A 1B model read it as "for this goal,
// sometimes Tap node 1" and on the real search screen replied
//   {"type":"Tap","node":0,"reason":"open the first matching biryani restaurant"}
// — copying the example's phrasing almost verbatim while ignoring the screen it
// had been given. The examples now use DISTINCT goals, DISTINCT vocabulary
// (pizza and cafes, never biryani, which is the word our real goals use) and
// non-zero indices, so there is nothing to copy that would happen to look right.
export const SECTION_EXAMPLES = `EXAMPLES

GOAL: search for pizza
ELEMENTS: [{"i":0,"role":"text","text":"FoodCo"},{"i":1,"role":"edit","desc":"Search for restaurants or dishes","ed":1},{"i":2,"role":"btn","text":"Cart","clk":1}]
{"type":"TypeText","node":1,"text":"pizza","reason":"type the search term into the search field"}

GOAL: open the Lotus Cafe listing
ELEMENTS: [{"i":0,"role":"edit","text":"cafe","ed":1},{"i":1,"role":"btn","text":"Lotus Cafe Coffee 4.2 20 min","clk":1},{"i":2,"role":"btn","text":"Rung Cafe Bakery 3.9","clk":1}]
{"type":"Tap","node":1,"reason":"open the Lotus Cafe listing"}

GOAL: Tiffin kholo aur check karo cart ka total 500 se kam hai
ELEMENTS: [{"i":0,"role":"text","text":"Total"},{"i":1,"role":"text","text":"Rs 374"},{"i":2,"role":"btn","text":"Proceed to checkout","clk":1}]
{"type":"Assert","node":1,"expect":"<500","reason":"check the total is under 500"}

GOAL: पहले रेस्टोरेंट से एक आइटम कार्ट में डालो
ELEMENTS: [{"i":0,"role":"text","text":"Menu"},{"i":1,"role":"btn","text":"Add","clk":1},{"i":2,"role":"list","scr":1}]
{"type":"Tap","node":1,"reason":"add the first item to the cart"}

GOAL: book a flight to Delhi
ELEMENTS: [{"i":0,"role":"edit","desc":"Search for restaurants or dishes","ed":1},{"i":1,"role":"btn","text":"Cart","clk":1}]
{"type":"Finish","verdict":"Blocked","reason":"this is a food delivery app and cannot book flights"}`;

/** The full system prompt. Constant per run, so a planner can cache it. */
export const SYSTEM_PROMPT = [
  SECTION_ROLE,
  SECTION_ADDRESSING,
  SECTION_ACTIONS,
  SECTION_ASSERT,
  SECTION_FINISHING,
  SECTION_EXAMPLES,
].join('\n\n');

/** Last N steps are shown in full; older ones collapse to a count. */
export const HISTORY_WINDOW = 6;

/**
 * Compresses history.
 *
 * Old steps are worth a count, not their text: what the model needs is "you
 * have already done 9 things, here are the last 6". Keeping all of them grows
 * the prompt without bound and pushes the screen — the only part that is
 * actually current — further from the instruction.
 */
export function formatHistory(history: readonly StepSummary[]): string {
  if (history.length === 0) return 'HISTORY\n(nothing yet - this is the first action)';

  const older = history.length - HISTORY_WINDOW;
  const recent = history.slice(-HISTORY_WINDOW);
  const lines = recent.map((s) => `${s.step}. ${s.action} -> ${s.outcome}${s.note ? ` (${s.note})` : ''}`);
  const prefix = older > 0 ? [`(${older} earlier step${older === 1 ? '' : 's'} omitted)`] : [];
  return ['HISTORY', ...prefix, ...lines].join('\n');
}

/**
 * The correction turn.
 *
 * The validator's message is fed back verbatim. It is written to be read by the
 * model — "Node 99 does not exist. Valid indices are 0 to 14." — which is why
 * the validator spends effort on specific messages instead of an error code.
 */
export function formatCorrection(lastError: string): string {
  return `YOUR LAST REPLY WAS REJECTED
${lastError}
Read the ELEMENT LIST again and reply with one corrected JSON object.`;
}

/** The reflection turn, injected when the screen has not changed for three reads. */
export function formatReflection(reflection: string): string {
  return `THE SCREEN HAS NOT CHANGED
${reflection}
Whatever you tried is not working. Choose a DIFFERENT approach, or Finish with verdict "Blocked".`;
}

/**
 * Assembles the user turn. Pure: same request in, same string out, always.
 *
 * Order is deliberate. The goal comes first because it is the thing being
 * served; the screen comes last because it is the freshest and small models
 * weight the end of the prompt most heavily. Corrections sit immediately before
 * the screen so the model re-reads the list with the error in mind.
 */
export function buildUserPrompt(request: PlanRequest): string {
  const parts = [`GOAL\n${request.goal}`, formatHistory(request.history)];

  if (request.reflection) parts.push(formatReflection(request.reflection));
  if (request.lastError) parts.push(formatCorrection(request.lastError));

  parts.push(`ELEMENT LIST (this is the whole screen; "i" is how you address each element)\n${request.screenJson}`);
  parts.push('Reply with one JSON object.');
  return parts.join('\n\n');
}

export interface AssembledPrompt {
  readonly system: string;
  readonly user: string;
  readonly estimatedTokens: number;
}

/**
 * The prompt that actually goes to a model, with its measured size.
 *
 * `estimateTokens` from core is calibrated against a real BPE tokenizer, so this
 * number is honest enough to log on every call and to put in the report.
 */
export function assemblePrompt(request: PlanRequest, estimate: (text: string) => number): AssembledPrompt {
  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(request);
  return { system, user, estimatedTokens: estimate(system) + estimate(user) };
}
