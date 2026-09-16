/**
 * The panel-side reader and executor.
 *
 * They implement core's ports by asking the content script to do the work. From
 * the agent's point of view they are indistinguishable from the DOM adapter,
 * which is the whole point: the loop, the validator and the guardrails never
 * learn that a process boundary appeared underneath them.
 *
 * This is also the closest analogue to Android in the repository — the agent
 * talks to something that lives in another context and reads a tree it did not
 * build, exactly as an AccessibilityService does.
 */

import type {
  Action,
  ActionExecutor,
  ExecError,
  ExecOutcome,
  ReadError,
  Result,
  ScreenReader,
  ScreenSnapshot,
  ScreenState,
} from '@origo/core';
import { err, ok } from '@origo/core';
import type { ContentReply, PanelMessage } from './protocol.js';

/** Sends one message to the content script in the active tab. Injected, so this file stays testable. */
export type SendToPage = (message: PanelMessage) => Promise<ContentReply>;

const NO_PAGE =
  'No page is connected. Open a normal http(s) tab and press Connect — Chrome blocks content scripts on its own pages, the Web Store, and PDF viewers.';

export class ExtensionScreenReader implements ScreenReader {
  private lastHash = '';

  constructor(private readonly send: SendToPage) {}

  get currentHash(): string {
    return this.lastHash;
  }

  async read(): Promise<Result<ScreenSnapshot, ReadError>> {
    let reply: ContentReply;
    try {
      reply = await this.send({ kind: 'origo:read' });
    } catch {
      // A missing content script is the single most common failure here, and it
      // is not exceptional — it is what happens on chrome:// pages. Say what to
      // do about it rather than surfacing a message-port error.
      return err({ kind: 'platform-unavailable', message: NO_PAGE });
    }

    if (reply.kind === 'error') {
      return err({ kind: 'read-failed', message: reply.error.message });
    }
    if (reply.kind !== 'ok:read') {
      return err({ kind: 'read-failed', message: `Unexpected reply "${reply.kind}" from the page.` });
    }

    this.lastHash = reply.snapshot.hash;
    return ok(reply.snapshot);
  }
}

export class ExtensionActionExecutor implements ActionExecutor {
  constructor(private readonly send: SendToPage) {}

  async execute(action: Action, screen: ScreenState, signal: AbortSignal): Promise<Result<ExecOutcome, ExecError>> {
    if (signal.aborted) {
      return err({ kind: 'platform-error', message: 'Cancelled before the action was performed.' });
    }

    let reply: ContentReply;
    try {
      reply = await this.send({ kind: 'origo:execute', action, screen });
    } catch {
      return err({ kind: 'platform-error', message: NO_PAGE });
    }

    if (reply.kind === 'error') {
      return err({ kind: 'not-actionable', message: reply.error.message });
    }
    if (reply.kind !== 'ok:execute') {
      return err({ kind: 'platform-error', message: `Unexpected reply "${reply.kind}" from the page.` });
    }
    return ok(reply.outcome);
  }
}
