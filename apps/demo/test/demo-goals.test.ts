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
