/**
 * Wait for the UI to stop changing.
 *
 * NEVER a fixed sleep. A fixed sleep is either too slow in a demo or too fast on
 * a loaded phone, and in practice it is both on the same run. We poll the screen
 * hash and stop as soon as two consecutive reads agree — which on a fast screen
 * is one poll, and on a slow one takes exactly as long as it needs to.
 *
 * The Android implementation is the same loop over accessibility snapshots.
 */

import type { ReadError, Result, ScreenReader, SettleOptions, SettleOutcome, SettleStrategy } from '@origo/core';
import { err, ok } from '@origo/core';

export const DEFAULT_SETTLE: SettleOptions = { timeoutMs: 2500, pollIntervalMs: 120 };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class HashSettleStrategy implements SettleStrategy {
  async settle(
    reader: ScreenReader,
    options: SettleOptions,
    signal: AbortSignal,
  ): Promise<Result<SettleOutcome, ReadError>> {
    const started = Date.now();
    let polls = 0;
    let previousHash: string | null = null;

    for (;;) {
      const read = await reader.read();
      if (!read.ok) return read;
      polls += 1;

      const elapsed = Date.now() - started;
      if (previousHash !== null && read.value.hash === previousHash) {
        return ok({ snapshot: read.value, settled: true, waitedMs: elapsed, polls });
      }
      if (signal.aborted) {
        return err({ kind: 'read-failed', message: 'Cancelled while waiting for the screen to settle.' });
      }
      if (elapsed >= options.timeoutMs) {
        // Not settled. Reported honestly rather than pretended: a screen that is
        // still animating is a real condition the report should show.
        return ok({ snapshot: read.value, settled: false, waitedMs: elapsed, polls });
      }

      previousHash = read.value.hash;
      await sleep(options.pollIntervalMs, signal);
    }
  }
}
