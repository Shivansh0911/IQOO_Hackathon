/**
 * Measurement entry point.
 *
 * Bundled by scripts/measure-screens.mjs and injected into a real page running
 * real Tiffin, so the numbers in our deck come from real markup with real layout
 * rather than from a jsdom stub where every rectangle is zero.
 */

import { DomScreenReader } from '@origo/adapter-web';
import type { NodeFate } from '@origo/core';

export interface MeasuredScreen {
  readonly screenId: string;
  readonly before: number;
  readonly after: number;
  readonly dropped: Record<string, number>;
  readonly overCap: number;
  readonly promptJson: string;
  readonly estimatedTokens: number;
  readonly hash: string;
  readonly kept: readonly { index: number; role: string; flags: string; text: string }[];
  readonly clickableKept: number;
}

declare global {
  var __origoMeasure: ((screenId: string) => MeasuredScreen | { error: string }) | undefined;
}

globalThis.__origoMeasure = (screenId: string) => {
  const reader = new DomScreenReader({
    appId: 'tiffin',
    root: () => globalThis.document.querySelector('.tiffin'),
    screenId: () => screenId,
  });

  const result = reader.readDetailed();
  if (!result.ok) return { error: result.error.message };

  const { snapshot, fates } = result.value;
  const dropped: Record<string, number> = { ...snapshot.stats.dropped };
  let overCap = 0;
  for (const fate of fates.values() as Iterable<NodeFate>) {
    if (fate === 'over-cap') overCap += 1;
  }

  return {
    screenId,
    before: snapshot.stats.before,
    after: snapshot.stats.after,
    dropped,
    overCap,
    promptJson: snapshot.promptJson,
    estimatedTokens: snapshot.estimatedTokens,
    hash: snapshot.hash,
    clickableKept: snapshot.state.nodes.filter((n) => n.clickable).length,
    kept: snapshot.state.nodes.map((n) => ({
      index: n.index,
      role: n.role,
      flags: [n.clickable ? 'clk' : '', n.editable ? 'ed' : '', n.scrollable ? 'scr' : ''].filter(Boolean).join(','),
      text: n.text || n.desc,
    })),
  };
};
