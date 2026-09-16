/**
 * The loop: observe -> plan -> validate -> guard -> execute -> settle -> record.
 *
 * Platform-agnostic by construction. It holds a ScreenReader, an ActionExecutor
 * and a SettleStrategy — three interfaces — and has no idea whether they are
 * backed by a DOM, a content script, or an AccessibilityService. That is the
 * portability claim, and packages/agent/test proves it by running this entire
 * file against a profile with no browser anywhere in it.
 */

import type {
  ActionExecutor,
  ScreenReader,
  ScreenSnapshot,
  SettleStrategy,
  ValidatedAction,
} from '@origo/core';
import {
  evaluateExpectation,
  formatAction,
  nodeAt,
  validateModelOutput,
} from '@origo/core';
import type { Planner, StepSummary } from '@origo/planner';
import type { RunEvent, ScreenFacts } from './events.js';
import { AssertLedger, DEFAULT_LIMITS, RetryBudget, StuckDetector } from './guardrails.js';

export interface RunLimits {
  readonly maxSteps: number;
  readonly maxRetries: number;
  readonly settleTimeoutMs: number;
  readonly settlePollMs: number;
  /**
   * Wall-clock ceiling for the whole run.
   *
   * The step ceiling bounds how many actions happen; it does not bound TIME. A
   * planner that takes 40s a call (which we measured on an integrated GPU)
   * would sit at 25 steps for seventeen minutes with the UI looking alive and
   * a judge waiting. Nothing in this system is allowed to have no timeout.
   */
  readonly maxRunMs: number;
}

/**
 * Asked before a flagged action runs. The console shows a sheet and resolves
 * this; a headless caller can auto-deny. It is a promise so the loop genuinely
 * suspends rather than racing ahead.
 */
export type ConfirmationHandler = (request: {
  readonly action: ValidatedAction;
  readonly matched: string;
}) => Promise<boolean>;

export interface RunnerDeps {
  readonly reader: ScreenReader;
  readonly executor: ActionExecutor;
  readonly settle: SettleStrategy;
  readonly planner: Planner;
  /** Shown in the Started event and the report header. Comes from PlatformProfile. */
  readonly platform: string;
  /** Live network state at the moment the run starts. Never assumed. */
  readonly online: () => boolean;
  readonly limits?: Partial<RunLimits>;
  readonly destructivePatterns?: readonly string[];
  readonly onConfirm?: ConfirmationHandler;
  /** Injected so tests are deterministic and the report's clock is testable. */
  readonly now?: () => number;
}

function facts(snapshot: ScreenSnapshot): ScreenFacts {
  return {
    screenId: snapshot.state.screenId,
    nodeCount: snapshot.state.nodes.length,
    estimatedTokens: snapshot.estimatedTokens,
    hash: snapshot.hash,
    stats: snapshot.stats,
    promptJson: snapshot.promptJson,
  };
}

/**
 * Runs one goal to completion, yielding events as it goes.
 *
 * Never throws. Every failure path ends in a Failed or Finished event, because
 * a thrown error mid-run is a console that dies in front of a judge with no
 * explanation.
 */
export async function* run(goal: string, deps: RunnerDeps, signal: AbortSignal): AsyncGenerator<RunEvent> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const limits: RunLimits = {
    maxSteps: deps.limits?.maxSteps ?? DEFAULT_LIMITS.maxSteps,
    maxRetries: deps.limits?.maxRetries ?? DEFAULT_LIMITS.maxRetries,
    settleTimeoutMs: deps.limits?.settleTimeoutMs ?? DEFAULT_LIMITS.settleTimeoutMs,
    settlePollMs: deps.limits?.settlePollMs ?? DEFAULT_LIMITS.settlePollMs,
    maxRunMs: deps.limits?.maxRunMs ?? DEFAULT_LIMITS.maxRunMs,
  };

  const retries = new RetryBudget(limits.maxRetries);
  const stuck = new StuckDetector();
  const asserts = new AssertLedger();
  const history: StepSummary[] = [];

  let step = 0;
  let attempt = 1;
  let lastError: string | undefined;
  let reflection: string | undefined;
  /** False after an Assert: an observation is not an attempt to move the screen. */
  let lastActionMutated = true;

  yield { type: 'Started', goal, planner: deps.planner.info, platform: deps.platform, online: deps.online(), at: startedAt };

  const finished = (verdict: 'Pass' | 'Fail' | 'Blocked', reason: string): RunEvent => ({
    type: 'Finished',
    verdict,
    reason,
    steps: step,
    passedAsserts: asserts.passedCount,
    failedAsserts: asserts.failedCount,
    durationMs: now() - startedAt,
    at: now(),
  });

  const failed = (kind: 'model-output' | 'execution' | 'read', message: string): RunEvent => ({
    type: 'Failed',
    kind,
    message,
    step,
    durationMs: now() - startedAt,
    at: now(),
  });

  while (true) {
    if (signal.aborted) {
      yield finished('Blocked', 'stopped by the user');
      return;
    }

    if (step >= limits.maxSteps) {
      yield finished('Blocked', `reached the ${limits.maxSteps}-action ceiling without finishing`);
      return;
    }

    const elapsed = now() - startedAt;
    if (elapsed >= limits.maxRunMs) {
      yield finished(
        'Blocked',
        `ran for ${Math.round(elapsed / 1000)}s without finishing, past the ${Math.round(limits.maxRunMs / 1000)}s ceiling`,
      );
      return;
    }

    // ── observe ────────────────────────────────────────────────────────────
    const read = await deps.reader.read();
    if (!read.ok) {
      yield failed('read', read.error.message);
      return;
    }
    const snapshot = read.value;

    // ── stuck detection, before spending an inference on a screen we have
    //    already failed to move twice ─────────────────────────────────────
    const verdict = stuck.observe(snapshot.hash, lastActionMutated);
    if (verdict !== 'moving') {
      yield {
        type: 'Stuck',
        step: step + 1,
        hash: snapshot.hash,
        repeats: stuck.count,
        terminating: verdict === 'terminate',
        at: now(),
      };
      if (verdict === 'terminate') {
        yield finished('Blocked', `the screen did not change across ${stuck.count} reads; the goal cannot be advanced here`);
        return;
      }
      reflection = stuck.describe();
    }

    step += 1;
    yield { type: 'Planning', step, screen: facts(snapshot), attempt, at: now() };

    // ── plan ───────────────────────────────────────────────────────────────
    const planned = await deps.planner.next(
      {
        goal,
        screenJson: snapshot.promptJson,
        history,
        ...(lastError === undefined ? {} : { lastError }),
        ...(reflection === undefined ? {} : { reflection }),
      },
      signal,
    );

    if (signal.aborted) {
      yield finished('Blocked', 'stopped by the user');
      return;
    }
    if (!planned.ok) {
      // A planner that cannot answer is not the same as a model that answered
      // badly. This is infrastructure, so it ends the run rather than burning
      // retries on something retrying will not fix.
      yield failed('model-output', `${deps.planner.info.tier} planner failed: ${planned.error.message}`);
      return;
    }

    // ── validate: the one place model output is ever judged ────────────────
    const validated = validateModelOutput(planned.value.raw, {
      screen: snapshot.state,
      passedAsserts: asserts.passedCount,
      failedAsserts: asserts.failedCount,
      ...(deps.destructivePatterns === undefined ? {} : { destructivePatterns: deps.destructivePatterns }),
    });

    if (!validated.ok) {
      yield { type: 'ActionRejected', step, attempt, error: validated.error, raw: planned.value.raw, at: now() };
      history.push({ step, action: 'invalid output', outcome: 'rejected', note: validated.error.message });

      if (!retries.recordFailure()) {
        yield finished('Blocked', `the model produced ${retries.used} invalid actions in a row`);
        return;
      }
      // The rejection does not consume a step: the model has not acted yet.
      step -= 1;
      attempt += 1;
      lastError = validated.error.message;
      yield { type: 'Retrying', step: step + 1, attempt, because: validated.error.message, at: now() };
      continue;
    }

    retries.recordSuccess();
    attempt = 1;
    lastError = undefined;
    reflection = undefined;

    const { action, target, adjustments, requiresConfirmation, destructiveMatch } = validated.value;
    yield {
      type: 'ActionProposed',
      step,
      action,
      target,
      adjustments,
      latencyMs: planned.value.latencyMs,
      promptTokens: planned.value.promptTokens,
      raw: planned.value.raw,
      at: now(),
    };

    // ── the run's own ending ───────────────────────────────────────────────
    if (action.type === 'Finish') {
      // The verdict here is already the validator's, including the Pass->Fail
      // and Pass->Blocked corrections. The loop does not re-decide policy.
      yield finished(action.verdict, action.reason);
      return;
    }

    // ── guard: the destructive gate ────────────────────────────────────────
    if (requiresConfirmation && destructiveMatch) {
      yield { type: 'ConfirmationRequired', step, action, target, matched: destructiveMatch, at: now() };
      // Suspends here. With no handler the answer is no: an unattended agent
      // must not place an order because nobody was watching.
      const allowed = deps.onConfirm ? await deps.onConfirm({ action: validated.value, matched: destructiveMatch }) : false;
      yield { type: 'ConfirmationResolved', step, allowed, at: now() };

      if (!allowed) {
        history.push({ step, action: formatAction(action), outcome: 'rejected', note: 'denied by the user' });
        yield finished('Blocked', `"${destructiveMatch}" action was not allowed`);
        return;
      }
    }

    if (signal.aborted) {
      yield finished('Blocked', 'stopped by the user');
      return;
    }

    // ── execute ────────────────────────────────────────────────────────────
    const executed = await deps.executor.execute(action, snapshot.state, signal);
    if (!executed.ok) {
      // Distinct from a rejection: the action was well-formed and legal for the
      // screen, but the platform could not carry it out. The report says which,
      // because they are different bugs with different fixes.
      yield failed('execution', `${formatAction(action)} could not be performed: ${executed.error.message}`);
      return;
    }

    // ── settle ─────────────────────────────────────────────────────────────
    const settled = await deps.settle.settle(
      deps.reader,
      { timeoutMs: limits.settleTimeoutMs, pollIntervalMs: limits.settlePollMs },
      signal,
    );
    if (!settled.ok) {
      if (signal.aborted) {
        yield finished('Blocked', 'stopped by the user');
        return;
      }
      yield failed('read', settled.error.message);
      return;
    }

    yield {
      type: 'ActionExecuted',
      step,
      action,
      target,
      detail: executed.value.detail,
      durationMs: executed.value.durationMs,
      settledMs: settled.value.waitedMs,
      settled: settled.value.settled,
      at: now(),
    };

    // ── assert against the POST-action screen ──────────────────────────────
    lastActionMutated = action.type !== 'Assert';

    let note = action.reason;
    let outcome: StepSummary['outcome'] = 'ok';
    if (action.type === 'Assert') {
      const after = settled.value.snapshot.state;
      // The screen may have re-indexed under us; re-resolve by index and say so
      // honestly if the node is gone rather than passing by accident.
      const node = nodeAt(after, action.node);
      const result = node
        ? evaluateExpectation(action.expect, node)
        : {
            passed: false,
            kind: 'substring' as const,
            observed: '',
            expected: action.expect,
            detail: `node ${action.node} no longer exists on the screen after the action`,
          };
      asserts.record(result.passed);
      yield { type: 'AssertResult', step, outcome: result, at: now() };
      note = result.detail;
      outcome = result.passed ? 'assert-pass' : 'assert-fail';
    }

    history.push({ step, action: formatAction(action), outcome, note });
  }
}
