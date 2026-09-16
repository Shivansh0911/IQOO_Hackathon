/**
 * Action -> real DOM events.
 *
 * Real events, not React internals: the executor clicks the way a finger clicks,
 * so Tiffin cannot tell the difference and needs no cooperation. Its Android
 * counterpart performs ACTION_CLICK and ACTION_SET_TEXT on the same seven
 * actions with the same signature.
 */

import type { Action, ActionExecutor, ExecError, ExecOutcome, Result, ScreenState } from '@origo/core';
import { err, hashScreenState, ok } from '@origo/core';
import type { DomScreenReader } from './dom-reader.js';

export interface DomExecutorOptions {
  readonly reader: DomScreenReader;
  /** Root element used for Home (scroll to top) and as the scroll fallback. */
  readonly root: () => Element | null;
}

const aborted = (): Result<ExecOutcome, ExecError> =>
  err({ kind: 'platform-error', message: 'Cancelled before the action was performed.' });

export class DomActionExecutor implements ActionExecutor {
  private readonly options: DomExecutorOptions;

  constructor(options: DomExecutorOptions) {
    this.options = options;
  }

  async execute(action: Action, screen: ScreenState, signal: AbortSignal): Promise<Result<ExecOutcome, ExecError>> {
    const started = Date.now();
    if (signal.aborted) return aborted();

    const done = (detail: string): Result<ExecOutcome, ExecError> =>
      ok({ detail, durationMs: Date.now() - started });

    // Resolve the index against the reader that produced it. If the reader has
    // re-read since this action was validated, the index means something else
    // now, and acting on it would be acting blind. Refuse rather than guess —
    // this is the same "never execute unvalidated output" rule, one layer down.
    let element: Element | null = null;
    if ('node' in action) {
      if (hashScreenState(screen) !== this.options.reader.currentHash) {
        return err({
          kind: 'target-gone',
          message: `Node ${action.node} was chosen from a screen that has since changed. Re-read before acting.`,
        });
      }
      const found = this.options.reader.elementFor(action.node);
      if (!found) {
        return err({
          kind: 'target-gone',
          message: `Node ${action.node} no longer resolves to an element; the screen changed since it was read.`,
        });
      }
      if (!found.isConnected) {
        return err({ kind: 'target-gone', message: `Node ${action.node} has been removed from the page.` });
      }
      element = found;
    }

    switch (action.type) {
      case 'Tap': {
        const el = element as HTMLElement;
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
        if (signal.aborted) return aborted();
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const shared = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy } as const;
        el.dispatchEvent(new PointerEvent('pointerdown', { ...shared, pointerType: 'touch', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', shared));
        el.focus({ preventScroll: true });
        el.dispatchEvent(new PointerEvent('pointerup', { ...shared, pointerType: 'touch', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', shared));
        el.click();
        return done(`tapped <${el.tagName.toLowerCase()}> at (${Math.round(cx)}, ${Math.round(cy)})`);
      }

      case 'TypeText': {
        const el = element as HTMLElement;
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable) {
          return err({ kind: 'not-actionable', message: `Node ${action.node} is not a text field in the DOM.` });
        }
        el.focus({ preventScroll: true });
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // React tracks the value on the DOM node; setting `.value` directly is
          // swallowed on the next render. Going through the prototype setter is
          // what makes a framework-agnostic executor actually work.
          const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (!setter) {
            return err({ kind: 'platform-error', message: 'This browser does not expose the value setter.' });
          }
          setter.call(el, action.text);
        } else {
          el.textContent = action.text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return done(`typed ${JSON.stringify(action.text)} into <${el.tagName.toLowerCase()}>`);
      }

      case 'Scroll': {
        const el = element as HTMLElement;
        const amount = Math.max(120, Math.round(el.clientHeight * 0.8));
        const before = { top: el.scrollTop, left: el.scrollLeft };
        const delta =
          action.direction === 'down' ? { top: amount, left: 0 }
          : action.direction === 'up' ? { top: -amount, left: 0 }
          : action.direction === 'right' ? { top: 0, left: amount }
          : { top: 0, left: -amount };
        el.scrollBy({ ...delta, behavior: 'instant' as ScrollBehavior });
        const moved = el.scrollTop !== before.top || el.scrollLeft !== before.left;
        return done(
          moved
            ? `scrolled ${action.direction} by ${amount}px (now at ${Math.round(el.scrollTop)})`
            : `scroll ${action.direction} had no effect; already at the end`,
        );
      }

      case 'PressKey': {
        const root = this.options.root();
        if (action.key === 'Back') {
          // The web's nearest equivalent. Documented in docs/PORTING.md: on
          // Android this becomes performGlobalAction(GLOBAL_ACTION_BACK), which
          // is a genuine system back rather than a history entry.
          globalThis.history.back();
          return done('pressed Back (history.back)');
        }
        if (action.key === 'Home') {
          root?.scrollTo?.({ top: 0, behavior: 'instant' as ScrollBehavior });
          return done('pressed Home (scrolled the app to the top)');
        }
        const focused = (globalThis.document.activeElement ?? root) as HTMLElement | null;
        if (!focused) return err({ kind: 'not-actionable', message: 'Nothing is focused to receive Enter.' });
        for (const type of ['keydown', 'keypress', 'keyup'] as const) {
          focused.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        }
        if (focused instanceof HTMLInputElement) focused.form?.requestSubmit?.();
        return done('pressed Enter');
      }

      case 'Wait': {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, action.maxMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        return signal.aborted ? aborted() : done(`waited ${action.maxMs}ms`);
      }

      case 'Assert':
        // Evaluated by the agent against the post-action screen, not here. The
        // executor performs; it does not judge.
        return done(`asserted on node ${action.node}`);

      case 'Finish':
        return done(`finished: ${action.verdict}`);
    }

    // The switch is exhaustive over the union; this keeps the compiler honest
    // if an eighth action is ever added without updating the executor.
    return err({ kind: 'unsupported', message: `No web implementation for ${(action as Action).type}.` });
  }
}
