/**
 * The Android profile — complete, type-checking and SELECTABLE today.
 *
 * Every method is NOT IMPLEMENTED and says so as a Result, never a throw. That
 * is deliberate and it is the point of the exercise: switching the demo to this
 * profile must produce a clear "not available on this platform" state and
 * nothing else. If anything besides the reader and executor breaks when you
 * flip to it, the abstraction is leaking and we fix it now rather than at hour
 * three on site.
 *
 * On site these three classes get real bodies and NOTHING ABOVE THEM CHANGES.
 * docs/PORTING.md maps each method to the Android API that will implement it.
 */

import type {
  Action,
  ActionExecutor,
  ExecError,
  ExecOutcome,
  PlatformProfile,
  ReadError,
  Result,
  ScreenReader,
  ScreenSnapshot,
  ScreenState,
  SettleOptions,
  SettleOutcome,
  SettleStrategy,
} from '@origo/core';
import { defineProfile, err } from '@origo/core';

const NOT_IMPLEMENTED =
  'The Android profile is not implemented in a browser. It runs on the phone, against the accessibility tree.';

/**
 * Will traverse AccessibilityNodeInfo from getWindows() — plural, not just
 * rootInActiveWindow, because the IME is its own window and a dialog is another.
 */
export class AccessibilityScreenReader implements ScreenReader {
  read(): Promise<Result<ScreenSnapshot, ReadError>> {
    return Promise.resolve(err({ kind: 'platform-unavailable', message: NOT_IMPLEMENTED }));
  }
}

/**
 * Will perform ACTION_CLICK (walking up to the nearest clickable ancestor, with
 * a gesture tap at the bounds centre as the fallback), ACTION_SET_TEXT,
 * ACTION_SCROLL_FORWARD/BACKWARD and performGlobalAction(GLOBAL_ACTION_BACK).
 */
export class AccessibilityActionExecutor implements ActionExecutor {
  execute(_action: Action, _screen: ScreenState, _signal: AbortSignal): Promise<Result<ExecOutcome, ExecError>> {
    return Promise.resolve(err({ kind: 'unsupported', message: NOT_IMPLEMENTED }));
  }
}

/**
 * Will poll accessibility snapshots and compare hashes — the same loop as the
 * web, because the strategy is portable and only the source of the snapshot is not.
 */
export class AccessibilitySettleStrategy implements SettleStrategy {
  settle(_reader: ScreenReader, _options: SettleOptions, _signal: AbortSignal): Promise<Result<SettleOutcome, ReadError>> {
    return Promise.resolve(err({ kind: 'platform-unavailable', message: NOT_IMPLEMENTED }));
  }
}

export const androidProfile: PlatformProfile = defineProfile({
  id: 'android',
  label: 'android',
  reader: new AccessibilityScreenReader(),
  executor: new AccessibilityActionExecutor(),
  settleStrategy: new AccessibilitySettleStrategy(),
  capabilities: {
    // AccessibilityService.takeScreenshot, API 30+, MediaProjection fallback.
    screenshots: true,
    // SpeechRecognizer with EXTRA_PREFER_OFFLINE.
    voice: true,
    backKey: true,
    // The IME is a separate accessibility window. This flag exists for that.
    multiWindow: true,
    // The agent can launch other apps by package name.
    appSwitching: true,
    // No same-origin policy on a phone: the agent reads any app it is granted.
    crossOriginLimited: false,
  },
  limits: {
    // Real apps are far denser than Tiffin's clean React. Expect to retune this
    // in the first two hours on site against a real app's node counts, which is
    // why the drop-reason histogram logging stays in.
    maxNodes: 40,
    maxSteps: 25,
    // A loaded phone settles more slowly than a laptop.
    settleTimeoutMs: 4000,
  },
  implemented: false,
  detail: 'Runs on the phone against the Android accessibility tree. Not implemented in a browser.',
});
