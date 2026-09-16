import { describe, expect, it } from 'vitest';
import type { Action } from '@origo/core';
import { CloudPlanner, DEFAULT_CLOUD_MODEL, MockPlanner, PlannerRegistry } from '../src/index.js';
import type { FetchLike } from '../src/cloud-planner.js';
import type { PlanRequest } from '../src/planner.js';

const request: PlanRequest = { goal: 'search for biryani', screenJson: '[{"i":0,"role":"btn","clk":1}]', history: [] };
const live = (): AbortSignal => new AbortController().signal;

const tap: Action = { type: 'Tap', node: 0, reason: 'open it' };

/**
 * A hand-rolled fetch spy. Deliberately not vi.fn: this records the exact
 * arguments we then assert on (that the key appears in the header and NOWHERE
 * else), and it stays readable across vitest versions.
 */
function spyFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { impl, calls };
}

describe('MockPlanner', () => {
  it('serialises a scripted Action the way a model would emit it', async () => {
    const planner = new MockPlanner({ script: [tap] });
    const result = await planner.next(request, live());
    expect(result.ok && JSON.parse(result.value.raw)).toEqual(tap);
  });

  it('can emit deliberately malformed output, so the rejection path is testable', async () => {
    const planner = new MockPlanner({ script: ['I think you should tap the first card.'] });
    const result = await planner.next(request, live());
    expect(result.ok && result.value.raw).toBe('I think you should tap the first card.');
  });

  it('walks the script in order', async () => {
    const planner = new MockPlanner({ script: [tap, { type: 'Finish', verdict: 'Pass', reason: 'done' }] });
    const first = await planner.next(request, live());
    const second = await planner.next(request, live());
    expect(first.ok && JSON.parse(first.value.raw).type).toBe('Tap');
    expect(second.ok && JSON.parse(second.value.raw).type).toBe('Finish');
    expect(planner.consumed).toBe(2);
  });

  it('finishes Blocked rather than looping when the script runs out', async () => {
    const planner = new MockPlanner({ script: [] });
    const result = await planner.next(request, live());
    expect(result.ok && JSON.parse(result.value.raw)).toMatchObject({ type: 'Finish', verdict: 'Blocked' });
  });

  it('reports the prompt size it would have sent', async () => {
    const result = await new MockPlanner({ script: [tap] }).next(request, live());
    expect(result.ok && result.value.promptTokens).toBeGreaterThan(100);
  });

  it('is honest about itself: mock tier, not on-device, no model', () => {
    const info = new MockPlanner({ script: [] }).info;
    expect(info.tier).toBe('mock');
    expect(info.onDevice).toBe(false);
    expect(info.detail).toMatch(/nothing is being inferred/);
  });

  it('aborts mid-inference when STOP is pressed', async () => {
    const planner = new MockPlanner({ script: [tap], latencyMs: 500 });
    const controller = new AbortController();
    const pending = planner.next(request, controller.signal);
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('aborted');
  });
});

describe('CloudPlanner', () => {
  const okResponse = (content: string): Response =>
    ({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) }) as Response;

  it('reports itself unavailable with no key, rather than failing the app', async () => {
    const planner = new CloudPlanner({ apiKey: () => null });
    expect(await planner.available()).toBe(false);
    const result = await planner.next(request, live());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-configured');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('becomes available once a key exists', async () => {
    expect(await new CloudPlanner({ apiKey: () => 'sk-test' }).available()).toBe(true);
  });

  it('sends the assembled system and user prompts and the decoding constraints', async () => {
    const fetch = spyFetch(() => okResponse('{"type":"Tap","node":0,"reason":"go"}'));
    await new CloudPlanner({ apiKey: () => 'sk-test', fetchImpl: fetch.impl }).next(request, live());

    const body = JSON.parse(String(fetch.calls[0]?.init.body));
    expect(body.model).toBe(DEFAULT_CLOUD_MODEL);
    expect(body.temperature).toBeLessThanOrEqual(0.2);
    expect(body.max_tokens).toBeLessThanOrEqual(200);
    expect(body.stop).toContain('```');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/EXACTLY ONE JSON object/);
    expect(body.messages[1].content).toContain('search for biryani');
  });

  it('never puts the key anywhere but the Authorization header', async () => {
    const fetch = spyFetch(() => okResponse('{}'));
    await new CloudPlanner({ apiKey: () => 'sk-secret-value', fetchImpl: fetch.impl }).next(request, live());
    const call = fetch.calls[0];
    expect(call?.url).not.toContain('sk-secret-value');
    expect(String(call?.init.body)).not.toContain('sk-secret-value');
    expect((call?.init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret-value');
  });

  it('returns the raw completion unexamined, for the one validator to judge', async () => {
    const raw = 'Sure!\n```json\n{"type":"Tap","node":0,"reason":"go"}\n```';
    const fetchImpl: FetchLike = () => Promise.resolve(okResponse(raw));
    const result = await new CloudPlanner({ apiKey: () => 'k', fetchImpl }).next(request, live());
    expect(result.ok && result.value.raw).toBe(raw);
  });

  it('explains a rate limit in terms the user can act on', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('') } as Response);
    const result = await new CloudPlanner({ apiKey: () => 'k', fetchImpl }).next(request, live());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/rate-limited/);
      expect(result.error.retryable).toBe(true);
    }
  });

  it('turns a network throw into an Err, never an exception', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('DNS failure'));
    const result = await new CloudPlanner({ apiKey: () => 'k', fetchImpl }).next(request, live());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('treats an empty completion as a retryable failure, not as an action', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(okResponse('   '));
    const result = await new CloudPlanner({ apiKey: () => 'k', fetchImpl }).next(request, live());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('empty');
  });

  it('says plainly that the screen leaves the device', () => {
    const info = new CloudPlanner({ apiKey: () => 'k' }).info;
    expect(info.onDevice).toBe(false);
    expect(info.detail).toMatch(/leaves this device/);
  });
});

describe('PlannerRegistry', () => {
  const planner = (tier: 'local' | 'cloud' | 'mock', usable: boolean) =>
    ({
      info: { tier, model: `${tier}-model`, detail: '', onDevice: tier === 'local' },
      available: () => Promise.resolve(usable),
      next: () => Promise.reject(new Error('not called')),
    }) as const;

  it('prefers local, because on-device is the product and not a fallback', async () => {
    const registry = new PlannerRegistry([planner('local', true), planner('cloud', true), planner('mock', true)]);
    const result = await registry.select();
    expect(result.ok && result.value.planner.info.tier).toBe('local');
  });

  it('falls through in order when a tier is unavailable', async () => {
    const registry = new PlannerRegistry([planner('local', false), planner('cloud', false), planner('mock', true)]);
    const result = await registry.select();
    expect(result.ok && result.value.planner.info.tier).toBe('mock');
    expect(result.ok && result.value.trace.map((t) => t.available)).toEqual([false, false, true]);
  });

  it('honours a manual override', async () => {
    const registry = new PlannerRegistry([planner('local', true), planner('cloud', true)]);
    const result = await registry.select('cloud');
    expect(result.ok && result.value.planner.info.tier).toBe('cloud');
    expect(result.ok && result.value.overridden).toBe(true);
  });

  it('fails loudly rather than silently substituting when a pinned tier is unavailable', async () => {
    // A pinned tier that quietly fell back would make the status strip a liar.
    const registry = new PlannerRegistry([planner('local', false), planner('mock', true)]);
    const result = await registry.select('local');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not available here/);
  });

  it('reports the full trace so the UI can explain its choice', async () => {
    const registry = new PlannerRegistry([planner('local', false), planner('cloud', true)]);
    const result = await registry.select();
    expect(result.ok && result.value.trace).toEqual([
      { tier: 'local', model: 'local-model', available: false },
      { tier: 'cloud', model: 'cloud-model', available: true },
    ]);
  });

  it('errors clearly when nothing at all is available', async () => {
    const result = await new PlannerRegistry([planner('local', false)]).select();
    expect(result.ok).toBe(false);
  });
});
