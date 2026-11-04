import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
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

// Reactive, as a Pinia store is, so a load shows in the options.
const rounds = reactive(roundStore);
const phases = reactive(phaseStore);
mockNuxtImport('useRoundStore', () => () => rounds);
mockNuxtImport('usePhaseStore', () => () => phases);
vi.mock('~/modules/event-data/resync', () => ({
	useConsumedEventData: vi.fn(),
}));

describe('screenRoundField', () => {
	beforeEach(() => {
		rounds.isLoaded = true;
		phases.isLoaded = true;
		rounds.rounds = [
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
		phases.phases = [
			{ id: 3, name: 'Swiss', sortOrder: 1 },
			{ id: 4, name: 'Top Cut', sortOrder: 2 },
		];
		vi.resetAllMocks();
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

	it('offers the Event\'s Rounds once it has loaded those it lacked', async () => {
		const loaded = {
			rounds: [...rounds.rounds],
			phases: [...phases.phases],
		};
		Object.assign(rounds, { isLoaded: false, rounds: [] });
		Object.assign(phases, { isLoaded: false, phases: [] });
		rounds.loadRoundsByEventId.mockImplementation(async (eventId: number) => {
			if (eventId === 1)
				Object.assign(rounds, { isLoaded: true, rounds: loaded.rounds });
		});
		phases.loadPhasesByEventId.mockImplementation(async (eventId: number) => {
			if (eventId === 1)
				Object.assign(phases, { isLoaded: true, phases: loaded.phases });
		});
		const wrapper = mountField('Current standings');
		await flushPromises();

		expect(wrapper.findAll('option').map(option => option.text())).toEqual(['Current standings', 'Swiss · Round 4', 'Top Cut · Round 1']);
	});
});
