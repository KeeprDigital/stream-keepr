import type { Event } from '~/types';
import { describe, expectTypeOf, it } from 'vitest';

/**
 * Tripwires for the divergence recorded in `shared/api/index.ts` (#272): response types
 * say `Date`, the wire delivers a string. A failure here is a prompt to re-read that
 * decision, not a regression to undo.
 */
describe('api response timestamps at the wire boundary', () => {
	it('is inferred correctly by a typed $fetch that is left to infer', () => {
		expectTypeOf<Awaited<ReturnType<typeof _inferredFetch>>>().toEqualTypeOf<string>();
	});

	it('is overridden back to Date by the explicit generic every call site passes', () => {
		expectTypeOf<Awaited<ReturnType<typeof _explicitFetch>>>().toEqualTypeOf<Date>();
	});
});

/** Nitro's inferred type applies the serialisation transform, so it says `string`. */
async function _inferredFetch() {
	const response = await $fetch('/api/events/1');
	return response.createdAt;
}

/** The form every `$fetch` under `app/` uses: an explicit `~/types` generic, which says `Date`. */
async function _explicitFetch() {
	const response = await $fetch<Event>('/api/events/1');
	return response.createdAt;
}
