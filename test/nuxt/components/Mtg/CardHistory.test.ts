import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

const selectPreviewCard = vi.fn();
const cardStore = reactive({
	selectionHistory: [{
		id: 'card-1',
		name: 'Lightning Bolt',
		displayData: { turnedOver: false },
	}],
	selectPreviewCard,
	clearHistory: vi.fn(),
});

mockNuxtImport('useCardStore', () => () => cardStore);

const UModalStub = defineComponent({
	template: '<div><slot name="body" /><slot name="footer" /></div>',
});

const CardImageStub = defineComponent({
	emits: ['selected'],
	template: '<button type="button" data-testid="card" @keydown.enter="$emit(\'selected\', false)" />',
});

describe('mtgCardHistory', () => {
	it('uses the card selected event so keyboard activation selects a card', async () => {
		const { default: CardHistory } = await import('../../../../app/components/Mtg/CardHistory.vue');
		const wrapper = mount(CardHistory, {
			global: {
				stubs: {
					UModal: UModalStub,
					UButton: true,
					MtgCardImage: CardImageStub,
				},
			},
		});

		await wrapper.get('[data-testid="card"]').trigger('keydown', { key: 'Enter' });

		expect(selectPreviewCard).toHaveBeenCalledWith(cardStore.selectionHistory[0], false);
		expect(wrapper.emitted('close')).toHaveLength(1);
	});
});
