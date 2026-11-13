import type { VueWrapper } from '@vue/test-utils';
import type { CommanderDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { Commander } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { ANIMAR, ASHLING, deckListEntryOf, MOXFIELD_CARDS } from '~~/test/helpers/magicDeckText';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import MtgDisplay from '~/components/Screen/Modes/Deck/MtgDisplay.vue';

// A Deck List Screen whose Deck Source is a Commander Seat (ADR-0087): the Seat's
// Commanders apart, ahead of its Mainboard, each card the printing it was saved as.
// The Screen Output reads are faked at `$fetch`; card data at the Scryfall batch.

const SLOT_ID = 11;
const { ashling, animar, forest, hedgeMaze } = MOXFIELD_CARDS;

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
mockNuxtImport('tryUseRealtime', () => () => createFakeEventChannel().transport);

const imageOf = (scryfallId: string) => `https://img.test/${scryfallId}.jpg`;
mockNuxtImport('useScryfallBatch', async () => {
	const actual = await vi.importActual<typeof import('~/composables/data/useScryfallBatch')>('~/composables/data/useScryfallBatch');
	return () => ({
		...actual.useScryfallBatch(),
		// Each printing asked for answers its own image.
		fetchScryfallCards: async (cards: Array<{ scryfallId: string | null }>) => ({
			cards: new Map(cards.flatMap(card => card.scryfallId
				? [[card.scryfallId, { imageData: { front: { normal: imageOf(card.scryfallId) } } }]]
				: [])),
			degraded: false,
		}),
	});
});

const mockFetch = vi.hoisted(() => vi.fn());
mockNuxtImport('$fetch', () => mockFetch);
stubImageLoading();

/** The Slot and the Seat's Deck Lists as the Screen Output reads answer them now. */
const served = {
	slot: null as Record<string, unknown> | null,
	lists: new Map<number, CommanderDeckListEntry[]>(),
};

function seat(name: string, commanders: Commander[], deckListId?: number) {
	return {
		name,
		gameData: {
			type: 'mtg',
			commanders,
			deckName: commanders.map(commander => commander.name).join(' / '),
			deckColors: 'WUBRG',
			...(deckListId
				? { featureMatchDeckList: { id: deckListId, mainboardCount: 0 } }
				: {}),
		},
	};
}

function serveSlot(seats: Record<string, unknown>) {
	served.slot = {
		id: SLOT_ID,
		matchId: null,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		activeSession: null,
		...seats,
	};
}

function mountSeat(side: string) {
	const screen = ref({
		id: 42,
		modeConfigs: {
			deck: { deckSource: { type: 'featureMatchSlot', slotId: SLOT_ID, side } },
		},
	});
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: screen as never,
				eventId: computed(() => 7),
				interactive: ref(false),
				overlayContainer: ref(null),
				followsScreenChannel: ref(false),
			});
			return () => h(MtgDisplay, { followsSeat: true });
		},
	});
	// The real transition, because its after-leave is what commits a swap.
	return mount(Parent, { global: { stubs: { transition: false } } });
}

/** Each section shown, in order, with its cards as drawn: name and image. */
function shown(wrapper: VueWrapper) {
	return wrapper.findAll('[data-testid$="-section"]').map(section => ({
		section: section.attributes('data-testid'),
		cards: section.findAll('img').map(image => [image.attributes('alt'), image.attributes('src')]),
	}));
}

const drawn = (card: { id: string; name: string }) => [card.name, imageOf(card.id)];

beforeEach(() => {
	featureMatchStore.featureMatches = [];
	served.lists.clear();
	mockFetch.mockReset();
	mockFetch.mockImplementation(async (path: string) => {
		const listId = /feature-match-slots\/11\/commander-deck-lists\/(\d+)$/.exec(path)?.[1];
		if (listId) {
			return {
				id: Number(listId),
				slotId: SLOT_ID,
				entries: served.lists.get(Number(listId)),
			};
		}
		if (path.endsWith(`/feature-match-slots/${SLOT_ID}`)) {
			return {
				slot: served.slot,
				match: null,
				round: null,
				phase: null,
			};
		}
		throw new Error(`Unexpected read: ${path}`);
	});
});

describe('a Deck List Screen showing a Commander Seat', () => {
	it('shows the Seat\'s Commanders apart, ahead of its Mainboard, each card as the printing saved', async () => {
		served.lists.set(501, [deckListEntryOf(ashling), deckListEntryOf(animar), deckListEntryOf(forest, 3), deckListEntryOf(hedgeMaze)]);
		serveSlot({ player4Data: seat('Dee', [ASHLING, ANIMAR], 501) });

		const wrapper = mountSeat('player4');
		await flushPromises();

		expect(shown(wrapper)).toEqual([
			{ section: 'commanders-section', cards: [drawn(ashling), drawn(animar)] },
			{ section: 'mainboard-section', cards: [drawn(forest), drawn(hedgeMaze)] },
		]);
		expect(wrapper.get('[data-testid="deck-player-name"]').text()).toBe('Dee');
		expect(wrapper.get('[data-testid="deck-name"]').text()).toBe('Ashling, the Limitless / Animar, Soul of Elements');
	});

	it('shows the Commanders alone when the Seat holds no list', async () => {
		serveSlot({ player2Data: seat('Ben', [ASHLING]) });

		const wrapper = mountSeat('player2');
		await flushPromises();

		expect(shown(wrapper)).toEqual([
			{ section: 'commanders-section', cards: [drawn(ashling)] },
		]);
	});

	it('shows nothing for a Seat nobody sits in', async () => {
		serveSlot({ player2Data: seat('Ben', [ASHLING]) });

		const wrapper = mountSeat('player3');
		await flushPromises();

		expect(shown(wrapper)).toEqual([]);
	});

	// The Seat names its list by id, so a re-paste or Swap Seats reaches the Screen with the Slot.
	it('follows the Seat to the list it holds now', async () => {
		served.lists.set(501, [deckListEntryOf(ashling), deckListEntryOf(forest, 3)]);
		served.lists.set(502, [deckListEntryOf(animar), deckListEntryOf(hedgeMaze)]);
		serveSlot({ player1Data: seat('Ana', [ASHLING], 501) });
		const wrapper = mountSeat('player1');
		await flushPromises();

		featureMatchStore.featureMatches = [{ ...served.slot, player1Data: seat('Cyd', [ANIMAR], 502) }];

		await vi.waitFor(() => expect(shown(wrapper)).toEqual([
			{ section: 'commanders-section', cards: [drawn(animar)] },
			{ section: 'mainboard-section', cards: [drawn(hedgeMaze)] },
		]));
		expect(wrapper.get('[data-testid="deck-player-name"]').text()).toBe('Cyd');
	});
});
