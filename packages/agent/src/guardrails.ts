/**
 * Guardrails.
 *
 * Each one is a small, separately-testable object rather than a condition buried
 * in the loop, because every one of them is a claim we make to a judge and each
 * needs a test with its name on it.
 *
 * All of them are portable. On Android the same objects run with different
 * limits, which is why the numbers live in PlatformProfile.limits and not here.
 */

export const DEFAULT_LIMITS = {
  /** Hard ceiling on actions. On exhaustion the run ends Blocked, never silently. */
  maxSteps: 25,
  /** Consecutive invalid outputs tolerated before the run ends Blocked. */
  maxRetries: 2,
  /** Identical screen hashes before a reflection turn is injected. */
  stuckReflectAt: 3,
  /** Identical screen hashes before the run is terminated. */
  stuckTerminateAt: 4,
  settleTimeoutMs: 2500,
  settlePollMs: 120,
  /**
   * Wall-clock ceiling. 25 steps at a measured 4s a call is ~100s of planning
   * plus execution and settle; 180s leaves room for a slow machine and still
   * ends before a judge assumes it has hung.
   */
  maxRunMs: 180_000,
} as const;

/** Counts consecutive invalid model outputs; resets the moment one is accepted. */
export class RetryBudget {
  private consecutive = 0;
  constructor(private readonly max: number = DEFAULT_LIMITS.maxRetries) {}

  get used(): number {
    return this.consecutive;
  }

  /** @returns true when another attempt is allowed. */
  recordFailure(): boolean {
    this.consecutive += 1;
    return this.consecutive <= this.max;
  }

  recordSuccess(): void {
    this.consecutive = 0;
  }

  get exhausted(): boolean {
    return this.consecutive > this.max;
  }
}

export type StuckVerdict = 'moving' | 'reflect' | 'terminate';

/**
 * Stuck detection by screen hash.
 *
 * Three identical screens means the last two actions changed nothing, and a
 * model that is looping will keep looping unless something interrupts it. The
 * reflection turn is that interruption; a fourth identical screen means the
 * reflection did not help either, and continuing just burns the step budget in
 * front of a judge.
 */
export class StuckDetector {
  private lastHash: string | null = null;
  private repeats = 1;

  constructor(
    private readonly reflectAt: number = DEFAULT_LIMITS.stuckReflectAt,
    private readonly terminateAt: number = DEFAULT_LIMITS.stuckTerminateAt,
  ) {}

  get count(): number {
    return this.repeats;
  }

  /**
   * @param afterMutation false when the previous action was an observation
   *   (Assert) rather than something meant to change the screen. Reading the
   *   same screen twice because you checked it twice is not being stuck, and
   *   counting it would terminate perfectly good runs that verify two things
   *   in a row.
   */
  observe(hash: string, afterMutation = true): StuckVerdict {
    if (hash === this.lastHash && afterMutation) {
      this.repeats += 1;
    } else if (hash === this.lastHash) {
      // Same screen, but nothing tried to change it. Hold the count.
    } else {
      this.lastHash = hash;
      this.repeats = 1;
    }
    if (this.repeats >= this.terminateAt) return 'terminate';
    if (this.repeats >= this.reflectAt) return 'reflect';
    return 'moving';
  }

  /** Message handed to the model as the reflection turn. */
  describe(): string {
    return `The screen has been identical for ${this.repeats} reads. Your last actions changed nothing.`;
  }
}

/**
 * Tracks assertions for the Finish(Pass) rule.
 *
 * The downgrade itself lives in the validator — it is policy, not bookkeeping —
 * but the count it consults comes from here.
 */
export class AssertLedger {
  private passed = 0;
  private failed = 0;

  record(ok: boolean): void {
    if (ok) this.passed += 1;
    else this.failed += 1;
  }

  get passedCount(): number {
    return this.passed;
  }

  get failedCount(): number {
    return this.failed;
  }

  /**
   * A run that verified something and found it wrong is a FAIL, not a pass.
   * Used to correct a model that asserts, sees the assertion fail, and then
   * cheerfully finishes Pass anyway — which small models do.
   */
  get shouldFail(): boolean {
    return this.failed > 0;
  }
}
