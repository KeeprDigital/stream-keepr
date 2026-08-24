import type { PlayerDeckList } from '~~/shared/types/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));

mockNuxtImport('useSendDeckToScreen', () => () => ({
	hasDeckScreens: ref(false),
	deckScreens: ref([]),
	sendToScreen: vi.fn(),
	sendToFirstDeckScreen: vi.fn(),
}));

mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(async () => ({ cards: new Map() })),
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

describe('player deck list modal', () => {
	it('renders deck lists delivered as reactive proxies, as useOverlay passes props', async () => {
		const { default: DeckListModal } = await import('~/components/Player/DeckListModal.vue');

		// useOverlay().create(...).open(props) stores props in reactive() state,
		// so the modal receives deep reactive proxies rather than plain objects.
		const overlayProps = reactive({
			playerName: 'Marcus',
			deckLists: [makeDeckList()],
		});

		const wrapper = mount(DeckListModal, {
			props: overlayProps,
			global: {
				stubs: {
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
				},
			},
		});

		expect(wrapper.text()).toContain('Ocelot Pride');
		expect(wrapper.text()).toContain('Wear // Tear');
	});
});
