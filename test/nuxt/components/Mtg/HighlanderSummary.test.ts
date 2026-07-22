import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

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

const UBadgeStub = defineComponent({
	props: {
		color: { type: String, required: false },
	},
	template: '<span data-testid="badge" :data-color="color"><slot /></span>',
});

const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<div data-testid="alert">{{ title }}<slot name="description" /></div>',
});

const UButtonStub = defineComponent({
	template: '<button type="button"><slot /></button>',
});

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
			{ name: 'Mana Drain', points: 1, compartments: ['sideboard'], totalQuantity: 1 },
			{ name: 'Lutri, the Spellchaser', points: 3, compartments: [], totalQuantity: 1, pointedAs: 'companion' },
		],
		duplicateCards: [{ name: 'Mana Drain', quantity: 2 }],
		unknownCards: [],
		...overrides,
	};
}

async function mountComponent(props: { highlander?: HighlanderDeckSummary | null; compact?: boolean } = {}) {
	const componentPath = '../../../../app/components/Mtg/HighlanderSummary.vue';
	const { default: HighlanderSummary } = await import(componentPath);

	return mount(HighlanderSummary, {
		props: {
			highlander: createHighlander(),
			...props,
		},
		global: {
			stubs: {
				UBadge: UBadgeStub,
				UAlert: UAlertStub,
				UButton: UButtonStub,
				CardHoverPreview: CardHoverPreviewStub,
			},
		},
	});
}

describe('highlanderSummary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps the full layout warnings in default mode', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Pointed Cards');
		expect(wrapper.findAll('[data-testid="alert"]')).toHaveLength(1);
		expect(wrapper.find('[data-testid="badge"]').attributes('data-color')).toBe('error');
	});
});
