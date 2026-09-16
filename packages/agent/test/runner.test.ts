/**
 * Every guardrail gets a test with its name on it.
 *
 * All of this runs against FakeReader/FakeExecutor — no DOM, no browser, no
 * jsdom. That is deliberate: it is the proof that the loop is portable.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '@origo/core';
import { MockPlanner } from '@origo/planner';
import { run } from '../src/runner.js';
import type { RunnerDeps } from '../src/runner.js';
import type { RunEvent, RunEventType } from '../src/events.js';
import { FakeExecutor, FakeReader, InstantSettle, node, screen } from './fake-platform.js';

// A two-screen app: a search screen, then a cart showing a total.
const SEARCH = screen('search', [
  node({ index: 0, role: 'edit', desc: 'Search', editable: true }),
  node({ index: 1, role: 'btn', text: 'Deccan Dastarkhwan 4.5', clickable: true }),
  node({ index: 2, role: 'list', scrollable: true }),
  node({ index: 3, role: 'btn', text: 'Place order', clickable: true }),
]);

const CART = screen('cart', [
  node({ index: 0, role: 'btn', text: 'Back', clickable: true }),
  node({ index: 1, role: 'text', text: 'Total ₹374' }),
  node({ index: 2, role: 'btn', text: 'Proceed to checkout', clickable: true }),
]);

const tap: Action = { type: 'Tap', node: 1, reason: 'open the first restaurant' };
const assertUnder500: Action = { type: 'Assert', node: 1, expect: '<500', reason: 'check the total' };
const finishPass: Action = { type: 'Finish', verdict: 'Pass', reason: 'goal met' };

function harness(
  script: (Action | string)[],
  over: Partial<RunnerDeps> = {},
  screens = [SEARCH, CART],
  cycling = false,
) {
  const reader = new FakeReader(screens, cycling);
  const executor = new FakeExecutor(reader, over.executor === undefined);
  const deps: RunnerDeps = {
    reader,
    executor,
    settle: new InstantSettle(),
    planner: new MockPlanner({ script }),
    platform: 'fake',
    online: () => true,
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { deps, reader, executor: deps.executor as FakeExecutor };
}

async function collect(goal: string, deps: RunnerDeps, signal = new AbortController().signal): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of run(goal, deps, signal)) events.push(event);
  return events;
}

const types = (events: RunEvent[]): RunEventType[] => events.map((e) => e.type);
const find = <T extends RunEventType>(events: RunEvent[], type: T): Extract<RunEvent, { type: T }> | undefined =>
  events.find((e) => e.type === type) as Extract<RunEvent, { type: T }> | undefined;

describe('a clean run', () => {
  it('emits Started first and Finished last, and nothing after', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    const events = await collect('check the cart total', deps);
    expect(events[0]?.type).toBe('Started');
    expect(events[events.length - 1]?.type).toBe('Finished');
    expect(events.filter((e) => e.type === 'Finished' || e.type === 'Failed')).toHaveLength(1);
  });

  it('runs observe -> plan -> validate -> execute -> settle in order', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    const events = await collect('goal', deps);
    const first = types(events).slice(0, 4);
    expect(first).toEqual(['Started', 'Planning', 'ActionProposed', 'ActionExecuted']);
  });

  it('actually executes the actions on the platform', async () => {
    const { deps, executor } = harness([tap, assertUnder500, finishPass]);
    await collect('goal', deps);
    expect(executor.calls.map((c) => c.action.type)).toEqual(['Tap', 'Assert']);
  });

  it('reports the planner and platform it really used', async () => {
    const { deps } = harness([finishPass]);
    const started = find(await collect('goal', deps), 'Started');
    expect(started?.planner.tier).toBe('mock');
    expect(started?.platform).toBe('fake');
  });

  it('reports the live network state rather than assuming it', async () => {
    const { deps } = harness([finishPass], { online: () => false });
    expect(find(await collect('goal', deps), 'Started')?.online).toBe(false);
  });

  it('carries the token count of the screen being reasoned over', async () => {
    const { deps } = harness([finishPass]);
    const planning = find(await collect('goal', deps), 'Planning');
    expect(planning?.screen.estimatedTokens).toBeGreaterThan(0);
    expect(planning?.screen.promptJson).toContain('"i":0');
  });
});

describe('guardrail: the Assert rule', () => {
  it('records a passing assert against the POST-action screen', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    const events = await collect('goal', deps);
    const result = find(events, 'AssertResult');
    expect(result?.outcome.passed).toBe(true);
    expect(result?.outcome.detail).toContain('374');
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Pass', passedAsserts: 1 });
  });

  it('downgrades Finish(Pass) to Blocked when nothing was verified', async () => {
    const { deps } = harness([tap, finishPass]);
    const finished = find(await collect('goal', deps), 'Finished');
    expect(finished?.verdict).toBe('Blocked');
    expect(finished?.reason).toMatch(/no expectation was verified/);
  });

  it('does not count an Assert as being stuck: observing twice is not looping', async () => {
    const second: Action = { type: 'Assert', node: 2, expect: 'checkout', reason: 'check the button' };
    const { deps } = harness([tap, assertUnder500, second, finishPass]);
    const events = await collect('goal', deps);
    expect(events.some((e) => e.type === 'Stuck')).toBe(false);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Pass', passedAsserts: 2 });
  });

  it('turns Pass into Fail when an assert was checked and did not hold', async () => {
    // The model asserts, watches it fail, and cheerfully finishes Pass. Small
    // models do exactly this, so the loop overrides it.
    const failing: Action = { type: 'Assert', node: 1, expect: '<100', reason: 'check the total' };
    const { deps } = harness([tap, failing, finishPass]);
    const events = await collect('goal', deps);
    expect(find(events, 'AssertResult')?.outcome.passed).toBe(false);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Fail', failedAsserts: 1 });
  });

  it('fails an assert honestly when the node has vanished after the action', async () => {
    const vanishing: Action = { type: 'Assert', node: 9, expect: 'anything', reason: 'check' };
    const { deps } = harness([vanishing, finishPass]);
    // node 9 is out of range, so the validator rejects before it ever executes.
    const events = await collect('goal', deps);
    expect(find(events, 'ActionRejected')?.error.message).toMatch(/does not exist/);
  });
});

describe('guardrail: retries on invalid output', () => {
  it('rejects prose and retries with the validator message fed back', async () => {
    const { deps } = harness(['I think you should tap the first card.', tap, assertUnder500, finishPass]);
    const events = await collect('goal', deps);
    const rejected = find(events, 'ActionRejected');
    expect(rejected?.error.fault).toBe('malformed-output');
    expect(find(events, 'Retrying')?.because).toMatch(/exactly one JSON object/);
    expect(find(events, 'Finished')?.verdict).toBe('Pass');
  });

  it('does not spend a step on a rejected action', async () => {
    const { deps } = harness(['nonsense', tap, assertUnder500, finishPass]);
    const events = await collect('goal', deps);
    // Three real actions happened, so the run is three steps long despite four calls.
    expect(find(events, 'Finished')?.steps).toBe(3);
  });

  it('ends Blocked after two consecutive invalid outputs, never a third', async () => {
    const { deps } = harness(['nope', 'still nope', 'nope again', tap]);
    const events = await collect('goal', deps);
    expect(events.filter((e) => e.type === 'ActionRejected')).toHaveLength(3);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Blocked' });
    expect(find(events, 'Finished')?.reason).toMatch(/invalid actions in a row/);
  });

  it('resets the retry budget once an action is accepted', async () => {
    // Three rejections, but never two in a row, so the run survives all of them.
    const { deps } = harness(['bad', tap, 'bad', assertUnder500, 'bad', finishPass]);
    const events = await collect('goal', deps);
    expect(events.filter((e) => e.type === 'ActionRejected')).toHaveLength(3);
    expect(find(events, 'Finished')?.verdict).toBe('Pass');
  });

  it('distinguishes malformed output from an action that was wrong for the screen', async () => {
    const outOfRange: Action = { type: 'Tap', node: 99, reason: 'tap something' };
    const { deps } = harness([outOfRange, tap, assertUnder500, finishPass]);
    const rejected = find(await collect('goal', deps), 'ActionRejected');
    expect(rejected?.error.fault).toBe('invalid-for-screen');
    expect(rejected?.error.stage).toBe('semantic');
  });
});

// These use a CYCLING app, so the screen genuinely keeps changing. With a
// static screen, stuck detection correctly fires long before the ceiling — a
// property worth having, and the reason the first version of these tests was
// wrong rather than the code.
describe('guardrail: the step ceiling', () => {
  // Two screens that both offer a tappable node 0, so the run can bounce
  // between them forever without ever producing an invalid action.
  const PING = screen('ping', [node({ index: 0, role: 'btn', text: 'Next page', clickable: true })]);
  const PONG = screen('pong', [node({ index: 0, role: 'btn', text: 'Back again', clickable: true })]);
  const backAndForth: Action = { type: 'Tap', node: 0, reason: 'keep going' };

  it('stops at the ceiling and ends Blocked rather than running forever', async () => {
    const { deps } = harness(
      Array.from({ length: 40 }, () => backAndForth),
      { limits: { maxSteps: 5 } },
      [PING, PONG],
      true,
    );
    const events = await collect('goal', deps);
    const finished = find(events, 'Finished');
    expect(finished?.verdict).toBe('Blocked');
    expect(finished?.reason).toMatch(/5-action ceiling/);
    expect(finished?.steps).toBe(5);
  });

  it('defaults to 25 actions', async () => {
    const { deps } = harness(Array.from({ length: 60 }, () => backAndForth), {}, [PING, PONG], true);
    const finished = find(await collect('goal', deps), 'Finished');
    expect(finished?.reason).toMatch(/25-action ceiling/);
    expect(finished?.steps).toBe(25);
  });

  it('a static screen hits stuck detection first, which is the better answer', async () => {
    const wait: Action = { type: 'Wait', maxMs: 1, reason: 'waiting' };
    const { deps } = harness(Array.from({ length: 60 }, () => wait), {}, [SEARCH]);
    const finished = find(await collect('goal', deps), 'Finished');
    expect(finished?.reason).toMatch(/did not change across/);
  });
});

describe('guardrail: stuck detection', () => {
  const wait: Action = { type: 'Wait', maxMs: 10, reason: 'waiting for something to happen' };

  it('injects a reflection turn on the third identical screen', async () => {
    const { deps } = harness([wait, wait, wait, finishPass], {}, [SEARCH]);
    const events = await collect('goal', deps);
    const stuck = events.filter((e) => e.type === 'Stuck');
    expect(stuck.length).toBeGreaterThanOrEqual(1);
    expect(stuck[0]).toMatchObject({ repeats: 3, terminating: false });
  });

  it('terminates on the fourth, rather than burning the step budget', async () => {
    const { deps } = harness(Array.from({ length: 10 }, () => wait), {}, [SEARCH]);
    const events = await collect('goal', deps);
    expect(events.some((e) => e.type === 'Stuck' && e.terminating)).toBe(true);
    expect(find(events, 'Finished')?.reason).toMatch(/did not change across/);
  });

  it('does not fire while the screen keeps changing', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    expect((await collect('goal', deps)).some((e) => e.type === 'Stuck')).toBe(false);
  });
});

describe('guardrail: the destructive gate', () => {
  const placeOrder: Action = { type: 'Tap', node: 3, reason: 'place the order' };

  it('suspends and asks before a flagged action', async () => {
    let asked: string | null = null;
    const { deps } = harness([placeOrder, finishPass], {
      onConfirm: ({ matched }) => {
        asked = matched;
        return Promise.resolve(true);
      },
    });
    const events = await collect('goal', deps);
    expect(find(events, 'ConfirmationRequired')?.matched).toBe('order');
    expect(asked).toBe('order');
    expect(find(events, 'ConfirmationResolved')?.allowed).toBe(true);
  });

  it('executes the action once allowed', async () => {
    const { deps, executor } = harness([placeOrder, assertUnder500, finishPass], {
      onConfirm: () => Promise.resolve(true),
    });
    await collect('goal', deps);
    expect(executor.calls[0]?.action).toMatchObject({ type: 'Tap', node: 3 });
  });

  it('does not execute when denied, and ends Blocked', async () => {
    const { deps, executor } = harness([placeOrder, finishPass], { onConfirm: () => Promise.resolve(false) });
    const events = await collect('goal', deps);
    expect(executor.calls).toHaveLength(0);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Blocked' });
  });

  it('denies by default when nobody is watching', async () => {
    // An unattended agent must not place an order because no handler was wired.
    const { deps, executor } = harness([placeOrder, finishPass]);
    const events = await collect('goal', deps);
    expect(executor.calls).toHaveLength(0);
    expect(find(events, 'ConfirmationResolved')?.allowed).toBe(false);
  });

  it('does not flag an ordinary tap', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    expect((await collect('goal', deps)).some((e) => e.type === 'ConfirmationRequired')).toBe(false);
  });

  it('honours a caller-supplied pattern list', async () => {
    const { deps } = harness([tap, finishPass], {
      destructivePatterns: ['Deccan Dastarkhwan'],
      onConfirm: () => Promise.resolve(false),
    });
    expect(find(await collect('goal', deps), 'ConfirmationRequired')?.matched).toBe('Deccan Dastarkhwan');
  });
});

describe('guardrail: cancellation', () => {
  it('stops before the first action when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, executor } = harness([tap, finishPass]);
    const events = await collect('goal', deps, controller.signal);
    expect(executor.calls).toHaveLength(0);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Blocked', reason: 'stopped by the user' });
  });

  it('aborts mid-inference and ends the run within one action', async () => {
    const controller = new AbortController();
    const { deps, executor } = harness([tap, tap, tap, finishPass], {
      planner: new MockPlanner({ script: [tap, tap, tap, finishPass], latencyMs: 50 }),
    });
    const events: RunEvent[] = [];
    for await (const event of run('goal', deps, controller.signal)) {
      events.push(event);
      if (event.type === 'ActionExecuted') controller.abort();
    }
    expect(find(events, 'Finished')).toMatchObject({ reason: 'stopped by the user' });
    expect(executor.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('failure paths never throw', () => {
  it('reports a read failure as a Failed event', async () => {
    const { deps, reader } = harness([tap, finishPass]);
    reader.failNext = { kind: 'no-root', message: 'The target app root is not mounted yet.' };
    const events = await collect('goal', deps);
    expect(find(events, 'Failed')).toMatchObject({ kind: 'read' });
  });

  it('reports an execution failure distinctly from a rejection', async () => {
    const { deps, executor } = harness([tap, finishPass]);
    executor.failWith = { kind: 'target-gone', message: 'Node 1 has been removed from the page.' };
    const events = await collect('goal', deps);
    const failed = find(events, 'Failed');
    expect(failed?.kind).toBe('execution');
    expect(failed?.message).toMatch(/could not be performed/);
    expect(events.some((e) => e.type === 'ActionRejected')).toBe(false);
  });

  it('ends the run when the planner itself is unavailable', async () => {
    const { deps } = harness([], { planner: new MockPlanner({ script: [], onExhausted: 'error' }) });
    expect(find(await collect('goal', deps), 'Failed')?.kind).toBe('model-output');
  });
});

describe('the port is proven, not promised', () => {
  it('runs the entire loop with no DOM anywhere in the dependency graph', async () => {
    // FakeReader and FakeExecutor touch no browser API. If this passes, nothing
    // above the adapter boundary secretly needs one.
    const { deps } = harness([tap, assertUnder500, finishPass]);
    const events = await collect('check the cart total is under 500', deps);
    expect(find(events, 'Finished')).toMatchObject({ verdict: 'Pass', passedAsserts: 1, steps: 3 });
  });
});

describe('guardrail: the wall-clock ceiling', () => {
  // The step ceiling bounds ACTIONS, not TIME. A slow planner could sit at 25
  // steps for many minutes with the UI looking alive. Measured on an integrated
  // GPU: 41s per call, which is 17 minutes for a full run.
  it('ends the run when it has taken too long, whatever the step count', async () => {
    let clock = 1_700_000_000_000;
    const wait: Action = { type: 'Wait', maxMs: 1, reason: 'slow' };
    const { deps } = harness(
      Array.from({ length: 30 }, () => wait),
      {
        limits: { maxRunMs: 5000 },
        // Every call to now() advances the clock by two seconds.
        now: () => {
          clock += 2000;
          return clock;
        },
      },
      [SEARCH],
    );
    const finished = find(await collect('goal', deps), 'Finished');
    expect(finished?.verdict).toBe('Blocked');
    expect(finished?.reason).toMatch(/past the 5s ceiling/);
  });

  it('does not fire on a normal run', async () => {
    const { deps } = harness([tap, assertUnder500, finishPass]);
    const finished = find(await collect('goal', deps), 'Finished');
    expect(finished?.verdict).toBe('Pass');
  });
});
