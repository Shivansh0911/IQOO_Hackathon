/**
 * The Android profile is selectable TODAY.
 *
 * That is the whole point: if flipping to it broke anything other than the
 * reader and the executor, the abstraction would be leaking and we would want
 * to know now rather than at hour three on site. It degrades to a clear
 * "not available on this platform" state, as a Result, never a throw.
 */
import { describe, expect, it } from 'vitest';
import { androidProfile } from '../src/index.js';

const signal = new AbortController().signal;

describe('the Android profile', () => {
  it('type-checks and is selectable as an ordinary PlatformProfile', () => {
    expect(androidProfile.id).toBe('android');
    expect(androidProfile.label).toBe('android');
    expect(androidProfile.reader).toBeDefined();
    expect(androidProfile.executor).toBeDefined();
    expect(androidProfile.settleStrategy).toBeDefined();
  });

  it('declares itself unimplemented, so the UI can say so instead of crashing', () => {
    expect(androidProfile.implemented).toBe(false);
    expect(androidProfile.detail).toMatch(/Not implemented in a browser/);
  });

  it('fails as a Result, never as a throw', async () => {
    const read = await androidProfile.reader.read();
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('platform-unavailable');

    const exec = await androidProfile.executor.execute(
      { type: 'Tap', node: 0, reason: 'test' },
      { appId: 'x', screenId: 'y', timestampMs: 0, nodes: [], scrollable: [] },
      signal,
    );
    expect(exec.ok).toBe(false);
    if (!exec.ok) expect(exec.error.kind).toBe('unsupported');
  });

  it('declares the capabilities that actually differ from the web', () => {
    // These are the flags every consumer branches on, and each one is a real
    // Android difference rather than a placeholder.
    expect(androidProfile.capabilities.multiWindow).toBe(true); // the IME is its own window
    expect(androidProfile.capabilities.appSwitching).toBe(true); // launch by package name
    expect(androidProfile.capabilities.crossOriginLimited).toBe(false); // no same-origin policy
    expect(androidProfile.capabilities.backKey).toBe(true); // GLOBAL_ACTION_BACK
  });

  it('allows a longer settle than the web, because a loaded phone is slower', () => {
    expect(androidProfile.limits.settleTimeoutMs).toBeGreaterThan(2500);
  });

  it('shares the node and step limits with the web, so runs are comparable', () => {
    expect(androidProfile.limits.maxNodes).toBe(40);
    expect(androidProfile.limits.maxSteps).toBe(25);
  });
});
