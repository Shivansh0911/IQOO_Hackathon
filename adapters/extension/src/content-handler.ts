/**
 * The page-side half.
 *
 * Runs inside the target site and is the ONLY thing that touches its DOM. It
 * reuses the web adapter's reader and executor unchanged — which is itself a
 * small proof: the same code that reads Tiffin reads Wikipedia, because neither
 * of them knows it is being read.
 */

import type { Result } from '@origo/core';
import { hashScreenState } from '@origo/core';
import { DomActionExecutor, DomScreenReader, HashSettleStrategy } from '@origo/adapter-web';
import type { ContentReply, PanelMessage } from './protocol.js';

export interface ContentHandlerOptions {
  /** Defaults to the whole document. */
  readonly root?: () => Element | null;
  readonly appId?: () => string;
  readonly screenId?: () => string;
}

/**
 * Builds the handler a content script installs as its message listener.
 * Returned as a function so the content script stays three lines long.
 */
export function createContentHandler(options: ContentHandlerOptions = {}) {
  const root = options.root ?? (() => globalThis.document.body);
  const reader = new DomScreenReader({
    appId: options.appId?.() ?? globalThis.location.hostname,
    root,
    // The path is the closest thing a website has to a screen name, and it is
    // diagnostics only — it never reaches the model.
    screenId: options.screenId ?? (() => globalThis.location.pathname.slice(0, 60) || '/'),
  });
  const executor = new DomActionExecutor({ reader, root });
  const settle = new HashSettleStrategy();

  return {
    reader,
    executor,
    settle,
    async handle(message: PanelMessage): Promise<ContentReply> {
      switch (message.kind) {
        case 'origo:ping':
          return { kind: 'ok:ping', url: globalThis.location.href, title: globalThis.document.title };

        case 'origo:read': {
          const result = reader.readSync();
          if (!result.ok) return { kind: 'error', error: result.error };
          return {
            kind: 'ok:read',
            snapshot: {
              state: result.value.state,
              stats: result.value.stats,
              promptJson: result.value.promptJson,
              estimatedTokens: result.value.estimatedTokens,
              hash: result.value.hash,
            },
          };
        }

        case 'origo:execute': {
          // The screen crossed a process boundary as JSON, so re-hash it here
          // rather than trusting a hash that travelled with it. The staleness
          // check then means the same thing it means in-process.
          const expected = hashScreenState(message.screen);
          if (expected !== reader.currentHash) {
            return {
              kind: 'error',
              error: {
                kind: 'target-gone',
                message: 'The page changed between reading it and acting on it. Re-read before acting.',
              },
            };
          }
          const outcome: Result<{ detail: string; durationMs: number }, { kind: string; message: string }> =
            await executor.execute(message.action, message.screen, new AbortController().signal);
          return outcome.ok ? { kind: 'ok:execute', outcome: outcome.value } : { kind: 'error', error: outcome.error };
        }
      }
    },
  };
}
