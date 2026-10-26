import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import HighlanderSummary from '~/components/Mtg/HighlanderSummary.vue';

const mockEventStore = {
	eventId: 1,
};

const mockCardPreview = {
	activePreviewCard: null,
	handlePreviewUpdate: vi.fn(),
	togglePreviewPin: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useCardPreview', () => () => mockCardPreview);

const CardHoverPreviewStub = defineComponent({
	template: '<div><slot /></div>',
});

function createHighlander(overrides: Partial<HighlanderDeckSummary> = {}): HighlanderDeckSummary {
	return {
		system: '7ph',
		status: 'illegal',
		points: 4,
		maxPoints: 3,
		hasReserveListCards: false,
		pointedCards: [
			{
				name: 'Mana Drain',
				points: 1,
				compartments: ['sideboard'],
				totalQuantity: 1,
			},
			{
				name: 'Lutri, the Spellchaser',
				points: 3,
				compartments: [],
				totalQuantity: 1,
				pointedAs: 'companion',
			},
		],
		duplicateCards: [
			{ name: 'Mana Drain', quantity: 2 },
		],
		unknownCards: [],
		...overrides,
	};
}

async function mountComponent(props: { highlander?: HighlanderDeckSummary | null; compact?: boolean } = {}) {
	return mount(HighlanderSummary, {
		props: {
			highlander: createHighlander(),
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				CardHoverPreview: CardHoverPreviewStub,
			},
		},
	});
}

describe('highlanderSummary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('explains an illegal deck: the singleton violation and the points over the cap', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Illegal');
		expect(wrapper.text()).toContain('Singleton violations: Mana Drain (2)');
		expect(wrapper.text()).toContain('Points cap exceeded: 4/3 Points');
		expect(wrapper.text()).toContain('Pointed Cards');
	});

	it('keeps only the pointed cards when compact', async () => {
		const wrapper = await mountComponent({ compact: true });

		expect(wrapper.find('[data-alert]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain('Illegal');
		expect(wrapper.get('[data-testid="highlander-compact-cards"]').text()).toContain('Lutri, the Spellchaser');
	});
});
