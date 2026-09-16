/**
 * The extension profile.
 *
 * Its one meaningful difference from the web profile is `crossOriginLimited:
 * false` — a content script reads the page it is injected into, whatever origin
 * that is. That single flag is why this profile exists: it is the answer to
 * "would this work on something you didn't build?"
 */

import type { PlatformProfile, SettleStrategy } from '@origo/core';
import { defineProfile } from '@origo/core';
import { ExtensionActionExecutor, ExtensionScreenReader } from './proxy.js';
import type { SendToPage } from './proxy.js';

export interface ExtensionProfileOptions {
  readonly send: SendToPage;
  readonly settleStrategy: SettleStrategy;
  /** The hostname being driven, shown in the status strip. */
  readonly label?: string;
}

export function createExtensionProfile(options: ExtensionProfileOptions): PlatformProfile {
  return defineProfile({
    id: 'extension',
    label: options.label ?? 'extension',
    reader: new ExtensionScreenReader(options.send),
    executor: new ExtensionActionExecutor(options.send),
    settleStrategy: options.settleStrategy,
    capabilities: {
      screenshots: true,
      voice: true,
      backKey: true,
      multiWindow: false,
      appSwitching: false,
      // The whole reason this profile exists.
      crossOriginLimited: false,
    },
    limits: {
      maxNodes: 40,
      // Real sites are denser and slower than Tiffin; a lower ceiling keeps a
      // wandering run from spending a minute on someone else's website.
      maxSteps: 20,
      settleTimeoutMs: 4000,
    },
    implemented: true,
    detail: 'Reads and acts on the page in the active tab, whatever site it is.',
  });
}
