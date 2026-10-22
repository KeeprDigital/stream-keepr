import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';

/**
 * The server's two halves of the Screen Output Player read (#604): the Player
 * the Screen selects, and that Player's deck at their current revision.
 */
const mockReadPlayer = vi.fn();
const mockReadDeck = vi.fn();
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();
const mockGetSelectedBroadcastDeckList = vi.fn();
const mockOnChannel = vi.fn<(
	channel: string,
	type: string,
	handler: (message: { eventId: number; listId: number; revision: number }) => void,
) => () => void>(() => vi.fn());

const mockPlayerId = ref<number | null>(null);
const mockBroadcastDeckListId = ref<number | null>(null);
const mockEventId = ref<number | null>(1);
const mockPlayerDecks = vi.fn(async (playerId: number) => {
	const player = await mockReadPlayer(mockEventId.value, playerId);
	if (!player)
		throw Object.assign(new Error('Not found'), { statusCode: 404 });
	const deck = await mockReadDeck(playerId, mockEventId.value, player.updatedAt);
	return { player, decks: { decks: deck ? [deck] : [], selectedDeckId: deck?.id ?? null } };
});
const mockScreen = ref({ id: 1, name: 'Test', modeConfigs: { deck: {} } });
const mockAssetCapability = ref<string | null>('output-capability');
const continuity = createContinuitySignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	onChannel: mockOnChannel,
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
});

mockNuxtImport('useScreenOutputReads', () => () => ({
	scope: computed(() => mockEventId.value ? { eventId: mockEventId.value, screenId: mockScreen.value.id } : null),
	scopeKey: computed(() => mockEventId.value ? `${mockEventId.value}:${mockScreen.value.id}` : null),
	playerDecks: mockPlayerDecks,
}));
mockNuxtImport('useScreenOutputBroadcastDeckListRepository', () => () => ({
	getSelected: mockGetSelectedBroadcastDeckList,
}));
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
const mockCardDataHealth = ref<'complete' | 'degraded'>('complete');

mockNuxtImport('useScreenContext', () => () => ({
	screen: mockScreen,
	eventId: computed(() => mockEventId.value),
	interactive: ref(false),
	assetCapability: mockAssetCapability,
	cardDataHealth: mockCardDataHealth,
}));
mockNuxtImport('useScreenModeConfig', () => (_mode: string) => computed(() => ({
	deckSource: mockBroadcastDeckListId.value === null
		? { type: 'player' as const, playerId: mockPlayerId.value }
		: { type: 'broadcast' as const, broadcastDeckListId: mockBroadcastDeckListId.value },
})));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));

class MockImage {
	static loadedUrls: string[] = [];
	static failedUrls = new Set<string>();
	complete = false;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	#src = '';

	set src(value: string) {
		this.#src = value;
		MockImage.loadedUrls.push(value);
		this.complete = true;
		queueMicrotask(() => {
			if (MockImage.failedUrls.has(value))
				this.onerror?.();
			else
				this.onload?.();
		});
	}

	get src() {
		return this.#src;
	}

	get naturalWidth() {
		return MockImage.failedUrls.has(this.#src) ? 0 : 488;
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

function createBroadcastList(revision: number, name: string, entries: Array<Record<string, unknown>> = []) {
	return {
		id: 23,
		eventId: 1,
		name,
		archetypeLabel: null,
		colors: null,
		revision,
		mainboardQuantity: entries
			.filter(entry => entry.compartment === 'mainboard')
			.reduce((total, entry) => total + Number(entry.quantity ?? 0), 0),
		sideboardQuantity: entries
			.filter(entry => entry.compartment === 'sideboard')
			.reduce((total, entry) => total + Number(entry.quantity ?? 0), 0),
		hasCompanion: entries.some(entry => entry.compartment === 'companion'),
		sourceText: 'saved source',
		entries,
		createdAt: new Date(0),
		updatedAt: new Date(revision * 1000),
	};
}

/** The Event-channel `player:updated` listener live-follow rides on (#604). */
function playerUpdatedHandler() {
	const call = mockOnChannel.mock.calls.find(([, type]) => type === 'player:updated');
	return call?.[2] as unknown as ((message: { eventId: number; player: { id: number; name: string; updatedAt: string } }) => void) | undefined;
}

function broadcastUpdateHandler() {
	const call = mockOnChannel.mock.calls.find(([, type]) => type === 'broadcastDeckList:updated');
	return call?.[2] as ((message: { eventId: number; listId: number; revision: number }) => void) | undefined;
}

/** Any other Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const [channel, messageType, handler] of mockOnChannel.mock.calls) {
		if (channel === 'event:1' && messageType === type)
			(handler as unknown as (message: Record<string, unknown>) => void)({ eventId: 1, ...payload });
	}
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
		MockImage.failedUrls.clear();
		mockPlayerId.value = null;
		mockBroadcastDeckListId.value = null;
		mockEventId.value = 1;
		mockScreen.value = { id: 1, name: 'Test', modeConfigs: { deck: {} } };
		mockAssetCapability.value = 'output-capability';
		mockRealtime.connectionState = 'connected';
		mockCardDataHealth.value = 'complete';
		mockReadDeck.mockResolvedValue(createDeckResponse([]));
		mockGetSelectedBroadcastDeckList.mockResolvedValue(null);
		mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: false });
		mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });
	});

	afterEach(() => {
		activeScopes.splice(0).forEach(scope => scope.stop());
	});

	it('returns expected properties for staged deck swaps', () => {
		const result = mountDeckModeData();
		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('primaryHeader');
		expect(result).toHaveProperty('secondaryHeader');
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
		const { primaryHeader, secondaryHeader, mainboard, sideboard, loading, hasDisplayedDeck } = mountDeckModeData();
		expect(primaryHeader.value).toBe('');
		expect(secondaryHeader.value).toBe('');
		expect(mainboard.value).toEqual([]);
		expect(sideboard.value).toEqual([]);
		expect(loading.value).toBe(false);
		expect(hasDisplayedDeck.value).toBe(false);
	});

	it('loads the initial deck immediately and preloads its images', async () => {
		mockReadPlayer.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard({ quantity: 4 })]));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [createEnrichedCard('Counterspell', 'https://img.test/counterspell.jpg', { quantity: 4 })],
			sideboard: [],
		});

		mockPlayerId.value = 5;
		const { primaryHeader, secondaryHeader, deckColors, hasDisplayedDeck, displayedDeckVersion } = mountDeckModeData();

		await flushPromises();

		expect(primaryHeader.value).toBe('Alice');
		expect(secondaryHeader.value).toBe('Azorius Control');
		expect(deckColors.value).toBe('WU');
		expect(hasDisplayedDeck.value).toBe(true);
		expect(displayedDeckVersion.value).toBe(1);
		expect(MockImage.loadedUrls).toContain('https://img.test/counterspell.jpg');
	});

	it('projects the selected Broadcast Deck List through the source-independent display state', async () => {
		mockGetSelectedBroadcastDeckList.mockResolvedValue({
			id: 23,
			eventId: 1,
			name: 'Feature Table',
			archetypeLabel: 'Jeskai Control',
			colors: 'WUR',
			revision: 4,
			mainboardQuantity: 5,
			sideboardQuantity: 2,
			hasCompanion: true,
			sourceText: 'saved source',
			createdAt: new Date(0),
			updatedAt: new Date(0),
			entries: [
				{ id: 1, listId: 23, compartment: 'mainboard', quantity: 4, sortOrder: 0, canonicalName: 'Lightning Bolt', scryfallId: 'printing-bolt', oracleId: 'oracle-bolt', setCode: 'lea', collectorNumber: '161', cardType: 'Instant', colors: 'R', manaCost: '{R}', manaValue: 1, deckCounterTypes: ['storm'] },
				{ id: 2, listId: 23, compartment: 'mainboard', quantity: 1, sortOrder: 1, canonicalName: 'Birds of Paradise', scryfallId: 'printing-birds', oracleId: 'oracle-birds', setCode: 'lea', collectorNumber: '186', cardType: 'Creature — Bird', colors: 'G', manaCost: '{G}', manaValue: 1, deckCounterTypes: [] },
				{ id: 3, listId: 23, compartment: 'sideboard', quantity: 2, sortOrder: 0, canonicalName: 'Surgical Extraction', scryfallId: 'printing-surgical', oracleId: 'oracle-surgical', setCode: 'nph', collectorNumber: '74', cardType: 'Instant', colors: 'B', manaCost: '{B/P}', manaValue: 1, deckCounterTypes: ['poison'] },
				{ id: 4, listId: 23, compartment: 'companion', quantity: 1, sortOrder: 0, canonicalName: 'Lutri, the Spellchaser', scryfallId: 'printing-lutri', oracleId: 'oracle-lutri', setCode: 'iko', collectorNumber: '227', cardType: 'Legendary Creature — Elemental Otter', colors: 'UR', manaCost: '{1}{U/R}{U/R}', manaValue: 3, deckCounterTypes: ['energy'] },
			],
		});
		mockBuildDeckListArrays.mockImplementation((cards: Array<Record<string, unknown>>) => ({
			mainboard: cards.filter(card => card.compartment === 'mainboard').map(card => ({ ...card, mtgCard: null })),
			sideboard: cards.filter(card => card.compartment === 'sideboard').map(card => ({ ...card, mtgCard: null })),
		}));

		mockBroadcastDeckListId.value = 23;
		const result = mountDeckModeData();
		await flushPromises();

		expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledWith(1, 1, 'output-capability');
		expect(mockFetchScryfallCards).toHaveBeenCalledWith([
			expect.objectContaining({ name: 'Lightning Bolt', scryfallId: 'printing-bolt' }),
			expect.objectContaining({ name: 'Birds of Paradise', scryfallId: 'printing-birds' }),
			expect.objectContaining({ name: 'Surgical Extraction', scryfallId: 'printing-surgical' }),
			expect.objectContaining({ name: 'Lutri, the Spellchaser', scryfallId: 'printing-lutri' }),
		]);
		expect(result.primaryHeader.value).toBe('Feature Table');
		expect(result.secondaryHeader.value).toBe('Jeskai Control');
		expect(result.deckColors.value).toBe('WUR');
		expect(result.highlander.value).toBeNull();
		expect(result.deckStats.value).toEqual([
			{ type: 'Creatures', count: 1 },
			{ type: 'Instants', count: 4 },
		]);
		expect(result.deckCounters.value.map(counter => counter.key)).toEqual(['poison', 'storm']);
		expect(result.companion.value).toMatchObject({
			cardId: 4,
			name: 'Lutri, the Spellchaser',
			scryfallId: 'printing-lutri',
		});
		expect(result.mainboard.value.map(card => card.name)).toEqual(['Lightning Bolt', 'Birds of Paradise']);
		expect(result.sideboard.value.map(card => card.name)).toEqual(['Surgical Extraction']);
	});

	it('keeps the displayed Broadcast revision until an update notification fetches and stages its successor', async () => {
		mockGetSelectedBroadcastDeckList
			.mockResolvedValueOnce(createBroadcastList(1, 'Old revision'))
			.mockResolvedValue(createBroadcastList(2, 'New revision'));
		mockBroadcastDeckListId.value = 23;
		const result = mountDeckModeData();
		await flushPromises();

		expect(result.primaryHeader.value).toBe('Old revision');
		const onUpdated = broadcastUpdateHandler();
		expect(onUpdated).toBeTypeOf('function');
		onUpdated!({ eventId: 1, listId: 23, revision: 2 });
		await flushPromises();

		expect(result.primaryHeader.value).toBe('Old revision');
		expect(result.pendingSwapVersion.value).toBe(1);
		expect(result.error.value).toBeNull();

		result.commitPendingDeck();
		expect(result.primaryHeader.value).toBe('New revision');
	});

	it('follows only the selected Broadcast Deck List, at a revision it does not hold', async () => {
		mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(1, 'Feature Table'));
		mockBroadcastDeckListId.value = 23;
		mountDeckModeData();
		await flushPromises();

		broadcastUpdateHandler()!({ eventId: 1, listId: 24, revision: 2 });
		broadcastUpdateHandler()!({ eventId: 1, listId: 23, revision: 1 });
		await flushPromises();
		expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledTimes(1);

		// A Player edit is not the Broadcast Deck List's.
		playerUpdatedHandler()!({ eventId: 1, player: { id: 5, name: 'Alice', updatedAt: '2026-10-15T10:05:00.000Z' } });
		await flushPromises();
		expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledTimes(1);
		expect(mockPlayerDecks).not.toHaveBeenCalled();
	});

	it('keeps and retries the old Broadcast revision when the canonical selected-list read fails', async () => {
		vi.useFakeTimers();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			mockGetSelectedBroadcastDeckList.mockResolvedValueOnce(createBroadcastList(1, 'On air'));
			mockBroadcastDeckListId.value = 23;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			mockGetSelectedBroadcastDeckList.mockRejectedValueOnce(new Error('canonical read unavailable'));
			broadcastUpdateHandler()!({ eventId: 1, listId: 23, revision: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.primaryHeader.value).toBe('On air');
			expect(result.pendingSwapVersion.value).toBe(0);

			mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(2, 'Recovered revision'));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.primaryHeader.value).toBe('On air');
			expect(result.pendingSwapVersion.value).toBe(1);
		}
		finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('stages a new canonical Broadcast revision with placeholders and does not re-stage unchanged degraded retries', async () => {
		vi.useFakeTimers();
		try {
			const entry = {
				id: 1,
				listId: 23,
				compartment: 'mainboard',
				quantity: 4,
				sortOrder: 0,
				canonicalName: 'Lightning Bolt',
				scryfallId: 'printing-bolt',
				oracleId: 'oracle-bolt',
				setCode: 'lea',
				collectorNumber: '161',
				cardType: 'Instant',
				colors: 'R',
				manaCost: '{R}',
				manaValue: 1,
				deckCounterTypes: [],
			};
			mockGetSelectedBroadcastDeckList
				.mockResolvedValueOnce(createBroadcastList(1, 'First', [entry]))
				.mockResolvedValue(createBroadcastList(2, 'Second', [entry]));
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: false })
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockImplementation((cards: Array<Record<string, unknown>>) => ({
				mainboard: cards.map(card => ({ ...card, mtgCard: null })),
				sideboard: [],
			}));

			mockBroadcastDeckListId.value = 23;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			broadcastUpdateHandler()!({ eventId: 1, listId: 23, revision: 2 });
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
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('airs a new canonical Broadcast revision with a name placeholder when image preload fails, then retries it', async () => {
		vi.useFakeTimers();
		try {
			const failedUrl = 'https://img.test/unavailable.jpg';
			const entry = {
				id: 1,
				listId: 23,
				compartment: 'mainboard',
				quantity: 1,
				sortOrder: 0,
				canonicalName: 'Lightning Bolt',
				scryfallId: 'printing-bolt',
				oracleId: 'oracle-bolt',
				setCode: 'lea',
				collectorNumber: '161',
				cardType: 'Instant',
				colors: 'R',
				manaCost: '{R}',
				manaValue: 1,
				deckCounterTypes: [],
			};
			mockGetSelectedBroadcastDeckList
				.mockResolvedValueOnce(createBroadcastList(1, 'On air'))
				.mockResolvedValue(createBroadcastList(2, 'New revision', [entry]));
			mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
				mainboard: cards.map(card => createEnrichedCard(card.name, failedUrl)),
				sideboard: [],
			}));
			MockImage.failedUrls.add(failedUrl);

			mockBroadcastDeckListId.value = 23;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);

			broadcastUpdateHandler()!({ eventId: 1, listId: 23, revision: 2 });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.pendingSwapVersion.value).toBe(1);
			expect(result.cardDataDegraded.value).toBe(true);

			result.commitPendingDeck();
			expect(result.primaryHeader.value).toBe('New revision');
			expect(result.mainboard.value[0]?.mtgCard).toBeNull();

			MockImage.failedUrls.clear();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(result.cardDataDegraded.value).toBe(false);
			expect(result.pendingSwapVersion.value).toBe(2);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('re-reads the selected Broadcast detail once its Event channel is attached again', async () => {
		mockGetSelectedBroadcastDeckList.mockResolvedValue(createBroadcastList(1, 'Feature Table'));
		mockBroadcastDeckListId.value = 23;
		mountDeckModeData();
		await flushPromises();
		expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledTimes(1);

		mockRealtime.connectionState = 'disconnected';
		await nextTick();
		mockRealtime.connectionState = 'connected';
		continuity.reattach('event:1');
		await flushPromises();

		expect(mockGetSelectedBroadcastDeckList).toHaveBeenCalledTimes(2);
	});

	it('keeps the current deck visible until the pending deck is committed', async () => {
		mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) => {
			if (playerId === 1) {
				return { id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: 'Deck A', deckColors: 'U' } };
			}
			return { id: 2, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } };
		});
		mockReadDeck.mockImplementation(async (playerId: number) => {
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

		expect(result.primaryHeader.value).toBe('Alice');
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

	it('ignores stale async requests when the selected deck changes rapidly', async () => {
		interface BobPlayer { id: number; name: string; gameData: { type: string; deckName: string; deckColors: string } }
		const bobResolver: { resolve: ((value: BobPlayer) => void) | null } = { resolve: null };
		mockReadPlayer.mockImplementation((_eventId: number, playerId: number) => {
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
		mockReadDeck.mockImplementation(async (playerId: number) => {
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

		expect(result.primaryHeader.value).toBe('Alice');
		expect(result.pendingSwapVersion.value).toBe(1);

		result.commitPendingDeck();
		await nextTick();

		expect(result.primaryHeader.value).toBe('Carol');

		if (bobResolver.resolve) {
			bobResolver.resolve({ id: 2, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } });
		}
		await flushPromises();

		expect(result.primaryHeader.value).toBe('Carol');
		expect(result.secondaryHeader.value).toBe('Deck C');
	});

	it('keeps a degraded deck on program and exposes the degradation instead of an error', async () => {
		mockReadPlayer.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			mockReadPlayer.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) => ({
				id: playerId,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			}));
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			mockReadPlayer.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			mockReadPlayer.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			mockReadPlayer.mockResolvedValue({
				id: 5,
				name: 'Alice',
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			});
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
			mockFetchScryfallCards
				.mockResolvedValueOnce({ cards: new Map(), degraded: true })
				.mockResolvedValue({ cards: new Map(), degraded: false });
			mockBuildDeckListArrays.mockReturnValue({ mainboard: [], sideboard: [] });

			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await vi.advanceTimersByTimeAsync(0);
			expect(result.cardDataDegraded.value).toBe(true);

			// The same outage takes down card data entirely for one cadence tick.
			mockFetchScryfallCards.mockRejectedValueOnce(new Error('network down'));
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
			mockReadPlayer.mockImplementation(async () => ({
				id: 5,
				name: 'Alice',
				updatedAt,
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			}));
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			playerUpdatedHandler()!({ eventId: 1, player: { id: 5, name: 'Alice', updatedAt } });
			await vi.advanceTimersByTimeAsync(0);
			expect(result.pendingSwapVersion.value).toBe(1);
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('cancels a degraded re-fetch when the operator selects another player, so the stale deck cannot come back', async () => {
		vi.useFakeTimers();
		try {
			mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) =>
				playerId === 5
					? { id: 5, name: 'Alice', gameData: { type: 'mtg', deckName: 'Deck A', deckColors: 'U' } }
					: { id: 6, name: 'Bob', gameData: { type: 'mtg', deckName: 'Deck B', deckColors: 'R' } });
			mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
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
			expect(result.primaryHeader.value).toBe('Bob');
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);

			// The degraded player-5 re-fetch must not fire and drag Alice back on program.
			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(result.primaryHeader.value).toBe('Bob');
		}
		finally {
			vi.useRealTimers();
		}
	});

	it('clears to blank when playerId becomes null', async () => {
		mockReadPlayer.mockResolvedValue({
			id: 5,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		});
		mockReadDeck.mockResolvedValue(createDeckResponse([createDeckCard()]));
		mockBuildDeckListArrays.mockReturnValue({
			mainboard: [createEnrichedCard('Counterspell', 'https://img.test/counterspell.jpg')],
			sideboard: [],
		});

		mockPlayerId.value = 5;
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

	describe('live-follow of the selected Player (#483)', () => {
		/** Two revisions of one Player, and the deck the server holds at each. */
		const BEFORE_EDIT = '2026-10-15T10:00:00.000Z';
		const AFTER_EDIT = '2026-10-15T10:05:00.000Z';

		/** What the server holds; the Screen Output Player read answers it. */
		let serverPlayer: { id: number; name: string; updatedAt: string };

		/** The server commits an edit and announces it on the Event channel. */
		function applyPlayerUpdated(next: typeof serverPlayer) {
			if (next.id === serverPlayer.id)
				serverPlayer = next;
			playerUpdatedHandler()?.({ eventId: 1, player: next });
		}

		/** A Player read served now — with what the server holds now — but delivered when the test says so. */
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

		function mainboardNames(result: ReturnType<typeof mountDeckModeData>) {
			return result.mainboard.value.map(card => card.name);
		}

		beforeEach(() => {
			serverPlayer = { id: 5, name: 'Alice', updatedAt: BEFORE_EDIT };
			mockReadPlayer.mockImplementation(async (_eventId: number, playerId: number) =>
				playerId === serverPlayer.id ? serverPlayer : null);
			mockReadDeck.mockImplementation(async (_playerId: number, _eventId: number, updatedAt: string) =>
				createDeckResponse([createDeckCard({ name: updatedAt === BEFORE_EDIT ? 'Counterspell' : 'Brainstorm' })]));
			mockBuildDeckListArrays.mockImplementation((cards: Array<{ name: string }>) => ({
				mainboard: [createEnrichedCard(cards[0]!.name, `https://img.test/${cards[0]!.name}.jpg`)],
				sideboard: [],
			}));
		});

		it('stages the edited deck when the selected Player is updated mid-display', async () => {
			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await flushPromises();
			expect(mainboardNames(result)).toEqual(['Counterspell']);

			applyPlayerUpdated({ ...serverPlayer, updatedAt: AFTER_EDIT });
			await flushPromises();

			expect(mainboardNames(result)).toEqual(['Counterspell']);
			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			await nextTick();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
		});

		it('neither swaps for its own unchanged revision nor for another Player\'s update', async () => {
			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await flushPromises();
			expect(result.displayedDeckVersion.value).toBe(1);

			applyPlayerUpdated({ ...serverPlayer });
			applyPlayerUpdated({ id: 6, name: 'Bob', updatedAt: AFTER_EDIT });
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(0);
			expect(mockPlayerDecks).toHaveBeenCalledTimes(1);
		});

		it('shows an edit announced while the first read is in flight, which that read missed', async () => {
			const releaseRead = holdRead();
			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await flushPromises();

			// Served before the edit, delivered after it: the announcement asks for a
			// follow-up that supersedes the load, and with nothing on program yet its
			// answer is displayed directly.
			applyPlayerUpdated({ ...serverPlayer, updatedAt: AFTER_EDIT });
			releaseRead();
			await flushPromises();

			expect(mainboardNames(result)).toEqual(['Brainstorm']);
			expect(result.pendingSwapVersion.value).toBe(0);
			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
		});

		it('shows an edit missed while disconnected once its channel is attached again, without a second swap', async () => {
			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await flushPromises();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			// The message is gone; only the server knows.
			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			await nextTick();
			expect(mainboardNames(result)).toEqual(['Brainstorm']);
			expect(result.pendingSwapVersion.value).toBe(1);
		});

		it('shows a Melee decklist sync or a deck review of the selected Player', async () => {
			mockPlayerId.value = 5;
			mountDeckModeData();
			await flushPromises();

			deliver('melee:decklistsSynced', { playerCount: 1, deckCount: 1 });
			await flushPromises();
			deliver('playerDeck:reviewed', { deck: { playerId: 6 } });
			await flushPromises();
			expect(mockPlayerDecks).toHaveBeenCalledTimes(2);

			deliver('playerDeck:reviewed', { deck: { playerId: 5 } });
			await flushPromises();
			expect(mockPlayerDecks).toHaveBeenCalledTimes(3);
		});

		describe('a resolved deck card, which moves no Player revision (#648)', () => {
			/** The card the server holds once the unresolved entry is resolved. */
			let resolved: boolean;

			beforeEach(() => {
				resolved = false;
				mockReadDeck.mockImplementation(async () =>
					createDeckResponse([createDeckCard({ name: resolved ? 'Lightning Bolt' : 'Counterspell' })]));
			});

			it('stages the rewritten Deck List of the selected Player, and reads nothing for another', async () => {
				mockPlayerId.value = 5;
				const result = mountDeckModeData();
				await flushPromises();
				expect(mainboardNames(result)).toEqual(['Counterspell']);

				resolved = true;
				deliver('playerDeck:cardsResolved', { deckIds: [9], playerIds: [6] });
				await flushPromises();
				expect(mockPlayerDecks).toHaveBeenCalledTimes(1);

				deliver('playerDeck:cardsResolved', { deckIds: [3, 9], playerIds: [5, 6] });
				await flushPromises();

				expect(mockPlayerDecks).toHaveBeenCalledTimes(2);
				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});

			it('swaps in the rewritten Deck List even while its card data is still degraded', async () => {
				mockFetchScryfallCards.mockResolvedValue({ cards: new Map(), degraded: true });
				mockPlayerId.value = 5;
				const result = mountDeckModeData();
				await flushPromises();
				expect(mainboardNames(result)).toEqual(['Counterspell']);

				resolved = true;
				deliver('playerDeck:cardsResolved', { deckIds: [3], playerIds: [5] });
				await flushPromises();

				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});

			it('shows a resolution missed while disconnected once its channel is attached again', async () => {
				mockPlayerId.value = 5;
				const result = mountDeckModeData();
				await flushPromises();

				mockRealtime.connectionState = 'disconnected';
				await nextTick();
				resolved = true;
				mockRealtime.connectionState = 'connected';
				continuity.reattach('event:1');
				await flushPromises();

				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				await nextTick();
				expect(mainboardNames(result)).toEqual(['Lightning Bolt']);
			});
		});

		it('re-reads while disconnected without re-staging a deck that has not changed', async () => {
			vi.useFakeTimers();
			try {
				mockPlayerId.value = 5;
				const result = mountDeckModeData();
				await vi.advanceTimersByTimeAsync(0);

				mockRealtime.connectionState = 'disconnected';
				await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 2);
				expect(mockPlayerDecks).toHaveBeenCalledTimes(3);
				expect(result.pendingSwapVersion.value).toBe(0);

				// The edit lands on the next cadence read, not the next message.
				serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
				await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
				expect(result.pendingSwapVersion.value).toBe(1);
				result.commitPendingDeck();
				expect(mainboardNames(result)).toEqual(['Brainstorm']);
			}
			finally {
				vi.useRealTimers();
			}
		});

		it('clears a Deck List removed while disconnected once its channel is attached again', async () => {
			mockPlayerId.value = 5;
			const result = mountDeckModeData();
			await flushPromises();
			expect(mainboardNames(result)).toEqual(['Counterspell']);

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			serverPlayer = { ...serverPlayer, updatedAt: AFTER_EDIT };
			mockReadDeck.mockResolvedValue(null);
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(result.pendingSwapVersion.value).toBe(1);
			result.commitPendingDeck();
			expect(result.hasDisplayedDeck.value).toBe(false);
			expect(result.error.value).toBe('Player has no deck list');
		});

		it('leaves a deleted Player\'s deck once the Screen clears its Deck Source, and stops re-reading them (#651)', async () => {
			vi.useFakeTimers();
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			try {
				mockPlayerId.value = 5;
				const result = mountDeckModeData();
				await vi.advanceTimersByTimeAsync(0);
				expect(mainboardNames(result)).toEqual(['Counterspell']);

				// Deleted while disconnected: the resync's read finds no Player and retries.
				mockRealtime.connectionState = 'disconnected';
				await nextTick();
				mockReadPlayer.mockImplementation(async () => null);
				mockRealtime.connectionState = 'connected';
				continuity.reattach('event:1');
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
			}
			finally {
				consoleError.mockRestore();
				vi.useRealTimers();
			}
		});

		it('shows a deck imported after the Player was selected without one', async () => {
			mockReadDeck.mockImplementation(async (_playerId: number, _eventId: number, updatedAt: string) =>
				createDeckResponse(updatedAt === BEFORE_EDIT ? [] : [createDeckCard({ name: 'Brainstorm' })]));
			mockPlayerId.value = 5;
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
