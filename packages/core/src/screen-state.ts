/**
 * The serialisation contract.
 *
 * UiNode and ScreenState are shaped so that a DOM traversal and an
 * AccessibilityNodeInfo traversal produce *the same thing*. That is the whole
 * thesis: the planner prompt, the validator and the agent loop never learn
 * which platform they are on.
 *
 * The role vocabulary lives here (portable); the mapping from tag/className to
 * a role lives in each adapter (platform-specific).
 */

/**
 * Compact, normalised role vocabulary. Deliberately tiny — every extra role is
 * another token per node and another thing a 1B model can confuse.
 *
 * web:     tag name + ARIA role  → Role
 * android: className             → Role
 */
export const ROLES = ['btn', 'edit', 'text', 'img', 'list', 'switch', 'tab', 'other'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** On-screen rectangle in device-independent pixels, origin top-left. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One interactive or informative element.
 *
 * `index` is the model's ONLY way to address this node (CLAUDE.md constraint 4).
 * It is assigned by us during serialisation, after pruning, and is dense from 0.
 * `bounds` never reaches the model — it exists to draw the highlight ring and to
 * annotate report evidence.
 */
export interface UiNode {
  readonly index: number;
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
}

export interface ScreenState {
  readonly appId: string;
  /** Stable-ish identifier for the current screen, e.g. a route. Diagnostics only. */
  readonly screenId: string;
  readonly timestampMs: number;
  readonly nodes: readonly UiNode[];
  /** Indices of nodes that can be scrolled. Drives the Scroll semantic check. */
  readonly scrollable: readonly number[];
}

export const MAX_NODES = 40;

/** Compact wire form of a node. Every falsy field is omitted to save tokens. */
export interface PromptNode {
  i: number;
  role: Role;
  text?: string;
  desc?: string;
  clk?: 1;
  ed?: 1;
  scr?: 1;
  chk?: 0 | 1;
}

/** Longer text costs tokens and adds nothing; a label is never a paragraph. */
export const MAX_TEXT_CHARS = 60;

export function truncate(value: string, max = MAX_TEXT_CHARS): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * The exact JSON the model sees. No nulls, no whitespace, no pretty-printing.
 *
 *   [{"i":0,"role":"edit","text":"Search","clk":1},{"i":1,"role":"btn","text":"Add","clk":1}]
 */
export function toPromptNodes(state: ScreenState): PromptNode[] {
  return state.nodes.map((n) => {
    const p: PromptNode = { i: n.index, role: n.role };
    const text = truncate(n.text);
    const desc = truncate(n.desc);
    if (text) p.text = text;
    // `desc` only earns its tokens when it says something the text does not.
    if (desc && desc.toLowerCase() !== text.toLowerCase()) p.desc = desc;
    if (n.clickable) p.clk = 1;
    if (n.editable) p.ed = 1;
    if (n.scrollable) p.scr = 1;
    if (n.checked !== null) p.chk = n.checked ? 1 : 0;
    return p;
  });
}

export function toPromptJson(state: ScreenState): string {
  return JSON.stringify(toPromptNodes(state));
}

/**
 * Token estimate for the status strip and the step log.
 *
 * CALIBRATED, not guessed. An earlier 3.5-chars-per-token guess understated the
 * real BPE count by about 17% on our own screens, which is exactly the kind of
 * quiet flattery a status strip must not do. Measured against a real BPE
 * tokenizer on Tiffin's five screens, compact JSON runs at ~2.8 characters per
 * token — it is punctuation-dense, and punctuation tokenises badly.
 *
 * Still an estimate, still labelled as one wherever it is shown; the
 * measurement harness (scripts/measure-screens.mjs) reports the true count.
 */
export const CHARS_PER_TOKEN = 2.8;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Structural hash, used for stuck detection and settle detection.
 *
 * Deliberately ignores `timestampMs` and `bounds` — a screen that merely moved a
 * pixel or re-rendered identically is the same screen. It includes text and
 * flags, because those are what actually changed if anything did.
 *
 * FNV-1a, 32-bit: no dependency, stable across platforms, fast enough to run on
 * every settle poll.
 */
export function hashScreenState(state: ScreenState): string {
  const material = state.nodes
    .map((n) => `${n.index}|${n.role}|${truncate(n.text)}|${truncate(n.desc)}|${n.clickable ? 1 : 0}${n.editable ? 1 : 0}${n.enabled ? 1 : 0}${n.checked === null ? '-' : n.checked ? 1 : 0}`)
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Safe node lookup. Returns undefined for any index the model invented. */
export function nodeAt(state: ScreenState, index: number): UiNode | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  return state.nodes[index];
}

export function emptyScreenState(appId: string, screenId: string, timestampMs: number): ScreenState {
  return { appId, screenId, timestampMs, nodes: [], scrollable: [] };
}
