/**
 * THE SWITCH POINT.
 *
 * One object holds everything that differs between web, extension and Android.
 * Every consumer — the agent loop, the console, the report generator — reads
 * platform facts from here and NEVER from a direct adapter import. A lint rule
 * enforces that, because the difference between "we have an abstraction" and
 * "we have a habit" is whether the build fails when someone reaches past it.
 *
 * Adding Android later means adding one profile object and changing one
 * selection line. That is the whole claim, and profile.test.ts checks it by
 * running the agent against a profile that has no browser in it at all.
 */

import type { ActionExecutor, ScreenReader, SettleStrategy } from './ports.js';

export type PlatformId = 'web' | 'extension' | 'android' | 'fake';

/**
 * What this platform can actually do.
 *
 * Every flag exists because some consumer must behave differently, and every
 * one is answered honestly — a capability claimed but absent is worse than one
 * admitted missing, because the UI will offer the user something that fails.
 */
export interface PlatformCapabilities {
  /** Can evidence be captured? web: a DOM snapshot · android: takeScreenshot. */
  readonly screenshots: boolean;
  readonly voice: boolean;
  /** web: history.back() · android: performGlobalAction(GLOBAL_ACTION_BACK). */
  readonly backKey: boolean;
  /**
   * Android's IME is a separate accessibility window, so TypeText may need to
   * read a different window than the one being acted on. False everywhere else.
   */
  readonly multiWindow: boolean;
  /** Can the agent leave the current app? android: yes, by package name. */
  readonly appSwitching: boolean;
  /**
   * True where the same-origin policy limits what can be read. A deployed web
   * page cannot read a cross-origin iframe, which is precisely why the hosted
   * demo drives our own app and the extension drives sites we do not own.
   */
  readonly crossOriginLimited: boolean;
}

export interface PlatformLimits {
  readonly maxNodes: number;
  readonly maxSteps: number;
  readonly settleTimeoutMs: number;
}

export interface PlatformProfile {
  readonly id: PlatformId;
  /** Shown in the status strip. Always truthful, never aspirational. */
  readonly label: string;
  readonly reader: ScreenReader;
  readonly executor: ActionExecutor;
  readonly settleStrategy: SettleStrategy;
  readonly capabilities: PlatformCapabilities;
  readonly limits: PlatformLimits;
  /**
   * False for a profile whose adapters are stubs. The UI shows a clear
   * "not available on this platform" state instead of crashing into a
   * NOT_IMPLEMENTED — which is the entire point of being able to select it.
   */
  readonly implemented: boolean;
  /** One line explaining what this platform is, for the UI and the report. */
  readonly detail: string;
}

export const DEFAULT_LIMITS: PlatformLimits = {
  maxNodes: 40,
  maxSteps: 25,
  settleTimeoutMs: 2500,
};

/** Small helper so a profile reads as a declaration rather than a literal. */
export function defineProfile(profile: PlatformProfile): PlatformProfile {
  return profile;
}
