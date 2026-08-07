import type { Event } from '~/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

/**
 * Tripwires for the divergence recorded at the top of `shared/api/index.ts`:
 * the response types say `Date`, the wire delivers `string`, and #272 decided to
 * record that rather than close it.
 *
 * These pin behaviour that is established, not behaviour anyone prefers. The
 * would-be fix described in that record widens the client-side aliases in
 * `app/types/index.ts` to `Date | string`; the second type pin below is written
 * against one of those aliases precisely so that fix trips it. A failure here is
 * a prompt to re-read the decision, not a regression to undo.
 */
describe('api response timestamps at the wire boundary', () => {
	it('is JSON, so a mapper-produced Date arrives as an ISO string', () => {
		const produced = { updatedAt: new Date('2026-08-07T00:44:52.000Z') };

		const received = JSON.parse(JSON.stringify(produced));

		expect(produced.updatedAt).toBeInstanceOf(Date);
		expect(received.updatedAt).not.toBeInstanceOf(Date);
		expect(received.updatedAt).toBe('2026-08-07T00:44:52.000Z');
	});

	it('is inferred correctly by a typed $fetch that is left to infer', () => {
		expectTypeOf<Awaited<ReturnType<typeof _inferredFetch>>>().toEqualTypeOf<string>();
	});

	it('is overridden back to Date by the explicit generic every call site passes', () => {
		expectTypeOf<Awaited<ReturnType<typeof _explicitFetch>>>().toEqualTypeOf<Date>();
	});
});

/**
 * Nitro derives this one from the route handler and applies the serialisation
 * transform, so it already says `string`. Nothing in the app relies on it,
 * which is the point: the correct inference is available and unused.
 */
async function _inferredFetch() {
	const response = await $fetch('/api/events/1');
	return response.createdAt;
}

/**
 * And this is the form every `$fetch` under `app/` actually uses — an explicit
 * generic naming one of the `~/types` aliases, as at
 * `app/composables/repositories/useScreenRepository.ts:26`. The generic wins
 * over the inference, so the caller is told `Date` and handed the string the
 * first test above describes.
 */
async function _explicitFetch() {
	const response = await $fetch<Event>('/api/events/1');
	return response.createdAt;
}
