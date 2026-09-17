/**
 * The scripted tier's goal matching.
 *
 * `isScriptedGoal` drives a warning shown before a run, and `scriptFor` decides
 * what actually happens during one. If they ever disagree, the console warns
 * about the wrong thing — or worse, stays silent and lets a judge hit an
 * unexplained Blocked. These tests pin them together.
 */

import { describe, expect, it } from 'vitest';
import { DEMO_GOALS, isScriptedGoal, scriptFor } from '../src/demo-goals.js';

const blocks = (goal: string): boolean => {
  const steps = scriptFor(goal);
  const first = steps[0];
  return steps.length === 1 && first?.type === 'Finish' && first.verdict === 'Blocked';
};

describe('isScriptedGoal', () => {
  it('recognises every shipped demo goal', () => {
    for (const demo of DEMO_GOALS) {
      expect(isScriptedGoal(demo.goal), demo.label).toBe(true);
    }
  });

  it('ignores case and surrounding whitespace, as the run path does', () => {
    const first = DEMO_GOALS[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(isScriptedGoal(`  ${first.goal.toUpperCase()}  `)).toBe(true);
  });

  it('rejects a free-form goal', () => {
    expect(isScriptedGoal('search for pizza and check the price')).toBe(false);
  });

  it('rejects an empty or whitespace-only goal', () => {
    expect(isScriptedGoal('')).toBe(false);
    expect(isScriptedGoal('   ')).toBe(false);
  });

  it('rejects a goal that merely CONTAINS a demo goal', () => {
    const first = DEMO_GOALS[0];
    expect(first).toBeDefined();
    if (!first) return;
    // Matching loosely here would promise a script that scriptFor will not run.
    expect(isScriptedGoal(`${first.goal} and then order it`)).toBe(false);
  });

  it('agrees with scriptFor about which goals actually block', () => {
    // The whole point: the warning must appear exactly when the run would be
    // blocked, never one without the other.
    for (const demo of DEMO_GOALS) {
      expect(blocks(demo.goal), `${demo.label} should not block`).toBe(false);
    }
    for (const freeForm of ['do something else', 'book a flight to Delhi', 'log me in']) {
      expect(isScriptedGoal(freeForm)).toBe(false);
      expect(blocks(freeForm), `${freeForm} should block`).toBe(true);
    }
  });
});

describe('the destructive goal is honest on both sides of the gate', () => {
  const ORDER_GOAL = 'add an item and place the order';

  it('never claims the order was placed', () => {
    // Driving it showed where the gate actually fires: on "Proceed to
    // checkout", which lands on the payment screen with a separate "Place
    // order" button still waiting. So no wording here may imply payment
    // happened, and an Assert for "Order placed" would fail truthfully.
    const steps = scriptFor(ORDER_GOAL);
    const last = steps.at(-1);
    expect(last?.type).toBe('Finish');
    if (last?.type !== 'Finish') return;
    expect(last.verdict).toBe('Blocked');
    expect(last.reason).not.toMatch(/order (was )?placed|order went through/i);
  });

  it('does not contradict the human who approved it', () => {
    // The old reason said "placing an order needs a human decision" — printed
    // after the human had just made one, by pressing Allow.
    const steps = scriptFor(ORDER_GOAL);
    const last = steps.at(-1);
    if (last?.type !== 'Finish') throw new Error('expected a Finish');
    expect(last.reason).not.toMatch(/needs a human decision/i);
    expect(last.reason).toMatch(/payment screen/i);
  });

  it('still reaches the checkout tap that trips the destructive gate', () => {
    // If this step were ever removed the gate would never fire and the whole
    // guardrail demo would silently become a happy path.
    const steps = scriptFor(ORDER_GOAL);
    const checkout = steps.find((s) => s.type === 'Tap' && String(s.match).includes('checkout'));
    expect(checkout).toBeDefined();
  });
});
