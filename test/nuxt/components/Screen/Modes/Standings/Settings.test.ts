import type { StandingsColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref, toRaw } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Settings from '~/components/Screen/Modes/Standings/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

vi.mock('vue-draggable-plus', () => ({
	VueDraggable: defineComponent({
		name: 'VueDraggable',
		props: {
			modelValue: { type: Array, required: false },
		},
		emits: ['update:modelValue', 'end'],
		template: '<div data-testid="draggable"><slot /></div>',
	}),
}));

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const channel = createFakeEventChannel();

const config = ref<Record<string, any>>({});
const saving = ref(false);
const writes: Record<string, unknown>[] = [];

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => channel.transport);
mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => 1_000_000,
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving,
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = {
			...config.value,
			...patch,
		};
	},
	resetConfig: vi.fn(),
}));

const loaded = {
	isLoaded: true,
	$reset: vi.fn(),
};
mockNuxtImport('usePlayerListStore', () => () => ({
	...loaded,
	lists: [],
	loadByEventId: vi.fn(),
}));
mockNuxtImport('useRoundStore', () => () => ({
	...loaded,
	rounds: [
		{
			id: 31,
			phaseId: 3,
			name: 'Round 1',
			roundNumber: 1,
		},
		{
			id: 41,
			phaseId: 4,
			name: 'Round 1',
			roundNumber: 1,
		},
	],
	loadRoundsByEventId: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => ({
	...loaded,
	phases: [
		{ id: 3, name: 'Swiss', sortOrder: 1 },
		{ id: 4, name: 'Top Cut', sortOrder: 2 },
	],
	loadPhasesByEventId: vi.fn(),
}));

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

/** The Standings Screen Output read answers no Players, with or without a previous Round's positions. */
function answerStandings(previousRoundPositions: { roundId: number; positions: { playerId: number; position: number }[] } | null) {
	mockFetch.mockResolvedValue({
		players: [],
		round: null,
		roundStandings: null,
		watchlist: null,
		previousRoundPositions,
	});
}

/** The default Standings config, its Position Change column shown or hidden. */
function standingsShowingPositionChange(visible: boolean): Record<string, any> {
	const defaults = getDefaultConfigForMode('standings');
	return {
		...defaults,
		columns: defaults.columns.map((column: StandingsColumnConfig) =>
			column.key === 'positionChange'
				? { ...column, visible }
				: column),
	};
}

/** The editor over a Screen as saved; the operator's config starts as saved. */
async function mountSettings(saved: Record<string, any> = config.value) {
	config.value = structuredClone(toRaw(saved));
	const wrapper = mount(Settings, {
		props: {
			screen: {
				id: 1,
				modeConfigs: { standings: saved },
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: { USwitch: USwitchStub, USelect: USelectStub, UIcon: true },
		},
	});
	await flushPromises();
	return wrapper;
}

function columnLabels(wrapper: Awaited<ReturnType<typeof mountSettings>>) {
	return wrapper.findAll('[data-testid="column-label"]').map(label => label.text());
}

beforeEach(() => {
	writes.length = 0;
	saving.value = false;
	mockFetch.mockReset();
	answerStandings(null);
	config.value = structuredClone(getDefaultConfigForMode('standings'));
});

describe('the Standings settings editor\'s columns', () => {
	it('offers the Position Change column to a Screen whose stored columns predate it, and shows it on request', async () => {
		config.value.columns = [
			{ key: 'name', visible: true },
			{ key: 'position', visible: true },
			{ key: 'record', visible: false },
			{ key: 'points', visible: true },
			{ key: 'deck', visible: false },
		];

		const wrapper = await mountSettings();
		const rows = wrapper.findAll('[data-testid="column-row"]');

		expect(columnLabels(wrapper)).toEqual([
			'Name',
			'#',
			'Record (W-L-D)',
			'Points',
			'Deck',
			'Position Change',
		]);

		await rows[5]!.get('[data-testid="u-switch"]').trigger('click');

		expect(writes.at(-1)).toMatchObject({
			columns: [
				{ key: 'name', visible: true },
				{ key: 'position', visible: true },
				{ key: 'record', visible: false },
				{ key: 'points', visible: true },
				{ key: 'deck', visible: false },
				{ key: 'positionChange', visible: true },
			],
		});
	});
});

describe('the Standings settings editor\'s Position Change warning', () => {
	// Warns from the Screen's own read, and goes at once when the operator hides the column (#905).
	it.each([
		[
			'its read found no previous Round',
			true,
			null,
			true,
		],
		[
			'its read found a previous Round',
			true,
			{
				roundId: 6,
				positions: [
					{ playerId: 1, position: 1 },
				],
			},
			false,
		],
		[
			'the operator hid the column, the save still out',
			false,
			null,
			false,
		],
	])('with the column shown and %s, warns: %s', async (_, editedShows, previousRoundPositions, warns) => {
		answerStandings(previousRoundPositions);
		const wrapper = await mountSettings(standingsShowingPositionChange(true));

		saving.value = !editedShows;
		config.value = standingsShowingPositionChange(editedShows);
		await flushPromises();

		const warning = wrapper.find('[data-testid="position-change-no-data"]');
		expect(warning.exists()).toBe(warns);
		if (warns)
			expect(warning.text()).toContain('no data for this Event yet');
	});
});

describe('the Standings settings editor\'s Round picker', () => {
	it('offers each Round as "Phase · Round", after Current', async () => {
		const wrapper = await mountSettings();
		const pickers = wrapper.findAll('select').map(select => select.findAll('option').map(option => option.text()));

		expect(pickers).toContainEqual([
			'Current',
			'Swiss · Round 1',
			'Top Cut · Round 1',
		]);
	});
});
