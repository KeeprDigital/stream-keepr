import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardHistory from '~/components/Mtg/CardHistory.vue';

const cardStore = reactive({
	selectionHistory: [
		{
			id: 'card-1',
			name: 'Lightning Bolt',
			displayData: { turnedOver: true },
		},
	],
	selectPreviewCard: vi.fn(),
	clearHistory: vi.fn(),
});

mockNuxtImport('useCardStore', () => () => cardStore);

function mountHistory() {
	return mount(CardHistory, {
		attrs: { open: true },
		global: {
			stubs: {
				...nuxtUiStubs,
				MtgCardImage: {
					name: 'MtgCardImage',
					emits: ['selected'],
					template: '<div data-testid="card" />',
				},
			},
		},
	});
}

describe('mtgCardHistory', () => {
	it('previews a chosen card the way it was last shown, then closes', () => {
		const wrapper = mountHistory();

		wrapper.findComponent({ name: 'MtgCardImage' }).vm.$emit('selected');

		expect(cardStore.selectPreviewCard).toHaveBeenCalledWith(cardStore.selectionHistory[0], true);
		expect(wrapper.emitted('close')).toHaveLength(1);
	});

	it('clears the history, then closes', async () => {
		const wrapper = mountHistory();

		await wrapper.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');

		expect(cardStore.clearHistory).toHaveBeenCalledOnce();
		expect(wrapper.emitted('close')).toHaveLength(1);
	});
});
