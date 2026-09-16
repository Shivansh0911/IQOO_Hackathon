/**
 * THE BOUNDARY.
 *
 * Everything above this line is portable; everything that implements these
 * interfaces is platform-specific. The web adapter implements them against the
 * DOM today; the Android adapter implements them against AccessibilityNodeInfo
 * on site. Nothing in packages/** may ever import an implementation — only these
 * interfaces. That is the difference between a port and a rewrite.
 */

import type { Action } from './action.js';
import type { Result } from './result.js';
import type { PruneStats } from './prune.js';
import type { ScreenState } from './screen-state.js';

export interface ReadError {
  readonly kind: 'no-root' | 'platform-unavailable' | 'read-failed';
  readonly message: string;
}

export interface ScreenSnapshot {
  readonly state: ScreenState;
  readonly stats: PruneStats;
  /** Compact JSON exactly as the model will see it. */
  readonly promptJson: string;
  readonly estimatedTokens: number;
  readonly hash: string;
}

/** Reads the current UI as a pruned, indexed ScreenState. */
export interface ScreenReader {
  read(): Promise<Result<ScreenSnapshot, ReadError>>;
}

export interface ExecError {
  readonly kind: 'target-gone' | 'not-actionable' | 'unsupported' | 'platform-error';
  readonly message: string;
}

export interface ExecOutcome {
  /** What the executor actually did, for the report. */
  readonly detail: string;
  readonly durationMs: number;
}

/**
 * Performs one validated action. Receives the ScreenState the action was
 * validated against, so it can resolve the index back to a real element and
 * refuse if the screen moved underneath it.
 */
export interface ActionExecutor {
  execute(action: Action, screen: ScreenState, signal: AbortSignal): Promise<Result<ExecOutcome, ExecError>>;
}

export interface SettleOptions {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

export interface SettleOutcome {
  readonly snapshot: ScreenSnapshot;
  /** True when two consecutive snapshots hashed identically before the timeout. */
  readonly settled: boolean;
  readonly waitedMs: number;
  readonly polls: number;
}

/**
 * Waits for the UI to stop changing. NEVER a fixed sleep — a fixed sleep is
 * either too slow in the demo or too fast on a loaded phone, and usually both.
 */
export interface SettleStrategy {
  settle(reader: ScreenReader, options: SettleOptions, signal: AbortSignal): Promise<Result<SettleOutcome, ReadError>>;
}
