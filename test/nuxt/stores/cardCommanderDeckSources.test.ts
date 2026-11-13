import type { CommanderDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { Commander } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIMAR, ASHLING, deckListEntryOf, MOXFIELD_CARDS } from '~~/test/helpers/magicDeckText';
import { createFollowedFeatureMatchSessions, followNoSession } from '~~/test/nuxt/helpers/followedFeatureMatchSession';

// Cards page Feature Match Deck Lists on a Commander Event (ADR-0087): the picked Slot's
// Seats, each with its Commanders and the list it holds. The server's Deck List reads
// are faked at `$fetch`; card data at the Scryfall batch.

const { ashling, animar, forest, hedgeMaze } = MOXFIELD_CARDS;

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useScryfallBatch', async () => {
	const actual = await vi.importActual<typeof import('~/composables/data/useScryfallBatch')>('~/composables/data/useScryfallBatch');
	return () => ({
		...actual.useScryfallBatch(),
		// Each printing asked for answers its own card.
		fetchScryfallCards: async (cards: Array<{ scryfallId: string | null }>) => ({
			cards: new Map(cards.flatMap(card => card.scryfallId
				? [
						[
							card.scryfallId,
							{ id: card.scryfallId },
						],
					]
				: [])),
			degraded: false,
		}),
	});
});

mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	event: {
		id: 1,
		game: 'mtg',
		variant: 'commander',
		cardTimeout: 0,
	},
}));
mockNuxtImport('useCardRepository', () => () => ({
	getScreenCard: vi.fn(async () => ({ card: null, revision: 0 })),
}));

const featureMatchStore = reactive({ featureMatches: [] as any[] });
mockNuxtImport('useFeatureMatchStore', () => () => featureMatchStore);
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));

const followed = createFollowedFeatureMatchSessions();
mockNuxtImport('useFeatureMatchStateStore', () => () => followed);

/** The Deck Lists the server answers, by id; a missing one fails its read. */
let deckLists: Map<number, CommanderDeckListEntry[]>;

function seat(name: string, commanders: Commander[], deckListId?: number) {
	return {
		name,
		gameData: {
			type: 'mtg' as const,
			commanders,
			deckName: commanders.map(commander => commander.name).join(' / '),
			deckColors: 'URG',
			...(deckListId
				? {
						featureMatchDeckList: { id: deckListId, mainboardCount: 3 },
					}
				: {}),
		},
	};
}

/** Slot 7: Ana in Seat 1 with a list, nobody in Seats 2 and 3, Dee in Seat 4 with a Commander alone. */
function slot7(anaDeckListId = 301) {
	return {
		id: 7,
		player1Id: null,
		player2Id: null,
		player1Data: seat('Ana', [ASHLING], anaDeckListId),
		player2Data: null,
		player4Data: seat('Dee', [ANIMAR]),
		activeSession: null,
	};
}

/** Each Seat shown, with its Commanders and Mainboard as the printings' card data. */
function shown() {
	return useCardStore().commanderDeckListSeats.map(seated => ({
		seat: seated.seat,
		player: seated.playerName,
		commanders: seated.commanders.map(card => card.mtgCard?.id),
		mainboard: seated.mainboard.map(card => [card.quantity, card.mtgCard?.id]),
		failed: seated.failed,
	}));
}

describe('useCardStore Commander Feature Match Deck Lists', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		followNoSession(followed);
		featureMatchStore.featureMatches = [
			slot7(),
		];
		deckLists = new Map([
			[
				301,
				[
					deckListEntryOf(ashling),
					deckListEntryOf(forest, 3),
				],
			],
			[
				302,
				[
					deckListEntryOf(ashling),
					deckListEntryOf(hedgeMaze),
				],
			],
		]);
		mockFetch.mockReset();
		mockFetch.mockImplementation(async (path: string) => {
			const id = Number(/\/feature-match-slots\/7\/commander-deck-lists\/(\d+)$/.exec(path)?.[1]);
			const entries = deckLists.get(id);
			if (!entries)
				throw Object.assign(new Error('Not found'), { statusCode: 404 });
			return {
				id,
				slotId: 7,
				sourceText: '',
				entries,
			};
		});
	});

	it('shows each Seat somebody sits in, its Commanders apart from the Mainboard of the list it holds', async () => {
		await store.loadMatchDeckLists(7);

		expect(shown()).toEqual([
			{
				seat: 'player1',
				player: 'Ana',
				commanders: [ashling.id],
				mainboard: [
					[3, forest.id],
				],
				failed: false,
			},
			{
				seat: 'player4',
				player: 'Dee',
				commanders: [animar.id],
				mainboard: [],
				failed: false,
			},
		]);
		expect(store.deckListHasData).toBe(true);
	});

	// A re-paste gives the list a new id, which the Slot announces.
	it('reloads the shown Slot when a Seat names another list', async () => {
		await store.loadMatchDeckLists(7);

		featureMatchStore.featureMatches = [
			slot7(302),
		];
		await flushPromises();

		expect(shown()[0]?.mainboard).toEqual([
			[1, hedgeMaze.id],
		]);
	});

	it('keeps a Seat\'s Commanders, and says so, when its list cannot be read', async () => {
		deckLists.delete(301);

		await store.loadMatchDeckLists(7);

		expect(shown()[0]).toMatchObject({
			commanders: [ashling.id],
			mainboard: [],
			failed: true,
		});
	});

	it.each([
		{
			slots: 'a Slot seating a Commander',
			seats: () => [
				slot7(),
			],
			offered: true,
		},
		{
			slots: 'no Seat holding a Commander',
			seats: () => [
				{
					...slot7(),
					player1Data: { name: 'Ana' },
					player4Data: null,
				},
			],
			offered: false,
		},
	])('offers the Feature Match Deck List mode with $slots: $offered', ({ seats, offered }) => {
		featureMatchStore.featureMatches = seats();

		expect(store.canUseDeckListMode).toBe(offered);
	});
});
