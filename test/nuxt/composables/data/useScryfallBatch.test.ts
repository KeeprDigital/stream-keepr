import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

// Mock cardParser from shared utils
vi.mock('~~/shared/utils/card/parsers', () => ({
	cardParser: vi.fn((card: any) => ({
		id: card.id,
		name: card.name,
		imageUri: 'https://example.com/card.jpg',
	})),
}));

function createCard(overrides: Record<string, any> = {}) {
	return {
		name: 'Test Card',
		scryfallId: undefined,
		quantity: 1,
		compartment: 'mainboard',
		setCode: 'TST',
		cardType: 'creature',
		...overrides,
	} as any;
}

describe('useScryfallBatch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns fetchScryfallCards and buildDeckListArrays', () => {
		const batch = useScryfallBatch();
		expect(batch).toHaveProperty('fetchScryfallCards');
		expect(batch).toHaveProperty('buildDeckListArrays');
	});

	it('fetches cards with scryfallId via collection endpoint', async () => {
		mockFetch.mockResolvedValueOnce({
			data: [{
				id: 'abc-123',
				name: 'Lightning Bolt',
				all_parts: [{ id: 'treasure', component: 'token', name: 'Treasure Token', type_line: 'Token Artifact — Treasure', uri: 'https://api.scryfall.com/cards/treasure' }],
			}],
		});

		const batch = useScryfallBatch();
		const result = await batch.fetchScryfallCards([
			createCard({ name: 'Lightning Bolt', scryfallId: 'abc-123', quantity: 4 }),
		]);

		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.scryfall.com/cards/collection',
			expect.objectContaining({ method: 'POST' }),
		);
		expect(result.has('abc-123')).toBe(true);
		expect(result.get('abc-123')?.deckTokens).toEqual([{
			id: 'treasure',
			scryfallId: 'treasure',
			name: 'Treasure Token',
			typeLine: 'Token Artifact — Treasure',
			uri: 'https://api.scryfall.com/cards/treasure',
		}]);
	});

	it('fetches cards without scryfallId via fuzzy name search', async () => {
		mockFetch.mockResolvedValueOnce({
			id: 'xyz-789',
			name: 'Counterspell',
		});

		const batch = useScryfallBatch();
		const result = await batch.fetchScryfallCards([
			createCard({ name: 'Counterspell', scryfallId: undefined, quantity: 2 }),
		]);

		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.scryfall.com/cards/named',
			expect.objectContaining({ query: { fuzzy: 'Counterspell' } }),
		);
		expect(result.has('xyz-789')).toBe(true);
		expect(result.has('name:counterspell')).toBe(true);
	});

	it('limits concurrent fuzzy lookups to four requests', async () => {
		let releaseRequests!: () => void;
		const requestGate = new Promise<void>((resolve) => {
			releaseRequests = resolve;
		});
		let activeRequests = 0;
		let maximumActiveRequests = 0;
		mockFetch.mockImplementation(async (_url: string, options: { query: { fuzzy: string } }) => {
			activeRequests++;
			maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
			await requestGate;
			activeRequests--;
			return { id: options.query.fuzzy.toLowerCase(), name: options.query.fuzzy };
		});

		const batch = useScryfallBatch();
		const cards = Array.from({ length: 9 }, (_, index) => createCard({ name: `Card ${index}`, scryfallId: undefined }));
		const request = batch.fetchScryfallCards(cards);
		await Promise.resolve();

		expect(mockFetch).toHaveBeenCalledTimes(4);
		expect(maximumActiveRequests).toBe(4);

		releaseRequests();
		await request;
		expect(mockFetch.mock.calls.filter(([url]) => url === 'https://api.scryfall.com/cards/named')).toHaveLength(9);
		expect(maximumActiveRequests).toBe(4);
	});

	it('splits mainboard and sideboard in buildDeckListArrays', () => {
		const batch = useScryfallBatch();
		const cardDataMap = new Map<string, any>();
		cardDataMap.set('abc', { id: 'abc', name: 'Bolt', imageUri: '' });

		const cards = [
			createCard({ name: 'Bolt', scryfallId: 'abc', quantity: 4, compartment: 'mainboard' }),
			createCard({ name: 'Bolt', scryfallId: 'abc', quantity: 2, compartment: 'sideboard' }),
		];

		const { mainboard, sideboard } = batch.buildDeckListArrays(cards, cardDataMap);
		expect(mainboard).toHaveLength(1);
		expect(sideboard).toHaveLength(1);
		expect(mainboard[0]!.mtgCard).toEqual({ id: 'abc', name: 'Bolt', imageUri: '' });
	});

	it('sets mtgCard to null when card data is not in map', () => {
		const batch = useScryfallBatch();
		const cardDataMap = new Map<string, any>();

		const cards = [
			createCard({ name: 'Unknown', scryfallId: 'missing', quantity: 1, compartment: 'mainboard' }),
		];

		const { mainboard } = batch.buildDeckListArrays(cards, cardDataMap);
		expect(mainboard[0]!.mtgCard).toBeNull();
	});
});
