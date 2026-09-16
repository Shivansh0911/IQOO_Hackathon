/**
 * The scripted planner used when no model is available.
 *
 * The first end-to-end run taught us something worth keeping: a script of
 * hardcoded node indices is brittle, because indices legitimately shift with app
 * state. A cart badge appearing adds a node and everything after it moves. The
 * run still passed, but only because index 11 happened to be a restaurant card
 * on both screens — that is luck, and luck is not a demo.
 *
 * So the script names its target by TEXT and resolves the index against the
 * screen the agent was actually just shown. It is still scripted — the plan is
 * fixed, nothing is inferred, and the status strip says "mock" throughout — but
 * it is scripted the way a human would describe the steps, not the way a
 * brittle recording would.
 *
 * This lives in the demo app rather than in packages/planner because it is a
 * demo affordance, not part of the product's inference story.
 */

import type { Action, Result } from '@origo/core';
import { estimateTokens, ok, err } from '@origo/core';
import type { Planner, PlanError, PlanOutput, PlanRequest, PlannerInfo } from '@origo/planner';
import { assemblePrompt } from '@origo/planner';

/** One scripted step. `match` picks the node; everything else is the action. */
export type ScriptStep =
  | { type: 'Tap'; match: string | RegExp; reason: string }
  | { type: 'TypeText'; match: string | RegExp; text: string; reason: string }
  | { type: 'Scroll'; match: string | RegExp; direction: 'up' | 'down'; reason: string }
  | { type: 'Assert'; match: string | RegExp; expect: string; reason: string }
  | { type: 'Finish'; verdict: 'Pass' | 'Fail' | 'Blocked'; reason: string };

interface PromptNode {
  i: number;
  role: string;
  text?: string;
  desc?: string;
  clk?: 1;
  ed?: 1;
  scr?: 1;
}

/** Finds the first node whose text or description matches, and that can take the action. */
function resolve(nodes: PromptNode[], step: ScriptStep): number | null {
  if (step.type === 'Finish') return null;
  const needs =
    step.type === 'TypeText' ? (n: PromptNode) => n.ed === 1
    : step.type === 'Scroll' ? (n: PromptNode) => n.scr === 1
    : step.type === 'Tap' ? (n: PromptNode) => n.clk === 1
    : () => true;

  const test = (value: string): boolean =>
    typeof step.match === 'string' ? value.toLowerCase().includes(step.match.toLowerCase()) : step.match.test(value);

  const candidate = nodes.find((n) => needs(n) && (test(n.text ?? '') || test(n.desc ?? '')));
  return candidate?.i ?? null;
}

export class ScriptedPlanner implements Planner {
  readonly info: PlannerInfo = {
    tier: 'mock',
    model: 'scripted',
    detail: 'A fixed plan, resolved against the live screen. No model is running and nothing is inferred.',
    onDevice: false,
  };

  private cursor = 0;

  constructor(
    private readonly script: readonly ScriptStep[],
    private readonly latencyMs = 240,
  ) {}

  available(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async next(request: PlanRequest, signal: AbortSignal): Promise<Result<PlanOutput, PlanError>> {
    const started = Date.now();
    const prompt = assemblePrompt(request, estimateTokens);

    await new Promise<void>((resolve_) => {
      const timer = setTimeout(resolve_, this.latencyMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve_();
      }, { once: true });
    });
    if (signal.aborted) {
      return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });
    }

    const step = this.script[this.cursor];
    const done = (action: Action): Result<PlanOutput, PlanError> =>
      ok({ raw: JSON.stringify(action), latencyMs: Date.now() - started, promptTokens: prompt.estimatedTokens });

    if (!step) {
      return done({ type: 'Finish', verdict: 'Blocked', reason: 'the scripted plan ran out of steps' });
    }
    this.cursor += 1;

    if (step.type === 'Finish') {
      return done({ type: 'Finish', verdict: step.verdict, reason: step.reason });
    }

    const nodes = JSON.parse(request.screenJson) as PromptNode[];
    const index = resolve(nodes, step);
    if (index === null) {
      // Honest failure: the script named something this screen does not have.
      // Blocked, not a wrong tap on whatever happened to be nearby.
      return done({
        type: 'Finish',
        verdict: 'Blocked',
        reason: `nothing on this screen matches "${String(step.match)}"`,
      });
    }

    switch (step.type) {
      case 'Tap':
        return done({ type: 'Tap', node: index, reason: step.reason });
      case 'TypeText':
        return done({ type: 'TypeText', node: index, text: step.text, reason: step.reason });
      case 'Scroll':
        return done({ type: 'Scroll', node: index, direction: step.direction, reason: step.reason });
      case 'Assert':
        return done({ type: 'Assert', node: index, expect: step.expect, reason: step.reason });
    }
  }
}
