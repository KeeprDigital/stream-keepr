import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatch } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

const mockOnChannel = vi.fn<(
	channel: string,
	type: string,
	handler: (message: { eventId: number; player: Record<string, unknown> }) => void,
) => () => void>(() => vi.fn());
const mockRealtime = { connectionState: 'connected', onChannel: mockOnChannel };

/** What the server holds for each Player, and the deck it answers for a selection. */
const serverPlayers = new Map<number, Record<string, unknown>>();
const mockReadDeck = vi.fn();
/** The Screen Output Player read: the Player with their deck collection. */
const mockPlayerDecks = vi.fn(async (playerId: number, selection: { deckId?: number } = {}) => {
	const player = serverPlayers.get(playerId) ?? rosterPlayer(playerId);
	const deck = await mockReadDeck(playerId, selection);
	return {
		player,
		decks: {
			decks: deck
				? [deck]
				: [],
			selectedDeckId: deck?.id ?? null,
		},
	};
});
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();

const mockEventId = ref<number | null>(1);
const mockCardDataHealth = ref<'complete' | 'degraded'>('complete');

mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useScreenOutputReads', () => () => ({ playerDecks: mockPlayerDecks }));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));
const reconnectResyncCallbacks: Array<() => void> = [];
const firstAttachCallbacks: Array<() => void> = [];
mockNuxtImport('useReconnectResync', () => (resync: () => void, _eventId: unknown, _realtime: unknown, options: { onFirstAttach?: () => void } = {}) => {
	reconnectResyncCallbacks.push(resync);
	if (options.onFirstAttach)
		firstAttachCallbacks.push(options.onFirstAttach);
	return {
		disconnected: ref(false),
	};
});
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref(null),
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
	overlayContainer: ref(null),
	cardDataHealth: mockCardDataHealth,
}));

/** The server commits an edit to a Player and announces it on the Event channel. */
function announcePlayerUpdated(player: Record<string, unknown>) {
	serverPlayers.set(player.id as number, player);
	const call = mockOnChannel.mock.calls.find(([, type]) => type === 'player:updated');
	call?.[2]({ eventId: 1, player });
}

/** Another browser resolved an unresolved deck card; no Player revision moves (#648). */
function announceCardsResolved(playerIds: number[]) {
	const call = mockOnChannel.mock.calls.find(([, type]) => type === 'playerDeck:cardsResolved');
	call?.[2]({
		eventId: 1,
		deckIds: playerIds.map(id => id * 10),
		playerIds,
	} as never);
}

function deckListItem(playerSide: 'player1' | 'player2', id = `deck-${playerSide}`) {
	return { id, type: 'deck-list' as const, playerSide };
}

function groupItem(children: Array<Record<string, unknown>>) {
	return { id: 'group-1', type: 'group' as const, children };
}

function overlayConfig(items: Array<Record<string, unknown>>): FeatureMatchOverlayModeConfig {
	return {
		layout: {
			composition: { id: 'composition', name: 'Feature Match Layout', items },
		},
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
		mtgCard: imageUrl === null
			? null
			: {
					imageData: {
						front: { normal: imageUrl },
					},
				},
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
		reconnectResyncCallbacks.length = 0;
		firstAttachCallbacks.length = 0;
		mockEventId.value = 1;
		mockCardDataHealth.value = 'complete';
		serverPlayers.clear();
		config.value = overlayConfig([]);
		match.value = null;
		mockReadDeck.mockResolvedValue(deckResponse([
			sideboardCard('Duress'),
		]));
		mockFetchScryfallCards.mockResolvedValue({
			cards: new Map(),
			degraded: false,
		});
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });
	});

	afterEach(() => {
		activeScopes.splice(0).forEach(scope => scope.stop());
	});

	it('fetches nothing while the composition holds no deck-list item', async () => {
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockPlayerDecks).not.toHaveBeenCalled();
		expect(mockFetchScryfallCards).not.toHaveBeenCalled();
		expect(sideboards.value).toEqual({ player1: null, player2: null });
	});

	it('resolves an authored side"s sideboard, keeping null, [], and missing art distinct', async () => {
		// One authored `deck-list` item is the whole fetch condition — the composable
		// never reads `sideboardRevealed`, so a hidden-but-authored item keeps the
		// cache warm and a reveal never cold-fetches Scryfall on air.
		mockReadDeck.mockImplementation(async (playerId: number) =>
			playerId === 5
				? deckResponse([
						sideboardCard('Duress'),
						sideboardCard('Counterspell', { compartment: 'mainboard' }),
						sideboardCard('Obscure Card'),
					])
				: deckResponse([
						sideboardCard('Anything'),
					]));
		mockFetchScryfallCards.mockResolvedValue({
			cards: new Map(),
			degraded: false,
		});
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [],
			sideboard: [
				enrichedCard('Duress', 'https://img.test/duress.jpg'),
				// No art resolved: the card still counts, with a null image.
				enrichedCard('Obscure Card', null),
			],
		});
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		// Only the authored side fetched: player 2 has no item and no fetch.
		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);
		expect(mockPlayerDecks.mock.calls[0]![0]).toBe(5);
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
		mockReadDeck.mockImplementation(async (playerId: number) =>
			playerId === 5
				? deckResponse([
						sideboardCard('Counterspell', { compartment: 'mainboard' }),
					])
				// Player 6 has no deck the read can answer.
				: null);
		config.value = overlayConfig([
			deckListItem('player1'),
			deckListItem('player2'),
		]);
		match.value = slotMatch();

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockFetchScryfallCards).not.toHaveBeenCalled();
		expect(sideboards.value).toEqual({ player1: [], player2: null });
	});

	it('finds a deck-list item authored inside a Graphic Group', async () => {
		config.value = overlayConfig([
			groupItem([
				deckListItem('player2'),
			]),
		]);
		match.value = slotMatch();

		mountSideboardData();
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);
		expect(mockPlayerDecks.mock.calls[0]![0]).toBe(6);
	});

	it('pins the session snapshot"s deckId first, matched by player across a swap', async () => {
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch({
			activeSession: {
				sourceSnapshot: {
					// The session was swapped: the Slot's player 5 sits on the
					// snapshot's player2 side. The deck pin belongs to the player.
					player1: {
						playerId: 6,
						data: { deckId: 40 },
					},
					player2: {
						playerId: 5,
						data: { deckId: 30 },
					},
				},
			},
		});

		mountSideboardData();
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledWith(5, { deckId: 30 });
	});

	it('falls back to the collection"s own ladder when the pinned deck is gone', async () => {
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch({
			activeSession: {
				sourceSnapshot: {
					player1: {
						playerId: 5,
						data: { deckId: 999 },
					},
					player2: { playerId: null, data: null },
				},
			},
		});
		// The collection no longer holds deck 999; it answers its own selection.
		mockReadDeck.mockResolvedValue(deckResponse([
			sideboardCard('Duress'),
		], { id: 10 }));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [],
			sideboard: [
				enrichedCard('Duress', 'https://img.test/duress.jpg'),
			],
		});

		const { sideboards } = mountSideboardData();
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);
		expect(mockPlayerDecks).toHaveBeenCalledWith(5, { deckId: 999 });
		expect(sideboards.value.player1).toEqual([
			{ name: 'Duress', quantity: 2, imageUrl: 'https://img.test/duress.jpg' },
		]);
	});

	it('re-fetches when a player:updated announces a revision other than the one on screen', async () => {
		// Live-follow: the announcement rolls `updatedAt` past the displayed
		// stamp, and the refreshed deck flows through the ordinary load.
		serverPlayers.set(5, rosterPlayer(5, '2026-08-21T00:00:00.000Z'));
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();

		mountSideboardData();
		await flushPromises();
		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);

		// The revision on screen, and a Player on neither side, are not news.
		announcePlayerUpdated(rosterPlayer(5, '2026-08-21T00:00:00.000Z'));
		announcePlayerUpdated(rosterPlayer(9, '2026-08-21T01:00:00.000Z'));
		await flushPromises();
		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);

		announcePlayerUpdated(rosterPlayer(5, '2026-08-21T01:00:00.000Z'));
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
	});

	it('shows an edit announced while the first read is in flight, which that read missed', async () => {
		serverPlayers.set(5, rosterPlayer(5, '2026-08-21T00:00:00.000Z'));
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();
		// The first read is served before the edit and delivered after it.
		let releaseFirstRead!: () => void;
		mockReadDeck.mockImplementationOnce(() => new Promise((resolve) => {
			releaseFirstRead = () => resolve(deckResponse([
				sideboardCard('Duress'),
			]));
		}));
		mockReadDeck.mockResolvedValue(deckResponse([
			sideboardCard('Negate'),
		]));
		mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
			mainboard: [],
			sideboard: cards.map(card => enrichedCard(card.name, `https://img.test/${card.name}.jpg`)),
		}));

		const { sideboards } = mountSideboardData();
		await flushPromises();
		announcePlayerUpdated(rosterPlayer(5, '2026-08-21T01:00:00.000Z'));
		await flushPromises();
		releaseFirstRead();
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
		expect(sideboards.value.player1).toEqual([
			{ name: 'Negate', quantity: 2, imageUrl: 'https://img.test/Negate.jpg' },
		]);
	});

	describe('a resolved deck card, which moves no Player revision (#648)', () => {
		beforeEach(() => {
			mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
				mainboard: [],
				sideboard: cards.map(card => enrichedCard(card.name, `https://img.test/${card.name}.jpg`)),
			}));
		});

		it('re-reads a side whose Player\'s Deck Lists were rewritten, and not for another Player', async () => {
			config.value = overlayConfig([
				deckListItem('player1'),
			]);
			match.value = slotMatch();
			const { sideboards } = mountSideboardData();
			await flushPromises();
			expect(sideboards.value.player1).toEqual([
				{ name: 'Duress', quantity: 2, imageUrl: 'https://img.test/Duress.jpg' },
			]);

			mockReadDeck.mockResolvedValue(deckResponse([
				sideboardCard('Negate'),
			]));
			announceCardsResolved([9]);
			await flushPromises();
			expect(mockPlayerDecks).toHaveBeenCalledTimes(1);

			announceCardsResolved([5, 9]);
			await flushPromises();

			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
			expect(sideboards.value.player1).toEqual([
				{ name: 'Negate', quantity: 2, imageUrl: 'https://img.test/Negate.jpg' },
			]);
		});

		it('swaps in the rewritten sideboard even while its card data is still degraded', async () => {
			mockFetchScryfallCards.mockResolvedValue({
				cards: new Map(),
				degraded: true,
			});
			config.value = overlayConfig([
				deckListItem('player1'),
			]);
			match.value = slotMatch();
			const { sideboards } = mountSideboardData();
			await flushPromises();

			mockReadDeck.mockResolvedValue(deckResponse([
				sideboardCard('Negate'),
			]));
			announceCardsResolved([5]);
			await flushPromises();

			expect(sideboards.value.player1).toEqual([
				{ name: 'Negate', quantity: 2, imageUrl: 'https://img.test/Negate.jpg' },
			]);
		});
	});

	it('re-fetches degraded card data on the shared cadence and reports health both ways', async () => {
		vi.useFakeTimers();
		try {
			config.value = overlayConfig([
				deckListItem('player1'),
			]);
			match.value = slotMatch();
			mockFetchScryfallCards
				.mockResolvedValueOnce({
					cards: new Map(),
					degraded: true,
				})
				.mockResolvedValue({
					cards: new Map(),
					degraded: false,
				});
			mockBuildDeckListArrays.mockReturnValue({
				mainboard: [],
				sideboard: [
					enrichedCard('Duress', null),
				],
			});

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
			config.value = overlayConfig([
				deckListItem('player1'),
			]);
			match.value = slotMatch();
			mockFetchScryfallCards
				.mockRejectedValueOnce(new Error('network down'))
				.mockResolvedValue({
					cards: new Map(),
					degraded: false,
				});
			mockBuildDeckListArrays.mockReturnValue({
				mainboard: [],
				sideboard: [
					enrichedCard('Duress', null),
				],
			});
			// The first load's Scryfall batch reports degraded; nothing throws there.
			mockFetchScryfallCards.mockReset();
			mockFetchScryfallCards
				.mockResolvedValueOnce({
					cards: new Map(),
					degraded: true,
				})
				.mockRejectedValueOnce(new Error('network down'))
				.mockResolvedValue({
					cards: new Map(),
					degraded: false,
				});

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
			config.value = overlayConfig([
				deckListItem('player1'),
			]);
			match.value = slotMatch();
			mockFetchScryfallCards.mockResolvedValue({
				cards: new Map(),
				degraded: true,
			});
			mockBuildDeckListArrays.mockReturnValue({
				mainboard: [],
				sideboard: [
					enrichedCard('Duress', null),
				],
			});

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

	it('re-reads its sides on reconnect while a side is authored, and only then', async () => {
		// Nothing arrives late after a suspended connection (#307): the missed
		// `player:updated` is gone, so coming back re-reads through the Screen.
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();

		mountSideboardData();
		await flushPromises();
		expect(reconnectResyncCallbacks).toHaveLength(1);
		expect(mockPlayerDecks).toHaveBeenCalledTimes(1);

		reconnectResyncCallbacks[0]!();
		await flushPromises();
		expect(mockPlayerDecks).toHaveBeenCalledTimes(2);

		// No authored item, no fetch — reconnects included.
		config.value = overlayConfig([]);
		await flushPromises();
		mockPlayerDecks.mockClear();
		reconnectResyncCallbacks[0]!();
		await flushPromises();
		expect(mockPlayerDecks).not.toHaveBeenCalled();
	});

	it('shows an edit published between its first read and its Event channel\'s first attach (#733)', async () => {
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();
		const { sideboards } = mountSideboardData();
		await flushPromises();
		expect(firstAttachCallbacks).toHaveLength(1);

		// Published while nothing listened on the channel, so never heard.
		mockReadDeck.mockResolvedValue(deckResponse([
			sideboardCard('Negate'),
		]));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [],
			sideboard: [
				enrichedCard('Negate', null),
			],
		});
		firstAttachCallbacks[0]!();
		await flushPromises();

		expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
		expect(sideboards.value.player1?.map(card => card.name)).toEqual(['Negate']);
	});

	it('clears a standing degraded report on teardown', async () => {
		config.value = overlayConfig([
			deckListItem('player1'),
		]);
		match.value = slotMatch();
		mockFetchScryfallCards.mockResolvedValue({
			cards: new Map(),
			degraded: true,
		});
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [],
			sideboard: [
				enrichedCard('Duress', null),
			],
		});

		mountSideboardData();
		await flushPromises();
		expect(mockCardDataHealth.value).toBe('degraded');

		activeScopes.splice(0).forEach(scope => scope.stop());
		expect(mockCardDataHealth.value).toBe('complete');
	});
});
