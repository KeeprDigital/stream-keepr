import type { PlayerDeckList } from '~~/shared/types/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
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

mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(async () => ({
		cards: new Map(),
	})),
}));

const UModalStub = defineComponent({
	template: '<div><slot name="title" /><slot name="description" /><slot name="body" /><slot name="footer" /></div>',
});

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
	UBadge: true,
	UIcon: true,
	UButton: true,
	UDropdownMenu: true,
	UISegmentedTabs: true,
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
});
