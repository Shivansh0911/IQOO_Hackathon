/**
 * The content script.
 *
 * Three lines of real work: build the handler, install it as a message
 * listener, and get out of the way. Everything it does is in
 * @origo/adapter-extension, which reuses the web adapter's reader and executor
 * unchanged — the same code that reads Tiffin reads Wikipedia.
 */

import { createContentHandler } from '@origo/adapter-extension';
import type { PanelMessage } from '@origo/adapter-extension';

const handler = createContentHandler();

chrome.runtime.onMessage.addListener((message: PanelMessage, _sender, sendResponse) => {
  if (!message?.kind?.startsWith('origo:')) return false;
  handler
    .handle(message)
    .then(sendResponse)
    .catch((cause: unknown) => sendResponse({ kind: 'error', error: { kind: 'platform-error', message: String(cause) } }));
  // Keeps the message channel open for the async reply.
  return true;
});
