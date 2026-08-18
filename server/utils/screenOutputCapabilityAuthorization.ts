import { SCREEN_OUTPUT_ASSET_CAPABILITY_PATTERN } from '~~/shared/utils/screenOutput';

/**
 * The Screen Output Asset Capability a request presents, or nothing.
 *
 * The capability's *shape* comes from `shared/`, which is where the fragment
 * carrying it is written and read (#397's review): this file used to hold a second
 * copy of that pattern, and two copies of one encoding is how the two stop
 * agreeing about what a capability is. What stays here is the wrapper — the
 * `Bearer ` scheme a request presents it under, which is this side's business.
 */
export function bearerScreenOutputCapability(value: string | undefined): string | undefined {
	const bearer = /^Bearer (\S+)$/.exec(value ?? '')?.[1];
	return bearer !== undefined && SCREEN_OUTPUT_ASSET_CAPABILITY_PATTERN.test(bearer)
		? bearer
		: undefined;
}
