import type { OpDeckListEntry } from '~~/shared/types/opDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { NAMI, opDeckListEntry, opSlotSide, ZORO } from '~~/test/helpers/opCards';
import { createFollowedFeatureMatchSessions, followNoSession, followSwappedSession } from '~~/test/nuxt/helpers/followedFeatureMatchSession';

// Cards page Feature Match Deck Lists on a One Piece Event (ADR-0057): a Slot side
// shows its own Feature Match Deck List or its linked Player's. The server's
// Deck List reads are faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	event: { id: 1, game: 'op', cardTimeout: 0 },
}));
mockNuxtImport('useCardRepository', () => () => ({
	getScreenCard: vi.fn(async () => ({ card: null, revision: 0 })),
}));

const featureMatchStore = reactive({ featureMatches: [] as any[] });
mockNuxtImport('useFeatureMatchStore', () => () => featureMatchStore);
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));

const followed = createFollowedFeatureMatchSessions();
mockNuxtImport('useFeatureMatchStateStore', () => () => followed);

/** Deck List bodies the server answers, by request path. */
let deckLists: Map<string, unknown>;

function deckListView(entries: OpDeckListEntry[], leaderNumber: string) {
	return {
		entries,
		leaderNumber,
		mainboardCount: 50,
		warnings: [],
	};
}

const ALICE_LIST = deckListView([
	opDeckListEntry(ZORO.number, 1, 'leader'),
	opDeckListEntry('OP01-025', 4, 'character', 3),
], ZORO.number);
const ALICE_REPASTE = deckListView([
	opDeckListEntry(ZORO.number, 1, 'leader'),
	opDeckListEntry('OP01-026', 4, 'event', 1),
], ZORO.number);
const BOB_LIST = deckListView([
	opDeckListEntry(NAMI.number, 1, 'leader'),
	opDeckListEntry('OP01-060', 4, 'character', 2),
], NAMI.number);

/** Bob, Player 42, linked to a side, whose slot data names his own Deck List. */
function linkedBob(deckListId: number | null) {
	return {
		name: 'Bob',
		gameData: {
			type: 'op' as const,
			leader: NAMI,
			deckList: deckListId === null
				? null
				: { id: deckListId, mainboardCount: 50, leaderNumber: NAMI.number },
		},
	};
}

/** Slot 7: Alice by hand with a pasted Feature Match Deck List, against linked Player Bob. */
function slot7(aliceDeckListId: number | null = 301, bobDeckListId: number | null = 501) {
	return {
		id: 7,
		player1Id: null,
		player1Data: opSlotSide('Alice', ZORO, aliceDeckListId),
		player2Id: 42,
		player2Data: linkedBob(bobDeckListId),
		activeSession: null,
	};
}

/** Who each side shows, with their Leader and Deck List's card numbers. */
function shown() {
	const store = useCardStore();
	return [store.opDeckListPlayer1, store.opDeckListPlayer2].map(side => side && {
		player: side.playerName,
		leader: side.leader?.name ?? null,
		cards: side.deckList?.entries.map(entry => entry.number) ?? null,
		failed: side.failed,
	});
}

describe('useCardStore One Piece Feature Match Deck Lists', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		followNoSession(followed);
		featureMatchStore.featureMatches = [
			slot7(),
		];
		deckLists = new Map<string, unknown>([
			[
				'/api/events/1/feature-match-slots/7/deck-lists/301',
				{
					...ALICE_LIST,
					id: 301,
					slotId: 7,
					sourceText: '',
				},
			],
			[
				'/api/events/1/feature-match-slots/7/deck-lists/302',
				{
					...ALICE_REPASTE,
					id: 302,
					slotId: 7,
					sourceText: '',
				},
			],
			[
				'/api/events/1/players/42/deck-list',
				{
					deckList: {
						...BOB_LIST,
						id: 501,
						playerId: 42,
						handEdited: false,
						sourceText: '',
					},
				},
			],
		]);
		mockFetch.mockReset().mockImplementation(async (path: string) => {
			if (!deckLists.has(path))
				throw new Error(`500 ${path}`);
			return deckLists.get(path);
		});
	});

	afterEach(() => {
		store.$reset();
	});

	it.each([
		[
			'a pasted Deck List',
			slot7(301, null),
			true,
		],
		[
			'a linked Player\'s Deck List',
			slot7(null, 501),
			true,
		],
		[
			'no Deck List on either side',
			slot7(null, null),
			false,
		],
	])('offers the Deck List mode for a Slot holding %s: %s', (_, slot, usable) => {
		featureMatchStore.featureMatches = [slot];

		expect(store.canUseDeckListMode).toBe(usable);
	});

	it('shows a side\'s pasted Deck List and a linked side\'s Player Deck List', async () => {
		await store.loadMatchDeckLists(7);

		expect(shown()).toEqual([
			{
				player: 'Alice',
				leader: 'Roronoa Zoro',
				cards: [ZORO.number, 'OP01-025'],
				failed: false,
			},
			{
				player: 'Bob',
				leader: 'Nami',
				cards: [NAMI.number, 'OP01-060'],
				failed: false,
			},
		]);
	});

	it.each([
		[
			'a swap seats each player, and their Deck List, on the other side',
			() => followSwappedSession(followed, slot7()),
			['Bob', 'Alice'],
			[
				[NAMI.number, 'OP01-060'],
				[ZORO.number, 'OP01-025'],
			],
		],
		[
			'a re-paste shows the new Deck List',
			() => {
				featureMatchStore.featureMatches = [
					slot7(302),
				];
			},
			['Alice', 'Bob'],
			[
				[ZORO.number, 'OP01-026'],
				[NAMI.number, 'OP01-060'],
			],
		],
	])('reloads the shown Slot in place when %s', async (_, change, players, cards) => {
		await store.loadMatchDeckLists(7);

		change();
		await flushPromises();

		expect(shown().map(side => side?.player)).toEqual(players);
		expect(shown().map(side => side?.cards)).toEqual(cards);
		expect(store.loadingDeckList).toBe(false);
	});

	it.each([
		[
			'holds none',
			slot7(null),
			{
				player: 'Alice',
				leader: 'Roronoa Zoro',
				cards: null,
				failed: false,
			},
		],
		[
			'cannot be read',
			slot7(999),
			{
				player: 'Alice',
				leader: 'Roronoa Zoro',
				cards: null,
				failed: true,
			},
		],
	])('shows a side whose Deck List it %s without one', async (_, slot, side) => {
		featureMatchStore.featureMatches = [slot];

		await store.loadMatchDeckLists(7);

		expect(shown()[0]).toEqual(side);
		expect(shown()[1]?.cards).toEqual([NAMI.number, 'OP01-060']);
	});

	it('shows the Slot picked last when an earlier pick answers after it', async () => {
		const slow = deferred<unknown>();
		featureMatchStore.featureMatches = [
			slot7(),
			{
				...slot7(null, null),
				id: 8,
				player1Data: opSlotSide('Carol', null, null),
			},
		];
		mockFetch.mockImplementationOnce(() => slow.promise);

		const first = store.loadMatchDeckLists(7);
		await store.loadMatchDeckLists(8);
		slow.resolve({
			...ALICE_LIST,
			id: 301,
			slotId: 7,
			sourceText: '',
		});
		await first;

		expect(shown().map(side => side?.player)).toEqual(['Carol', 'Bob']);
		expect(store.loadingDeckList).toBe(false);
	});
});
