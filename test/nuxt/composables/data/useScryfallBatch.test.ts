import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

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
		expect(result.cards.has('abc-123')).toBe(true);
		expect(result.cards.get('abc-123')?.deckTokens).toEqual([{
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
		expect(result.cards.has('xyz-789')).toBe(true);
		expect(result.cards.has('name:counterspell')).toBe(true);
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

	it('retries a failed collection batch with backoff before succeeding', async () => {
		vi.useFakeTimers();
		try {
			mockFetch
				.mockRejectedValueOnce(new Error('scryfall 503'))
				.mockRejectedValueOnce(new Error('scryfall 503'))
				.mockResolvedValueOnce({ data: [{ id: 'abc-123', name: 'Lightning Bolt' }] });

			const batch = useScryfallBatch();
			const request = batch.fetchScryfallCards([
				createCard({ name: 'Lightning Bolt', scryfallId: 'abc-123' }),
			]);

			await vi.advanceTimersByTimeAsync(0);
			expect(mockFetch).toHaveBeenCalledTimes(1);

			// First backoff: no retry before 500ms, one at it.
			await vi.advanceTimersByTimeAsync(499);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(mockFetch).toHaveBeenCalledTimes(2);

			// Second backoff: no retry before 2000ms, one at it.
			await vi.advanceTimersByTimeAsync(1999);
			expect(mockFetch).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(mockFetch).toHaveBeenCalledTimes(3);

			const result = await request;
			expect(result.degraded).toBe(false);
			expect(result.cards.has('abc-123')).toBe(true);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('marks the result degraded when a batch exhausts its retries, and still fetches the other batches', async () => {
		vi.useFakeTimers();
		try {
			// 76 unique ids → two collection batches (75 + 1).
			const cards = Array.from({ length: 76 }, (_, index) => createCard({ name: `Card ${index}`, scryfallId: `id-${index}` }));
			mockFetch
				.mockRejectedValueOnce(new Error('scryfall 503'))
				.mockRejectedValueOnce(new Error('scryfall 503'))
				.mockRejectedValueOnce(new Error('scryfall 503'))
				.mockResolvedValueOnce({ data: [{ id: 'id-75', name: 'Card 75' }] });

			const batch = useScryfallBatch();
			const request = batch.fetchScryfallCards(cards);

			await vi.advanceTimersByTimeAsync(500);
			await vi.advanceTimersByTimeAsync(2000);
			const result = await request;

			expect(mockFetch).toHaveBeenCalledTimes(4);
			expect(result.degraded).toBe(true);
			expect(result.cards.has('id-75')).toBe(true);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('does not retry or degrade on a fuzzy-search 404: the card genuinely does not exist', async () => {
		mockFetch.mockRejectedValueOnce({ statusCode: 404 });

		const batch = useScryfallBatch();
		const result = await batch.fetchScryfallCards([
			createCard({ name: 'Not A Card', scryfallId: undefined }),
		]);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(result.degraded).toBe(false);
		expect(result.cards.size).toBe(0);
	});

	it('marks the result degraded when a fuzzy lookup exhausts retries on a transient failure', async () => {
		vi.useFakeTimers();
		try {
			mockFetch.mockRejectedValue(new Error('network down'));

			const batch = useScryfallBatch();
			const request = batch.fetchScryfallCards([
				createCard({ name: 'Counterspell', scryfallId: undefined }),
			]);

			await vi.advanceTimersByTimeAsync(500);
			await vi.advanceTimersByTimeAsync(2000);
			const result = await request;

			expect(mockFetch).toHaveBeenCalledTimes(3);
			expect(result.degraded).toBe(true);
		}
		finally {
			vi.useRealTimers();
		}
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
