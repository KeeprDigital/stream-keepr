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

	// Timing is sent only when edited, so a save never undoes a "Start now" made since the modal opened (ADR-0066).
	it.each([
		[
			'a duration',
			async (wrapper: ReturnType<typeof mountModal>) => {
				await wrapper.findAll('input[type="number"]')[1]!.setValue('50');
			},
			{ durationMinutes: 50 },
		],
		[
			'a cleared duration',
			async (wrapper: ReturnType<typeof mountModal>) => {
				await wrapper.findAll('input[type="number"]')[1]!.setValue('');
			},
			{ durationMinutes: null },
		],
		[
			'a start',
			async (wrapper: ReturnType<typeof mountModal>) => {
				await wrapper.get('input[type="datetime-local"]').setValue('2026-11-04T10:30:00');
			},
			{
				startedAt: new Date('2026-11-04T10:30:00').toISOString(),
			},
		],
		[
			'a cleared start',
			async (wrapper: ReturnType<typeof mountModal>) => {
				await wrapper.findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
			},
			{ startedAt: null },
		],
	] as const)('saves %s, and nothing of the timing left alone', async (_, edit, sent) => {
		mockRoundStore.getRoundById.mockReturnValue({
			id: 10,
			name: 'Round 1',
			roundNumber: 1,
			startedAt: '2026-11-04T09:00:00.000Z',
			durationMinutes: 30,
		});
		const wrapper = mountModal(RoundEditModal, { roundId: 10 });

		await edit(wrapper);
		await saveButton(wrapper).trigger('click');
		await flushPromises();

		expect(mockRoundStore.updateRound).toHaveBeenCalledWith(1, 10, { name: 'Round 1', roundNumber: 1, ...sent });
	});

	// An unreadable start is refused rather than saved as a cleared one.
	it.each([
		[
			'a duration past its bound',
			'input[type="number"]',
			1,
			'601',
		],
		[
			'a start that names no instant',
			'input[type="datetime-local"]',
			0,
			'soon',
		],
	] as const)('refuses %s', async (_, selector, index, value) => {
		const wrapper = mountModal(RoundEditModal, { roundId: 10 });

		await wrapper.findAll(selector)[index]!.setValue(value);

		expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
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
