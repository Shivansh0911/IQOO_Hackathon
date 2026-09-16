// RULE C fixture: reading platform facts from the profile, as everything above
// the adapter boundary must. Lints clean, forever.
import type { PlatformProfile } from '@origo/core';

export function canCaptureEvidence(profile: PlatformProfile): boolean {
  return profile.capabilities.screenshots && profile.implemented;
}
