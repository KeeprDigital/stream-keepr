import type { VueWrapper } from '@vue/test-utils';
import type { FeatureMatchDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { OpLeader } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { LUFFY, NAMI } from '~~/test/helpers/opCards';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import OpDisplay from '~/components/Screen/Modes/Deck/OpDisplay.vue';

// A Deck Screen showing a Feature Match Slot side follows whichever player sits
// there now (ADR-0058): a re-paste, Swap Players and a clear all reach program.

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

function card(number: string, category: 'leader' | 'character' | 'event' | 'stage', cost: number | null, quantity: number): FeatureMatchDeckListEntry {
	return {
		number,
		quantity,
		card: {
			name: `Card ${number}`,
			category,
			colors: ['Red'],
			cost,
			power: null,
			counter: null,
			imageUrl: `https://cards-img.keepr.digital/${number}.png`,
		},
	};
}

function deckList(id: number, entries: FeatureMatchDeckListEntry[]) {
	return {
		id,
		slotId: SLOT_ID,
		entries,
		leaderNumber: entries[0]?.number ?? null,
		mainboardCount: 0,
	};
}

const ALICE_LIST = deckList(501, [
	card('OP01-003', 'leader', null, 1),
	card('OP01-030', 'stage', 1, 2),
	card('OP01-020', 'character', 5, 4),
	card('OP01-026', 'event', 2, 3),
	card('OP01-013', 'character', 2, 4),
	card('OP01-029', 'event', 0, 2),
]);
const BOB_LIST = deckList(502, [
	card('OP01-016', 'leader', null, 1),
	card('OP01-040', 'character', 3, 4),
]);
const ALICE_REPASTED = deckList(503, [
	card('OP01-003', 'leader', null, 1),
	card('OP01-050', 'event', 1, 4),
]);

function side(name: string, leader: OpLeader, deckListId: number | null) {
	return {
		name,
		gameData: {
			type: 'op',
			leader,
			featureMatchDeckList: deckListId === null
				? null
				: { id: deckListId, mainboardCount: 50 },
		},
	};
}

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

function mountDisplay(deckSide: 'player1' | 'player2' = 'player1') {
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: ref({
					id: 42,
					modeConfigs: {
						deck: {
							deckSource: { type: 'featureMatchSlot', slotId: SLOT_ID, side: deckSide },
						},
					},
				} as never),
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
	mockFetch.mockImplementation(async (path: string) => {
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

describe('a Deck Screen showing a Feature Match Slot side', () => {
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
		expect(wrapper.findAll('[data-testid="op-cost-curve-bar"]').map(bar => [
			bar.attributes('data-cost'),
			bar.attributes('data-count'),
		]))
			.toEqual([
				['0', '2'],
				['1', '2'],
				['2', '7'],
				['3', '0'],
				['4', '0'],
				['5', '4'],
			]);
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
});
