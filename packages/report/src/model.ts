/**
 * The report model: RunEvent[] -> a structured run.
 *
 * Pure and platform-agnostic. The generator builds its output from the event
 * stream and nothing else, which is what makes the same report generator work
 * unchanged on Android — and what makes it testable without a browser.
 */

import type { RunEvent } from '@origo/agent';
import type { Action, UiNode } from '@origo/core';

export interface ReportStep {
  readonly step: number;
  readonly action: Action;
  readonly target: UiNode | null;
  readonly reason: string;
  readonly status: 'ok' | 'failed' | 'not-run';
  readonly detail: string;
  /** Where the model's time went, split so the engineering section can say. */
  readonly planMs: number;
  readonly actMs: number;
  readonly settleMs: number;
  readonly settled: boolean;
  /** Tokens of the screen this step was reasoned over. */
  readonly screenTokens: number;
  readonly screenId: string;
  /** The exact JSON the model saw. This is the evidence. */
  readonly screenJson: string;
  readonly assert: { readonly passed: boolean; readonly detail: string; readonly expected: string } | null;
  /** Rejections that happened before this step succeeded. Never hidden. */
  readonly rejections: readonly {
    readonly attempt: number;
    readonly stage: string;
    readonly fault: string;
    readonly message: string;
    readonly raw: string;
  }[];
  readonly confirmation: { readonly matched: string; readonly allowed: boolean } | null;
}

export interface ReportModel {
  readonly goal: string;
  readonly verdict: 'Pass' | 'Fail' | 'Blocked' | 'Error';
  readonly reason: string;
  readonly platform: string;
  readonly plannerTier: string;
  readonly plannerModel: string;
  readonly onDevice: boolean;
  readonly online: boolean;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly steps: readonly ReportStep[];
  readonly passedAsserts: number;
  readonly failedAsserts: number;
  readonly rejectionCount: number;
  readonly stuckCount: number;
  readonly meanPlanMs: number;
  readonly meanScreenTokens: number;
  readonly worstScreenTokens: number;
}

interface Draft {
  step: number;
  action: Action | null;
  target: UiNode | null;
  reason: string;
  status: 'ok' | 'failed' | 'not-run';
  detail: string;
  planMs: number;
  actMs: number;
  settleMs: number;
  settled: boolean;
  screenTokens: number;
  screenId: string;
  screenJson: string;
  assert: ReportStep['assert'];
  rejections: ReportStep['rejections'][number][];
  confirmation: ReportStep['confirmation'];
}

function blank(step: number): Draft {
  return {
    step,
    action: null,
    target: null,
    reason: '',
    status: 'not-run',
    detail: '',
    planMs: 0,
    actMs: 0,
    settleMs: 0,
    settled: true,
    screenTokens: 0,
    screenId: '',
    screenJson: '',
    assert: null,
    rejections: [],
    confirmation: null,
  };
}

export function buildReportModel(events: readonly RunEvent[]): ReportModel {
  const drafts = new Map<number, Draft>();
  const at = (step: number): Draft => {
    const existing = drafts.get(step);
    if (existing) return existing;
    const fresh = blank(step);
    drafts.set(step, fresh);
    return fresh;
  };

  let goal = '';
  let platform = 'unknown';
  let plannerTier = 'unknown';
  let plannerModel = 'unknown';
  let onDevice = false;
  let online = true;
  let startedAt = 0;
  let durationMs = 0;
  let verdict: ReportModel['verdict'] = 'Blocked';
  let reason = 'the run produced no verdict';
  let passedAsserts = 0;
  let failedAsserts = 0;
  let stuckCount = 0;

  for (const event of events) {
    switch (event.type) {
      case 'Started':
        goal = event.goal;
        platform = event.platform;
        plannerTier = event.planner.tier;
        plannerModel = event.planner.model;
        onDevice = event.planner.onDevice;
        online = event.online;
        startedAt = event.at;
        break;

      case 'Planning': {
        const draft = at(event.step);
        draft.screenTokens = event.screen.estimatedTokens;
        draft.screenId = event.screen.screenId;
        draft.screenJson = event.screen.promptJson;
        break;
      }

      case 'ActionProposed': {
        const draft = at(event.step);
        draft.action = event.action;
        draft.target = event.target;
        draft.reason = event.action.reason;
        draft.planMs = event.latencyMs;
        break;
      }

      case 'ActionRejected':
        at(event.step).rejections.push({
          attempt: event.attempt,
          stage: event.error.stage,
          fault: event.error.fault,
          message: event.error.message,
          raw: event.raw,
        });
        break;

      case 'ActionExecuted': {
        const draft = at(event.step);
        draft.status = 'ok';
        draft.detail = event.detail;
        draft.actMs = event.durationMs;
        draft.settleMs = event.settledMs;
        draft.settled = event.settled;
        break;
      }

      case 'AssertResult': {
        const draft = at(event.step);
        draft.assert = {
          passed: event.outcome.passed,
          detail: event.outcome.detail,
          expected: event.outcome.expected,
        };
        if (!event.outcome.passed) draft.status = 'failed';
        if (event.outcome.passed) passedAsserts += 1;
        else failedAsserts += 1;
        break;
      }

      case 'ConfirmationRequired':
        at(event.step).confirmation = { matched: event.matched, allowed: false };
        break;

      case 'ConfirmationResolved': {
        const draft = at(event.step);
        if (draft.confirmation) draft.confirmation = { ...draft.confirmation, allowed: event.allowed };
        break;
      }

      case 'Stuck':
        stuckCount += 1;
        break;

      case 'Finished':
        verdict = event.verdict;
        reason = event.reason;
        durationMs = event.durationMs;
        passedAsserts = event.passedAsserts;
        failedAsserts = event.failedAsserts;
        break;

      case 'Failed':
        verdict = 'Error';
        reason = event.message;
        durationMs = event.durationMs;
        break;

      case 'Retrying':
        break;
    }
  }

  const steps: ReportStep[] = [...drafts.values()]
    .sort((a, b) => a.step - b.step)
    .filter((d) => d.action !== null || d.rejections.length > 0)
    .map((d) => ({
      step: d.step,
      action: d.action ?? { type: 'Wait', maxMs: 1, reason: 'no action was accepted for this step' },
      target: d.target,
      reason: d.reason,
      status: d.status,
      detail: d.detail,
      planMs: d.planMs,
      actMs: d.actMs,
      settleMs: d.settleMs,
      settled: d.settled,
      screenTokens: d.screenTokens,
      screenId: d.screenId,
      screenJson: d.screenJson,
      assert: d.assert,
      rejections: d.rejections,
      confirmation: d.confirmation,
    }));

  const planTimes = steps.map((s) => s.planMs).filter((n) => n > 0);
  const tokenCounts = steps.map((s) => s.screenTokens).filter((n) => n > 0);
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

  return {
    goal,
    verdict,
    reason,
    platform,
    plannerTier,
    plannerModel,
    onDevice,
    online,
    startedAt,
    durationMs,
    steps,
    passedAsserts,
    failedAsserts,
    rejectionCount: steps.reduce((n, s) => n + s.rejections.length, 0),
    stuckCount,
    meanPlanMs: mean(planTimes),
    meanScreenTokens: mean(tokenCounts),
    worstScreenTokens: tokenCounts.length === 0 ? 0 : Math.max(...tokenCounts),
  };
}
