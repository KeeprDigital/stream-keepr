import { describe, expect, it } from 'vitest';
import { graphicAssetListQuerySchema } from '~~/server/schemas/api/graphicsAsset';

/**
 * The two halves of the discovery query answer a malformed value differently,
 * and the difference is the point of the schema rather than an accident of it.
 * A search term is free text an author typed, so an over-long one is trimmed;
 * a lifecycle filter names a shelf from a closed set, and a name outside that
 * set is a request nobody can answer, so it is refused.
 */
describe('graphic Asset Library discovery query', () => {
	it('reads a bare query as an unfiltered search of the active shelf', () => {
		expect(graphicAssetListQuerySchema.parse({})).toEqual({
			search: '',
			lifecycleStates: undefined,
		});
	});

	it('truncates an over-long search term rather than refusing it', () => {
		const parsed = graphicAssetListQuerySchema.parse({ search: 'a'.repeat(250) });

		expect(parsed.search).toBe('a'.repeat(200));
	});

	it('reads a comma-separated filter as the lifecycle states it names', () => {
		expect(graphicAssetListQuerySchema.parse({
			lifecycleStates: 'active,trashed',
		}).lifecycleStates).toEqual(['active', 'trashed']);
	});

	it('refuses a lifecycle state the library does not have', () => {
		expect(() => graphicAssetListQuerySchema.parse({ lifecycleStates: 'bogus' })).toThrow();
	});

	it('refuses a filter that names one real state and one invented one', () => {
		expect(() => graphicAssetListQuerySchema.parse({
			lifecycleStates: 'active,bogus',
		})).toThrow();
	});

	it('refuses an empty filter rather than reading it as no filter', () => {
		expect(() => graphicAssetListQuerySchema.parse({ lifecycleStates: '' })).toThrow();
	});
});
