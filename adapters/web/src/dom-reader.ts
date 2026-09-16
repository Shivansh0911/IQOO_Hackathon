/**
 * DOM tree -> ScreenState.
 *
 * The web half of the platform boundary. It walks the DOM, computes the flags
 * that pruning needs, and hands a flat candidate list to the PORTABLE pruning
 * policy in @origo/core. It decides nothing about what to keep — that decision
 * lives in core precisely so the phone inherits it unchanged.
 *
 * It reads the target app from the outside, exactly as an accessibility service
 * reads another app's window. Tiffin has no idea this is happening.
 */

import type { NodeFate, PruneCandidate, ReadError, Result, ScreenReader, ScreenSnapshot } from '@origo/core';
import { err, estimateTokens, hashScreenState, ok, pruneAndRank, toPromptJson } from '@origo/core';
import { mapRole } from './role-map.js';

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'br', 'hr']);

const CLICKABLE_TAGS = new Set(['button', 'a', 'summary']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option']);
const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number', '']);

export interface DomReaderOptions {
  readonly appId: string;
  /** Root of the app being read. Everything outside it is invisible to the agent. */
  readonly root: () => Element | null;
  /** How the current screen is named in logs. Diagnostics only, never sent to the model. */
  readonly screenId?: () => string;
  readonly maxNodes?: number;
}

function isClickable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role')?.toLowerCase() ?? '';
  if (CLICKABLE_TAGS.has(tag) && !(tag === 'a' && !el.hasAttribute('href'))) return true;
  if (CLICKABLE_ROLES.has(role)) return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type.toLowerCase();
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file'].includes(type);
  }
  // An author-supplied handler or a focusable non-control is a real affordance.
  if (el.hasAttribute('onclick')) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0 && !CLICKABLE_TAGS.has(tag)) return true;
  return false;
}

function isEditable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') return EDITABLE_INPUT_TYPES.has((el as HTMLInputElement).type.toLowerCase());
  if ((el as HTMLElement).isContentEditable) return true;
  return el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox';
}

function isScrollable(el: Element, style: CSSStyleDeclaration): boolean {
  const overflowY = style.overflowY;
  const scrolls = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  return scrolls && el.scrollHeight - el.clientHeight > 4;
}

function checkedState(el: Element): boolean | null {
  const aria = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed') ?? el.getAttribute('aria-selected');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  if (el.tagName.toLowerCase() === 'input') {
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked;
  }
  return null;
}

/**
 * Opacity, defensively.
 *
 * A browser resolves `opacity` to "1"; a non-browser DOM can leave it "".
 * Number("") is 0, which silently made every node invisible and pruned the whole
 * screen away — a failure mode that looks exactly like "the agent sees nothing"
 * and would have cost an hour to diagnose on site. Unparseable means fully
 * opaque, because that is what an element with no opacity set actually is.
 */
function opacityOf(style: CSSStyleDeclaration): number {
  const value = Number(style.opacity);
  return Number.isFinite(value) && style.opacity !== '' ? value : 1;
}

function isEnabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

/** Text belonging to this element itself, not to its descendants. */
function ownText(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* Node.TEXT_NODE */) text += child.nodeValue ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The text a node presents.
 *
 * An interactive node aggregates its descendants, because the whole control is
 * one thing to a user and to an accessibility tree: a card with its name, rating
 * and price in child spans IS "Deccan Dastarkhwan 4.5 32 min". A non-interactive
 * node carries only its own text, so wrappers do not duplicate what their
 * children already say.
 *
 * Two details that measurement forced, and that Android's accessible-name
 * computation gets right for the same reasons:
 *
 *   - aria-hidden subtrees are excluded. Tiffin's cards open with a decorative
 *     two-letter monogram marked aria-hidden; including it produced
 *     "DDDeccan Dastarkhwan", which is not what the control is called.
 *   - text blocks are joined with a space. textContent concatenates raw, so
 *     "Deccan Dastarkhwan" and "Biryani, Hyderabadi" arrived glued together and
 *     a small model has to guess where one field ends.
 */
function aggregatedText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Element): void => {
    if (node.getAttribute('aria-hidden') === 'true' || (node as HTMLElement).hidden) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        const text = (child.nodeValue ?? '').replace(/\s+/g, ' ').trim();
        if (text) parts.push(text);
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        walk(child as Element);
      }
    }
  };
  walk(el);
  return parts.join(' ');
}

/**
 * Only CLICKABLE and EDITABLE nodes aggregate. A merely-scrollable container
 * does not: measurement caught Tiffin's <main> presenting the entire page as its
 * own label, which is both expensive and false. A scroll container is a viewport,
 * not a control with a name — and on Android a scrollable RecyclerView likewise
 * has no text of its own.
 */
function presentedText(el: Element, clickable: boolean, editable: boolean): string {
  return clickable || editable ? aggregatedText(el) : ownText(el);
}

function accessibleDescription(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label?.trim()) return label.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return (el.getAttribute('alt') ?? '').trim();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    const placeholder = input.getAttribute('placeholder')?.trim();
    if (placeholder) return placeholder;
  }
  return (el.getAttribute('title') ?? '').trim();
}

export interface DetailedRead {
  readonly snapshot: ScreenSnapshot;
  /** Every candidate the traversal found, before any rule ran. */
  readonly candidates: readonly PruneCandidate[];
  /** What happened to each candidate id: kept, or the rule that dropped it. */
  readonly fates: ReadonlyMap<number, NodeFate>;
}

/**
 * Reads the DOM under `root` into a pruned, indexed ScreenState, and remembers
 * which element each index came from so the executor can act on it.
 */
export class DomScreenReader implements ScreenReader {
  private readonly options: DomReaderOptions;
  private elementsByIndex: Element[] = [];
  private lastHash = '';

  constructor(options: DomReaderOptions) {
    this.options = options;
  }

  /** Resolves a node index back to the element it was read from. */
  elementFor(index: number): Element | undefined {
    return this.elementsByIndex[index];
  }

  /** Hash of the most recent snapshot, so the executor can refuse stale indices. */
  get currentHash(): string {
    return this.lastHash;
  }

  read(): Promise<Result<ScreenSnapshot, ReadError>> {
    return Promise.resolve(this.readSync());
  }

  readSync(): Result<ScreenSnapshot, ReadError> {
    const captured = this.capture();
    return captured.ok ? ok(captured.value.snapshot) : captured;
  }

  /**
   * Everything the debug panel needs: the snapshot, plus what happened to every
   * candidate that did not survive. The agent never sees this.
   */
  readDetailed(): Result<DetailedRead, ReadError> {
    return this.capture();
  }

  private capture(): Result<DetailedRead, ReadError> {
    const root = this.options.root();
    if (!root) {
      return err({ kind: 'no-root', message: 'The target app root is not mounted yet.' });
    }

    const viewport = root.getBoundingClientRect();
    const candidates: PruneCandidate[] = [];
    const elements: Element[] = [];

    const visit = (el: Element, depth: number, parentId: number | null): void => {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;

      const style = globalThis.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const ariaHidden = el.getAttribute('aria-hidden') === 'true';
      const visible =
        !ariaHidden &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        opacityOf(style) > 0.05 &&
        !(el as HTMLElement).hidden;

      const clickable = isClickable(el);
      const editable = isEditable(el);
      const scrollable = isScrollable(el, style);

      const id = candidates.length;
      candidates.push({
        id,
        parent: parentId,
        role: mapRole({
          tag,
          ariaRole: el.getAttribute('role'),
          inputType: tag === 'input' ? (el as HTMLInputElement).type : null,
          contentEditable: (el as HTMLElement).isContentEditable,
        }),
        text: editable ? ((el as HTMLInputElement).value ?? '') : presentedText(el, clickable, editable),
        desc: accessibleDescription(el),
        bounds: {
          x: Math.round(rect.left - viewport.left),
          y: Math.round(rect.top - viewport.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        clickable,
        editable,
        scrollable,
        checked: checkedState(el),
        enabled: isEnabled(el),
        depth,
        visible,
        // Measured against the app's own viewport, not the browser window: the
        // agent sees what is on the app's screen, which is what a phone shows.
        onScreen:
          rect.bottom > viewport.top &&
          rect.top < viewport.bottom &&
          rect.right > viewport.left &&
          rect.left < viewport.right,
      });
      elements.push(el);

      // An <svg> is one image; its internal geometry is noise.
      if (tag === 'svg') return;
      for (const child of el.children) visit(child, depth + 1, id);
    };

    visit(root, 0, null);

    const pruned = pruneAndRank(candidates, { ...(this.options.maxNodes === undefined ? {} : { maxNodes: this.options.maxNodes }) });
    this.elementsByIndex = pruned.indexToCandidateId.map((cid) => elements[cid] as Element);

    const state = {
      appId: this.options.appId,
      screenId: this.options.screenId?.() ?? 'unknown',
      timestampMs: Date.now(),
      nodes: pruned.nodes,
      scrollable: pruned.nodes.filter((n) => n.scrollable).map((n) => n.index),
    };

    const promptJson = toPromptJson(state);
    this.lastHash = hashScreenState(state);

    return ok({
      snapshot: {
        state,
        stats: pruned.stats,
        promptJson,
        estimatedTokens: estimateTokens(promptJson),
        hash: this.lastHash,
      },
      candidates,
      fates: pruned.fates,
    });
  }
}
