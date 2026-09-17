/**
 * The demo goals and their scripts.
 *
 * These exist so a judge with no key still sees the REAL loop — real reading,
 * real validation, real guardrails, real execution against real Tiffin — driven
 * by a fixed plan instead of a model. The status strip says "mock" throughout.
 * A scripted run must never be presentable as a live one.
 *
 * Steps name their target by TEXT, not by index, and the index is resolved
 * against the screen the agent was just shown. See scripted-planner.ts for why.
 */

import type { ScriptStep } from './scripted-planner.js';

export interface DemoGoal {
  readonly label: string;
  readonly goal: string;
  readonly script: readonly ScriptStep[];
  /** What this run is meant to demonstrate. Shown as the button's tooltip. */
  readonly shows: string;
}

export const DEMO_GOALS: readonly DemoGoal[] = [
  {
    label: 'Hinglish · search and verify',
    goal: 'biryani search karo aur check karo ki biryani wale restaurants mile',
    shows: 'A goal in Hinglish, reaching the planner exactly as spoken.',
    script: [
      { type: 'TypeText', match: /search/i, text: 'biryani', reason: 'type the search term' },
      { type: 'Assert', match: /restaurants? for/i, expect: 'biryani', reason: 'check the results are for biryani' },
      { type: 'Finish', verdict: 'Pass', reason: 'the results are filtered to biryani' },
    ],
  },
  {
    label: 'Cart total under ₹500',
    goal: 'add an item from the first biryani restaurant and check the cart total is under 500',
    shows: 'A full multi-screen flow ending in a numeric assertion.',
    script: [
      { type: 'TypeText', match: /search/i, text: 'biryani', reason: 'search for biryani' },
      { type: 'Tap', match: /deccan dastarkhwan/i, reason: 'open the first matching restaurant' },
      { type: 'Tap', match: /^add$/i, reason: 'add the first item to the cart' },
      { type: 'Tap', match: /^cart,/i, reason: 'open the cart' },
      // Target the node that actually carries the TOTAL. An earlier version
      // matched the first rupee value on the screen, which was the item price —
      // it passed, but it was verifying the wrong number, and a test that passes
      // for the wrong reason is worse than one that fails.
      { type: 'Assert', match: /proceed to checkout/i, expect: '<500', reason: 'check the cart total is under 500' },
      { type: 'Finish', verdict: 'Pass', reason: 'the cart total is under 500' },
    ],
  },
  {
    label: 'Guardrail · try to order',
    goal: 'add an item and place the order',
    shows: 'The destructive gate suspending the run and asking a human.',
    script: [
      { type: 'TypeText', match: /search/i, text: 'biryani', reason: 'search for biryani' },
      { type: 'Tap', match: /deccan dastarkhwan/i, reason: 'open the first restaurant' },
      { type: 'Tap', match: /^add$/i, reason: 'add an item so there is something to order' },
      { type: 'Tap', match: /^cart,/i, reason: 'open the cart' },
      { type: 'Tap', match: /proceed to checkout/i, reason: 'proceed towards placing the order' },
      // The tail has to read true on BOTH sides of the gate.
      //
      // MEASURED, by driving it: the gate fires on "Proceed to checkout". Press
      // Deny and the run ends at the gate with the gate's own reason. Press
      // Allow and the app advances to the payment screen — where a separate
      // "Place order" button still waits, so no order has been placed.
      //
      // The old reason, "placing an order needs a human decision", contradicted
      // the human who had just made one. Claiming a Pass would have been worse:
      // an attempt at asserting "Order placed" here finished Blocked with
      // *nothing on this screen matches "/order placed/i"* — correct, because
      // the order genuinely had not been placed. Blocked is the right verdict
      // (the goal was not completed); the reason now says exactly where it
      // stopped and why, which is true whichever button the human pressed.
      { type: 'Finish', verdict: 'Blocked', reason: 'stopped on the payment screen — paying is not something an agent should do unsupervised' },
    ],
  },
  {
    label: 'Fails on purpose',
    goal: 'check that the first biryani restaurant is rated above 4.9',
    shows: 'A red verdict: the expectation was checked and did not hold.',
    script: [
      { type: 'TypeText', match: /search/i, text: 'biryani', reason: 'search for biryani' },
      { type: 'Assert', match: /deccan dastarkhwan/i, expect: '>4.9', reason: 'check the rating is above 4.9' },
      { type: 'Finish', verdict: 'Pass', reason: 'checked the rating' },
    ],
  },
];

/**
 * Whether the scripted tier has a real plan for this goal.
 *
 * The UI needs this to warn BEFORE a run rather than after. A judge who types
 * their own goal on the scripted tier gets an honest `Blocked`, which is
 * correct but reads as breakage if it arrives with no warning — so the console
 * says so up front, while the goal is still being typed.
 *
 * Exported from here, not reimplemented in the UI, so the answer can never
 * disagree with what scriptFor() actually does.
 */
export function isScriptedGoal(goal: string): boolean {
  const trimmed = goal.trim().toLowerCase();
  return DEMO_GOALS.some((g) => g.goal.toLowerCase() === trimmed);
}

export function scriptFor(goal: string): readonly ScriptStep[] {
  const trimmed = goal.trim().toLowerCase();
  const exact = DEMO_GOALS.find((g) => g.goal.toLowerCase() === trimmed);
  if (exact) return exact.script;
  // An unrecognised goal gets an honest Blocked rather than someone else's plan.
  return [
    {
      type: 'Finish',
      verdict: 'Blocked',
      reason: 'the mock tier only has scripts for the example goals; add an API key or use the on-device tier for a free-form goal',
    },
  ];
}
