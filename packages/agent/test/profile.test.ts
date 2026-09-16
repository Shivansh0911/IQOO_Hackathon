/**
 * THE PORT IS PROVEN HERE.
 *
 * The entire agent — loop, validator, guardrails — driven through a
 * PlatformProfile whose reader and executor touch no platform API of any kind.
 * If this passes, nothing above the adapter boundary secretly needs a browser,
 * and adding Android is adding one object.
 *
 * It is also the regression guard: the day a DOM call is smuggled into core,
 * this fails here rather than at hour three on site.
 */
import { describe, expect, it } from 'vitest';
import type { Action, PlatformProfile } from '@origo/core';
import { MockPlanner } from '@origo/planner';
import { run } from '../src/runner.js';
import type { RunEvent } from '../src/events.js';
import { fakeProfile, node, screen } from './fake-platform.js';

const SEARCH = screen('search', [
  node({ index: 0, role: 'edit', desc: 'Search', editable: true }),
  node({ index: 1, role: 'btn', text: 'Deccan Dastarkhwan 4.5', clickable: true }),
]);
const CART = screen('cart', [node({ index: 0, role: 'text', text: 'Total ₹374' })]);

const script: Action[] = [
  { type: 'Tap', node: 1, reason: 'open the first restaurant' },
  { type: 'Assert', node: 0, expect: '<500', reason: 'check the total is under 500' },
  { type: 'Finish', verdict: 'Pass', reason: 'the total is under 500' },
];

async function runThrough(profile: PlatformProfile, planner = new MockPlanner({ script })): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const iterator = run(
    'check the total is under 500',
    {
      reader: profile.reader,
      executor: profile.executor,
      settle: profile.settleStrategy,
      planner,
      platform: profile.label,
      online: () => true,
      limits: { maxSteps: profile.limits.maxSteps, settleTimeoutMs: profile.limits.settleTimeoutMs },
    },
    new AbortController().signal,
  );
  for await (const event of iterator) events.push(event);
  return events;
}

describe('the whole agent against a profile with no browser in it', () => {
  it('completes a run and reaches Pass', async () => {
    const events = await runThrough(fakeProfile([SEARCH, CART]));
    const finished = events.find((e) => e.type === 'Finished');
    expect(finished).toMatchObject({ verdict: 'Pass', passedAsserts: 1, steps: 3 });
  });

  it('reports the label the profile itself carries, not a hardcoded platform name', async () => {
    const events = await runThrough(fakeProfile([SEARCH, CART]));
    const started = events.find((e) => e.type === 'Started');
    expect(started && 'platform' in started && started.platform).toBe('fake');
  });

  it('takes its limits from the profile, not from a constant in the loop', async () => {
    const profile = fakeProfile([SEARCH, CART]);
    const tight: PlatformProfile = { ...profile, limits: { ...profile.limits, maxSteps: 1 } };
    const loop: Action = { type: 'Tap', node: 1, reason: 'again' };
    const events = await runThrough(tight, new MockPlanner({ script: [loop, loop, loop] }));
    const finished = events.find((e) => e.type === 'Finished');
    expect(finished).toMatchObject({ verdict: 'Blocked' });
    expect(finished && 'reason' in finished && finished.reason).toMatch(/1-action ceiling/);
  });
});
