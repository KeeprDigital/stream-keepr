import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test', modeConfigs: { deck: {} } }),
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
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
	beforeEach(() => {
		vi.clearAllMocks();
		MockImage.loadedUrls = [];
		mockPlayerId.value = null;
		mockEventId.value = 1;
		mockFetchDeck.mockResolvedValue(createDeckResponse([]));
		mockFetchScryfallCards.mockResolvedValue(new Map());
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });
	});

	it('returns expected properties for staged deck swaps', () => {
		const result = useDeckModeData();
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
		const { playerName, deckName, mainboard, sideboard, loading, hasDisplayedDeck } = useDeckModeData();
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
		const { playerName, deckName, deckColors, hasDisplayedDeck, displayedDeckVersion } = useDeckModeData();

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
		const result = useDeckModeData();
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
		const result = useDeckModeData();
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
		const result = useDeckModeData();
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
