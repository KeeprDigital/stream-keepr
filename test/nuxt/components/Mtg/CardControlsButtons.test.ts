import type { MtgCard } from '~/types/card/mtg';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardControlsButtons from '~/components/Mtg/CardControlsButtons.vue';

function createMockMtgCard(overrides: Partial<MtgCard> = {}): MtgCard {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: {
			front: null,
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			counterRotated: false,
			turnedOver: false,
		},
		...overrides,
	};
}

const mockControlPreviewCard = vi.fn();
const mockSelectMeldCardPart = vi.fn();

const useMockCardStore = defineStore('mock-card-controls', () => {
	const previewCard = ref<MtgCard | null>(null);
	const previewCardPrintings = ref<MtgCard[]>([]);
	const activeCard = ref<MtgCard | null>(null);
	const activeScreenId = ref<number | null>(null);
	const cardsMatch = ref(false);

	return {
		previewCard,
		previewCardPrintings,
		activeCard,
		activeScreenId,
		cardsMatch,
		controlPreviewCard: mockControlPreviewCard,
		selectMeldCardPart: mockSelectMeldCardPart,
	};
});

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
};

mockNuxtImport('useEventStore', () => () => ({
	event: null,
	updateEvent: vi.fn(),
}));
mockNuxtImport('useCardStore', () => () => {
	const store = useMockCardStore();
	return Object.assign(store, {
		$reset: vi.fn(),
	});
});
mockNuxtImport('useOverlay', () => () => mockOverlay);

async function mountComponent() {
	return mount(CardControlsButtons, {
		global: {
			stubs: nuxtUiStubs,
		},
	});
}

describe('mtgCardControlsButtons', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setActivePinia(createPinia());
		const store = useMockCardStore();
		store.previewCard = createMockMtgCard();
		store.previewCardPrintings = [];
		store.activeCard = null;
		store.activeScreenId = null;
		store.cardsMatch = false;
	});

	it('disables Show and explains why when no card screen is configured', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('button').attributes('disabled')).toBeDefined();
		expect(wrapper.text()).toContain('No card image screen configured');
		expect(wrapper.text()).toContain('Add a screen in card mode to show cards.');
	});

	it('keeps Show enabled when a card screen is active', async () => {
		useMockCardStore().activeScreenId = 7;
		const wrapper = await mountComponent();

		expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
		expect(wrapper.find('[data-alert]').exists()).toBe(false);

		await wrapper.get('button').trigger('click');
		expect(mockControlPreviewCard).toHaveBeenCalledWith('show');
	});
});
