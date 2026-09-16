// RULE C fixture: a portable package reaching past the profile to an adapter.
import { DomScreenReader } from '@origo/adapter-web';

export const leak = DomScreenReader;
