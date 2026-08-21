import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

const mockPlayerStore = {
	getPlayerById: vi.fn(),
};

const mockFetchDeck = vi.fn();
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();

const mockPlayerId = ref<number | null>(null);
const mockEventId = ref<number | null>(1);

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckCache', () => () => ({ fetchDeck: mockFetchDeck }));
const mockCardDataHealth = ref<'complete' | 'degraded'>('complete');

mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test', modeConfigs: { deck: {} } }),
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
	cardDataHealth: mockCardDataHealth,
}));
mockNuxtImport('useScreenModeConfig', () => (_mode: string) => computed(() => ({ playerId: mockPlayerId.value })));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));

class MockImage {
	static loadedUrls: string[] = [];
	complete = false;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	#src = '';

	set src(value: string) {
		this.#src = value;
		MockImage.loadedUrls.push(value);
		this.complete = true;
		queueMicrotask(() => this.onload?.());
	}

	get src() {
		return this.#src;
	}

	decode() {
		return Promise.resolve();
	}
}

vi.stubGlobal('Image', MockImage);

function createDeckResponse(
	cards: Array<Record<string, unknown>>,
	metadata: { id?: number; name?: string; colors?: string } = {},
) {
	return {
		id: metadata.id ?? 10,
		externalId: `deck-${metadata.id ?? 10}`,
		formatExternalId: 'modern',
		phaseIds: [1],
		phaseName: 'Swiss',
		name: metadata.name ?? 'Azorius Control',
		colors: metadata.colors ?? 'WU',
		sortOrder: 0,
		isPrimary: true,
		cards,
		companion: null,
		highlander: null,
	};
}

function createDeckCard(overrides: Record<string, unknown> = {}) {
	return {
		name: 'Counterspell',
		scryfallId: 'card-1',
		cardType: 'Instant',
		quantity: 4,
		compartment: 'mainboard',
		...overrides,
	};
}

function createEnrichedCard(name: string, imageUrl: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		quantity: 1,
		compartment: 'mainboard',
		cardType: 'Instant',
		scryfallId: imageUrl,
		highlanderPoints: null,
		mtgCard: {
			imageData: {
				front: {
					normal: imageUrl,
				},
			},
		},
		...overrides,
	};
}

describe('useDeckModeData', () => {
	// Each instance registers watchers on the shared mocked refs; a stopped scope
	// keeps earlier tests' instances from reacting to later tests' ref writes.
	const activeScopes: Array<ReturnType<typeof effectScope>> = [];

	function mountDeckModeData() {
		const scope = effectScope();
		activeScopes.push(scope);
		return scope.run(() => useDeckModeData())!;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		MockImage.loadedUrls = [];
		mockPlayerId.value = null;
		mockEventId.value = 1;
		mockCardDataHealth.value = 'complete';
		mockFetchDeck.mockResolvedValue(createDeckResponse([]));
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: false });
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });
	});

	afterEach(() => {
		activeScopes.splice(0).forEach(scope => scope.stop());
	});

	it('returns expected properties for staged deck swaps', () => {
		const result = mountDeckModeData();
		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('playerName');
		expect(result).toHaveProperty('deckName');
		expect(result).toHaveProperty('deckColors');
		expect(result).toHaveProperty('deckStats');
		expect(result).toHaveProperty('mainboard');
		expect(result).toHaveProperty('sideboard');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
		expect(result).toHaveProperty('hasDisplayedDeck');
		expect(result).toHaveProperty('displayedDeckVersion');
		expect(result).toHaveProperty('pendingSwapVersion');
		expect(result).toHaveProperty('commitPendingDeck');
	});

	it('starts blank with no loading state when no player is selected', () => {
		const { playerName, deckName, mainboard, sideboard, loading, hasDisplayedDeck } = mountDeckModeData();
		expect(playerName.value).toBe('');
		expect(deckName.value).toBe('');
		expect(mainboard.value).toEqual([]);
		expect(sideboard.value).toEqual([]);
		expect(loading.value).toBe(false);
		expect(hasDisplayedDeck.value).toBe(false);
	});

	it('loads the initial deck immediately and preloads its images', async () => {
		mockPlayerStore.getPlayerById.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard({ quantity: 4 })]));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [createEnrichedCard('Counterspell', 'https://img.test/counterspell.jpg', { quantity: 4 })],
			sideboard: [],
		});

		mockPlayerId.value = 5;
		const { playerName, deckName, deckColors, hasDisplayedDeck, displayedDeckVersion } = mountDeckModeData();

		await flushPromises();

		expect(playerName.value).toBe('Alice');
		expect(deckName.value).toBe('Azorius Control');
		expect(deckColors.value).toBe('WU');
		expect(hasDisplayedDeck.value).toBe(true);
		expect(displayedDeckVersion.value).toBe(1);
		expect(MockImage.loadedUrls).toContain('https://img.test/counterspell.jpg');
	});

	it('keeps the current deck visible until the pending deck is committed', async () => {
		mockPlayerStore.getPlayerById.mockImplementation(async (_eventId: number, playerId: number) => {
			if (playerId === 1) {
				return { id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: 'Deck A', deckColors: 'U' } };
			}
			return { id: 2, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } };
		});
		mockFetchDeck.mockImplementation(async (playerId: number) => {
			return playerId === 1
				? createDeckResponse([createDeckCard({ name: 'Card A' })], { id: 10, name: 'Deck A', colors: 'U' })
				: createDeckResponse([createDeckCard({ name: 'Card B', scryfallId: 'card-2' })], { id: 20, name: 'Deck B', colors: 'R' });
		});
		mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
			mainboard: [createEnrichedCard(cards[0]!.name, `https://img.test/${cards[0]!.name}.jpg`)],
			sideboard: [],
		}));

		mockPlayerId.value = 1;
		const result = mountDeckModeData();
		await flushPromises();

		expect(result.playerName.value).toBe('Alice');
		expect(result.displayedDeckVersion.value).toBe(1);

		mockPlayerId.value = 2;
		await flushPromises();

		expect(result.playerName.value).toBe('Alice');
		expect(result.pendingSwapVersion.value).toBe(1);

		result.commitPendingDeck();
		await nextTick();

		expect(result.playerName.value).toBe('Bob');
		expect(result.displayedDeckVersion.value).toBe(2);
	});

	it('ignores stale async requests when the selected deck changes rapidly', async () => {
		interface BobPlayer { id: number; name: string; gameData: { type: string; deckName: string; deckColors: string } }
		const bobResolver: { resolve: ((value: BobPlayer) => void) | null } = { resolve: null };
		mockPlayerStore.getPlayerById.mockImplementation((_eventId: number, playerId: number) => {
			if (playerId === 1) {
				return Promise.resolve({ id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: 'Deck A', deckColors: 'U' } });
			}
			if (playerId === 2) {
				return new Promise<BobPlayer>((resolve) => {
					bobResolver.resolve = resolve;
				});
			}
			return Promise.resolve({ id: 3, name: 'Carol', gameData: { type: 'mtg', deckName: 'Deck C', deckColors: 'G' } });
		});
		mockFetchDeck.mockImplementation(async (playerId: number) => {
			if (playerId === 1)
				return createDeckResponse([createDeckCard({ name: 'Card A' })], { id: 10, name: 'Deck A', colors: 'U' });
			if (playerId === 2)
				return createDeckResponse([createDeckCard({ name: 'Card B', scryfallId: 'card-2' })], { id: 20, name: 'Deck B', colors: 'R' });
			return createDeckResponse([createDeckCard({ name: 'Card C', scryfallId: 'card-3' })], { id: 30, name: 'Deck C', colors: 'G' });
		});
		mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
			mainboard: [createEnrichedCard(cards[0]!.name, `https://img.test/${cards[0]!.name}.jpg`)],
			sideboard: [],
		}));

		mockPlayerId.value = 1;
		const result = mountDeckModeData();
		await flushPromises();

		mockPlayerId.value = 2;
		await nextTick();
		mockPlayerId.value = 3;
		await flushPromises();

		expect(result.playerName.value).toBe('Alice');
		expect(result.pendingSwapVersion.value).toBe(1);

		result.commitPendingDeck();
		await nextTick();

		expect(result.playerName.value).toBe('Carol');

		if (bobResolver.resolve) {
			bobResolver.resolve({ id: 2, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } });
		}
		await flushPromises();

		expect(result.playerName.value).toBe('Carol');
		expect(result.deckName.value).toBe('Deck C');
	});

	it('keeps a degraded deck on program and exposes the degradation instead of an error', async () => {
		mockPlayerStore.getPlayerById.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [{ ...createEnrichedCard('Counterspell', ''), mtgCard: null }],
			sideboard: [],
		});

		mockPlayerId.value = 5;
		const result = mountDeckModeData();
		await flushPromises();

		expect(result.hasDisplayedDeck.value).toBe(true);
		expect(result.error.value).toBeNull();
		expect(result.cardDataDegraded.value).toBe(true);
	});

	it('re-fetches degraded card data without a reload and recovers when Scryfall answers', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			expect(result.cardDataDegraded.value).toBe(true);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(1);

			// One minute later the output re-fetches by itself — no reload, no operator action.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.cardDataDegraded.value).toBe(false);

			// The recovered deck arrives through the ordinary staged swap.
			expect(result.pendingSwapVersion.value).toBe(1);

			// Recovered: nothing left to re-fetch.
			await vi.advanceTimersByTimeAsync(120_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('reports card data health through the screen context, and settles it on teardown', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(mockCardDataHealth.value).toBe('degraded');

			// Recovery reports itself the same way.
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: false });
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockCardDataHealth.value).toBe('complete');

			// A degraded surface that goes away must not leave its report standing.
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockPlayerId.value = 6;
			await vi.advanceTimersByTimeAsync(0);
			expect(mockCardDataHealth.value).toBe('degraded');
			activeScopes.splice(0).forEach(scope => scope.stop());
			expect(mockCardDataHealth.value).toBe('complete');
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('stops re-fetching and clears the degradation when the player selection is cleared', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.cardDataDegraded.value).toBe(true);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(1);

			mockPlayerId.value = null;
			await vi.advanceTimersByTimeAsync(0);
			expect(result.cardDataDegraded.value).toBe(false);

			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(1);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('keeps program untouched while a re-fetch is still degraded, and keeps retrying', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.hasDisplayedDeck.value).toBe(true);

			// A still-degraded re-fetch has nothing better to show: no staged swap,
			// so program does not cross-fade to an identical placeholder deck.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.pendingSwapVersion.value).toBe(0);

			// And the cadence continues until Scryfall answers.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(3);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('keeps the recovery cadence alive when a re-fetch itself fails mid-outage', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.cardDataDegraded.value).toBe(true);

			// The same outage takes down the deck endpoint for one cadence tick.
			mockFetchDeck.mockRejectedValueOnce(new Error('network down'));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(true);

			// A failed re-fetch must not end the cadence: the next tick recovers.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(false);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('swaps in a still-degraded rebuild when the deck itself changed during the outage', async () => {
		vi.useFakeTimers();
		try {
			let updatedAt = '2026-08-21T00:00:00.000Z';
			mockPlayerStore.getPlayerById.mockImplementation(async () => ({
				id: 5,
				name: 'Alice',
				updatedAt,
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			}));
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.hasDisplayedDeck.value).toBe(true);

			// Unchanged deck: the still-degraded rebuild is suppressed.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.pendingSwapVersion.value).toBe(0);

			// The operator edits the deck mid-outage: the rebuild carries new cards
			// and must reach program even though its card data is still degraded.
			updatedAt = '2026-08-21T01:00:00.000Z';
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.pendingSwapVersion.value).toBe(1);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('cancels a degraded re-fetch when the operator selects another player, so the stale deck cannot come back', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.getPlayerById.mockImplementation(async (_eventId: number, playerId: number) =>
				playerId === 5
					? { id: 5, name: 'Alice', gameData: { type: 'mtg', deckName: 'Deck A', deckColors: 'U' } }
					: { id: 6, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } });
			mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.cardDataDegraded.value).toBe(true);

			mockPlayerId.value = 6;
			await vi.advanceTimersByTimeAsync(0);
			result.commitPendingDeck();
			expect(result.playerName.value).toBe('Bob');
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);

			// The degraded player-5 re-fetch must not fire and drag Alice back on program.
			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.playerName.value).toBe('Bob');
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('clears to blank when playerId becomes null', async () => {
		mockPlayerStore.getPlayerById.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockFetchDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [createEnrichedCard('Counterspell', 'https://img.test/counterspell.jpg')],
			sideboard: [],
		});

		mockPlayerId.value = 5;
		const result = mountDeckModeData();
		await flushPromises();

		mockPlayerId.value = null;
		await flushPromises();

		expect(result.playerName.value).toBe('Alice');

		result.commitPendingDeck();
		await nextTick();

		expect(result.playerName.value).toBe('');
		expect(result.hasDisplayedDeck.value).toBe(false);
	});
});
