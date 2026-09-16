/**
 * Tier selection: detect capability, fall back in order, allow a manual override.
 *
 * The registry never *probes* for a capability itself — no navigator.gpu here,
 * that would be web code in packages/** — it asks each planner whether it can
 * run. Each planner knows its own requirements, which is also what lets the
 * MediaPipe planner slot in on Android with no change here.
 *
 * Order is priority order: local first, because on-device is the product and not
 * a fallback.
 */

import type { Result } from '@origo/core';
import { err, ok } from '@origo/core';
import type { Planner, PlannerTier } from './planner.js';

export interface SelectionOutcome {
  readonly planner: Planner;
  /** Every tier considered and what happened, so the UI can explain itself. */
  readonly trace: readonly { tier: PlannerTier; model: string; available: boolean }[];
  /** True when the user pinned a tier rather than letting detection choose. */
  readonly overridden: boolean;
}

export interface RegistryError {
  readonly message: string;
  readonly trace: readonly { tier: PlannerTier; model: string; available: boolean }[];
}

export class PlannerRegistry {
  private readonly candidates: readonly Planner[];

  /** @param candidates in priority order. Local first: on-device is the product. */
  constructor(candidates: readonly Planner[]) {
    this.candidates = candidates;
  }

  get tiers(): readonly PlannerTier[] {
    return this.candidates.map((c) => c.info.tier);
  }

  find(tier: PlannerTier): Planner | undefined {
    return this.candidates.find((c) => c.info.tier === tier);
  }

  /**
   * Picks a planner. With `override`, uses that tier if it is genuinely
   * available and fails loudly if it is not — a pinned tier that silently falls
   * back to another one would make the status strip a liar.
   */
  async select(override?: PlannerTier): Promise<Result<SelectionOutcome, RegistryError>> {
    const trace: { tier: PlannerTier; model: string; available: boolean }[] = [];

    if (override) {
      const pinned = this.find(override);
      if (!pinned) {
        return err({ message: `No planner is registered for the "${override}" tier.`, trace });
      }
      const usable = await pinned.available();
      trace.push({ tier: pinned.info.tier, model: pinned.info.model, available: usable });
      if (!usable) {
        return err({
          message: `The "${override}" tier was selected but is not available here. ${pinned.info.detail}`,
          trace,
        });
      }
      return ok({ planner: pinned, trace, overridden: true });
    }

    for (const candidate of this.candidates) {
      const usable = await candidate.available();
      trace.push({ tier: candidate.info.tier, model: candidate.info.model, available: usable });
      if (usable) return ok({ planner: candidate, trace, overridden: false });
    }

    return err({ message: 'No planner is available in this environment.', trace });
  }
}
