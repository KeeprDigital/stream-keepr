import type { EffectScope } from 'vue';
import type { DeckModeConfig, DeckSource } from '~~/shared/screenModeConfigs/deck';
import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { opSlotSide } from '~~/test/helpers/opCards';
import { createFollowedFeatureMatchSessions, followNoSession, followSwappedSession } from '~~/test/nuxt/helpers/followedFeatureMatchSession';
import { clearPlayerDeckCache } from '~/composables/data/usePlayerDeckCache';
import { useDeckBoardCards } from '~/composables/screen/useDeckBoardCards';

// How many cards each board of a Deck List Screen lays out, as its settings page knows them: one per
// Deck List entry where the list is held, its copies where only those are, and nothing with no Deck List.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const eventStore = reactive({
	event: null as { id: number; game: Game } | null,
});
const playerStore = reactive({
	players: [] as Array<Record<string, unknown>>,
});
const featureMatchStore = reactive({
	featureMatches: [] as Array<Record<string, unknown>>,
});
const featureMatchStateStore = createFollowedFeatureMatchSessions();
const broadcastDeckListStore = reactive({
	summaries: [] as Array<Record<string, unknown>>,
	details: new Map<number, Record<string, unknown>>(),
});

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerStore', () => () => playerStore);
mockNuxtImport('useFeatureMatchStore', () => () => featureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => featureMatchStateStore);
mockNuxtImport('useBroadcastDeckListStore', () => () => broadcastDeckListStore);

type Compartment = 'mainboard' | 'sideboard' | 'companion';

/** A Player's Deck List entry: `quantity` copies of one card. */
function card(name: string, compartment: Compartment, quantity = 1) {
	return { name, compartment, quantity };
}

/** A Broadcast Deck List entry: `quantity` copies of one card. */
function entry(canonicalName: string, compartment: Compartment, quantity = 1) {
	return { canonicalName, compartment, quantity };
}

/** What `GET …/players/:id/decks` answers: the Player's one Deck List, or none. */
function playerDecks(cards: ReturnType<typeof card>[] | null, companion: string | null = null) {
	return cards === null
		? { decks: [], selectedDeckId: null }
		: {
				decks: [
					{
						id: 10,
						isPrimary: true,
						cards,
						companion: companion === null
							? null
							: { name: companion },
					},
				],
				selectedDeckId: 10,
			};
}

function mtgPlayer(id: number, updatedAt = '2026-08-01T00:00:00.000Z') {
	return {
		id,
		name: `Player ${id}`,
		updatedAt,
		gameData: { type: 'mtg', deckName: 'Mono Blue' },
	};
}

function opPlayer(id: number, mainboardCount: number | null) {
	return {
		id,
		name: `Player ${id}`,
		updatedAt: '2026-08-01T00:00:00.000Z',
		gameData: {
			type: 'op',
			deckList: mainboardCount === null
				? null
				: { id: 600 + id, mainboardCount, leaderNumber: 'OP01-001' },
		},
	};
}

function summary(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name: 'Feature Table',
		revision: 1,
		mainboardQuantity: 60,
		sideboardQuantity: 15,
		hasCompanion: false,
		...overrides,
	};
}

/** An OP Slot: its first side holds its own Feature Match Deck List, its second sits a linked Player holding theirs. */
const SLOT = {
	id: 11,
	player1Id: null,
	player2Id: 6,
	player1Data: opSlotSide('Alice', null, 501),
	player2Data: {
		name: 'Bea',
		gameData: {
			type: 'op',
			deckList: { id: 606, mainboardCount: 42, leaderNumber: 'OP01-001' },
		},
	},
	activeSession: null,
};

const PLAYER: DeckSource = { type: 'player', playerId: 1 };
const BROADCAST: DeckSource = { type: 'broadcast', broadcastDeckListId: 23 };
const SLOT_SIDE: DeckSource = { type: 'featureMatchSlot', slotId: 11, side: 'player1' };

const BURN = [
	card('Lightning Bolt', 'mainboard', 4),
	card('Goblin Guide', 'mainboard', 4),
	card('Mountain', 'mainboard', 20),
	card('Smash to Smithereens', 'sideboard', 3),
	card('Roiling Vortex', 'sideboard', 2),
];

const scopes: EffectScope[] = [];

/** The counts as a settings page follows them for `config`, read once every read in flight has settled. */
async function follow(config: Partial<DeckModeConfig> | (() => Partial<DeckModeConfig>)) {
	const scope = effectScope();
	scopes.push(scope);
	const cards = scope.run(() => useDeckBoardCards(config, 1))!;
	await flushPromises();
	return cards;
}

describe('the cards each board of a Deck List Screen lays out', () => {
	beforeEach(() => {
		clearPlayerDeckCache();
		mockFetch.mockResolvedValue(playerDecks(BURN));
		eventStore.event = { id: 1, game: 'mtg' };
		playerStore.players = [
			mtgPlayer(1),
			mtgPlayer(2),
		];
		featureMatchStore.featureMatches = [SLOT];
		followNoSession(featureMatchStateStore);
		broadcastDeckListStore.summaries = [];
		broadcastDeckListStore.details = new Map();
	});

	afterEach(() => {
		for (const scope of scopes.splice(0))
			scope.stop();
	});

	// A card is one Deck List entry, a grid cell, whatever its copies. A shown companion heads the sideboard, once.
	it.each([
		{
			name: 'an entry each, whatever its copies',
			decks: playerDecks(BURN),
			config: {},
			cards: { mainboard: 3, sideboard: 2 },
		},
		{
			name: 'no sideboard cards for a Deck List without one',
			decks: playerDecks(BURN.filter(held => held.compartment === 'mainboard')),
			config: {},
			cards: { mainboard: 3, sideboard: 0 },
		},
		{
			name: 'a companion from outside the sideboard as one more sideboard card',
			decks: playerDecks(BURN, 'Lurrus of the Dream-Den'),
			config: {},
			cards: { mainboard: 3, sideboard: 3 },
		},
		{
			name: 'a companion the sideboard already lists once',
			decks: playerDecks(BURN, 'Roiling Vortex'),
			config: {},
			cards: { mainboard: 3, sideboard: 2 },
		},
		{
			name: 'no companion while the Screen hides it',
			decks: playerDecks(BURN, 'Lurrus of the Dream-Den'),
			config: { showCompanion: false },
			cards: { mainboard: 3, sideboard: 2 },
		},
	])('counts a Magic Player\'s Deck List as $name', async ({ decks, config, cards }) => {
		mockFetch.mockResolvedValue(decks);

		const counted = await follow({ deckSource: PLAYER, ...config });

		expect(counted.value).toEqual(cards);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/1/decks', { query: {} });
	});

	// The list itself gives entries; its summary only copies, a looser count that is never under the entries.
	it.each([
		{
			name: 'its entries where the list is loaded',
			summaries: [
				summary(23),
			],
			detail: {
				...summary(23),
				entries: [
					entry('Lightning Bolt', 'mainboard', 4),
					entry('Mountain', 'mainboard', 56),
					entry('Roiling Vortex', 'sideboard', 15),
				],
			},
			config: {},
			cards: { mainboard: 2, sideboard: 1 },
		},
		{
			name: 'its entries with its companion heading the sideboard',
			summaries: [
				summary(23, { hasCompanion: true }),
			],
			detail: {
				...summary(23, { hasCompanion: true }),
				entries: [
					entry('Mountain', 'mainboard', 60),
					entry('Roiling Vortex', 'sideboard', 14),
					entry('Lurrus of the Dream-Den', 'companion'),
				],
			},
			config: {},
			cards: { mainboard: 1, sideboard: 2 },
		},
		{
			name: 'its copies where only its summary is held',
			summaries: [
				summary(23),
			],
			detail: null,
			config: {},
			cards: { mainboard: 60, sideboard: 15 },
		},
		{
			name: 'its copies and its companion where only its summary is held',
			summaries: [
				summary(23, { hasCompanion: true }),
			],
			detail: null,
			config: {},
			cards: { mainboard: 60, sideboard: 16 },
		},
		{
			name: 'its copies without a companion the Screen hides',
			summaries: [
				summary(23, { hasCompanion: true }),
			],
			detail: null,
			config: { showCompanion: false },
			cards: { mainboard: 60, sideboard: 15 },
		},
		{
			name: 'its copies where the list held is older than its summary',
			summaries: [
				summary(23, { revision: 2, mainboardQuantity: 40, sideboardQuantity: 0 }),
			],
			detail: {
				...summary(23),
				entries: [
					entry('Mountain', 'mainboard', 60),
				],
			},
			config: {},
			cards: { mainboard: 40, sideboard: 0 },
		},
		{
			name: 'no cards for an empty list',
			summaries: [
				summary(23, { mainboardQuantity: 0, sideboardQuantity: 0 }),
			],
			detail: null,
			config: {},
			cards: { mainboard: 0, sideboard: 0 },
		},
	])('counts a Broadcast Deck List as $name', async ({ summaries, detail, config, cards }) => {
		broadcastDeckListStore.summaries = summaries;
		broadcastDeckListStore.details = new Map(detail
			? [
					[23, detail],
				]
			: []);

		const counted = await follow({ deckSource: BROADCAST, ...config });

		expect(counted.value).toEqual(cards);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	// A One Piece Deck List is held by reference, which carries its Mainboard's copies; it has no sideboard.
	it.each([
		{
			name: 'a Slot side holding its own Feature Match Deck List',
			deckSource: SLOT_SIDE,
			cards: { mainboard: 50, sideboard: 0 },
		},
		{
			name: 'a Slot side showing its linked Player\'s Deck List',
			deckSource: { ...SLOT_SIDE, side: 'player2' },
			cards: { mainboard: 42, sideboard: 0 },
		},
		{
			name: 'a Player',
			deckSource: { type: 'player', playerId: 5 },
			cards: { mainboard: 38, sideboard: 0 },
		},
	] as { name: string; deckSource: DeckSource; cards: { mainboard: number; sideboard: number } }[])('counts the Mainboard copies of a One Piece Deck List from $name', async ({ deckSource, cards }) => {
		eventStore.event = { id: 1, game: 'op' };
		playerStore.players = [
			opPlayer(5, 38),
		];

		const counted = await follow({ deckSource });

		expect(counted.value).toEqual(cards);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	// With no Deck List resolved there is nothing to count, so the contract's own bound stands.
	it.each([
		{
			name: 'no Player selected',
			game: 'mtg',
			deckSource: { type: 'player', playerId: null },
		},
		{
			name: 'a Player the Event no longer holds',
			game: 'mtg',
			deckSource: { type: 'player', playerId: 99 },
		},
		{
			name: 'a Magic Player with no Deck List',
			game: 'mtg',
			deckSource: PLAYER,
			decks: playerDecks(null),
		},
		{
			name: 'a Magic Player whose Deck List holds no cards',
			game: 'mtg',
			deckSource: PLAYER,
			decks: playerDecks([]),
		},
		{
			name: 'a Magic Player whose Deck List read failed',
			game: 'mtg',
			deckSource: PLAYER,
			decks: new Error('offline'),
		},
		{
			name: 'a Broadcast Deck List the Event does not hold',
			game: 'mtg',
			deckSource: BROADCAST,
		},
		{
			name: 'a One Piece Player with no Deck List',
			game: 'op',
			deckSource: { type: 'player', playerId: 5 },
		},
		{
			name: 'no Slot selected',
			game: 'op',
			deckSource: { ...SLOT_SIDE, slotId: null },
		},
		{
			name: 'a Slot the Event no longer holds',
			game: 'op',
			deckSource: { ...SLOT_SIDE, slotId: 99 },
		},
		{
			name: 'a Slot side holding no Deck List',
			game: 'op',
			deckSource: SLOT_SIDE,
			slot: {
				...SLOT,
				player1Data: opSlotSide('Alice', null, null),
			},
		},
		{
			name: 'an Event still loading',
			game: null,
			deckSource: PLAYER,
		},
	] as { name: string; game: Game | null; deckSource: DeckSource; decks?: unknown; slot?: typeof SLOT }[])('counts nothing for $name', async ({ game, deckSource, decks, slot }) => {
		eventStore.event = game && { id: 1, game };
		playerStore.players = game === 'op'
			? [
					opPlayer(5, null),
				]
			: [
					mtgPlayer(1),
				];
		if (slot)
			featureMatchStore.featureMatches = [slot];
		if (decks instanceof Error)
			mockFetch.mockRejectedValue(decks);
		else if (decks)
			mockFetch.mockResolvedValue(decks);

		const counted = await follow({ deckSource });

		expect(counted.value).toBeUndefined();
	});

	it('counts nothing while a Player\'s Deck List is still being read, then its cards', async () => {
		const read = deferred<unknown>();
		mockFetch.mockReturnValue(read.promise);

		const counted = await follow({ deckSource: PLAYER });
		expect(counted.value).toBeUndefined();

		read.resolve(playerDecks(BURN));
		await flushPromises();
		expect(counted.value).toEqual({ mainboard: 3, sideboard: 2 });
	});

	// Live: the count follows the Deck Source and its Deck List while the page stays open.
	it('follows the Deck Source to another Player, counting nothing of the first while the second is read', async () => {
		const second = deferred<unknown>();
		mockFetch.mockImplementation((url: string) => url.includes('/players/2/')
			? second.promise
			: Promise.resolve(playerDecks(BURN)));
		const config = ref<Partial<DeckModeConfig>>({ deckSource: PLAYER });
		const counted = await follow(() => config.value);
		expect(counted.value).toEqual({ mainboard: 3, sideboard: 2 });

		config.value = {
			deckSource: { type: 'player', playerId: 2 },
		};
		await flushPromises();
		expect(counted.value).toBeUndefined();

		second.resolve(playerDecks([
			card('Island', 'mainboard', 60),
		]));
		await flushPromises();
		expect(counted.value).toEqual({ mainboard: 1, sideboard: 0 });
	});

	it('follows a Player\'s rewritten Deck List, keeping the count held until the new one is read', async () => {
		const counted = await follow({ deckSource: PLAYER });
		const rewritten = deferred<unknown>();
		mockFetch.mockReturnValue(rewritten.promise);

		playerStore.players = [
			mtgPlayer(1, '2026-08-02T00:00:00.000Z'),
		];
		await flushPromises();
		expect(counted.value).toEqual({ mainboard: 3, sideboard: 2 });

		rewritten.resolve(playerDecks([
			...BURN,
			card('Skullcrack', 'mainboard', 4),
		]));
		await flushPromises();
		expect(counted.value).toEqual({ mainboard: 4, sideboard: 2 });
	});

	it('follows a Deck Source changed to another kind', async () => {
		broadcastDeckListStore.summaries = [
			summary(23),
		];
		const config = ref<Partial<DeckModeConfig>>({ deckSource: PLAYER });
		const counted = await follow(() => config.value);

		config.value = { deckSource: BROADCAST };
		await flushPromises();

		expect(counted.value).toEqual({ mainboard: 60, sideboard: 15 });
	});

	it('follows a Broadcast Deck List from its copies to its entries once the list loads', async () => {
		broadcastDeckListStore.summaries = [
			summary(23),
		];
		const counted = await follow({ deckSource: BROADCAST });
		expect(counted.value).toEqual({ mainboard: 60, sideboard: 15 });

		broadcastDeckListStore.details = new Map([
			[
				23,
				{
					...summary(23),
					entries: [
						entry('Mountain', 'mainboard', 60),
						entry('Roiling Vortex', 'sideboard', 15),
					],
				},
			],
		]);

		expect(counted.value).toEqual({ mainboard: 1, sideboard: 1 });
	});

	it('follows a Slot side to the player a swap seats there', async () => {
		eventStore.event = { id: 1, game: 'op' };
		const counted = await follow({ deckSource: SLOT_SIDE });
		expect(counted.value).toEqual({ mainboard: 50, sideboard: 0 });

		followSwappedSession(featureMatchStateStore, SLOT);

		expect(counted.value).toEqual({ mainboard: 42, sideboard: 0 });
	});
});
