/**
 * @origo/adapter-web — the DOM implementation of core's ports.
 *
 * Swap this for @origo/adapter-android and nothing above it changes. That claim
 * is the point of the whole repository, and docs/PORTING.md maps it call by call.
 */
export { DomScreenReader } from './dom-reader.js';
export type { DomReaderOptions, DetailedRead } from './dom-reader.js';
export { DomActionExecutor } from './dom-executor.js';
export type { DomExecutorOptions } from './dom-executor.js';
export { HashSettleStrategy, DEFAULT_SETTLE } from './settle.js';
export { mapRole } from './role-map.js';
