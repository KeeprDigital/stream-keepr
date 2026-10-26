import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PlayerListCreateModal from '~/components/Player/ListCreateModal.vue';

const playerListStore = {
	createList: vi.fn(async () => ({ id: 42, name: 'Top 8' })),
};

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('usePlayerListStore', () => () => playerListStore);
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

enableAutoUnmount(afterEach);

describe('player list create modal', () => {
	it('creates a list from the footer button, then hands its id back', async () => {
		// Attached, so the footer's `form`-joined submit button submits the form.
		const wrapper = mount(PlayerListCreateModal, {
			attrs: { open: true },
			attachTo: document.body,
			global: { stubs: nuxtUiStubs },
		});

		await wrapper.get('input').setValue('Top 8');
		await wrapper.findAll('button').find(button => button.text() === 'Create List')!.trigger('click');
		await flushPromises();

		expect(playerListStore.createList).toHaveBeenCalledWith(1, { name: 'Top 8' });
		expect(wrapper.emitted('created')).toEqual([
			[42],
		]);
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
