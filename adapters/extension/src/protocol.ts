/**
 * The message protocol between the side panel and the content script.
 *
 * The panel runs the agent; the content script is the only thing that touches
 * the page. Everything crosses this boundary as plain JSON, which is also why
 * the ScreenState contract had to be plain data from the start — it survives
 * structured cloning without any special handling, on this boundary and on the
 * Android binder boundary later.
 */

import type { Action, ExecOutcome, PruneStats, ReadError, ScreenState } from '@origo/core';

export interface ReadRequest {
  readonly kind: 'origo:read';
}

export interface ExecuteRequest {
  readonly kind: 'origo:execute';
  readonly action: Action;
  readonly screen: ScreenState;
}

export interface PingRequest {
  readonly kind: 'origo:ping';
}

export type PanelMessage = ReadRequest | ExecuteRequest | PingRequest;

/**
 * Serialisable snapshot. The same fields as ScreenSnapshot — it is repeated here
 * rather than reused so that a change to the wire format is a deliberate edit to
 * a file named "protocol" and not an accident.
 */
export interface WireSnapshot {
  readonly state: ScreenState;
  readonly stats: PruneStats;
  readonly promptJson: string;
  readonly estimatedTokens: number;
  readonly hash: string;
}

export type ContentReply =
  | { readonly kind: 'ok:read'; readonly snapshot: WireSnapshot }
  | { readonly kind: 'ok:execute'; readonly outcome: ExecOutcome }
  | { readonly kind: 'ok:ping'; readonly url: string; readonly title: string }
  | { readonly kind: 'error'; readonly error: ReadError | { kind: string; message: string } };

/** Read-only goals only. Named here so both halves of the extension agree. */
export const EXTENSION_DESTRUCTIVE_PATTERNS: readonly string[] = [
  // Everything the web profile blocks...
  'pay',
  'purchase',
  'order',
  'checkout',
  'delete',
  'remove',
  'share',
  'send',
  'confirm',
  // ...and more, because here we are on someone else's site. The gate is
  // deliberately stricter than on Tiffin: an agent loose on a real website
  // should stop at anything that writes, posts, or identifies a person.
  'sign in',
  'log in',
  'login',
  'sign up',
  'register',
  'subscribe',
  'submit',
  'post',
  'comment',
  'reply',
  'edit',
  'save',
  'publish',
  'upload',
  'download',
  'install',
  'buy',
  'donate',
  'unsubscribe',
  'follow',
];
