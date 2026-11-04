import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { createFollowedFeatureMatchSessions } from '~~/test/nuxt/helpers/followedFeatureMatchSession';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

vi.mock('~/modules/event-data/resync', async importOriginal => ({
	...await importOriginal<typeof import('~/modules/event-data/resync')>(),
	useConsumedEventData: () => {},
}));

const SHARED_ID = 7;
function deckPlayer(id: number, name: string) {
	return {
		id,
		name,
		gameData: { type: 'mtg', deckName: `${name}'s deck` },
		updatedAt: '2026-11-01T00:00:00.000Z',
	};
}

const eventStore = reactive({
	eventId: 1,
	event: { id: 1, game: 'mtg', cardTimeout: 0 },
});
const playerStore = reactive({
	isLoaded: true,
	players: [
		deckPlayer(41, 'Alice'),
		deckPlayer(42, 'Bob'),
		deckPlayer(51, 'Mallory'),
		deckPlayer(52, 'Nina'),
	],
});
/** Feature Match Slot 7 seats Alice and Bob. */
const featureMatchStore = reactive({
	isLoaded: true,
	featureMatches: [
		{
			id: SHARED_ID,
			player1Id: 41,
			player1Data: { name: 'Alice' },
			player2Id: 42,
			player2Data: { name: 'Bob' },
			activeSession: null,
		},
	],
});
function match(id: number, roundId: number, player1: ReturnType<typeof deckPlayer>, player2: ReturnType<typeof deckPlayer>) {
	return {
		id,
		roundId,
		isBye: false,
		player1Id: player1.id,
		player1Data: { name: player1.name },
		player2Id: player2.id,
		player2Data: { name: player2.name },
	};
}
/** Match 7 of Round 3 is an unrelated pairing, Mallory and Nina; Round 4 pairs Mallory and Bob. */
const matchesByRound = new Map([
	[
		3,
		[
			match(SHARED_ID, 3, playerStore.players[2]!, playerStore.players[3]!),
		],
	],
	[
		4,
		[
			match(9, 4, playerStore.players[2]!, playerStore.players[1]!),
		],
	],
]);
const matchStore = reactive({
	matches: [] as ReturnType<typeof match>[],
	loadMatchesByRoundId: vi.fn(async (_eventId: number, roundId: number) => {
		matchStore.matches = matchesByRound.get(roundId) ?? [];
	}),
});
const roundStore = reactive({
	rounds: [
		{
			id: 3,
			phaseId: 1,
			name: 'Round 3',
			number: 3,
		},
		{
			id: 4,
			phaseId: 1,
			name: 'Round 4',
			number: 4,
		},
	],
});
const phaseStore = {
	getPhaseById: () => undefined,
};
const assignmentStore = {
	consumeRound: () => () => {},
	loadAssignments: vi.fn(async () => {}),
	assignmentsForRound: () => [],
	isRemoteChanged: () => false,
	updateAssignment: vi.fn(),
};
/** A Card Spotlight Screen tied to Feature Match Slot 7. */
const screenStore = reactive({
	screens: [
		{
			id: 5,
			name: 'Cards',
			currentMode: 'card',
			modeConfigs: {
				card: { featureMatchId: SHARED_ID },
			},
		},
	],
});

let afterLoad: (() => Promise<void>) | undefined;
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerStore', () => () => playerStore);
mockNuxtImport('useFeatureMatchStore', () => () => featureMatchStore);
mockNuxtImport('useMatchStore', () => () => matchStore);
mockNuxtImport('useRoundStore', () => () => roundStore);
mockNuxtImport('usePhaseStore', () => () => phaseStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => assignmentStore);
mockNuxtImport('useScreenStore', () => () => screenStore);
const followed = createFollowedFeatureMatchSessions();
mockNuxtImport('useFeatureMatchStateStore', () => () => followed);
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([]));
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: vi.fn(),
	}),
}));
mockNuxtImport('useEventPageLoading', () => (_entries: unknown, load: () => Promise<void>) => {
	afterLoad = load;
	return {
		initialLoading: ref(false),
		initialError: ref(null),
		retry: vi.fn(),
	};
});
mockNuxtImport('useCardRepository', () => () => ({
	getScreenCard: vi.fn(async () => null),
}));
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(async () => ({
		cards: new Map(),
		degraded: false,
	})),
	buildDeckListArrays: () => ({ mainboard: [], sideboard: [] }),
}));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: vi.fn(async () => null),
}));

const NuxtLayoutStub = defineComponent({ template: '<div><slot name="actions" /><slot /></div>' });

async function openCardsPage(query: Record<string, string> = {}) {
	await useRouter().replace({ query });
	const { default: CardPage } = await import('~/pages/event/[eventId]/card.vue');
	const wrapper = mount(CardPage, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: NuxtLayoutStub,
				MtgCardModeToggle: true,
				MtgCardSearch: true,
				MtgCardPlayerDeckHeader: true,
				MtgCardList: true,
				MtgCardDeckList: true,
				MtgCardPlayerDeck: true,
				MtgCardControls: true,
			},
		},
	});
	await flushPromises();
	await afterLoad?.();
	await flushPromises();
	return wrapper;
}

/** The Deck List header's Round and matchup pickers, in page order. */
function pickers(wrapper: ReturnType<typeof mount>) {
	const [round, matchup] = wrapper.findAllComponents({ name: 'USelect' });
	return { round: round!, matchup: matchup! };
}

/** The Round Match the matchup picker holds; none while a Slot is shown. */
function pickedMatchId(wrapper: ReturnType<typeof mount>) {
	return pickers(wrapper).matchup.props('modelValue');
}

function shownDecks() {
	const cardStore = useCardStore();
	return [cardStore.deckListPlayer1?.playerName, cardStore.deckListPlayer2?.playerName];
}

describe('cards page matchup Deck Lists', () => {
	let wrapper: ReturnType<typeof mount> | undefined;

	beforeEach(() => {
		useCardStore().$reset();
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = undefined;
	});

	// Slot 7 and Match 7 come from different tables: each reference keeps its own kind.
	it.each([
		[
			'the Card Spotlight Screen\'s Slot',
			{},
			['Alice', 'Bob'],
			undefined,
			{ slotId: '7' },
		],
		[
			'a linked Slot',
			{ mode: 'match-decklist', roundId: '3', slotId: '7' },
			['Alice', 'Bob'],
			undefined,
			{ slotId: '7' },
		],
		[
			'a linked Match',
			{ mode: 'match-decklist', roundId: '3', matchId: '7' },
			['Mallory', 'Nina'],
			SHARED_ID,
			{ matchId: '7' },
		],
	])('shows %s, not the other matchup with its id', async (_, query, decks, pickedMatch, link) => {
		wrapper = await openCardsPage(query);

		expect(shownDecks()).toEqual(decks);
		expect(pickedMatchId(wrapper)).toBe(pickedMatch);
		await vi.waitFor(() => expect(useRoute().query).toEqual({ mode: 'match-decklist', roundId: '3', ...link }));
	});

	it('replaces a shown Slot with the first Match of a Round the operator picks', async () => {
		wrapper = await openCardsPage();

		await pickers(wrapper).round.find('select').setValue('4');
		await flushPromises();

		expect(shownDecks()).toEqual(['Mallory', 'Bob']);
		expect(pickedMatchId(wrapper)).toBe(9);
		await vi.waitFor(() => expect(useRoute().query).toEqual({ mode: 'match-decklist', roundId: '4', matchId: '9' }));
	});
});
