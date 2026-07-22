import type { MtgCard } from '~/types/card/mtg';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

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

const noopResetStore = () => ({ $reset: vi.fn() });

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
};

mockNuxtImport('useEventStore', () => () => ({ loadEvent: vi.fn(), event: null, $reset: vi.fn() }));
mockNuxtImport('usePlayerStore', () => () => noopResetStore());
mockNuxtImport('useArchetypeStore', () => () => noopResetStore());
mockNuxtImport('useMetagameStore', () => () => noopResetStore());
mockNuxtImport('usePlayerListStore', () => () => noopResetStore());
mockNuxtImport('usePhaseStore', () => () => noopResetStore());
mockNuxtImport('useRoundStore', () => () => noopResetStore());
mockNuxtImport('useMatchStore', () => () => noopResetStore());
mockNuxtImport('useFeatureMatchStore', () => () => noopResetStore());
mockNuxtImport('useFeatureMatchStateStore', () => () => noopResetStore());
mockNuxtImport('useScreenStore', () => () => noopResetStore());
mockNuxtImport('useMeleeStore', () => () => noopResetStore());
mockNuxtImport('clearPlayerDeckCache', () => vi.fn());
mockNuxtImport('navigateTo', () => vi.fn());
mockNuxtImport('useCardStore', () => () => {
	const store = useMockCardStore();
	return Object.assign(store, { $reset: vi.fn() });
});
mockNuxtImport('useOverlay', () => () => mockOverlay);

const UButtonStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div data-testid="alert"><div>{{ title }}</div><div>{{ description }}</div></div>',
});

const UFieldGroupStub = defineComponent({
	template: '<div><slot /></div>',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/Mtg/CardControlsButtons.vue';
	const { default: CardControlsButtons } = await import(componentPath);

	return mount(CardControlsButtons, {
		global: {
			stubs: {
				UButton: UButtonStub,
				UAlert: UAlertStub,
				USeparator: true,
				UFieldGroup: UFieldGroupStub,
			},
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
		expect(wrapper.find('[data-testid="alert"]').exists()).toBe(false);

		await wrapper.get('button').trigger('click');
		expect(mockControlPreviewCard).toHaveBeenCalledWith('show');
	});
});
