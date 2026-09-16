/**
 * The RunEvent stream.
 *
 * This is the ONLY thing the UI is allowed to render from. No component reaches
 * into the agent; the agent emits, the console draws. That discipline is what
 * makes the Android shell a re-skin instead of a rewrite — the same stream,
 * a different renderer.
 *
 * Events are the complete record of a run: the report generator builds its
 * output from nothing else.
 */

import type { Action, Adjustment, ExpectationOutcome, PruneStats, UiNode, ValidationError } from '@origo/core';
import type { PlannerInfo } from '@origo/planner';

export interface ScreenFacts {
  readonly screenId: string;
  readonly nodeCount: number;
  readonly estimatedTokens: number;
  readonly hash: string;
  readonly stats: PruneStats;
  /** The exact JSON the model was shown. Kept for the report's evidence. */
  readonly promptJson: string;
}

/** Why a step ended the way it did — the report distinguishes these. */
export type StepFailureKind = 'model-output' | 'execution' | 'read';

export type RunEvent =
  | { readonly type: 'Started'; readonly goal: string; readonly planner: PlannerInfo; readonly platform: string; readonly online: boolean; readonly at: number }
  | { readonly type: 'Planning'; readonly step: number; readonly screen: ScreenFacts; readonly attempt: number; readonly at: number }
  | { readonly type: 'ActionProposed'; readonly step: number; readonly action: Action; readonly target: UiNode | null; readonly adjustments: readonly Adjustment[]; readonly latencyMs: number; readonly promptTokens: number; readonly raw: string; readonly at: number }
  | { readonly type: 'ActionRejected'; readonly step: number; readonly attempt: number; readonly error: ValidationError; readonly raw: string; readonly at: number }
  | { readonly type: 'Retrying'; readonly step: number; readonly attempt: number; readonly because: string; readonly at: number }
  | { readonly type: 'ActionExecuted'; readonly step: number; readonly action: Action; readonly target: UiNode | null; readonly detail: string; readonly durationMs: number; readonly settledMs: number; readonly settled: boolean; readonly at: number }
  | { readonly type: 'AssertResult'; readonly step: number; readonly outcome: ExpectationOutcome; readonly at: number }
  | { readonly type: 'ConfirmationRequired'; readonly step: number; readonly action: Action; readonly target: UiNode | null; readonly matched: string; readonly at: number }
  | { readonly type: 'ConfirmationResolved'; readonly step: number; readonly allowed: boolean; readonly at: number }
  | { readonly type: 'Stuck'; readonly step: number; readonly hash: string; readonly repeats: number; readonly terminating: boolean; readonly at: number }
  | { readonly type: 'Finished'; readonly verdict: 'Pass' | 'Fail' | 'Blocked'; readonly reason: string; readonly steps: number; readonly passedAsserts: number; readonly failedAsserts: number; readonly durationMs: number; readonly at: number }
  | { readonly type: 'Failed'; readonly kind: StepFailureKind; readonly message: string; readonly step: number; readonly durationMs: number; readonly at: number };

export type RunEventType = RunEvent['type'];

/** Events that end a run. Nothing follows one of these. */
export function isTerminal(event: RunEvent): boolean {
  return event.type === 'Finished' || event.type === 'Failed';
}
