/**
 * A platform with no browser in it.
 *
 * A reader that returns scripted ScreenStates and an executor that records
 * calls. If the whole agent — loop, validator, guardrails — works against this,
 * then nothing above the adapter boundary secretly depends on a DOM, and the
 * Android port is a proven property rather than a promise.
 *
 * It is also the regression guard: the day someone sneaks a `document` into
 * core, these tests fail here rather than at hour three on site.
 */

import type {
  Action,
  ActionExecutor,
  ExecError,
  ExecOutcome,
  ReadError,
  Result,
  ScreenReader,
  ScreenSnapshot,
  ScreenState,
  SettleOptions,
  SettleOutcome,
  SettleStrategy,
  PlatformProfile,
  UiNode,
} from '@origo/core';
import { defineProfile, err, estimateTokens, hashScreenState, ok, toPromptJson } from '@origo/core';

export function node(partial: Partial<UiNode> & { index: number }): UiNode {
  return {
    role: 'text',
    text: '',
    desc: '',
    bounds: { x: 0, y: partial.index * 40, w: 300, h: 40 },
    clickable: false,
    editable: false,
    scrollable: false,
    checked: null,
    enabled: true,
    depth: 2,
    ...partial,
  };
}

export function screen(screenId: string, nodes: UiNode[]): ScreenState {
  return {
    appId: 'fake',
    screenId,
    timestampMs: 1_700_000_000_000,
    nodes,
    scrollable: nodes.filter((n) => n.scrollable).map((n) => n.index),
  };
}

function snapshotOf(state: ScreenState): ScreenSnapshot {
  const promptJson = toPromptJson(state);
  return {
    state,
    stats: {
      before: state.nodes.length,
      after: state.nodes.length,
      dropped: { invisible: 0, 'zero-area': 0, offscreen: 0, disabled: 0, 'no-signal': 0, 'text-container': 0 },
      overCap: 0,
    },
    promptJson,
    estimatedTokens: estimateTokens(promptJson),
    hash: hashScreenState(state),
  };
}

/**
 * Returns screens from a script. The LAST screen repeats forever, which is what
 * makes stuck detection testable: keep acting and the screen stops changing.
 */
export class FakeReader implements ScreenReader {
  private cursor = 0;
  public reads = 0;
  public failNext: ReadError | null = null;

  /**
   * @param cycling when true the script wraps instead of sticking on the last
   *   screen — an app that keeps moving forever, which is what the step-ceiling
   *   test needs. Without it, stuck detection correctly fires first and the
   *   ceiling is never reached.
   */
  constructor(
    private readonly screens: readonly ScreenState[],
    private readonly cycling = false,
  ) {}

  /** Advances to the next scripted screen. The executor calls this on success. */
  advance(): void {
    if (this.cycling) this.cursor = (this.cursor + 1) % this.screens.length;
    else if (this.cursor < this.screens.length - 1) this.cursor += 1;
  }

  get current(): ScreenState {
    return this.screens[this.cursor] ?? (this.screens[this.screens.length - 1] as ScreenState);
  }

  read(): Promise<Result<ScreenSnapshot, ReadError>> {
    this.reads += 1;
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.resolve(err(error));
    }
    return Promise.resolve(ok(snapshotOf(this.current)));
  }
}

export interface RecordedCall {
  readonly action: Action;
  readonly screenId: string;
}

export class FakeExecutor implements ActionExecutor {
  public readonly calls: RecordedCall[] = [];
  public failWith: ExecError | null = null;

  constructor(
    private readonly reader: FakeReader,
    /** When false, the screen does not change after an action — the stuck path. */
    private readonly advancesScreen = true,
  ) {}

  execute(action: Action, screenState: ScreenState, signal: AbortSignal): Promise<Result<ExecOutcome, ExecError>> {
    if (signal.aborted) {
      return Promise.resolve(err({ kind: 'platform-error', message: 'Cancelled.' }));
    }
    this.calls.push({ action, screenId: screenState.screenId });
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      return Promise.resolve(err(error));
    }
    if (this.advancesScreen && action.type !== 'Assert' && action.type !== 'Wait') {
      this.reader.advance();
    }
    return Promise.resolve(ok({ detail: `fake ${action.type}`, durationMs: 1 }));
  }
}

/** Settles immediately. Settle timing is the adapter's business, not the loop's. */
export class InstantSettle implements SettleStrategy {
  async settle(reader: ScreenReader, _options: SettleOptions, _signal: AbortSignal): Promise<Result<SettleOutcome, ReadError>> {
    const read = await reader.read();
    if (!read.ok) return read;
    return ok({ snapshot: read.value, settled: true, waitedMs: 0, polls: 1 });
  }
}

/**
 * A PlatformProfile with no browser in it.
 *
 * This is the object the "the port is proven" test drives the whole agent
 * through. If the loop, the validator and the guardrails all work against a
 * profile whose reader and executor touch no platform API, then the seam is
 * real and adding Android is adding one object.
 */
export function fakeProfile(screens: readonly ScreenState[], cycling = false): PlatformProfile {
  const reader = new FakeReader(screens, cycling);
  return defineProfile({
    id: 'fake',
    label: 'fake',
    reader,
    executor: new FakeExecutor(reader),
    settleStrategy: new InstantSettle(),
    capabilities: {
      screenshots: false,
      voice: false,
      backKey: false,
      multiWindow: false,
      appSwitching: false,
      crossOriginLimited: false,
    },
    limits: { maxNodes: 40, maxSteps: 25, settleTimeoutMs: 2500 },
    implemented: true,
    detail: 'A scripted platform used to prove the agent needs no browser.',
  });
}
