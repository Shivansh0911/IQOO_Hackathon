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
You are given a list of ELEMENTS. You reply with one ACTION.

An ELEMENT looks like {"i":3,"role":"btn","text":"Add","clk":1}. That is INPUT.
An ACTION looks like {"node":3,"type":"Tap","reason":"add the item"}. That is your OUTPUT.
NEVER reply with an element. Your reply starts with {"node": whenever the action targets one.

Reply with EXACTLY ONE JSON object and nothing else.
Use each field name ONCE. No prose, no markdown, no code fences, no repetition.`;

// ─── Section 2: the addressing rule — the safety property, stated first ────
export const SECTION_ADDRESSING = `ADDRESSING
Refer to an element ONLY by its "i" number from the ELEMENT LIST you were just given.
Never use CSS selectors, coordinates, XPath, or element names.
If the element you want is not in the list, it is not on the screen: scroll, or Finish.`;

// ─── Section 3: the seven actions, shown as exact shapes ───────────────────
export const SECTION_ACTIONS = `ACTIONS - use exactly one of these shapes.
The FIRST thing you write is "node", so decide WHICH ELEMENT before anything else.

{"node":<i>,"type":"Tap","reason":"<why>"}
{"node":<i>,"type":"TypeText","text":"<text>","reason":"<why>"}
{"node":<i>,"type":"Scroll","direction":"down"|"up"|"left"|"right","reason":"<why>"}
{"node":<i>,"type":"Assert","expect":"<rule>","reason":"<why>"}
{"type":"PressKey","key":"Back"|"Home"|"Enter","reason":"<why>"}
{"type":"Wait","maxMs":<1-${MAX_WAIT_MS}>,"reason":"<why>"}
{"type":"Finish","verdict":"Pass"|"Fail"|"Blocked","reason":"<why>"}

Tap only elements with "clk":1.
TypeText only into elements with "ed":1.
Scroll only elements with "scr":1.
"reason" is short and in English, and appears exactly ONCE. It is shown to the user.
"type" must be one of the seven words above. Never invent an action name.`;

// ─── Section 4: the Assert grammar — evaluated in code, so it must be exact ─
export const SECTION_ASSERT = `ASSERT - the "expect" field. The key is spelled "expect".
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
//
// SECOND MEASURED LESSON, same harness. After that fix every example still
// ANSWERED with node 1, and the model duly replied node 1 on all fifteen calls
// regardless of the screen. The answers now use 0, 2 and 3 as well, and the
// correct target is deliberately NOT the first clickable element in two of them.
// A few-shot block teaches the shape of the answer AND any constant in it.
export const SECTION_EXAMPLES = `EXAMPLES

GOAL: search for pizza
ELEMENTS: [{"i":9,"role":"text","text":"FoodCo"},{"i":10,"role":"btn","text":"Cart","clk":1},{"i":11,"role":"edit","desc":"Search for restaurants or dishes","ed":1}]
{"node":11,"type":"TypeText","text":"pizza","reason":"type the search term into the search field"}

GOAL: open the Lotus Cafe listing
ELEMENTS: [{"i":0,"role":"edit","text":"cafe","ed":1},{"i":1,"role":"text","text":"3 places"},{"i":2,"role":"btn","text":"Rung Bakery 3.9","clk":1},{"i":3,"role":"btn","text":"Lotus Cafe Coffee 4.2 20 min","clk":1}]
{"node":3,"type":"Tap","reason":"open the Lotus Cafe listing"}

GOAL: Tiffin kholo aur check karo cart ka total 500 se kam hai
ELEMENTS: [{"i":22,"role":"text","text":"Total"},{"i":23,"role":"btn","text":"Proceed to checkout","clk":1},{"i":24,"role":"text","text":"Rs 374"}]
{"node":24,"type":"Assert","expect":"<500","reason":"check the total is under 500"}

GOAL: पहले रेस्टोरेंट से एक आइटम कार्ट में डालो
ELEMENTS: [{"i":4,"role":"text","text":"Menu"},{"i":5,"role":"list","scr":1},{"i":6,"role":"text","text":"Paneer Roll"},{"i":7,"role":"btn","text":"Add","clk":1}]
{"node":7,"type":"Tap","reason":"add the first item to the cart"}

GOAL: scroll down to see more results
ELEMENTS: [{"i":16,"role":"list","scr":1},{"i":17,"role":"btn","text":"Cart","clk":1}]
{"node":16,"type":"Scroll","direction":"down","reason":"reveal more of the list"}

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

  // An assert outcome is SHOUTED, not mentioned.
  //
  // A model that cannot see that its assertion already succeeded has no reason
  // to stop. This one is kept from the (otherwise reverted) termination-rule
  // experiment because it costs ZERO system-prompt tokens — see DECISIONS D15
  // for why the rest was reverted.
  const outcomeLabel = (outcome: StepSummary['outcome']): string => {
    if (outcome === 'assert-pass') return 'PASSED';
    if (outcome === 'assert-fail') return 'FAILED';
    return outcome;
  };
  const lines = recent.map((s) => `${s.step}. ${s.action} -> ${outcomeLabel(s.outcome)}${s.note ? ` (${s.note})` : ''}`);
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
  // ORDER, decided by measurement.
  //
  // History first, then the GOAL, then the ELEMENT LIST, then the instruction.
  // Small models weight the end of the prompt most heavily, and the element list
  // was precisely the part being ignored — so the goal and the list it must be
  // answered from now sit adjacent, at the end, with nothing between them.
  const parts = [formatHistory(request.history)];

  if (request.reflection) parts.push(formatReflection(request.reflection));
  if (request.lastError) parts.push(formatCorrection(request.lastError));

  parts.push(`GOAL\n${request.goal}`);
  parts.push(`ELEMENT LIST - this is INPUT, do not repeat it back\n${request.screenJson}`);

  // An index digest, derived from the list just given.
  //
  // MEASURED: a 1B model emitted a CONSTANT node index on 18 of 20 calls,
  // ignoring the element list entirely — reading the goal and writing a
  // plausible action shape without ever attending to the screen. Restating the
  // legal indices compactly, adjacent to the instruction, gives a small model
  // something concrete to select from. It is the same information the
  // clk/ed/scr flags already carry.
  const digest = indexDigest(request.screenJson);
  if (digest) parts.push(digest);

  parts.push('Choose the node number from the list above FIRST, then the action. Reply with ONE object.');
  return parts.join('\n\n');
}

/**
 * Summarises which indices can take which action, from the screen JSON.
 * Pure and defensive: an unparseable screen simply produces no digest rather
 * than failing a run.
 */
export function indexDigest(screenJson: string): string {
  let nodes: { i: number; clk?: number; ed?: number; scr?: number }[];
  try {
    nodes = JSON.parse(screenJson) as typeof nodes;
  } catch {
    return '';
  }
  if (!Array.isArray(nodes) || nodes.length === 0) return '';

  const list = (pick: (n: (typeof nodes)[number]) => boolean): string =>
    nodes.filter(pick).map((n) => n.i).join(',') || 'none';

  return [
    `VALID NODE NUMBERS: 0 to ${nodes.length - 1}`,
    `  can Tap: ${list((n) => n.clk === 1)}`,
    `  can TypeText: ${list((n) => n.ed === 1)}`,
    `  can Scroll: ${list((n) => n.scr === 1)}`,
    '  Assert works on any node.',
  ].join('\n');
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
