import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatch } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';

const mockPlayerStore = reactive({
	players: [] as Array<Record<string, unknown>>,
	isLoaded: false,
	loadPlayersByEventId: vi.fn(),
	getPlayerById: vi.fn(),
});

const mockFetchDeck = vi.fn();
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();

const mockEventId = ref<number | null>(1);
const mockCardDataHealth = ref<'complete' | 'degraded'>('complete');

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckCache', () => () => ({ fetchDeck: mockFetchDeck }));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref(null),
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
	overlayContainer: ref(null),
	cardDataHealth: mockCardDataHealth,
}));

function deckListItem(playerSide: 'player1' | 'player2', id = `deck-${playerSide}`) {
	return { id, type: 'deck-list' as const, playerSide };
}

function groupItem(children: Array<Record<string, unknown>>) {
	return { id: 'group-1', type: 'group' as const, children };
}

function overlayConfig(items: Array<Record<string, unknown>>): FeatureMatchOverlayModeConfig {
	return {
		layout: { composition: { id: 'composition', name: 'Feature Match Layout', items } },
	} as unknown as FeatureMatchOverlayModeConfig;
}

function slotMatch(overrides: Record<string, unknown> = {}): FeatureMatch {
	return {
		id: 7,
		player1Id: 5,
		player2Id: 6,
		activeSession: null,
		...overrides,
	} as unknown as FeatureMatch;
}

function rosterPlayer(id: number, updatedAt = '2026-08-21T00:00:00.000Z') {
	return { id, name: `Player ${id}`, updatedAt };
}

function deckResponse(
	cards: Array<Record<string, unknown>>,
	metadata: { id?: number } = {},
) {
	return {
		id: metadata.id ?? 10,
		name: 'Azorius Control',
		colors: 'WU',
		isPrimary: true,
		cards,
	};
}

function sideboardCard(name: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		scryfallId: `scryfall-${name}`,
		cardType: 'Instant',
		quantity: 2,
		compartment: 'sideboard',
		...overrides,
	};
}

function enrichedCard(name: string, imageUrl: string | null, overrides: Record<string, unknown> = {}) {
	return {
		name,
		quantity: 2,
		compartment: 'sideboard',
		cardType: 'Instant',
		scryfallId: `scryfall-${name}`,
		mtgCard: imageUrl === null ? null : { imageData: { front: { normal: imageUrl } } },
		...overrides,
	};
}

describe('useFeatureMatchOverlaySideboardData', () => {
	// Each instance registers watchers on the shared mocked refs; a stopped scope
	// keeps earlier tests' instances from reacting to later tests' ref writes.
	const activeScopes: Array<ReturnType<typeof effectScope>> = [];

	const config = ref(overlayConfig([]));
	const match = ref<FeatureMatch | null>(null);

	function mountSideboardData() {
		const scope = effectScope();
		activeScopes.push(scope);
		return scope.run(() => useFeatureMatchOverlaySideboardData(config, match))!;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockEventId.value = 1;
		mockCardDataHealth.value = 'complete';
		mockPlayerStore.players = [];
		mockPlayerStore.isLoaded = false;
		mockPlayerStore.loadPlayersByEventId.mockImplementation(async () => {
			mockPlayerStore.isLoaded = true;
		});
		mockPlayerStore.getPlayerById.mockResolvedValue(null);
		config.value = overlayConfig([]);
		match.value = null;
		mockFetchDeck.mockResolvedValue(deckResponse([sideboardCard('Duress')]));
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: false });
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });
	});

	afterEach(() => {
		activeScopes.splice(0).forEach(scope => scope.stop());
	});

	it('fetches nothing while the composition holds no deck-list item', async () => {
		mockPlayerStore.players = [rosterPlayer(5), rosterPlayer(6)];
		mockPlayerStore.isLoaded = true;
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockFetchDeck).not.toHaveBeenCalled();
		expect(mockFetchScryfallCards).not.toHaveBeenCalled();
		expect(sideboards.value).toEqual({ player1: null, player2: null });
	});

	it('resolves an authored side"s sideboard, keeping null, [], and missing art distinct', async () => {
		// One authored `deck-list` item is the whole fetch condition — the composable
		// never reads `sideboardRevealed`, so a hidden-but-authored item keeps the
		// cache warm and a reveal never cold-fetches Scryfall on air.
		mockPlayerStore.players = [rosterPlayer(5), rosterPlayer(6)];
		mockPlayerStore.isLoaded = true;
		mockFetchDeck.mockImplementation(async (playerId: number) =>
			playerId === 5
				? deckResponse([
						sideboardCard('Duress'),
						sideboardCard('Counterspell', { compartment: 'mainboard' }),
						sideboardCard('Obscure Card'),
					])
				: deckResponse([sideboardCard('Anything')]));
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: false });
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [],
			sideboard: [
				enrichedCard('Duress', 'https://img.test/duress.jpg'),
				// No art resolved: the card still counts, with a null image.
				enrichedCard('Obscure Card', null),
			],
		});
		config.value = overlayConfig([deckListItem('player1')]);
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		// Only the authored side fetched: player 2 has no item and no fetch.
		expect(mockFetchDeck).toHaveBeenCalledTimes(1);
		expect(mockFetchDeck.mock.calls[0]![0]).toBe(5);
		// Only the sideboard compartment reaches Scryfall.
		expect(mockFetchScryfallCards).toHaveBeenCalledWith([
			{ name: 'Duress', scryfallId: 'scryfall-Duress' },
			{ name: 'Obscure Card', scryfallId: 'scryfall-Obscure Card' },
		]);
		expect(sideboards.value).toEqual({
			player1: [
				{ name: 'Duress', quantity: 2, imageUrl: 'https://img.test/duress.jpg' },
				{ name: 'Obscure Card', quantity: 2, imageUrl: null },
			],
			player2: null,
		});
	});

	it('reports an empty sideboard as [] and an unresolved deck as null, without touching Scryfall', async () => {
		mockPlayerStore.players = [rosterPlayer(5), rosterPlayer(6)];
		mockPlayerStore.isLoaded = true;
		mockFetchDeck.mockImplementation(async (playerId: number) =>
			playerId === 5
				? deckResponse([sideboardCard('Counterspell', { compartment: 'mainboard' })])
				// Player 6's deck fetch resolved nothing: endpoint failure and a
				// missing deck both read as null from the cache.
				: null);
		config.value = overlayConfig([deckListItem('player1'), deckListItem('player2')]);
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockFetchScryfallCards).not.toHaveBeenCalled();
		expect(sideboards.value).toEqual({ player1: [], player2: null });
	});

	it('finds a deck-list item authored inside a Graphic Group', async () => {
		mockPlayerStore.players = [rosterPlayer(6)];
		mockPlayerStore.isLoaded = true;
		config.value = overlayConfig([groupItem([deckListItem('player2')])]);
		match.value = slotMatch();

		mountSideboardData();
		await flushPromises();

		expect(mockFetchDeck).toHaveBeenCalledTimes(1);
		expect(mockFetchDeck.mock.calls[0]![0]).toBe(6);
	});

	it('pins the session snapshot"s deckId first, matched by player across a swap', async () => {
		mockPlayerStore.players = [rosterPlayer(5, '2026-08-21T00:00:00.000Z')];
		mockPlayerStore.isLoaded = true;
		config.value = overlayConfig([deckListItem('player1')]);
		match.value = slotMatch({
			activeSession: {
				sourceSnapshot: {
					// The session was swapped: the Slot's player 5 sits on the
					// snapshot's player2 side. The deck pin belongs to the player.
					player1: { playerId: 6, data: { deckId: 40 } },
					player2: { playerId: 5, data: { deckId: 30 } },
				},
			},
		});

		mountSideboardData();
		await flushPromises();

		expect(mockFetchDeck).toHaveBeenCalledWith(5, 1, '2026-08-21T00:00:00.000Z', { deckId: 30 });
	});

	it('falls back to the cache"s own ladder when the pinned deck is gone', async () => {
		mockPlayerStore.players = [rosterPlayer(5)];
		mockPlayerStore.isLoaded = true;
		config.value = overlayConfig([deckListItem('player1')]);
		match.value = slotMatch({
			activeSession: { sourceSnapshot: { player1: { playerId: 5, data: { deckId: 999 } }, player2: { playerId: null, data: null } } },
		});
		mockFetchDeck.mockImplementation(async (_playerId: number, _eventId: number, _updatedAt: string, selection?: { deckId?: number }) =>
			selection?.deckId != null ? null : deckResponse([sideboardCard('Duress')], { id: 10 }));
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [enrichedCard('Duress', 'https://img.test/duress.jpg')] });

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockFetchDeck).toHaveBeenCalledTimes(2);
		expect(mockFetchDeck.mock.calls[0]![3]).toEqual({ deckId: 999 });
		expect(mockFetchDeck.mock.calls[1]![3]).toBeUndefined();
		expect(sideboards.value.player1).toEqual([{ name: 'Duress', quantity: 2, imageUrl: 'https://img.test/duress.jpg' }]);
	});

	it('re-fetches when a player:updated replaces the store-held record', async () => {
		// Live-follow: the remote update rolls `updatedAt`, which rolls the
		// deck-cache key, and the refreshed deck flows through the ordinary load.
		mockPlayerStore.players = [rosterPlayer(5, '2026-08-21T00:00:00.000Z')];
		mockPlayerStore.isLoaded = true;
		config.value = overlayConfig([deckListItem('player1')]);
		match.value = slotMatch();

		mountSideboardData();
		await flushPromises();
		expect(mockFetchDeck).toHaveBeenCalledTimes(1);

		mockPlayerStore.players = [rosterPlayer(5, '2026-08-21T01:00:00.000Z')];
		await flushPromises();

		expect(mockFetchDeck).toHaveBeenCalledTimes(2);
		expect(mockFetchDeck.mock.calls[1]![2]).toBe('2026-08-21T01:00:00.000Z');
	});

	it('re-fetches degraded card data on the shared cadence and reports health both ways', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.players = [rosterPlayer(5)];
			mockPlayerStore.isLoaded = true;
			config.value = overlayConfig([deckListItem('player1')]);
			match.value = slotMatch();
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [enrichedCard('Duress', null)] });

			const { cardDataDegraded } = mountSideboardData();
			await vi.advanceTimersByTimeAsync(0);

			expect(cardDataDegraded.value).toBe(true);
			expect(mockCardDataHealth.value).toBe('degraded');
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(1);

			// One minute later the output re-fetches by itself — no reload, no
			// operator action — and the recovery reports itself the same way.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(cardDataDegraded.value).toBe(false);
			expect(mockCardDataHealth.value).toBe('complete');

			// Recovered: nothing left to re-fetch.
			await vi.advanceTimersByTimeAsync(120_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('keeps the recovery cadence alive when a re-fetch itself fails mid-outage', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.players = [rosterPlayer(5)];
			mockPlayerStore.isLoaded = true;
			config.value = overlayConfig([deckListItem('player1')]);
			match.value = slotMatch();
			mockFetchScryfallCards
				.mockRejectedValueOnce(new Error('network down'))
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [enrichedCard('Duress', null)] });
			// The first load's Scryfall batch reports degraded; nothing throws there.
			mockFetchScryfallCards.mockReset();
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockRejectedValueOnce(new Error('network down'))
				.mockResolvedValue({ cards: new Map(), degraded: false });

			const { cardDataDegraded } = mountSideboardData();
			await vi.advanceTimersByTimeAsync(0);
			expect(cardDataDegraded.value).toBe(true);

			// The outage takes the whole load down for one cadence tick.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(cardDataDegraded.value).toBe(true);

			// A failed re-fetch must not end the cadence: the next tick recovers.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(cardDataDegraded.value).toBe(false);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('settles the degraded lifecycle when the last deck-list item is un-authored', async () => {
		vi.useFakeTimers();
		try {
			mockPlayerStore.players = [rosterPlayer(5)];
			mockPlayerStore.isLoaded = true;
			config.value = overlayConfig([deckListItem('player1')]);
			match.value = slotMatch();
			mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [enrichedCard('Duress', null)] });

			const { sideboards, cardDataDegraded } = mountSideboardData();
			await vi.advanceTimersByTimeAsync(0);
			expect(cardDataDegraded.value).toBe(true);

			config.value = overlayConfig([]);
			await vi.advanceTimersByTimeAsync(0);

			expect(cardDataDegraded.value).toBe(false);
			expect(mockCardDataHealth.value).toBe('complete');
			expect(sideboards.value).toEqual({ player1: null, player2: null });

			// And the cadence is gone with the item.
			const fetches = mockFetchScryfallCards.mock.calls.length;
			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(fetches);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('clears a standing degraded report on teardown', async () => {
		mockPlayerStore.players = [rosterPlayer(5)];
		mockPlayerStore.isLoaded = true;
		config.value = overlayConfig([deckListItem('player1')]);
		match.value = slotMatch();
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [enrichedCard('Duress', null)] });

		mountSideboardData();
		await flushPromises();
		expect(mockCardDataHealth.value).toBe('degraded');

		activeScopes.splice(0).forEach(scope => scope.stop());
		expect(mockCardDataHealth.value).toBe('complete');
	});
});
