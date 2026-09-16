/**
 * Pruning — where the intelligence actually lives, more than in the prompt.
 *
 * A real screen has hundreds of nodes. The model must see at most 40, they must
 * be the *useful* 40, and the target the user asked for must never be one of the
 * ones we deleted.
 *
 * This file is PORTABLE ON PURPOSE. The policy — the drop order, the echo rule,
 * the ranking, the cap, the reindex — is identical on web and Android. Each
 * adapter only computes the per-node flags on a PruneCandidate (is it visible?
 * what is its area? is it clickable?). That split is why the pruning rule we
 * tune against Tiffin is the same rule that runs on the phone.
 */

import type { Bounds, Role, UiNode } from './screen-state.js';
import { MAX_NODES, truncate } from './screen-state.js';

/**
 * Drop reasons, in the order they are evaluated. First match wins, and the
 * reason is recorded so the histogram can tell us which rule is doing the work
 * — and which one is eating something it should not.
 */
export const DROP_REASONS = [
  'invisible',
  'zero-area',
  'offscreen',
  'disabled',
  'no-signal',
  'text-container',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** A node as the adapter found it, before any policy is applied. */
export interface PruneCandidate {
  /** Stable pre-prune id, dense from 0, in document/traversal order. */
  readonly id: number;
  readonly parent: number | null;
  readonly role: Role;
  readonly text: string;
  readonly desc: string;
  readonly bounds: Bounds;
  readonly clickable: boolean;
  readonly editable: boolean;
  readonly scrollable: boolean;
  readonly checked: boolean | null;
  readonly enabled: boolean;
  readonly depth: number;
  /** Rendered at all: not display:none, visibility:hidden, opacity:0, aria-hidden. */
  readonly visible: boolean;
  /** Intersects the viewport. */
  readonly onScreen: boolean;
}

export interface PruneStats {
  readonly before: number;
  readonly after: number;
  readonly dropped: Readonly<Record<DropReason, number>>;
  /** Survived every rule but lost the area ranking against the node cap. */
  readonly overCap: number;
}

export type NodeFate = DropReason | 'over-cap' | 'kept';

export interface PruneResult {
  readonly nodes: UiNode[];
  /** Kept node index -> the candidate id it came from, so the adapter can find the element again. */
  readonly indexToCandidateId: number[];
  readonly stats: PruneStats;
  /** Per-candidate fate, for the debug panel. */
  readonly fates: ReadonlyMap<number, NodeFate>;
}

function interactive(c: PruneCandidate): boolean {
  return c.clickable || c.editable || c.scrollable;
}

function area(b: Bounds): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

/** Normalised text used for every echo comparison. Case- and space-insensitive. */
function norm(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Does this string still carry meaning once the child text is removed from it? */
function hasResidualMeaning(parentText: string, childTexts: readonly string[]): boolean {
  let residual = norm(parentText);
  // Longest first, so "Paradise Biryani" is removed before "Biryani".
  for (const child of [...childTexts].sort((a, b) => b.length - a.length)) {
    const n = norm(child);
    if (!n) continue;
    residual = residual.split(n).join(' ');
  }
  return /[\p{L}\p{N}]/u.test(residual);
}

/**
 * Applies the six drop rules in order, ranks the survivors by on-screen area,
 * caps at `maxNodes`, and reindexes from 0.
 *
 * Selection is by area (big things are the things a user acts on); PRESENTATION
 * is restored to traversal order before indexing, because a model reads a screen
 * far better top-to-bottom than largest-to-smallest.
 */
export function pruneAndRank(
  candidates: readonly PruneCandidate[],
  options: { readonly maxNodes?: number } = {},
): PruneResult {
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const byId = new Map<number, PruneCandidate>(candidates.map((c) => [c.id, c]));
  const fates = new Map<number, NodeFate>();
  const dropped: Record<DropReason, number> = {
    invisible: 0,
    'zero-area': 0,
    offscreen: 0,
    disabled: 0,
    'no-signal': 0,
    'text-container': 0,
  };

  const drop = (c: PruneCandidate, reason: DropReason): void => {
    fates.set(c.id, reason);
    dropped[reason] += 1;
  };

  // Pass 1: the five context-free rules, first match wins.
  const round1: PruneCandidate[] = [];
  for (const c of candidates) {
    if (!c.visible) {
      drop(c, 'invisible');
    } else if (area(c.bounds) <= 0) {
      drop(c, 'zero-area');
    } else if (!c.onScreen) {
      drop(c, 'offscreen');
    } else if (!c.enabled) {
      // A disabled control is not an option, and offering it to the model only
      // invites an action the executor would have to reject.
      drop(c, 'disabled');
    } else if (!interactive(c) && !norm(c.text) && !norm(c.desc)) {
      drop(c, 'no-signal');
    } else {
      round1.push(c);
    }
  }

  // Pass 2: text-container.
  //
  // A non-interactive node whose text is already represented in the kept set.
  // Echo runs in BOTH directions, because both happen in real markup:
  //
  //   downward - a wrapper div whose text is just its children concatenated
  //   upward   - a span inside a CLICKABLE card, whose text the card already carries
  //
  // An interactive node is NEVER dropped here. That is the guarantee that a
  // clickable card holding its text in child elements survives: it is usually
  // the only tappable target on the screen, and losing it silently kills a run.
  const survivorIds = new Set(round1.map((c) => c.id));
  const childrenOf = new Map<number, PruneCandidate[]>();
  for (const c of candidates) {
    if (c.parent === null) continue;
    const list = childrenOf.get(c.parent) ?? [];
    list.push(c);
    childrenOf.set(c.parent, list);
  }

  const descendantTexts = (id: number, acc: string[] = []): string[] => {
    for (const child of childrenOf.get(id) ?? []) {
      if (survivorIds.has(child.id) && norm(child.text)) acc.push(child.text);
      descendantTexts(child.id, acc);
    }
    return acc;
  };

  const clickableAncestorText = (c: PruneCandidate): string | null => {
    let cursor = c.parent === null ? null : byId.get(c.parent);
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor.clickable && survivorIds.has(cursor.id)) return cursor.text;
      cursor = cursor.parent === null ? null : byId.get(cursor.parent);
      guard += 1;
    }
    return null;
  };

  const kept: PruneCandidate[] = [];
  for (const c of round1) {
    if (interactive(c)) {
      kept.push(c);
      continue;
    }
    const text = norm(c.text);
    if (!text) {
      kept.push(c);
      continue;
    }

    const childText = descendantTexts(c.id);
    if (childText.length > 0 && !hasResidualMeaning(c.text, childText)) {
      drop(c, 'text-container');
      continue;
    }

    const ancestorText = clickableAncestorText(c);
    if (ancestorText && norm(ancestorText).includes(text)) {
      drop(c, 'text-container');
      continue;
    }

    kept.push(c);
  }

  // Pass 3: rank by area, cap, restore traversal order, reindex from 0.
  const ranked = [...kept].sort((a, b) => area(b.bounds) - area(a.bounds));
  const winners = ranked.slice(0, maxNodes);
  for (const loser of ranked.slice(maxNodes)) fates.set(loser.id, 'over-cap');

  const ordered = [...winners].sort((a, b) => a.id - b.id);
  const nodes: UiNode[] = [];
  const indexToCandidateId: number[] = [];
  ordered.forEach((c, index) => {
    fates.set(c.id, 'kept');
    indexToCandidateId.push(c.id);
    nodes.push({
      index,
      role: c.role,
      text: truncate(c.text),
      desc: truncate(c.desc),
      bounds: c.bounds,
      clickable: c.clickable,
      editable: c.editable,
      scrollable: c.scrollable,
      checked: c.checked,
      enabled: c.enabled,
      depth: c.depth,
    });
  });

  return {
    nodes,
    indexToCandidateId,
    stats: {
      before: candidates.length,
      after: nodes.length,
      dropped,
      overCap: Math.max(0, ranked.length - winners.length),
    },
    fates,
  };
}

/** One-line histogram for logs and the debug panel. */
export function formatPruneStats(stats: PruneStats): string {
  const parts = DROP_REASONS.filter((r) => stats.dropped[r] > 0).map((r) => `${r}:${stats.dropped[r]}`);
  if (stats.overCap > 0) parts.push(`over-cap:${stats.overCap}`);
  const pct = stats.before === 0 ? 0 : Math.round((stats.after / stats.before) * 100);
  return `${stats.before}->${stats.after} (${pct}% kept) ${parts.join(' ')}`.trim();
}
