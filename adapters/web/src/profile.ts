/**
 * The web profile: the hosted demo driving Tiffin in the same page.
 *
 * Its defining limitation is honest and load-bearing: `crossOriginLimited` is
 * true. A deployed page cannot read the DOM of a cross-origin iframe, and real
 * sites send X-Frame-Options anyway, so a shareable link physically cannot drive
 * third-party websites. That is why the hosted demo drives an app we built, and
 * why the extension profile exists to drive ones we did not.
 */

import type { PlatformProfile } from '@origo/core';
import { defineProfile } from '@origo/core';
import { DomScreenReader } from './dom-reader.js';
import type { DomReaderOptions } from './dom-reader.js';
import { DomActionExecutor } from './dom-executor.js';
import { HashSettleStrategy } from './settle.js';

export interface WebProfileOptions extends DomReaderOptions {
  readonly label?: string;
}

export function createWebProfile(options: WebProfileOptions): PlatformProfile {
  const reader = new DomScreenReader(options);
  return defineProfile({
    id: 'web',
    label: options.label ?? 'web',
    reader,
    executor: new DomActionExecutor({ reader, root: options.root }),
    settleStrategy: new HashSettleStrategy(),
    capabilities: {
      screenshots: true,
      voice: true,
      backKey: true,
      multiWindow: false,
      appSwitching: false,
      crossOriginLimited: true,
    },
    limits: { maxNodes: options.maxNodes ?? 40, maxSteps: 25, settleTimeoutMs: 2500 },
    implemented: true,
    detail: 'Reads the DOM of the app in this page. Cannot read cross-origin frames.',
  });
}
