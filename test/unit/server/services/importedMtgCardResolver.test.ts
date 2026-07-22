import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockListResolvedByEvent = vi.fn();

vi.mock('~~/server/services/eventCardNameOverride', () => ({
	eventCardNameOverrideService: () => ({
		listResolvedByEvent: mockListResolvedByEvent,
	}),
}));

const { ImportedMtgCardLookupError, importedMtgCardResolverService } = await import('~~/server/services/importedMtgCardResolver');

function createCollectionResponse(cards: Array<Record<string, unknown>>, notFound: Array<Record<string, unknown>> = []) {
	return {
		ok: true,
		json: () => Promise.resolve({
			object: 'list',
			data: cards,
			not_found: notFound,
		}),
	};
}

describe('importedMtgCardResolverService', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockListResolvedByEvent.mockReset().mockResolvedValue([]);
	});

	it('uses the collection endpoint for exact matches', async () => {
		mockFetch.mockResolvedValueOnce(createCollectionResponse([
			{
				id: 'shock-1',
				name: 'Shock',
				set: 'm21',
				oracle_id: 'oracle-shock',
				mana_cost: '{R}',
				cmc: 1,
				color_identity: ['R'],
				type_line: 'Instant',
			},
		]) as any);

		const result = await importedMtgCardResolverService().resolveBatch(1, [
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(result.resolutions.get('shock|m21')).toEqual(expect.objectContaining({
			status: 'resolved',
			source: 'exact',
			resolvedName: 'Shock',
		}));
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('returns unresolved when neither exact nor fuzzy lookup finds a match', async () => {
		mockFetch
			.mockResolvedValueOnce(createCollectionResponse([], [{ name: 'Totally Fake Card' }]) as any)
			.mockResolvedValueOnce({ ok: false, statusText: 'Not Found' } as any);

		const result = await importedMtgCardResolverService().resolveBatch(1, [
			{ name: 'Totally Fake Card', setCode: null },
		]);

		expect(result.resolutions.get('totally fake card')).toEqual({
			status: 'unresolved',
			inputName: 'Totally Fake Card',
			inputSetCode: null,
		});
	});

	it('aborts reconciliation when Scryfall is temporarily unavailable', async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 503,
			statusText: 'Service Unavailable',
			text: () => Promise.resolve('temporary upstream failure'),
		} as any);

		await expect(importedMtgCardResolverService().resolveBatch(1, [
			{ name: 'Shock', setCode: 'm21' },
		])).rejects.toBeInstanceOf(ImportedMtgCardLookupError);

		// Initial request plus two bounded retries. The card is never downgraded
		// to an unresolved authoritative result.
		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it('does not downgrade a card when exact lookup misses and fuzzy lookup has an infrastructure failure', async () => {
		mockFetch
			.mockResolvedValueOnce(createCollectionResponse([], [{ name: 'Shock', set: 'm21' }]) as any)
			.mockResolvedValue({
				ok: false,
				status: 503,
				statusText: 'Service Unavailable',
			} as any);

		await expect(importedMtgCardResolverService().resolveBatch(1, [
			{ name: 'Shock', setCode: 'm21' },
		])).rejects.toMatchObject({
			code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE',
			message: 'Card data lookup is temporarily unavailable; existing deck data was preserved',
		});
	});
});
