import type { BoundedRawMutationPolicy } from '~~/shared/utils/requestBodyLimits';

interface BoundedRawMutationRouteRules {
	boundedRawMutations?: Partial<Record<string, BoundedRawMutationPolicy>>;
}

function assertPolicy(policy: BoundedRawMutationPolicy): void {
	if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0)
		throw new TypeError('boundedRawMutations maxBytes must be a positive safe integer');
	if (!policy.label.trim())
		throw new TypeError('boundedRawMutations label must not be empty');
}

/**
 * Resolve the opt-in for one mutation method. Keeping policies keyed by method
 * prevents a raw POST registration from weakening PUT, PATCH, or DELETE at the
 * same path.
 */
export function boundedRawMutationPolicy(
	routeRules: BoundedRawMutationRouteRules,
	method: string,
): BoundedRawMutationPolicy | undefined {
	const policy = routeRules.boundedRawMutations?.[method.toUpperCase()];
	if (!policy)
		return;

	assertPolicy(policy);
	return policy;
}
