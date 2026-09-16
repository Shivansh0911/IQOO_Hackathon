import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@origo/agent';
import type { Action, UiNode } from '@origo/core';
import { buildReportModel, renderReportHtml, renderReportText, escapeHtml } from '../src/index.js';

const node = (partial: Partial<UiNode> & { index: number }): UiNode => ({
  role: 'btn',
  text: '',
  desc: '',
  bounds: { x: 0, y: 0, w: 100, h: 40 },
  clickable: true,
  editable: false,
  scrollable: false,
  checked: null,
  enabled: true,
  depth: 2,
  ...partial,
});

const tap: Action = { type: 'Tap', node: 1, reason: 'open the first restaurant' };
const assertion: Action = { type: 'Assert', node: 2, expect: '<500', reason: 'check the total' };

const stats = {
  before: 60,
  after: 15,
  dropped: { invisible: 6, 'zero-area': 1, offscreen: 0, disabled: 0, 'no-signal': 19, 'text-container': 22 },
  overCap: 0,
} as const;

const screen = (tokens: number) => ({
  screenId: 'results',
  nodeCount: 15,
  estimatedTokens: tokens,
  hash: 'abc123',
  stats,
  promptJson: '[{"i":1,"role":"btn","text":"Deccan Dastarkhwan","clk":1}]',
});

function run(overrides: RunEvent[] = []): RunEvent[] {
  return [
    {
      type: 'Started',
      goal: 'check the cart total is under ₹500',
      planner: { tier: 'cloud', model: 'llama-3.2-3b:free', detail: '', onDevice: false },
      platform: 'web',
      online: true,
      at: 1_700_000_000_000,
    },
    { type: 'Planning', step: 1, screen: screen(360), attempt: 1, at: 1 },
    { type: 'ActionProposed', step: 1, action: tap, target: node({ index: 1, text: 'Deccan Dastarkhwan' }), adjustments: [], latencyMs: 420, promptTokens: 1300, raw: '{}', at: 2 },
    { type: 'ActionExecuted', step: 1, action: tap, target: node({ index: 1 }), detail: 'tapped <button>', durationMs: 12, settledMs: 130, settled: true, at: 3 },
    { type: 'Planning', step: 2, screen: screen(580), attempt: 1, at: 4 },
    { type: 'ActionProposed', step: 2, action: assertion, target: node({ index: 2, text: 'Total ₹374' }), adjustments: [], latencyMs: 380, promptTokens: 1500, raw: '{}', at: 5 },
    { type: 'ActionExecuted', step: 2, action: assertion, target: node({ index: 2 }), detail: 'asserted', durationMs: 2, settledMs: 90, settled: true, at: 6 },
    { type: 'AssertResult', step: 2, outcome: { passed: true, kind: 'numeric', detail: 'node 2 reads 374; expected < 500', observed: 'Total ₹374', expected: '<500' }, at: 7 },
    { type: 'Finished', verdict: 'Pass', reason: 'the total is under 500', steps: 2, passedAsserts: 1, failedAsserts: 0, durationMs: 2300, at: 8 },
    ...overrides,
  ];
}

describe('buildReportModel', () => {
  it('reconstructs the run from the event stream alone', () => {
    const model = buildReportModel(run());
    expect(model.verdict).toBe('Pass');
    expect(model.goal).toBe('check the cart total is under ₹500');
    expect(model.steps).toHaveLength(2);
    expect(model.passedAsserts).toBe(1);
    expect(model.durationMs).toBe(2300);
  });

  it('records which platform and planner actually produced it', () => {
    const model = buildReportModel(run());
    expect(model.platform).toBe('web');
    expect(model.plannerTier).toBe('cloud');
    expect(model.plannerModel).toBe('llama-3.2-3b:free');
    expect(model.onDevice).toBe(false);
  });

  it('computes the engineering numbers', () => {
    const model = buildReportModel(run());
    expect(model.meanPlanMs).toBe(400);
    expect(model.meanScreenTokens).toBe(470);
    expect(model.worstScreenTokens).toBe(580);
  });

  it('attaches rejections to the step they preceded', () => {
    const events = run();
    events.splice(2, 0, {
      type: 'ActionRejected',
      step: 1,
      attempt: 1,
      error: { stage: 'semantic', fault: 'invalid-for-screen', message: 'Node 99 does not exist.' },
      raw: '{"type":"Tap","node":99}',
      at: 1.5,
    });
    const model = buildReportModel(events);
    expect(model.rejectionCount).toBe(1);
    expect(model.steps[0]?.rejections[0]?.message).toMatch(/does not exist/);
  });

  it('records a denied destructive action', () => {
    const events: RunEvent[] = [
      ...run().slice(0, 4),
      { type: 'ConfirmationRequired', step: 1, action: tap, target: node({ index: 1 }), matched: 'order', at: 9 },
      { type: 'ConfirmationResolved', step: 1, allowed: false, at: 10 },
      { type: 'Finished', verdict: 'Blocked', reason: '"order" action was not allowed', steps: 1, passedAsserts: 0, failedAsserts: 0, durationMs: 900, at: 11 },
    ];
    const model = buildReportModel(events);
    expect(model.verdict).toBe('Blocked');
    expect(model.steps[0]?.confirmation).toEqual({ matched: 'order', allowed: false });
  });

  it('marks a failed assertion on its step', () => {
    const events = run();
    events[7] = {
      type: 'AssertResult',
      step: 2,
      outcome: { passed: false, kind: 'numeric', detail: 'node 2 reads 1240; expected < 500', observed: '', expected: '<500' },
      at: 7,
    };
    const model = buildReportModel(events);
    expect(model.steps[1]?.status).toBe('failed');
    expect(model.steps[1]?.assert?.passed).toBe(false);
  });

  it('reports a Failed run as Error rather than inventing a verdict', () => {
    const events: RunEvent[] = [
      ...run().slice(0, 4),
      { type: 'Failed', kind: 'execution', message: 'Node 1 has been removed from the page.', step: 1, durationMs: 700, at: 9 },
    ];
    const model = buildReportModel(events);
    expect(model.verdict).toBe('Error');
    expect(model.reason).toMatch(/removed from the page/);
  });

  it('survives an empty stream without throwing', () => {
    const model = buildReportModel([]);
    expect(model.steps).toHaveLength(0);
    expect(model.verdict).toBe('Blocked');
  });
});

describe('renderReportHtml — one file, no external assets', () => {
  const html = renderReportHtml(buildReportModel(run()));

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
  });

  it('references NOTHING external — no src, no href, no url()', () => {
    // This is the property that lets the report cross the phone-to-laptop
    // bridge on site and still render.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/\bhref\s*=/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import/i);
  });

  it('leads with the verdict and the goal', () => {
    expect(html).toContain('class="verdict pass"');
    expect(html).toContain('check the cart total is under ₹500');
  });

  it('states the planner tier and network state without softening them', () => {
    expect(html).toContain('cloud');
    expect(html).toContain('llama-3.2-3b:free');
    expect(html).toContain('inference ran in the cloud');
  });

  it('says plainly when the plan was scripted rather than inferred', () => {
    const events = run();
    events[0] = { ...events[0], planner: { tier: 'mock', model: 'scripted', detail: '', onDevice: false } } as RunEvent;
    expect(renderReportHtml(buildReportModel(events))).toContain('no model was consulted');
  });

  it('embeds the exact screen JSON the model saw as evidence', () => {
    expect(html).toContain('&quot;i&quot;:1');
    expect(html).toContain('what the model was shown');
  });

  it('shows the assertion result with the observed value', () => {
    expect(html).toContain('node 2 reads 374; expected &lt; 500');
  });

  it('includes the engineering section with real timings', () => {
    expect(html).toContain('mean planning latency 400ms');
    expect(html).toContain('mean screen 470 est. tokens');
  });

  it('marks the token counts as estimates rather than implying precision', () => {
    expect(html).toMatch(/Token counts are estimates/);
    expect(html).toMatch(/do not transfer to another one/);
  });

  it('never claims the NPU', () => {
    // CLAUDE.md accuracy rule. MediaPipe on Android runs GPU/CPU, not Hexagon.
    expect(html.toLowerCase()).not.toContain('npu');
    expect(html.toLowerCase()).not.toContain('hexagon');
  });

  it('escapes model- and user-supplied text', () => {
    const events = run();
    events[0] = { ...events[0], goal: '<img onerror=alert(1)>' } as RunEvent;
    const dangerous = renderReportHtml(buildReportModel(events));
    expect(dangerous).not.toContain('<img onerror');
    expect(dangerous).toContain('&lt;img onerror');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders a red verdict for a failed assertion', () => {
    const events = run();
    events[8] = { type: 'Finished', verdict: 'Fail', reason: 'an expectation did not hold', steps: 2, passedAsserts: 0, failedAsserts: 1, durationMs: 2300, at: 8 };
    expect(renderReportHtml(buildReportModel(events))).toContain('class="verdict fail"');
  });
});

describe('renderReportText — for pasting into a chat', () => {
  const text = renderReportText(buildReportModel(run()));

  it('leads with the verdict and the goal', () => {
    expect(text.startsWith('ORIGO LOOP — Pass')).toBe(true);
    expect(text).toContain('goal: check the cart total is under ₹500');
  });

  it('lists every step and its assertion outcome', () => {
    expect(text).toContain('01  Tap(1)');
    expect(text).toContain('PASS: node 2 reads 374');
  });

  it('names the planner tier, so a pasted report cannot overstate itself', () => {
    expect(text).toContain('planner cloud (llama-3.2-3b:free)');
  });
});
