/**
 * Gate 2 harness.
 *
 * Mounts real Tiffin and exposes the on-device planner to Playwright, so the
 * numbers in our report come from a real 1B model reasoning over real screens
 * rather than from an argument about what a 1B model ought to manage.
 *
 * Measures exactly what the gate asks for: cold-start load, per-step planning
 * latency, and the invalid-output rate BROKEN DOWN BY SCREEN — because the
 * 580-token restaurant screen was flagged as the drift risk and a single
 * averaged number would hide it.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TiffinApp, useTiffin } from '@tiffin/app';
import '@tiffin/app/styles.css';
import { DomScreenReader } from '@origo/adapter-web';
import { LocalPlanner, detectWebGpu } from '@origo/adapter-webllm';
import { validateModelOutput } from '@origo/core';
import type { ScreenState } from '@origo/core';

export interface PlanAttempt {
  readonly screenId: string;
  readonly goal: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly screenTokens: number;
  readonly raw: string;
  /** Present when the validator rejected it, so failures can be categorised. */
  readonly stage?: string;
  readonly fault?: string;
  readonly message?: string;
  readonly actionType?: string;
}

declare global {
  var __gate2: {
    probe(): Promise<{ available: boolean; reason: string }>;
    load(): Promise<{ ok: boolean; ms: number; message: string }>;
    read(screenId: string): { tokens: number; json: string; nodes: number } | { error: string };
    plan(goal: string, screenId: string): Promise<PlanAttempt>;
    /** Raw generation against a caller-supplied prompt, to isolate prefill cost. */
    raw(system: string, user: string): Promise<{ ms: number; chars: number; text: string }>;
    progress(): { progress: number; text: string } | null;
    reset(): void;
  } | undefined;
}

let progress: { progress: number; text: string } | null = null;
const planner = new LocalPlanner({ onProgress: (p) => { progress = p; } });

const reader = new DomScreenReader({
  appId: 'tiffin',
  root: () => document.querySelector('.tiffin'),
  screenId: () => useTiffin.getState().route.name,
});

globalThis.__gate2 = {
  probe: () => detectWebGpu(),

  load: async () => {
    const started = Date.now();
    const result = await planner.preload();
    return {
      ok: result.ok,
      ms: Date.now() - started,
      message: result.ok ? 'loaded' : result.error.message,
    };
  },

  read: (_screenId) => {
    const result = reader.readSync();
    if (!result.ok) return { error: result.error.message };
    return { tokens: result.value.estimatedTokens, json: result.value.promptJson, nodes: result.value.state.nodes.length };
  },

  plan: async (goal, screenId) => {
    const read = reader.readSync();
    if (!read.ok) {
      return { screenId, goal, ok: false, latencyMs: 0, promptTokens: 0, screenTokens: 0, raw: '', message: read.error.message };
    }
    const state: ScreenState = { ...read.value.state, screenId };

    const controller = new AbortController();
    const planned = await planner.next(
      { goal, screenJson: read.value.promptJson, history: [] },
      controller.signal,
    );

    if (!planned.ok) {
      return {
        screenId,
        goal,
        ok: false,
        latencyMs: 0,
        promptTokens: 0,
        screenTokens: read.value.estimatedTokens,
        raw: '',
        stage: 'planner',
        fault: planned.error.kind,
        message: planned.error.message,
      };
    }

    // The REAL validator, not a lenient test double. This is the number that
    // matters: how often does a 1B model produce something we would execute?
    const validated = validateModelOutput(planned.value.raw, { screen: state, passedAsserts: 0 });

    return {
      screenId,
      goal,
      ok: validated.ok,
      latencyMs: planned.value.latencyMs,
      promptTokens: planned.value.promptTokens,
      screenTokens: read.value.estimatedTokens,
      raw: planned.value.raw.slice(0, 300),
      ...(validated.ok
        ? { actionType: validated.value.action.type }
        : { stage: validated.error.stage, fault: validated.error.fault, message: validated.error.message }),
    };
  },

  /**
   * Times one generation with an arbitrary prompt.
   *
   * Exists to test one hypothesis: if planning latency is dominated by PREFILL
   * rather than decode, then the 873-token system prompt — not the ~400-token
   * screen — is the thing to optimise, and that is a very different engineering
   * conclusion from "a 1B model is too slow".
   */
  raw: async (system, user) => {
    const started = Date.now();
    const engineResult = await planner.rawComplete(system, user);
    return { ms: Date.now() - started, chars: engineResult.length, text: engineResult.slice(0, 160) };
  },

  progress: () => progress,
  reset: () => useTiffin.getState().reset(),
};

const host = document.getElementById('root');
if (!host) throw new Error('gate2: #root missing');
createRoot(host).render(
  <StrictMode>
    <TiffinApp />
  </StrictMode>,
);
