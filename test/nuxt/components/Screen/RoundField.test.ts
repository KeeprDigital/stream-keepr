import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import RoundField from '~/components/Screen/RoundField.vue';

// The Round picker of Screen settings: the Event's Rounds in Round order after the mode's null
// option, emitting the Round's id, or `null` for the null option.

const { roundStore, phaseStore } = vi.hoisted(() => ({
	roundStore: {
		isLoaded: true,
		rounds: [] as Record<string, unknown>[],
		loadRoundsByEventId: vi.fn(),
	},
	phaseStore: {
		isLoaded: true,
		phases: [] as Record<string, unknown>[],
		loadPhasesByEventId: vi.fn(),
	},
}));

mockNuxtImport('useRoundStore', () => () => roundStore);
mockNuxtImport('usePhaseStore', () => () => phaseStore);
vi.mock('~/modules/event-data/resync', () => ({
	useConsumedEventData: vi.fn(),
}));

describe('screenRoundField', () => {
	beforeEach(() => {
		roundStore.isLoaded = true;
		phaseStore.isLoaded = true;
		roundStore.rounds = [
			{
				id: 41,
				phaseId: 4,
				name: 'Round 1',
				roundNumber: 1,
			},
			{
				id: 31,
				phaseId: 3,
				name: 'Round 4',
				roundNumber: 4,
			},
		];
		phaseStore.phases = [
			{ id: 3, name: 'Swiss', sortOrder: 1 },
			{ id: 4, name: 'Top Cut', sortOrder: 2 },
		];
		vi.clearAllMocks();
	});

	function mountField(nullLabel: string, modelValue: number | null = 31) {
		return mount(RoundField, {
			props: {
				modelValue,
				nullLabel,
				description: 'Which Round to show.',
				eventId: 1,
			},
			global: {
				stubs: { ...nuxtUiStubs, USelect: USelectStub },
			},
		});
	}

	it.each([
		{ nullLabel: 'Current standings' },
		{ nullLabel: 'Select a round…' },
	])('offers "$nullLabel" before each Round in Round order', ({ nullLabel }) => {
		const options = mountField(nullLabel).findAll('option').map(option => option.text());

		expect(options).toEqual([nullLabel, 'Swiss · Round 4', 'Top Cut · Round 1']);
	});

	it.each([
		{ name: 'a Round', pick: '41', emitted: 41 },
		{ name: 'null for the null option', pick: 'null', emitted: null },
	])('emits $name', async ({ pick, emitted }) => {
		const wrapper = mountField('Current standings');
		await wrapper.get('select').setValue(pick);

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[emitted],
		]);
	});

	it('loads the Event\'s Rounds and Phases it lacks', async () => {
		roundStore.isLoaded = false;
		phaseStore.isLoaded = false;
		mountField('Current standings');
		await flushPromises();

		expect(roundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
		expect(phaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
	});
});
