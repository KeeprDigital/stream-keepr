import type { ScryfallCardData } from '~~/server/utils/scryfall';
import { describe, expect, it, vi } from 'vitest';
import {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
} from '~~/server/modules/broadcast-deck-list-import';
import { ScryfallRequestError } from '~~/server/utils/scryfall';

function scryfallCard(overrides: Partial<ScryfallCardData> = {}): ScryfallCardData {
	return {
		name: 'Lightning Bolt',
		setCode: 'sld',
		collectorNumber: '101',
		id: 'bolt-printing',
		oracleId: 'bolt-oracle',
		manaCost: '{R}',
		cmc: 1,
		colors: 'R',
		typeLine: 'Instant',
		deckCounterTypes: ['energy'],
		deckTokens: [],
		...overrides,
	};
}

describe('broadcast Deck List Scryfall resolver', () => {
	it('applies Event overrides as names while preserving hints and normalizing split-card spellings', async () => {
		const lookupByName = vi.fn(async (requests: ReadonlyArray<{ name: string; setCode: string | null }>) => (
			requests.map(request => request.name.startsWith('Wear')
				? scryfallCard({
						name: 'Wear // Tear',
						setCode: request.setCode ?? 'dgm',
						collectorNumber: '152',
						id: 'wear-tear-printing',
					})
				: null)
		));
		const lookupBySetAndCollector = vi.fn(async () => scryfallCard());
		const resolver = createBroadcastDeckListScryfallResolver({
			overrides: [{ inputName: 'Bolt', inputSetCode: null, canonicalName: 'Lightning Bolt' }],
			scryfall: { lookupByName, lookupBySetAndCollector },
		});

		const result = await resolver.resolve([
			{ name: 'Bolt', setCode: 'SLD', collectorNumber: '101' },
			{ name: 'Wear / Tear', setCode: null, collectorNumber: null },
			{ name: 'Wear//Tear', setCode: null, collectorNumber: null },
			{ name: 'Wear', setCode: null, collectorNumber: null },
		]);

		expect(lookupBySetAndCollector).toHaveBeenCalledWith('sld', '101');
		expect(lookupByName).toHaveBeenCalledWith([
			{ name: 'Wear // Tear', setCode: null },
			{ name: 'Wear', setCode: null },
		]);
		expect(result).toHaveLength(4);
		expect(result.every(resolution => resolution.status === 'resolved')).toBe(true);
		expect(result[0]).toEqual({
			status: 'resolved',
			card: {
				canonicalName: 'Lightning Bolt',
				scryfallId: 'bolt-printing',
				oracleId: 'bolt-oracle',
				setCode: 'sld',
				collectorNumber: '101',
				cardType: 'Instant',
				colors: 'R',
				manaCost: '{R}',
				manaValue: 1,
				deckCounterTypes: ['energy'],
			},
		});
	});

	it('never accepts a fuzzy name or a printing that disagrees with a supplied hint', async () => {
		const resolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => [
					scryfallCard({ name: 'Lightning Bolt', setCode: 'neo' }),
					scryfallCard({ name: 'Shack', setCode: 'm21' }),
				]),
				lookupBySetAndCollector: vi.fn(async () => scryfallCard({ name: 'Shock' })),
			},
		});

		await expect(resolver.resolve([
			{ name: 'Lightning Bolt', setCode: 'm21', collectorNumber: null },
			{ name: 'Shock', setCode: null, collectorNumber: null },
			{ name: 'Lightning Bolt', setCode: 'sld', collectorNumber: '101' },
		])).resolves.toEqual([
			{ status: 'unresolved' },
			{ status: 'unresolved' },
			{ status: 'unresolved' },
		]);
	});

	it('turns provider outages into a retryable import failure rather than an unresolved card', async () => {
		const resolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => {
					throw new ScryfallRequestError('private upstream detail', { status: 503, retryable: true });
				}),
				lookupBySetAndCollector: vi.fn(),
			},
		});

		const failure = await resolver.resolve([
			{ name: 'Lightning Bolt', setCode: null, collectorNumber: null },
		]).catch(error => error);

		expect(failure).toBeInstanceOf(BroadcastDeckListCardProviderError);
		expect(failure).toMatchObject({
			code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE',
			retryable: true,
			message: 'Card data provider is temporarily unavailable',
		});
		expect(failure.message).not.toContain('private upstream detail');
	});

	it('uses the real Scryfall boundary in batches of 75 without losing result order', async () => {
		const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
			const body = JSON.parse(init.body as string) as { identifiers: Array<{ name: string }> };
			return {
				ok: true,
				json: () => Promise.resolve({
					object: 'list',
					not_found: [],
					data: body.identifiers.map(identifier => ({
						id: `${identifier.name}-printing`,
						name: identifier.name,
						set: 'dft',
						collector_number: '1',
					})),
				}),
			} as unknown as Response;
		});
		vi.stubGlobal('fetch', fetchMock);

		try {
			const requests = Array.from({ length: 80 }, (_, index) => ({
				name: `Card ${index}`,
				setCode: null,
				collectorNumber: null,
			}));
			const result = await createBroadcastDeckListScryfallResolver().resolve(requests);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(result).toHaveLength(80);
			expect(result[79]).toEqual(expect.objectContaining({
				status: 'resolved',
				card: expect.objectContaining({ canonicalName: 'Card 79', scryfallId: 'Card 79-printing' }),
			}));
		}
		finally {
			vi.unstubAllGlobals();
		}
	});

	it('bounds exact collector lookups to four concurrent requests', async () => {
		let active = 0;
		let maximumActive = 0;
		const lookupBySetAndCollector = vi.fn(async (setCode: string, collectorNumber: string) => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await Promise.resolve();
			active--;
			return scryfallCard({
				setCode,
				collectorNumber,
				id: `printing-${collectorNumber}`,
			});
		});
		const resolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupBySetAndCollector,
			},
		});

		const result = await resolver.resolve(Array.from({ length: 9 }, (_, index) => ({
			name: 'Lightning Bolt',
			setCode: 'sld',
			collectorNumber: String(index + 1),
		})));

		expect(result.every(resolution => resolution.status === 'resolved')).toBe(true);
		expect(lookupBySetAndCollector).toHaveBeenCalledTimes(9);
		expect(maximumActive).toBe(4);
	});

	it('maps collector not-found to unresolved but keeps collector outages retryable', async () => {
		const request = [{ name: 'Lightning Bolt', setCode: 'sld', collectorNumber: '101' }];
		const notFoundResolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupBySetAndCollector: vi.fn(async () => {
					throw new ScryfallRequestError('not found', { status: 404, notFound: true });
				}),
			},
		});
		const outageResolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupBySetAndCollector: vi.fn(async () => {
					throw new ScryfallRequestError('private outage', { status: 503, retryable: true });
				}),
			},
		});

		await expect(notFoundResolver.resolve(request)).resolves.toEqual([{ status: 'unresolved' }]);
		await expect(outageResolver.resolve(request)).rejects.toMatchObject({
			code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE',
			retryable: true,
		});
	});
});
