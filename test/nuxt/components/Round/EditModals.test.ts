import type { Component } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import RoundEditModal from '~/components/Round/EditModal.vue';
import PhaseEditModal from '~/components/Round/PhaseEditModal.vue';

const mockEventStore = reactive({
	eventId: 1,
	event: { id: 1, game: 'mtg' },
});

const mockRoundStore = reactive({
	getRoundById: vi.fn(),
	updateRound: vi.fn(),
});

const mockPhaseStore = reactive({
	getPhaseById: vi.fn(),
	updatePhase: vi.fn(),
});

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useToast', () => () => mockToast);

enableAutoUnmount(afterEach);

// Attached, so Save — a submit button outside the form, joined by `form` — submits it.
function mountModal(component: Component, props: Record<string, unknown>) {
	return mount(component, {
		props,
		attrs: { open: true },
		attachTo: document.body,
		global: { stubs: nuxtUiStubs },
	});
}

function saveButton(wrapper: ReturnType<typeof mountModal>) {
	return wrapper.findAll('button').find(button => button.text() === 'Save')!;
}

describe('round edit modals', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.eventId = 1;
		mockEventStore.event = { id: 1, game: 'mtg' };
		mockRoundStore.getRoundById.mockReturnValue({ id: 10, name: 'Round 1', roundNumber: 1 });
		mockRoundStore.updateRound.mockResolvedValue({ id: 10, name: 'Round 2' });
		mockPhaseStore.getPhaseById.mockReturnValue({ id: 20, name: 'Swiss' });
		mockPhaseStore.updatePhase.mockResolvedValue({ id: 20, name: 'Top 8' });
	});

	it('saves a round edit from the footer Save', async () => {
		const wrapper = mountModal(RoundEditModal, { roundId: 10 });

		await wrapper.get('input:not([type="number"])').setValue('Round 2');
		await wrapper.get('input[type="number"]').setValue('2');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockRoundStore.updateRound).toHaveBeenCalledWith(1, 10, { name: 'Round 2', roundNumber: 2 });
		expect(wrapper.emitted('close')).toEqual([[]]);
	});

	it('saves a phase edit from the footer Save', async () => {
		const wrapper = mountModal(PhaseEditModal, { phaseId: 20 });

		await wrapper.get('input').setValue('Top 8');
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockPhaseStore.updatePhase).toHaveBeenCalledWith(1, 20, {
			name: 'Top 8',
		});
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
