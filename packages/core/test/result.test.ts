import { describe, expect, it } from 'vitest';
import { andThen, attempt, describeThrown, err, isErr, isOk, map, mapErr, ok, unwrapOr } from '../src/result.js';

describe('Result', () => {
  it('narrows with isOk and isErr', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('bad'))).toBe(true);
  });

  it('maps the value and leaves errors alone', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err('bad'), (n: number) => n * 3)).toEqual({ ok: false, error: 'bad' });
  });

  it('maps the error and leaves values alone', () => {
    expect(mapErr(err('bad'), (e) => e.toUpperCase())).toEqual({ ok: false, error: 'BAD' });
    expect(mapErr(ok(1), (e: string) => e)).toEqual({ ok: true, value: 1 });
  });

  it('chains with andThen and short-circuits on the first error', () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err('odd'));
    expect(andThen(ok(8), half)).toEqual({ ok: true, value: 4 });
    expect(andThen(ok(7), half)).toEqual({ ok: false, error: 'odd' });
    expect(andThen(err('earlier'), half)).toEqual({ ok: false, error: 'earlier' });
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err('x'), 9)).toBe(9);
  });

  it('converts a throw into an Err without swallowing the cause', () => {
    const r = attempt(
      () => JSON.parse('{oops') as unknown,
      (cause) => `parse failed: ${describeThrown(cause)}`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/parse failed: /);
  });

  it('describes non-Error throws', () => {
    expect(describeThrown('plain string')).toBe('plain string');
    expect(describeThrown(42)).toBe('42');
    expect(describeThrown(new Error('boom'))).toBe('boom');
  });
});
