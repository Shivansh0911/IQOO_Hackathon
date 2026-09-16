import type { PruneCandidate } from '../src/prune.js';
import type { Bounds, Role, ScreenState, UiNode } from '../src/screen-state.js';

export function bounds(x = 0, y = 0, w = 100, h = 40): Bounds {
  return { x, y, w, h };
}

export function node(partial: Partial<UiNode> & { index: number }): UiNode {
  return {
    role: 'text' as Role,
    text: '',
    desc: '',
    bounds: bounds(),
    clickable: false,
    editable: false,
    scrollable: false,
    checked: null,
    enabled: true,
    depth: 1,
    ...partial,
  };
}

export function screen(nodes: UiNode[], scrollable: number[] = []): ScreenState {
  return { appId: 'tiffin', screenId: 'test', timestampMs: 1_700_000_000_000, nodes, scrollable };
}

export function candidate(partial: Partial<PruneCandidate> & { id: number }): PruneCandidate {
  return {
    parent: null,
    role: 'text' as Role,
    text: '',
    desc: '',
    bounds: bounds(),
    clickable: false,
    editable: false,
    scrollable: false,
    checked: null,
    enabled: true,
    depth: 1,
    visible: true,
    onScreen: true,
    ...partial,
  };
}
