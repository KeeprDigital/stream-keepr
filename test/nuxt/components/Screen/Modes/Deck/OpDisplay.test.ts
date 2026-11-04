import type { VueWrapper } from '@vue/test-utils';
import type { FeatureMatchDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { LUFFY, NAMI, opDeckListEntry, opSlotSide as side, ZORO } from '~~/test/helpers/opCards';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import OpDisplay from '~/components/Screen/Modes/Deck/OpDisplay.vue';

// A One Piece Deck List Screen follows its Deck Source live: a Feature Match
// Slot side's whichever player sits there now (ADR-0058), or a Player's own
// Deck List through every write to it (ADR-0074).

const SLOT_ID = 11;

const featureMatchStore = reactive({
	featureMatches: [] as Array<Record<string, unknown>>,
	holdFeatureMatch: vi.fn((slot: Record<string, unknown>) => {
		featureMatchStore.featureMatches = [slot];
		return true;
	}),
});
const featureMatchStateStore = reactive({
	featureMatchStates: new Map<number, unknown>(),
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
	readSessionsAsScreenOutput: vi.fn(() => vi.fn()),
});
mockNuxtImport('useFeatureMatchStore', () => () => featureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => featureMatchStateStore);

const realtime = createFakeEventChannel();
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);

/** The network: the Screen Output reads of the Slot and its Deck Lists. */
const deckListReads = new Map<number, Promise<unknown>>();
const mockFetch = vi.hoisted(() => vi.fn());
mockNuxtImport('$fetch', () => mockFetch);

const images = stubImageLoading();

function deckList(id: number, entries: FeatureMatchDeckListEntry[]) {
	return {
		id,
		slotId: SLOT_ID,
		playerId: 31,
		entries,
		leaderNumber: entries[0]?.number ?? null,
		mainboardCount: 0,
	};
}

const ALICE_LIST = deckList(501, [
	opDeckListEntry('OP01-003', 1, 'leader', null),
	opDeckListEntry('OP01-030', 2, 'stage', 1),
	opDeckListEntry('OP01-020', 4, 'character', 5),
	opDeckListEntry('OP01-026', 3, 'event', 2),
	opDeckListEntry('OP01-013', 4, 'character', 2),
	opDeckListEntry('OP01-029', 2, 'event', 0),
]);
const BOB_LIST = deckList(502, [
	opDeckListEntry('OP01-016', 1, 'leader', null),
	opDeckListEntry('OP01-040', 4, 'character', 3),
]);
const ALICE_REPASTED = deckList(503, [
	opDeckListEntry('OP01-003', 1, 'leader', null),
	opDeckListEntry('OP01-050', 4, 'event', 1),
]);

function slot(player1Data: unknown, player2Data: unknown) {
	return {
		id: SLOT_ID,
		matchId: null,
		player1Id: null,
		player2Id: null,
		player1Data,
		player2Data,
		activeSession: null,
	};
}

const ALICE = side('Alice', LUFFY, 501);

/** A Player's Deck List, as the Screen Output read answers it with the Player. */
const ZORO_LIST_ENTRIES = [
	opDeckListEntry('OP01-001', 1, 'leader', null),
	opDeckListEntry('OP01-013', 4, 'character', 2),
	opDeckListEntry('OP01-026', 3, 'event', 2),
	opDeckListEntry('OP99-999', 2, null),
];
function opPlayer(overrides: Record<string, unknown> = {}) {
	return {
		id: 31,
		eventId: 7,
		name: '',
		nickname: 'zoro_main',
		updatedAt: '2026-11-01T10:00:00.000Z',
		gameData: {
			type: 'op',
			deckList: { id: 601, mainboardCount: 9, leaderNumber: 'OP01-001' },
		},
		...overrides,
	};
}
const ZORO_MAIN = opPlayer();
const playerRead = ref<unknown>(null);
const BOB = side('Bob', NAMI, 502);

/** The Session the Live State Follower holds after Swap Players: the snapshot's sides swapped. */
function followSwappedSession() {
	featureMatchStateStore.featureMatchSessions.set(90, {
		id: 90,
		slotId: SLOT_ID,
		sourceSnapshot: {
			player1: { playerId: null, data: BOB },
			player2: { playerId: null, data: ALICE },
		},
	});
	featureMatchStateStore.sessionIdBySlotId.set(SLOT_ID, 90);
}

const screen = ref<{ id: number; modeConfigs: Record<string, unknown> }>({ id: 42, modeConfigs: {} });

function showSource(deckSource: Record<string, unknown>) {
	screen.value = {
		id: 42,
		modeConfigs: {
			deck: { deckSource },
		},
	};
}

function mountDisplay(deckSide: 'player1' | 'player2' = 'player1') {
	return mountSource({ type: 'featureMatchSlot', slotId: SLOT_ID, side: deckSide });
}

function mountSource(deckSource: Record<string, unknown>) {
	showSource(deckSource);
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: screen as never,
				eventId: computed(() => 7),
				interactive: ref(false),
				overlayContainer: ref(null),
			});
			return () => h(OpDisplay);
		},
	});
	return mount(Parent);
}

function shown(wrapper: VueWrapper) {
	const root = wrapper.find('[data-testid="op-deck"]');
	const player = wrapper.find('[data-testid="deck-player-name"]');
	const leader = wrapper.find('[data-testid="op-deck-leader"]');
	return {
		state: root.attributes('data-deck-state'),
		deckListId: root.attributes('data-deck-list-id'),
		player: player.exists()
			? player.text()
			: null,
		leader: leader.exists()
			? leader.attributes('data-number')
			: null,
	};
}

beforeEach(() => {
	featureMatchStore.featureMatches = [];
	featureMatchStateStore.featureMatchSessions = new Map();
	featureMatchStateStore.sessionIdBySlotId = new Map();
	images.reset();
	deckListReads.clear();
	for (const list of [ALICE_LIST, BOB_LIST, ALICE_REPASTED])
		deckListReads.set(list.id, Promise.resolve(list));
	mockFetch.mockReset();
	playerRead.value = {
		player: ZORO_MAIN,
		deckList: deckList(601, ZORO_LIST_ENTRIES),
	};
	mockFetch.mockImplementation(async (path: string) => {
		if (/players\/31\/deck-list$/.test(path))
			return playerRead.value;
		const listId = /feature-match-slots\/11\/deck-lists\/(\d+)$/.exec(path)?.[1];
		if (listId)
			return await deckListReads.get(Number(listId));
		if (/feature-match-slots\/11$/.test(path)) {
			return {
				slot: slot(ALICE, BOB),
				match: null,
				round: null,
				phase: null,
			};
		}
		throw new Error(`Unexpected read ${path}`);
	});
});

describe('a Deck List Screen showing a Feature Match Slot side', () => {
	it('shows the side\'s Leader, the Mainboard grouped Character, Event, Stage by cost, and its cost curve', async () => {
		const wrapper = mountDisplay();
		await flushPromises();

		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '501',
			player: 'Alice',
			leader: LUFFY.number,
		});
		expect(wrapper.findAll('[data-testid="op-deck-group"]').map(group => ({
			group: group.attributes('data-group'),
			count: group.attributes('data-count'),
			cards: group.findAll('[data-testid="op-deck-card"]').map(entry => `${entry.attributes('data-quantity')} ${entry.attributes('data-number')}`),
		}))).toEqual([
			{
				group: 'character',
				count: '8',
				cards: ['4 OP01-013', '4 OP01-020'],
			},
			{
				group: 'event',
				count: '5',
				cards: ['2 OP01-029', '3 OP01-026'],
			},
			{
				group: 'stage',
				count: '2',
				cards: ['2 OP01-030'],
			},
		]);
		// The curve's counting is `opDeckLayout`'s; here, that its buckets render.
		expect(wrapper.findAll('[data-testid="op-cost-curve-bar"]').map(bar => bar.attributes('data-cost')))
			.toEqual(['0', '1', '2', '3', '4', '5']);
	});

	it.each([
		{
			name: 'Swap Players puts the other player on the side',
			change: followSwappedSession,
			after: {
				state: 'deck',
				deckListId: '502',
				player: 'Bob',
				leader: NAMI.number,
			},
		},
		{
			name: 'a re-paste replaces the side\'s Deck List',
			change: () => featureMatchStore.holdFeatureMatch(slot(side('Alice', LUFFY, 503), BOB)),
			after: {
				state: 'deck',
				deckListId: '503',
				player: 'Alice',
				leader: LUFFY.number,
			},
		},
		{
			name: 'the side is cleared',
			change: () => featureMatchStore.holdFeatureMatch(slot(side('', LUFFY, null), BOB)),
			after: {
				state: 'empty',
				deckListId: undefined,
				player: null,
				leader: null,
			},
		},
	])('follows live when $name', async ({ change, after }) => {
		const wrapper = mountDisplay();
		await flushPromises();

		change();
		await flushPromises();

		expect(shown(wrapper)).toEqual(after);
	});

	it('shows the Deck List of a Player linked into the side, through a re-import', async () => {
		/** A linked side's slot data: the Player's Leader and Deck List, by reference (ADR-0074). */
		const linked = (deckListId: number) => ({
			name: '',
			nickname: 'zoro_main',
			gameData: {
				type: 'op',
				leader: ZORO,
				deckList: { id: deckListId, mainboardCount: 9, leaderNumber: ZORO.number },
			},
		});
		const wrapper = mountDisplay();
		await flushPromises();

		featureMatchStore.holdFeatureMatch({
			...slot(linked(601), BOB),
			player1Id: 31,
		});
		await flushPromises();
		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '601',
			player: 'zoro_main',
			leader: ZORO.number,
		});

		playerRead.value = {
			player: opPlayer(),
			deckList: deckList(602, ZORO_LIST_ENTRIES),
		};
		featureMatchStore.holdFeatureMatch({
			...slot(linked(602), BOB),
			player1Id: 31,
		});
		await flushPromises();
		expect(shown(wrapper)).toMatchObject({ state: 'deck', deckListId: '602' });
	});

	it('shows the side the Session puts the Slot\'s first player on', async () => {
		followSwappedSession();
		const wrapper = mountDisplay('player2');
		await flushPromises();

		expect(shown(wrapper)).toMatchObject({ deckListId: '501', player: 'Alice' });
	});

	it('keeps the outgoing Deck List on program until the incoming one has been read', async () => {
		const incoming = deferred<unknown>();
		deckListReads.set(BOB_LIST.id, incoming.promise);
		const wrapper = mountDisplay();
		await flushPromises();

		followSwappedSession();
		await flushPromises();
		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '501',
			player: 'Alice',
			leader: LUFFY.number,
		});

		incoming.resolve(BOB_LIST);
		await flushPromises();
		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '502',
			player: 'Bob',
			leader: NAMI.number,
		});
	});

	it('keeps its own Deck List when swapped back before the other one has loaded', async () => {
		const benImage = 'https://cards-img.keepr.digital/OP01-040.png';
		images.hold(benImage);
		const wrapper = mountDisplay();
		await flushPromises();

		followSwappedSession();
		await flushPromises();
		featureMatchStateStore.sessionIdBySlotId = new Map();
		await flushPromises();
		images.release(benImage);
		await flushPromises();

		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '501',
			player: 'Alice',
			leader: LUFFY.number,
		});
	});
});

describe('a Deck List Screen showing a One Piece Card Game Player', () => {
	const mountPlayer = () => mountSource({ type: 'player', playerId: 31 });

	it('shows the Player by their display name with their Leader, and the Mainboard grouped Character, Event, Stage', async () => {
		const wrapper = mountPlayer();
		await flushPromises();

		expect(shown(wrapper)).toEqual({
			state: 'deck',
			deckListId: '601',
			player: 'zoro_main',
			leader: 'OP01-001',
		});
		expect(wrapper.findAll('[data-testid="op-deck-group"]').map(group => `${group.attributes('data-group')} ${group.attributes('data-count')}`))
			.toEqual(['character 4', 'event 3', 'unknown 2']);
	});

	it.each([
		{
			name: 'a hand edit writes the Player a new Deck List',
			message: 'player:updated',
			read: {
				player: opPlayer({
					updatedAt: '2026-11-01T11:00:00.000Z',
					gameData: {
						type: 'op',
						deckList: { id: 602, mainboardCount: 4, leaderNumber: 'OP01-016' },
					},
				}),
				deckList: deckList(602, [
					opDeckListEntry('OP01-016', 1, 'leader', null),
					opDeckListEntry('OP01-040', 4, 'character', 3),
				]),
			},
			after: {
				state: 'deck',
				deckListId: '602',
				player: 'zoro_main',
				leader: 'OP01-016',
			},
		},
		{
			name: 'a TCG+ Import writes the Player a new Deck List',
			message: 'tcgplus:imported',
			read: {
				player: opPlayer({
					updatedAt: '2026-11-01T11:00:00.000Z',
					gameData: {
						type: 'op',
						deckList: { id: 602, mainboardCount: 4, leaderNumber: 'OP01-016' },
					},
				}),
				deckList: deckList(602, [
					opDeckListEntry('OP01-016', 1, 'leader', null),
					opDeckListEntry('OP01-040', 4, 'character', 3),
				]),
			},
			after: {
				state: 'deck',
				deckListId: '602',
				player: 'zoro_main',
				leader: 'OP01-016',
			},
		},
		{
			name: 'the operator names the Player',
			message: 'player:updated',
			read: {
				player: opPlayer({ name: 'Zoro', updatedAt: '2026-11-01T11:00:00.000Z' }),
				deckList: deckList(601, ZORO_LIST_ENTRIES),
			},
			after: {
				state: 'deck',
				deckListId: '601',
				player: 'Zoro',
				leader: 'OP01-001',
			},
		},
	])('follows live when $name', async ({ message, read, after }) => {
		const wrapper = mountPlayer();
		await flushPromises();

		playerRead.value = read;
		// An import announces itself once, not each Player it wrote.
		realtime.deliver(message, message === 'player:updated'
			? { player: read.player }
			: { playerCount: 512, deckCount: 512 }, 7);
		await flushPromises();

		expect(shown(wrapper)).toEqual(after);
	});

	it('shows nothing for a Player with no Deck List', async () => {
		playerRead.value = {
			player: opPlayer({
				gameData: { type: 'op' },
			}),
			deckList: null,
		};
		const wrapper = mountPlayer();
		await flushPromises();

		expect(shown(wrapper)).toEqual({
			state: 'empty',
			deckListId: undefined,
			player: null,
			leader: null,
		});
	});

	it('blanks once deleting the Player releases the Deck Source (ADR-0032)', async () => {
		const wrapper = mountPlayer();
		await flushPromises();

		showSource({ type: 'player', playerId: null });
		await flushPromises();

		expect(shown(wrapper).state).toBe('empty');
	});
});
