/**
 * Console state, derived from the RunEvent stream and NOTHING ELSE.
 *
 * No component reaches into the agent; the agent emits, this reduces, the UI
 * draws. The Android shell reuses this file verbatim — it is only a reducer over
 * events — which is why the discipline is worth keeping even when a shortcut
 * would be quicker.
 */

import { create } from 'zustand';
import type { RunEvent } from '@origo/agent';
import type { Action, PlatformProfile, UiNode } from '@origo/core';
import type { PlannerInfo, PlannerTier } from '@origo/planner';

/** One rendered line in the step log. Rejections and retries are rows too. */
export type LogRow =
  | { kind: 'step'; step: number; action: Action; target: UiNode | null; reason: string; status: 'running' | 'ok' | 'failed'; detail: string; durationMs: number; latencyMs: number; settled: boolean; assert?: { passed: boolean; detail: string } }
  | { kind: 'rejected'; step: number; attempt: number; stage: string; fault: string; message: string; raw: string }
  | { kind: 'stuck'; step: number; repeats: number; terminating: boolean }
  | { kind: 'confirm'; step: number; matched: string; allowed: boolean | null; action: Action };

export interface PendingConfirmation {
  readonly step: number;
  readonly action: Action;
  readonly target: UiNode | null;
  readonly matched: string;
  readonly resolve: (allowed: boolean) => void;
}

export interface Verdict {
  readonly verdict: 'Pass' | 'Fail' | 'Blocked';
  readonly reason: string;
  readonly steps: number;
  readonly passedAsserts: number;
  readonly failedAsserts: number;
  readonly durationMs: number;
}

export interface ConsoleState {
  readonly running: boolean;
  readonly goal: string;
  readonly rows: readonly LogRow[];
  readonly events: readonly RunEvent[];
  /** Node the agent is acting on right now. Drives the amber ring. */
  readonly highlight: UiNode | null;
  readonly thinking: { step: number; tokens: number; attempt: number } | null;
  readonly verdict: Verdict | null;
  readonly failure: { kind: string; message: string } | null;
  readonly pending: PendingConfirmation | null;
  /** Token count of the most recent screen read. Shown in the status strip. */
  readonly lastTokens: number | null;
  readonly planner: PlannerInfo | null;

  setGoal(goal: string): void;
  beginRun(goal: string): void;
  apply(event: RunEvent): void;
  askConfirmation(pending: PendingConfirmation): void;
  resolveConfirmation(allowed: boolean): void;
  clear(): void;
}

export const useConsole = create<ConsoleState>()((set, get) => ({
  running: false,
  goal: '',
  rows: [],
  events: [],
  highlight: null,
  thinking: null,
  verdict: null,
  failure: null,
  pending: null,
  lastTokens: null,
  planner: null,

  setGoal: (goal) => set({ goal }),

  beginRun: (goal) =>
    set({ running: true, goal, rows: [], events: [], verdict: null, failure: null, highlight: null, pending: null }),

  apply: (event) =>
    set((s) => {
      const events = [...s.events, event];
      const rows = [...s.rows];

      switch (event.type) {
        case 'Started':
          return { events, planner: event.planner };

        case 'Planning':
          return {
            events,
            lastTokens: event.screen.estimatedTokens,
            thinking: { step: event.step, tokens: event.screen.estimatedTokens, attempt: event.attempt },
          };

        case 'ActionProposed':
          rows.push({
            kind: 'step',
            step: event.step,
            action: event.action,
            target: event.target,
            reason: event.action.reason,
            status: 'running',
            detail: '',
            durationMs: 0,
            latencyMs: event.latencyMs,
            settled: true,
          });
          return { events, rows, thinking: null, highlight: event.target };

        case 'ActionExecuted': {
          const i = rows.findLastIndex((r) => r.kind === 'step' && r.step === event.step);
          const row = rows[i];
          if (row?.kind === 'step') {
            rows[i] = { ...row, status: 'ok', detail: event.detail, durationMs: event.durationMs, settled: event.settled };
          }
          return { events, rows, highlight: null };
        }

        case 'AssertResult': {
          const i = rows.findLastIndex((r) => r.kind === 'step' && r.step === event.step);
          const row = rows[i];
          if (row?.kind === 'step') {
            rows[i] = {
              ...row,
              status: event.outcome.passed ? 'ok' : 'failed',
              assert: { passed: event.outcome.passed, detail: event.outcome.detail },
            };
          }
          return { events, rows };
        }

        case 'ActionRejected':
          rows.push({
            kind: 'rejected',
            step: event.step,
            attempt: event.attempt,
            stage: event.error.stage,
            fault: event.error.fault,
            message: event.error.message,
            raw: event.raw,
          });
          return { events, rows, thinking: null };

        case 'Stuck':
          rows.push({ kind: 'stuck', step: event.step, repeats: event.repeats, terminating: event.terminating });
          return { events, rows };

        case 'ConfirmationRequired':
          rows.push({ kind: 'confirm', step: event.step, matched: event.matched, allowed: null, action: event.action });
          return { events, rows };

        case 'ConfirmationResolved': {
          const i = rows.findLastIndex((r) => r.kind === 'confirm' && r.step === event.step);
          const row = rows[i];
          if (row?.kind === 'confirm') rows[i] = { ...row, allowed: event.allowed };
          return { events, rows, pending: null };
        }

        case 'Finished':
          return {
            events,
            running: false,
            thinking: null,
            highlight: null,
            pending: null,
            verdict: {
              verdict: event.verdict,
              reason: event.reason,
              steps: event.steps,
              passedAsserts: event.passedAsserts,
              failedAsserts: event.failedAsserts,
              durationMs: event.durationMs,
            },
          };

        case 'Failed':
          return {
            events,
            running: false,
            thinking: null,
            highlight: null,
            pending: null,
            failure: { kind: event.kind, message: event.message },
          };

        case 'Retrying':
          return { events };
      }
    }),

  askConfirmation: (pending) => set({ pending }),

  resolveConfirmation: (allowed) => {
    const pending = get().pending;
    if (!pending) return;
    pending.resolve(allowed);
    set({ pending: null });
  },

  clear: () => set({ rows: [], events: [], verdict: null, failure: null, highlight: null, lastTokens: null }),
}));

/** Facts the status strip renders. Every field is read live; none is cached. */
export interface StatusFacts {
  readonly platform: string;
  readonly platformOk: boolean;
  readonly tier: PlannerTier | null;
  readonly model: string;
  readonly onDevice: boolean;
  readonly online: boolean;
  readonly tokens: number | null;
}

export function statusFacts(profile: PlatformProfile, planner: PlannerInfo | null, online: boolean, tokens: number | null): StatusFacts {
  return {
    platform: profile.label,
    platformOk: profile.implemented,
    tier: planner?.tier ?? null,
    model: planner?.model ?? 'none',
    onDevice: planner?.onDevice ?? false,
    online,
    tokens,
  };
}
