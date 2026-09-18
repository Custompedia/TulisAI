import { RequestError } from '../http';
import { entitlement, type Entitlement } from './quota';
import { hasFeature, requiredTierFor, type Feature } from '@/lib/plans';

export class FeatureLockedError extends RequestError {
  constructor(feature: Feature) {
    super('FEATURE_LOCKED', 'This feature is available on a paid plan.', 403, { feature, requiredTier: requiredTierFor(feature) });
  }
}

export function assertFeature(rights: Entitlement, feature: Feature): void {
  if (!hasFeature(rights.features, feature)) throw new FeatureLockedError(feature);
}

// The single gate for paid surfaces; returns the entitlement so callers reuse it instead of reading the row twice.
export async function requireFeature(ownerId: string, feature: Feature): Promise<Entitlement> {
  const rights = await entitlement(ownerId);
  assertFeature(rights, feature);
  return rights;
}
