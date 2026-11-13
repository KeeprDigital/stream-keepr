import type { ScryfallCardData } from '~~/server/utils/scryfall';
import { describe, expect, it, vi } from 'vitest';
import {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
} from '~~/server/modules/broadcast-deck-list-import';
import { ScryfallRequestError } from '~~/server/utils/scryfall';
import { createScryfallFake, FACE_NAME_COLLISIONS } from '~~/test/helpers/scryfallFake';

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
		const lookupPrintings = vi.fn(async () => [
			scryfallCard(),
		]);
		const resolver = createBroadcastDeckListScryfallResolver({
			overrides: [
				{ inputName: 'Bolt', inputSetCode: null, canonicalName: 'Lightning Bolt' },
			],
			scryfall: { lookupByName, lookupPrintings },
		});

		const result = await resolver.resolve([
			{ name: 'Bolt', setCode: 'SLD', collectorNumber: '101' },
			{ name: 'Wear / Tear', setCode: null, collectorNumber: null },
			{ name: 'Wear//Tear', setCode: null, collectorNumber: null },
			{ name: 'Wear', setCode: null, collectorNumber: null },
		]);

		expect(lookupPrintings).toHaveBeenCalledWith([
			{ setCode: 'sld', collectorNumber: '101' },
		]);
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
				lookupPrintings: vi.fn(async () => [
					scryfallCard({ name: 'Shock' }),
				]),
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
				lookupPrintings: vi.fn(async () => []),
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

	it('resolves a name to its own card when another card in the list has that name as a face', async () => {
		vi.stubGlobal('fetch', createScryfallFake(Object.values(FACE_NAME_COLLISIONS)).fetch);

		try {
			const result = await createBroadcastDeckListScryfallResolver().resolve([
				{ name: 'Emeritus of Conflict // Lightning Bolt', setCode: null, collectorNumber: null },
				{ name: 'Lightning Bolt', setCode: null, collectorNumber: null },
			]);

			expect(result.map(resolution => resolution.status === 'resolved' && resolution.card.canonicalName)).toEqual([
				'Emeritus of Conflict // Lightning Bolt',
				'Lightning Bolt',
			]);
		}
		finally {
			vi.unstubAllGlobals();
		}
	});

	it('asks for every exact printing in one lookup, a printing pasted twice asked for once', async () => {
		const lookupPrintings = vi.fn(async (requests: ReadonlyArray<{ setCode: string; collectorNumber: string }>) =>
			requests.map(request => scryfallCard({ ...request, id: `printing-${request.collectorNumber}` })));
		const resolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupPrintings,
			},
		});

		const result = await resolver.resolve([1, 2, 3, 2].map(number => ({
			name: 'Lightning Bolt',
			setCode: 'sld',
			collectorNumber: String(number),
		})));

		expect(lookupPrintings).toHaveBeenCalledExactlyOnceWith([
			{ setCode: 'sld', collectorNumber: '1' },
			{ setCode: 'sld', collectorNumber: '2' },
			{ setCode: 'sld', collectorNumber: '3' },
		]);
		expect(result.map(resolution => resolution.status === 'resolved' && resolution.card.scryfallId)).toEqual([
			'printing-1',
			'printing-2',
			'printing-3',
			'printing-2',
		]);
	});

	// ADR-0087: a Moxfield paste is about a hundred exact printings, fetched in batches and not one at a time.
	it('resolves a hundred exact printings through the real Scryfall boundary in two requests', async () => {
		const catalogue = Array.from({ length: 100 }, (_, index) => ({
			id: `printing-${index}`,
			name: `Card ${index}`,
			set: 'ecl',
			collector_number: String(index + 1),
		}));
		const scryfall = createScryfallFake(catalogue);
		vi.stubGlobal('fetch', scryfall.fetch);

		try {
			const result = await createBroadcastDeckListScryfallResolver().resolve(catalogue.map(card => ({
				name: card.name,
				setCode: 'ECL',
				collectorNumber: card.collector_number,
			})));

			expect(scryfall.collectionBatches.map(batch => batch.length)).toEqual([75, 25]);
			expect(result.map(resolution => resolution.status === 'resolved' && resolution.card.scryfallId))
				.toEqual(catalogue.map(card => card.id));
		}
		finally {
			vi.unstubAllGlobals();
		}
	});

	it('maps collector not-found to unresolved but keeps collector outages retryable', async () => {
		const request = [
			{ name: 'Lightning Bolt', setCode: 'sld', collectorNumber: '101' },
		];
		const notFoundResolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupPrintings: vi.fn(async () => [null]),
			},
		});
		const outageResolver = createBroadcastDeckListScryfallResolver({
			scryfall: {
				lookupByName: vi.fn(async () => []),
				lookupPrintings: vi.fn(async () => {
					throw new ScryfallRequestError('private outage', { status: 503, retryable: true });
				}),
			},
		});

		await expect(notFoundResolver.resolve(request)).resolves.toEqual([
			{ status: 'unresolved' },
		]);
		await expect(outageResolver.resolve(request)).rejects.toMatchObject({
			code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE',
			retryable: true,
		});
	});
});
