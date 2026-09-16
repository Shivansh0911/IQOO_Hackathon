/**
 * Result<T, E> — the only way a fallible operation reports failure in this repo.
 *
 * No exceptions as control flow (CLAUDE.md, code standards). The agent runs
 * unattended against a live UI; a thrown error somewhere in the loop is a demo
 * that dies mid-run in front of a judge. A Result is a value the loop can
 * inspect, log into the RunEvent stream, and feed back to the model.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error));
}

export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/**
 * Wraps a throwing callable at a trust boundary (JSON.parse, a platform API)
 * and converts the throw into an Err. Never swallows: the thrown value is
 * passed to `onThrow` so the caller builds a specific, feedable message.
 */
export function attempt<T, E>(fn: () => T, onThrow: (cause: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

/** Async form of {@link attempt}. */
export async function attemptAsync<T, E>(
  fn: () => Promise<T>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

/** Best-effort human string for an unknown thrown value, for error messages. */
export function describeThrown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return String(cause);
}
