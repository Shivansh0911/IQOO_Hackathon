/**
 * MockPlanner — scripted actions.
 *
 * Three jobs: drive the guardrail tests deterministically, let the whole app be
 * developed with no network and no GPU, and exist as a guaranteed-working path
 * if we ever have to record on bad conference wifi.
 *
 * It is HONEST by construction: its tier is 'mock' and its info says plainly
 * that nothing is being inferred. The status strip renders that, so a scripted
 * run can never be mistaken for a live one.
 */

import type { Action, Result } from '@origo/core';
import { err, estimateTokens, ok } from '@origo/core';
import type { Planner, PlanError, PlanOutput, PlanRequest, PlannerInfo } from './planner.js';
import { assemblePrompt } from './prompt.js';

export interface MockPlannerOptions {
  /**
   * The script. An Action is serialised to JSON as a real model would emit it;
   * a raw string lets a test feed deliberately malformed output to the
   * validator, which is the only way to test the rejection path honestly.
   */
  readonly script: readonly (Action | string)[];
  /** Simulated thinking time, so the UI's planning state is exercised. */
  readonly latencyMs?: number;
  /** What to do once the script runs out. Default: Finish(Blocked). */
  readonly onExhausted?: 'finish-blocked' | 'error';
}

const EXHAUSTED: Action = {
  type: 'Finish',
  verdict: 'Blocked',
  reason: 'the scripted plan ran out of steps',
};

export class MockPlanner implements Planner {
  readonly info: PlannerInfo = {
    tier: 'mock',
    model: 'scripted',
    detail: 'Scripted actions. No model is running and nothing is being inferred.',
    onDevice: false,
  };

  private cursor = 0;
  private readonly options: MockPlannerOptions;

  constructor(options: MockPlannerOptions) {
    this.options = options;
  }

  /** Always. That is the point of the tier. */
  available(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Steps consumed so far, for assertions in tests. */
  get consumed(): number {
    return this.cursor;
  }

  reset(): void {
    this.cursor = 0;
  }

  async next(request: PlanRequest, signal: AbortSignal): Promise<Result<PlanOutput, PlanError>> {
    const started = Date.now();
    const prompt = assemblePrompt(request, estimateTokens);

    const delay = this.options.latencyMs ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    // Cancellation is checked after the simulated inference, because that is
    // exactly where a real planner would notice it: mid-flight.
    if (signal.aborted) {
      return err({ kind: 'aborted', message: 'Cancelled during planning.', retryable: false });
    }

    const step = this.options.script[this.cursor];
    this.cursor += 1;

    if (step === undefined) {
      if (this.options.onExhausted === 'error') {
        return err({ kind: 'empty', message: 'The scripted plan ran out of steps.', retryable: false });
      }
      return ok({ raw: JSON.stringify(EXHAUSTED), latencyMs: Date.now() - started, promptTokens: prompt.estimatedTokens });
    }

    return ok({
      raw: typeof step === 'string' ? step : JSON.stringify(step),
      latencyMs: Date.now() - started,
      promptTokens: prompt.estimatedTokens,
    });
  }
}
