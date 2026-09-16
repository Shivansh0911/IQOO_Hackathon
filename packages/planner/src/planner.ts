/**
 * The Planner interface.
 *
 * TWO DELIBERATE DEVIATIONS FROM THE BRIEF, both flagged rather than made
 * silently, because both are boundary questions and the boundary wins:
 *
 * 1. `next()` returns the model's RAW text, not a parsed Action.
 *    The brief specifies Result<Action, PlanError>. If a planner returned a
 *    parsed Action, every planner implementation would have to parse and
 *    validate — three implementations, three chances to be lenient, and
 *    "never execute unvalidated model output" would become a convention
 *    instead of a guarantee. There is exactly ONE validator
 *    (validateModelOutput in @origo/core) and the agent owns it, because only
 *    the agent holds the ScreenState the action must be checked against.
 *    The planner's job is to produce text; judging it is someone else's.
 *
 * 2. LocalPlanner (WebLLM) does NOT live in this package.
 *    The brief lists packages/planner/local-planner.ts. It cannot: WebLLM needs
 *    navigator.gpu and a browser, and packages/** is machine-forbidden from
 *    containing web code by RULE A. Putting it here would mean weakening the
 *    lint rule that is our whole portability claim. It lives in
 *    adapters/webllm instead, behind this same interface — which is precisely
 *    what the interface is for. On Android, MediaPipe gets its own adapter and
 *    this package still does not change.
 */

import type { Result } from '@origo/core';

/** One line of compressed history, as the model will see it. */
export interface StepSummary {
  readonly step: number;
  /** Formatted action, e.g. `Tap(11)`. */
  readonly action: string;
  readonly outcome: 'ok' | 'rejected' | 'failed' | 'assert-pass' | 'assert-fail';
  /** Short note: the model's own reason, or why it was rejected. */
  readonly note: string;
}

export interface PlanRequest {
  readonly goal: string;
  /** Compact screen JSON, exactly as toPromptJson produced it. */
  readonly screenJson: string;
  readonly history: readonly StepSummary[];
  /** The validator's message from the previous attempt. Drives the correction turn. */
  readonly lastError?: string;
  /** Set when the screen has not changed for three reads. Drives the reflection turn. */
  readonly reflection?: string;
}

export type PlanErrorKind =
  | 'unavailable'
  | 'not-configured'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'empty'
  | 'provider-error';

export interface PlanError {
  readonly kind: PlanErrorKind;
  readonly message: string;
  /** Whether trying the same planner again could plausibly work. */
  readonly retryable: boolean;
}

export interface PlanOutput {
  /** Whatever the model said, unexamined. The agent validates it. */
  readonly raw: string;
  readonly latencyMs: number;
  /** Estimated prompt size, for the status strip and the engineering report. */
  readonly promptTokens: number;
}

/** Which tier is active. The status strip renders this and must never invent it. */
export type PlannerTier = 'local' | 'cloud' | 'mock';

export interface PlannerInfo {
  readonly tier: PlannerTier;
  /** Real model identifier, reported by the runtime. Never a hardcoded pretty name. */
  readonly model: string;
  /** One line for the UI explaining what this tier actually is. */
  readonly detail: string;
  /** True only when inference happens on this device with no network involved. */
  readonly onDevice: boolean;
}

export interface Planner {
  readonly info: PlannerInfo;
  /** Can this planner run here, right now? Cheap, and safe to call repeatedly. */
  available(): Promise<boolean>;
  next(request: PlanRequest, signal: AbortSignal): Promise<Result<PlanOutput, PlanError>>;
}

/** Sampling settings. Small models drift; every knob here exists to stop that. */
export const DECODING = {
  /** Near-greedy. We want the most likely action, never a creative one. */
  temperature: 0.1,
  topP: 0.9,
  /** One action object is ~40 tokens. 200 is generous and caps a runaway. */
  maxTokens: 200,
  /** Stop the moment the object closes, before the model starts explaining itself. */
  stop: ['}\n', '\n\n', '</s>', '```'],
} as const;
