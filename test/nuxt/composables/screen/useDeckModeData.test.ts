import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';
import { fitColumns } from '~~/shared/utils/cardGrid';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';

/** The server's two halves of the Screen Output Player read (#604). */
const mockReadPlayer = vi.fn();
const mockReadDeck = vi.fn();
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();
const mockGetSelectedBroadcastDeckList = vi.fn();
const mockOnChannel = vi.fn<(
	channel: string,
	type: string,
	handler: (message: Record<string, unknown>) => void,
) => () => void>(() => vi.fn());

const mockPlayerId = ref<number | null>(null);
const mockBroadcastDeckListId = ref<number | null>(null);
const mockEventId = ref<number | null>(1);
const mockPlayerDecks = vi.fn(async (playerId: number) => {
	const player = await mockReadPlayer(mockEventId.value, playerId);
	if (!player)
		throw Object.assign(new Error('Not found'), { statusCode: 404 });
	const deck = await mockReadDeck(playerId, mockEventId.value, player.updatedAt);
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
const mockScreen = ref({
	id: 1,
	name: 'Test',
	modeConfigs: { deck: {} },
});
const mockAssetCapability = ref<string | null>('output-capability');
const mockCardDataHealth = ref<'complete' | 'degraded'>('complete');
const continuity = createContinuitySignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	onChannel: mockOnChannel,
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
});

mockNuxtImport('useScreenOutputReads', () => () => ({
	scope: computed(() => mockEventId.value
		? { eventId: mockEventId.value, screenId: mockScreen.value.id }
		: null),
	scopeKey: computed(() => mockEventId.value
		? `${mockEventId.value}:${mockScreen.value.id}`
		: null),
	playerDecks: mockPlayerDecks,
	cardData: mockFetchScryfallCards,
}));
mockNuxtImport('useScreenOutputBroadcastDeckListRepository', () => () => ({
	getSelected: mockGetSelectedBroadcastDeckList,
}));
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
	assetCapability: mockAssetCapability,
	cardDataHealth: mockCardDataHealth,
}));
const mockBoardLayouts = ref<Record<string, unknown>>({});
mockNuxtImport('useScreenModeConfig', () => (_mode: string) => computed(() => ({
	deckSource: mockBroadcastDeckListId.value === null
		? { type: 'player' as const, playerId: mockPlayerId.value }
		: { type: 'broadcast' as const, broadcastDeckListId: mockBroadcastDeckListId.value },
	...mockBoardLayouts.value,
})));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));

const images = stubImageLoading();

function createDeckResponse(cards: Array<Record<string, unknown>>, metadata: { id?: number; name?: string; colors?: string } = {}) {
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

function createEnrichedCard(name: string, imageUrl = `https://img.test/${name}.jpg`) {
	return {
		name,
		quantity: 1,
		compartment: 'mainboard',
		cardType: 'Instant',
		scryfallId: imageUrl,
		highlanderPoints: null,
		mtgCard: {
			imageData: {
				front: { normal: imageUrl },
			},
		},
	};
}

/** Players the Screen Output reads, each with a one-card deck, keyed by id. */
function servePlayers(players: Record<number, { name: string; deckName?: string; card?: string; updatedAt?: () => string }>) {
	mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) => {
		const player = players[playerId];
		return player && {
			id: playerId,
			name: player.name,
			updatedAt: player.updatedAt?.(),
			gameData: { type: 'mtg', deckName: player.deckName ?? 'Azorius Control', deckColors: 'WU' },
		};
	});
	mockReadDeck.mockImplementation(async (playerId: number) => {
		const player = players[playerId];
		return createDeckResponse([
			createDeckCard({ name: player?.card ?? 'Counterspell' }),
		], { id: playerId * 10, name: player?.deckName });
	});
}

/** Scryfall's answers in order, the last repeating: `true` is a degraded answer. */
function scryfallAnswers(...degraded: boolean[]) {
	for (const answer of degraded.slice(0, -1)) {
		mockFetchScryfallCards.mockResolvedValueOnce({
			cards: new Map(),
			degraded: answer,
		});
	}
	mockFetchScryfallCards.mockResolvedValue({
		cards: new Map(),
		degraded: degraded.at(-1),
	});
}

function broadcastEntry(id: number, canonicalName: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		listId: 23,
		compartment: 'mainboard',
		quantity: 1,
		sortOrder: id,
		canonicalName,
		scryfallId: `printing-${id}`,
		oracleId: `oracle-${id}`,
		setCode: 'lea',
		collectorNumber: String(id),
		cardType: 'Instant',
		colors: 'R',
		manaCost: '{R}',
		manaValue: 1,
		deckCounterTypes: [],
		...overrides,
	};
}

function createBroadcastList(revision: number, name: string, entries: Array<Record<string, unknown>> = [], metadata: Record<string, unknown> = {}) {
	const quantity = (compartment: string) => entries
		.filter(entry => entry.compartment === compartment)
		.reduce((total, entry) => total + Number(entry.quantity ?? 0), 0);
	return {
		id: 23,
		eventId: 1,
		name,
		archetypeLabel: null,
		colors: null,
		revision,
		mainboardQuantity: quantity('mainboard'),
		sideboardQuantity: quantity('sideboard'),
		hasCompanion: entries.some(entry => entry.compartment === 'companion'),
		sourceText: 'saved source',
		entries,
		createdAt: new Date(0),
		updatedAt: new Date(revision * 1000),
		...metadata,
	};
}

/** Builds deck rows from the cards as Scryfall-enriched or, with `mtgCard: null`, as placeholders. */
function buildPlaceholders() {
	mockBuildDeckListArrays.mockImplementation((cards: Array<Record<string, unknown>>) => ({
		mainboard: cards.filter(card => card.compartment === 'mainboard').map(card => ({ ...card, mtgCard: null })),
		sideboard: cards.filter(card => card.compartment === 'sideboard').map(card => ({ ...card, mtgCard: null })),
	}));
}

/** Delivers an Event-channel message to the listeners registered for it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const [channel, messageType, handler] of mockOnChannel.mock.calls) {
		if (channel === 'event:1' && messageType === type)
			handler({ eventId: 1, ...payload });
	}
}

function reattachEventChannel() {
	mockRealtime.connectionState = 'connected';
	continuity.reattach('event:1');
}

describe('useDeckModeData', () => {
	// Each instance watches the shared mocked refs; stopping its scope keeps it from
	// reacting to a later test's writes.
	const activeScopes: Array<ReturnType<typeof effectScope>> = [];

	function mountDeckModeData() {
		const scope = effectScope();
		activeScopes.push(scope);
		return scope.run(() => useDeckModeData())!;
	}

	function mainboardNames(result: ReturnType<typeof mountDeckModeData>) {
		return result.mainboard.value.map(card => card.name);
	}

	beforeEach(() => {
		images.reset();
		mockPlayerId.value = null;
		mockBroadcastDeckListId.value = null;
		mockEventId.value = 1;
		mockScreen.value = {
			id: 1,
			name: 'Test',
			modeConfigs: { deck: {} },
		};
		mockAssetCapability.value = 'output-capability';
		mockRealtime.connectionState = 'connected';
		mockCardDataHealth.value = 'complete';
		servePlayers({
			5: { name: 'Alice' },
		});
		mockGetSelectedBroadcastDeckList.mockResolvedValue(null);
		scryfallAnswers(false);
		mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
			mainboard: cards.map(card => createEnrichedCard(card.name)),
			sideboard: [],
		}));
	});

	afterEach(() => {
		activeScopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	it('starts blank with no loading state when no player is selected', () => {
		const { primaryHeader, secondaryHeader, mainboard, sideboard, loading, hasDisplayedDeck } = mountDeckModeData();

		expect(primaryHeader.value).toBe('');
		expect(secondaryHeader.value).toBe('');
		expect(mainboard.value).toEqual([]);
		expect(sideboard.value).toEqual([]);
		expect(loading.value).toBe(false);
		expect(hasDisplayedDeck.value).toBe(false);
	});

	// A board's auto columns come from its own cards and the Event Canvas; without auto, its own count.
	it('gives each grid board its columns', async () => {
		mockPlayerId.value = 5;
		mockBoardLayouts.value = {
			mainboard: { cardSizing: 'fit', autoColumns: true },
			sideboard: { columns: 3 },
		};
		const { boardColumns, mainboard } = mountDeckModeData();
		await flushPromises();

		expect(mainboard.value.length).toBeGreaterThan(0);
		expect(boardColumns.mainboard.value).toBe(fitColumns({
			count: mainboard.value.length,
			width: 1920,
			height: 1080,
			gap: 8,
		}));
		expect(boardColumns.sideboard.value).toBe(3);
		mockBoardLayouts.value = {};
	});

	it('loads the initial deck immediately and preloads its images', async () => {
		mockPlayerId.value = 5;
		const { primaryHeader, secondaryHeader, deckColors, hasDisplayedDeck, displayedDeckVersion } = mountDeckModeData();
		await flushPromises();

		expect(primaryHeader.value).toBe('Alice');
		expect(secondaryHeader.value).toBe('Azorius Control');
		expect(deckColors.value).toBe('WU');
		expect(hasDisplayedDeck.value).toBe(true);
		expect(displayedDeckVersion.value).toBe(1);
		expect(images.requested).toContain('https://img.test/Counterspell.jpg');
	});

	describe('a Broadcast Deck List', () => {
		beforeEach(() => {
			mockBroadcastDeckListId.value = 23;
		});

		it('projects through the source-independent display state', async () => {
			mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(4, 'Feature Table', [
				broadcastEntry(1, 'Lightning Bolt', {
					quantity: 4,
					deckCounterTypes: ['storm'],
				}),
				broadcastEntry(2, 'Birds of Paradise', { cardType: 'Creature — Bird' }),
				broadcastEntry(3, 'Surgical Extraction', {
					compartment: 'sideboard',
					quantity: 2,
					deckCounterTypes: ['poison'],
				}),
				broadcastEntry(4, 'Lutri, the Spellchaser', {
					compartment: 'companion',
					deckCounterTypes: ['energy'],
				}),
			], { archetypeLabel: 'Jeskai Control', colors: 'WUR' }));
			buildPlaceholders();

			const result = mountDeckModeData();
			await flushPromises();

			expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledWith(1, 1, 'output-capability');
			expect(mockFetchScryfallCards.mock.calls[0]![0].map((card: { name: string }) => card.name))
				.toEqual([
					'Lightning Bolt',
					'Birds of Paradise',
					'Surgical Extraction',
					'Lutri, the Spellchaser',
				]);
			expect(result.primaryHeader.value).toBe('Feature Table');
			expect(result.secondaryHeader.value).toBe('Jeskai Control');
			expect(result.deckColors.value).toBe('WUR');
			expect(result.highlander.value).toBeNull();
			expect(result.deckStats.value).toEqual([
				{ type: 'Creatures', count: 1 },
				{ type: 'Instants', count: 4 },
			]);
			// The companion is a card image of its own, its art read with the deck's.
			expect(result.companion.value).toMatchObject({ cardId: 4, name: 'Lutri, the Spellchaser' });
			expect(result.companionCard.value).toMatchObject({ name: 'Lutri, the Spellchaser', quantity: 1 });
			expect(mainboardNames(result)).toEqual(['Lightning Bolt', 'Birds of Paradise']);
			expect(result.sideboard.value.map(card => card.name)).toEqual(['Surgical Extraction']);
		});

		it('keeps the displayed revision until an update notification fetches and stages its successor', async () => {
			mockGetSelectedBroadcastDeckList
				.mockResolvedValueOnce(createBroadcastList(1, 'Old revision'))
				.mockResolvedValue(createBroadcastList(2, 'New revision'));
			const result = mountDeckModeData();
			await flushPromises();

			deliver('broadcastDeckList:updated', { listId: 23, revision: 2 });
			await flushPromises();

			expect(result.primaryHeader.value).toBe('Old revision');
			expect(result.pendingSwapVersion.value).toBe(1);
			expect(result.error.value).toBeNull();
			result.commitPendingDeck();
			expect(result.primaryHeader.value).toBe('New revision');
		});

		it('follows only the selected list, at a revision it does not hold', async () => {
			mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(1, 'Feature Table'));
			mountDeckModeData();
			await flushPromises();

			deliver('broadcastDeckList:updated', { listId: 24, revision: 2 });
			deliver('broadcastDeckList:updated', { listId: 23, revision: 1 });
			deliver('player:updated', {
				player: { id: 5, name: 'Alice', updatedAt: '2026-10-15T10:05:00.000Z' },
			});
			await flushPromises();

			expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledOnce();
			expect(mockPlayerDecks).not.toHaveBeenCalled();
		});

		it('keeps and retries the old revision when the selected-list read fails', async () => {
			vi.useFakeTimers();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockGetSelectedBroadcastDeckList.mockResolvedValueOnce(createBroadcastList(1, 'On air'));
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockGetSelectedBroadcastDeckList.mockRejectedValueOnce(new Error('canonical read unavailable'));
			deliver('broadcastDeckList:updated', { listId: 23, revision: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.primaryHeader.value).toBe('On air');
			expect(result.pendingSwapVersion.value).toBe(0);

			mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(2, 'Recovered revision'));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.primaryHeader.value).toBe('On air');
			expect(result.pendingSwapVersion.value).toBe(1);
		});

		it('stages a new revision with placeholders and does not re-stage unchanged degraded retries', async () => {
			vi.useFakeTimers();
			const bolt = broadcastEntry(1, 'Lightning Bolt', { quantity: 4 });
			mockGetSelectedBroadcastDeckList
				.mockResolvedValueOnce(createBroadcastList(1, 'First', [bolt]))
				.mockResolvedValue(createBroadcastList(2, 'Second', [bolt]));
			scryfallAnswers(false, true, true, false);
			buildPlaceholders();
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			deliver('broadcastDeckList:updated', { listId: 23, revision: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.pendingSwapVersion.value).toBe(1);
			expect(result.cardDataDegraded.value).toBe(true);
			result.commitPendingDeck();
			expect(result.primaryHeader.value).toBe('Second');
			expect(result.mainboard.value[0]?.mtgCard).toBeNull();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.pendingSwapVersion.value).toBe(1);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(false);
			expect(result.pendingSwapVersion.value).toBe(2);
		});

		it('airs a new revision with a name placeholder when image preload fails, then retries it', async () => {
			vi.useFakeTimers();
			const failedUrl = 'https://img.test/unavailable.jpg';
			mockGetSelectedBroadcastDeckList
				.mockResolvedValueOnce(createBroadcastList(1, 'On air'))
				.mockResolvedValue(createBroadcastList(2, 'New revision', [
					broadcastEntry(1, 'Lightning Bolt'),
				]));
			mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
				mainboard: cards.map(card => createEnrichedCard(card.name, failedUrl)),
				sideboard: [],
			}));
			images.fail(failedUrl);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			deliver('broadcastDeckList:updated', { listId: 23, revision: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.pendingSwapVersion.value).toBe(1);
			expect(result.cardDataDegraded.value).toBe(true);
			result.commitPendingDeck();
			expect(result.primaryHeader.value).toBe('New revision');
			expect(result.mainboard.value[0]?.mtgCard).toBeNull();

			images.reset();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(false);
			expect(result.pendingSwapVersion.value).toBe(2);
		});

		it('re-reads the selected list once its Event channel is attached again', async () => {
			mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(1, 'Feature Table'));
			mountDeckModeData();
			await flushPromises();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			reattachEventChannel();
			await flushPromises();

			expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledTimes(2);
		});
	});

	describe('staged swaps', () => {
		beforeEach(() => {
			servePlayers({
				1: { name: 'Alice', deckName: 'Deck A', card: 'Card A' },
				2: { name: 'Bob', deckName: 'Deck B', card: 'Card B' },
				3: { name: 'Carol', deckName: 'Deck C', card: 'Card C' },
			});
		});

		it('keeps the current deck visible until the pending deck is committed', async () => {
			mockPlayerId.value = 1;
			const result = mountDeckModeData();
			await flushPromises();
			expect(result.displayedDeckVersion.value).toBe(1);

			mockPlayerId.value = 2;
			await flushPromises();
			expect(result.primaryHeader.value).toBe('Alice');
			expect(result.pendingSwapVersion.value).toBe(1);

			result.commitPendingDeck();
			await nextTick();
			expect(result.primaryHeader.value).toBe('Bob');
			expect(result.displayedDeckVersion.value).toBe(2);
		});

		it('ignores a stale read when the selected deck changes rapidly', async () => {
			let releaseBob!: () => void;
			const readPlayer = mockReadPlayer.getMockImplementation()!;
			mockReadPlayer.mockImplementation((eventId: number, playerId: number) => playerId === 2
				? new Promise((resolve) => {
						releaseBob = () => resolve(readPlayer(eventId, playerId));
					})
				: readPlayer(eventId, playerId));
			mockPlayerId.value = 1;
			const result = mountDeckModeData();
			await flushPromises();

			mockPlayerId.value = 2;
			await nextTick();
			mockPlayerId.value = 3;
			await flushPromises();
			result.commitPendingDeck();
			await nextTick();
			expect(result.primaryHeader.value).toBe('Carol');

			releaseBob();
			await flushPromises();
			expect(result.primaryHeader.value).toBe('Carol');
			expect(result.secondaryHeader.value).toBe('Deck C');
		});

		it('clears to blank when the Player selection is cleared', async () => {
			mockPlayerId.value = 1;
			const result = mountDeckModeData();
			await flushPromises();

			mockPlayerId.value = null;
			await flushPromises();
			expect(result.primaryHeader.value).toBe('Alice');

			result.commitPendingDeck();
			await nextTick();
			expect(result.primaryHeader.value).toBe('');
			expect(result.hasDisplayedDeck.value).toBe(false);
		});
	});

	describe('degraded card data', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			mockPlayerId.value = 5;
		});

		it('keeps a degraded deck on program and exposes the degradation instead of an error', async () => {
			scryfallAnswers(true);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			expect(result.hasDisplayedDeck.value).toBe(true);
			expect(result.error.value).toBeNull();
			expect(result.cardDataDegraded.value).toBe(true);
		});

		it('re-fetches without a reload and stages the recovered deck', async () => {
			scryfallAnswers(true, false);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.cardDataDegraded.value).toBe(false);
			expect(result.pendingSwapVersion.value).toBe(1);

			await vi.advanceTimersByTimeAsync(120_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
		});

		it('keeps program untouched while a re-fetch is still degraded, and keeps retrying', async () => {
			scryfallAnswers(true);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.pendingSwapVersion.value).toBe(0);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(3);
		});

		it('keeps the cadence alive when a re-fetch itself fails mid-outage', async () => {
			scryfallAnswers(true, false);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockFetchScryfallCards.mockRejectedValueOnce(new Error('network down'));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(true);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(false);
		});

		it('swaps in a still-degraded rebuild when the deck itself changed during the outage', async () => {
			let updatedAt = '2026-08-21T00:00:00.000Z';
			servePlayers({
				5: {
					name: 'Alice',
					updatedAt: () => updatedAt,
				},
			});
			scryfallAnswers(true);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.pendingSwapVersion.value).toBe(0);

			updatedAt = '2026-08-21T01:00:00.000Z';
			mockReadDeck.mockResolvedValue(createDeckResponse([
				createDeckCard({ name: 'Brainstorm' }),
			]));
			deliver('player:updated', {
				player: { id: 5, name: 'Alice', updatedAt },
			});
			await vi.advanceTimersByTimeAsync(0);
			expect(result.pendingSwapVersion.value).toBe(1);
		});

		it('cancels the re-fetch when another Player is selected, so the stale deck cannot come back', async () => {
			servePlayers({
				5: { name: 'Alice' },
				6: { name: 'Bob' },
			});
			scryfallAnswers(true, false);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockPlayerId.value = 6;
			await vi.advanceTimersByTimeAsync(0);
			result.commitPendingDeck();
			await vi.advanceTimersByTimeAsync(180_000);

			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.primaryHeader.value).toBe('Bob');
		});

		it('stops re-fetching and clears the degradation when the Player selection is cleared', async () => {
			scryfallAnswers(true);
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockPlayerId.value = null;
			await vi.advanceTimersByTimeAsync(180_000);

			expect(result.cardDataDegraded.value).toBe(false);
			expect(mockFetchScryfallCards).toHaveBeenCalledOnce();
		});

		it('reports card data health through the screen context, and settles it on teardown', async () => {
			servePlayers({
				5: { name: 'Alice' },
				6: { name: 'Bob' },
			});
			scryfallAnswers(true);
			mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(mockCardDataHealth.value).toBe('degraded');

			scryfallAnswers(false);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockCardDataHealth.value).toBe('complete');

			scryfallAnswers(true);
			mockPlayerId.value = 6;
			await vi.advanceTimersByTimeAsync(0);
			expect(mockCardDataHealth.value).toBe('degraded');
			activeScopes.splice(0).forEach(scope => scope.stop());
			expect(mockCardDataHealth.value).toBe('complete');
		});
	});

	describe('live-follow of the selected Player (#483)', () => {
		const BEFORE_EDIT = '2026-10-15T10:00:00.000Z';
		const AFTER_EDIT = '2026-10-15T10:05:00.000Z';

		/** What the server holds; the Screen Output Player read answers it. */
		let serverPlayer: { id: number; name: string; updatedAt: string };
		/** Whether the server's Deck List has had its unresolved card resolved (#648). */
		let resolved: boolean;

		/** The server commits an edit and announces it on the Event channel. */
		function applyPlayerUpdated(next: typeof serverPlayer) {
			if (next.id === serverPlayer.id)
				serverPlayer = next;
			deliver('player:updated', { player: next });
		}

		/** A Player read served with what the server holds now, delivered when the test says so. */
		function holdRead() {
			let release!: () => void;
			mockReadPlayer.mockImplementationOnce(() => {
				const served = serverPlayer;
				return new Promise((resolve) => {
					release = () => resolve(served);
				});
			});
			return () => release();
		}

		beforeEach(() => {
			serverPlayer = { id: 5, name: 'Alice', updatedAt: BEFORE_EDIT };
			resolved = false;
			mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) =>
				playerId === serverPlayer.id
					? serverPlayer
					: null);
			mockReadDeck.mockImplementation(async (_playerId: number, _eventId: number, updatedAt: string) =>
				createDeckResponse([
					createDeckCard({
						name: resolved
							? 'Lightning Bolt'
							: updatedAt === BEFORE_EDIT
								? 'Counterspell'
								: 'Brainstorm',
					}),
				]));
			mockPlayerId.value = 5;
		});

		it('stages the edited deck when the selected Player is updated mid-display', async () => {
			const result = mountDeckModeData();
			await flushPromises();

			applyPlayerUpdated({ ...serverPlayer, updatedAt: AFTER_EDIT });
			await flushPromises();

			expect(mainboardNames(result)).toEqual(['Counterspell']);
			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			await nextTick();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
		});

		it('neither swaps for its own unchanged revision nor for another Player\'s update', async () => {
			const result = mountDeckModeData();
			await flushPromises();

			applyPlayerUpdated({ ...serverPlayer });
			applyPlayerUpdated({ id: 6, name: 'Bob', updatedAt: AFTER_EDIT });
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(0);
			expect(mockPlayerDecks).toHaveBeenCalledOnce();
		});

		it('shows an edit announced while the first read is in flight, which that read missed', async () => {
			const releaseRead = holdRead();
			const result = mountDeckModeData();
			await flushPromises();

			applyPlayerUpdated({ ...serverPlayer, updatedAt: AFTER_EDIT });
			releaseRead();
			await flushPromises();

			expect(mainboardNames(result)).toEqual(['Brainstorm']);
			expect(result.pendingSwapVersion.value).toBe(0);
			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
		});

		it('shows an edit missed while disconnected once its channel is attached again, without a second swap', async () => {
			const result = mountDeckModeData();
			await flushPromises();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			reattachEventChannel();
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			await nextTick();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
			expect(result.pendingSwapVersion.value).toBe(1);
		});

		it('re-reads on a Melee decklist sync, and on a deck review of the selected Player only', async () => {
			mountDeckModeData();
			await flushPromises();

			deliver('melee:decklistsSynced', { playerCount: 1, deckCount: 1 });
			deliver('playerDeck:reviewed', {
				deck: { playerId: 6 },
			});
			await flushPromises();
			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);

			deliver('playerDeck:reviewed', {
				deck: { playerId: 5 },
			});
			await flushPromises();
			expect(mockPlayerDecks).toHaveBeenCalledTimes(3);
		});

		it('keeps an unchanged deck on program when only the Player revision moved', async () => {
			// A Round sync refreshes Players' records, moving their revision but not their Deck List.
			mockReadDeck.mockImplementation(async () => createDeckResponse([
				createDeckCard({ name: 'Counterspell' }),
			]));
			const result = mountDeckModeData();
			await flushPromises();

			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			deliver('melee:playersSynced', { playerCount: 1 });
			await flushPromises();

			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
			expect(result.pendingSwapVersion.value).toBe(0);
			expect(result.displayedDeckVersion.value).toBe(1);
		});

		describe('a resolved deck card, which moves no Player revision (#648)', () => {
			it('stages the rewritten Deck List of the selected Player, and reads nothing for another', async () => {
				const result = mountDeckModeData();
				await flushPromises();

				resolved = true;
				deliver('playerDeck:cardsResolved', {
					deckIds: [9],
					playerIds: [6],
				});
				await flushPromises();
				expect(mockPlayerDecks).toHaveBeenCalledOnce();

				deliver('playerDeck:cardsResolved', {
					deckIds: [3, 9],
					playerIds: [5, 6],
				});
				await flushPromises();
				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});

			it('swaps in the rewritten Deck List even while its card data is still degraded', async () => {
				scryfallAnswers(true);
				const result = mountDeckModeData();
				await flushPromises();

				resolved = true;
				deliver('playerDeck:cardsResolved', {
					deckIds: [3],
					playerIds: [5],
				});
				await flushPromises();

				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});

			it('shows a resolution missed while disconnected once its channel is attached again', async () => {
				const result = mountDeckModeData();
				await flushPromises();

				mockRealtime.connectionState = 'disconnected';
				await nextTick();
				resolved = true;
				reattachEventChannel();
				await flushPromises();

				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});
		});

		it('re-reads while disconnected without re-staging a deck that has not changed', async () => {
			vi.useFakeTimers();
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockRealtime.connectionState = 'disconnected';
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);
			expect(mockPlayerDecks).toHaveBeenCalledTimes(3);
			expect(result.pendingSwapVersion.value).toBe(0);

			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
		});

		it('clears a Deck List removed while disconnected once its channel is attached again', async () => {
			const result = mountDeckModeData();
			await flushPromises();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			mockReadDeck.mockResolvedValue(null);
			reattachEventChannel();
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			expect(result.hasDisplayedDeck.value).toBe(false);
			expect(result.error.value).toBe('Player has no deck list');
		});

		it('leaves a deleted Player\'s deck once the Screen clears its Deck Source, and stops re-reading them (#651)', async () => {
			vi.useFakeTimers();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			// Deleted while disconnected: the resync's read finds no Player and retries.
			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockReadPlayer.mockImplementation(async () => null);
			reattachEventChannel();
			await vi.advanceTimersByTimeAsync(0);
			const failedReads = mockPlayerDecks.mock.calls.length;
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
			expect(mockPlayerDecks.mock.calls.length).toBeGreaterThan(failedReads);
			expect(mainboardNames(result)).toEqual(['Counterspell']);

			// The deletion's `screen:updated` carries the cleared Deck Source.
			mockPlayerId.value = null;
			await vi.advanceTimersByTimeAsync(0);
			const reads = mockPlayerDecks.mock.calls.length;
			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			expect(result.hasDisplayedDeck.value).toBe(false);

			await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 4);
			expect(mockPlayerDecks).toHaveBeenCalledTimes(reads);
		});

		it('shows a deck imported after the Player was selected without one', async () => {
			mockReadDeck.mockImplementation(async (_playerId: number, _eventId: number, updatedAt: string) =>
				createDeckResponse(updatedAt === BEFORE_EDIT
					? []
					: [
							createDeckCard({ name: 'Brainstorm' }),
						]));
			const result = mountDeckModeData();
			await flushPromises();
			expect(result.error.value).toBe('Player has no deck list');
			expect(result.hasDisplayedDeck.value).toBe(false);

			applyPlayerUpdated({ ...serverPlayer, updatedAt: AFTER_EDIT });
			await flushPromises();

			expect(result.error.value).toBeNull();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
		});
	});
});
