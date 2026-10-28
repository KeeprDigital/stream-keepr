import type { PlayerDeckList } from '~~/shared/types/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import DeckListModal from '~/components/Player/DeckListModal.vue';

mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));

const mockPlayerStore = reactive({
	players: [
		createMockPlayer({ id: 7, name: 'Marcus' }),
	],
});
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);

const { openPlayerMatchHistory } = vi.hoisted(() => ({
	openPlayerMatchHistory: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory }));

mockNuxtImport('useSendDeckToScreen', () => () => ({
	hasDeckScreens: ref(false),
	deckScreens: ref([]),
	sendToScreen: vi.fn(),
	sendToFirstDeckScreen: vi.fn(),
}));

const { getMeleeLiveResultsStatus } = vi.hoisted(() => ({
	getMeleeLiveResultsStatus: vi.fn(),
}));
mockNuxtImport('useEventRepository', () => () => ({ getMeleeLiveResultsStatus }));

mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(async () => ({
		cards: new Map(),
	})),
}));

const UModalStub = defineComponent({
	template: '<div><header><slot name="title" /><slot name="description" /></header><main><slot name="body" /></main><slot name="footer" /></div>',
});

function currentRoundIn(phaseId: number) {
	return {
		currentRound: {
			id: 30,
			name: 'Round 3',
			phaseId,
			phaseName: 'Swiss',
		},
	};
}

const constructedDeck: PlayerDeckList = {
	deckId: 8,
	externalId: 'deck-8',
	formatExternalId: 'standard',
	phaseIds: [2],
	phaseName: 'Constructed',
	name: 'Mono Red',
	colors: 'R',
	isPrimary: false,
	cards: [
		{
			name: 'Lightning Bolt',
			quantity: 4,
			compartment: 'mainboard',
			cardType: 'Instant',
			scryfallId: null,
		},
	],
};

const kaheera = {
	cardId: 9,
	name: 'Kaheera, the Orphanguard',
	scryfallId: null,
	oracleId: null,
	source: 'melee' as const,
};

function makeDeckList(): PlayerDeckList {
	return {
		deckId: 7,
		externalId: 'deck-7',
		formatExternalId: 'modern',
		phaseIds: [1],
		phaseName: 'Swiss',
		name: 'Boros Energy',
		colors: 'RW',
		isPrimary: true,
		cards: [
			{
				name: 'Ocelot Pride',
				quantity: 4,
				compartment: 'mainboard',
				cardType: 'Creature',
				scryfallId: null,
			},
			{
				name: 'Wear // Tear',
				quantity: 2,
				compartment: 'sideboard',
				cardType: 'Instant',
				scryfallId: null,
			},
		],
	};
}

const stubs = {
	UModal: UModalStub,
	UBadge: { template: '<span><slot /></span>' },
	UIcon: true,
	UButton: true,
	UDropdownMenu: true,
	UISegmentedTabs: {
		props: ['items', 'modelValue'],
		emits: ['update:modelValue'],
		template: '<div role="tablist"><button v-for="item in items" :key="item.value" role="tab" :aria-selected="String(item.value === modelValue)" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
	},
	UIEmptyState: true,
	UILoadingSpinner: true,
	MtgManaColorDisplay: true,
	MtgHighlanderSummary: true,
	DeckManaCurveChart: true,
	PlayerDeckListCardItem: {
		props: ['card'],
		template: '<li>{{ card.name }}</li>',
	},
};

describe('player deck list modal', () => {
	beforeEach(() => {
		getMeleeLiveResultsStatus.mockReset().mockResolvedValue({ currentRound: null });
	});

	it('renders deck lists delivered as reactive proxies, as useOverlay passes props', async () => {
		// useOverlay().create(...).open(props) stores props in reactive() state,
		// so the modal receives deep reactive proxies rather than plain objects.
		const overlayProps = reactive({
			playerName: 'Marcus',
			deckLists: [
				makeDeckList(),
			],
		});

		const wrapper = mount(DeckListModal, {
			props: overlayProps,
			global: { stubs },
		});

		expect(wrapper.text()).toContain('Ocelot Pride');
		expect(wrapper.text()).toContain('Wear // Tear');
	});

	it.each([
		[
			'names the Companion',
			{
				cardId: 9,
				name: 'Kaheera, the Orphanguard',
				scryfallId: null,
				oracleId: null,
				source: 'melee' as const,
				usesExistingSideboardSlot: false,
			},
			true,
		],
		['shows no Companion', null, false],
	])('%s when the deck list has one or not', async (_, companion, shown) => {
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [
					{
						...makeDeckList(),
						companion,
					},
				],
			},
			global: { stubs },
		});

		const label = wrapper.find('[data-deck-companion]');
		expect(label.exists()).toBe(shown);
		if (shown)
			expect(label.text()).toContain('Kaheera, the Orphanguard');
	});

	it.each([
		['a known Player\'s', 7, true],
		['a Player-less', undefined, false],
	])('titles %s deck list with a name that opens their match history only when one is known', async (_, playerId, clickable) => {
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				playerId,
				deckLists: [
					makeDeckList(),
				],
			},
			global: { stubs },
		});

		const name = wrapper.find('button[title="View Match History"]');
		expect(name.exists()).toBe(clickable);
		if (clickable) {
			await name.trigger('click');
			expect(openPlayerMatchHistory).toHaveBeenCalledWith(mockPlayerStore.players[0]);
		}
	});

	it.each([
		['its own slot', false, 'Sideboard (2 + Companion)'],
		['a sideboard copy', true, 'Sideboard (2)'],
	])('counts a Companion taking %s in the sideboard heading', async (_, usesExistingSideboardSlot, heading) => {
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [
					{
						...makeDeckList(),
						companion: { ...kaheera, usesExistingSideboardSlot },
					},
				],
			},
			global: { stubs },
		});

		expect(wrapper.text()).toContain(heading);
	});

	it.each([
		[
			'a reviewed',
			true,
			'reviewed',
			'Reviewed',
		],
		[
			'an unreviewed',
			false,
			'unreviewed',
			'Unreviewed',
		],
	])('badges %s deck', async (_, reviewed, state, label) => {
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [
					{
						...makeDeckList(),
						reviewed,
					},
				],
			},
			global: { stubs },
		});

		const badge = wrapper.get('[data-deck-review]');
		expect(badge.attributes('data-deck-review')).toBe(state);
		expect(badge.text()).toBe(label);
	});

	it.each([
		[
			'the Current Round\'s Phase',
			() => Promise.resolve(currentRoundIn(2)),
			'Constructed',
		],
		[
			'the primary deck with no Current Round',
			() => Promise.resolve({ currentRound: null }),
			'Swiss',
		],
		[
			'the primary deck when no deck holds the Current Round',
			() => Promise.resolve(currentRoundIn(99)),
			'Swiss',
		],
		[
			'the primary deck when the Current Round cannot be read',
			() => Promise.reject(new Error('offline')),
			'Swiss',
		],
	])('opens on %s', async (_, status, selectedTab) => {
		getMeleeLiveResultsStatus.mockImplementation(status);
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [
					makeDeckList(),
					constructedDeck,
				],
			},
			global: { stubs },
		});
		await flushPromises();

		expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe(selectedTab);
	});

	it('keeps the deck an operator picked when the Current Round arrives after', async () => {
		const status = deferred<ReturnType<typeof currentRoundIn>>();
		getMeleeLiveResultsStatus.mockReturnValue(status.promise);
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [
					constructedDeck,
					makeDeckList(),
				],
			},
			global: { stubs },
		});

		await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
		status.resolve(currentRoundIn(2));
		await flushPromises();

		expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Swiss');
	});

	it('lists the deck\'s counter types with the cards, not in the header', async () => {
		const deck = makeDeckList();
		deck.cards[0]!.deckCounterTypes = ['energy'];
		deck.cards[1]!.deckCounterTypes = ['poison', 'energy'];
		const wrapper = mount(DeckListModal, {
			props: {
				playerName: 'Marcus',
				deckLists: [deck],
			},
			global: { stubs },
		});

		expect(wrapper.get('header').text()).not.toContain('Counters');
		const counters = wrapper.get('main [data-deck-counters]');
		expect(counters.findAll('li').map(item => item.text())).toEqual(['Poison', 'Energy']);
	});
});
