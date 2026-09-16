/** @origo/adapter-extension — the same agent, on sites we do not own. */
export * from './protocol.js';
export { ExtensionScreenReader, ExtensionActionExecutor } from './proxy.js';
export type { SendToPage } from './proxy.js';
export { createContentHandler } from './content-handler.js';
export type { ContentHandlerOptions } from './content-handler.js';
export { createExtensionProfile } from './profile.js';
export type { ExtensionProfileOptions } from './profile.js';
