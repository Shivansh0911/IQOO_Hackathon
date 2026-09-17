/**
 * Recognition failures must be explained, not swallowed.
 *
 * The bug these tests exist for: `onerror` was declared on the recogniser
 * interface and never assigned. Every Web Speech failure — a blocked
 * permission, an unreachable transcription service, a missing microphone —
 * ended the session in silence. `start()` returned ok, the panel showed
 * "listening", release produced an empty transcript, and the only conclusion
 * available to a user was that the microphone was broken.
 */

import { describe, expect, it } from 'vitest';
import { describeRecognitionError } from '../src/voice-capture.js';

const CODES = [
  'not-allowed',
  'service-not-allowed',
  'network',
  'audio-capture',
  'no-speech',
  'aborted',
  'language-not-supported',
] as const;

describe('describeRecognitionError', () => {
  it('maps every code the spec defines', () => {
    for (const code of CODES) {
      const described = describeRecognitionError(code);
      expect(described.message.length, code).toBeGreaterThan(20);
      expect(described.kind, code).toBeTruthy();
    }
  });

  it('classifies a blocked permission as permission-denied, not a platform fault', () => {
    // These two differ only in who blocked it, and the fix is the same, so they
    // must not send the user looking in different places.
    expect(describeRecognitionError('not-allowed').kind).toBe('permission-denied');
    expect(describeRecognitionError('service-not-allowed').kind).toBe('permission-denied');
  });

  it('says plainly that recognition needs the network, and the agent does not', () => {
    // The most confusing failure available to us: the product claims on-device
    // inference and offline operation, and both are true of the AGENT. Speech
    // recognition in Chrome is not on-device. Conflating the two would make our
    // headline claim look false to anyone who tested the mic with wifi off.
    const described = describeRecognitionError('network');
    expect(described.message).toMatch(/network/i);
    expect(described.message).toMatch(/on-device/i);
    expect(described.message).toMatch(/type the goal/i);
  });

  it('tells the user what to DO in every case', () => {
    // A message that only names the fault leaves a judge stuck. Each one has to
    // offer an action, and typing is always available.
    for (const code of CODES) {
      const { message } = describeRecognitionError(code);
      const actionable = /allow|reconnect|type|hold|check|pick|connected/i.test(message);
      expect(actionable, `${code}: "${message}"`).toBe(true);
    }
  });

  it('never blames the user for an unknown code, and still names it', () => {
    const described = describeRecognitionError('some-future-code');
    expect(described.kind).toBe('platform-error');
    expect(described.message).toContain('some-future-code');
  });

  it('handles an empty code without producing a dangling sentence', () => {
    expect(describeRecognitionError('').message).toMatch(/unknown error/i);
  });

  it('mentions the microphone when there is no capture device', () => {
    expect(describeRecognitionError('audio-capture').message).toMatch(/microphone/i);
  });
});
