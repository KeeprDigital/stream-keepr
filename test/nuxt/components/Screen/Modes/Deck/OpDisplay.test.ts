import type { VueWrapper } from '@vue/test-utils';
import type { FeatureMatchDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { LUFFY, NAMI, opDeckListEntry, opSlotSide as side } from '~~/test/helpers/opCards';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import OpDisplay from '~/components/Screen/Modes/Deck/OpDisplay.vue';

// A Deck List Screen showing a Feature Match Slot side follows whichever player sits
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
