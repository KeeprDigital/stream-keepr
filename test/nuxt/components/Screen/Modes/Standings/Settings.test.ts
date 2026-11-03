import type { StandingsColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { deferred } from '~~/test/helpers/deferred';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
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
	rounds: [],
	loadRoundsByEventId: vi.fn(),
}));

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

const previousRound = {
	roundId: 6,
	positions: [
		{ playerId: 1, position: 1 },
	],
};

/** The Standings Screen Output read's answer, with or without a previous Round's Round Standings. */
function answerStandings(previousRoundPositions: typeof previousRound | null) {
	mockFetch.mockResolvedValue({
		players: [],
		round: null,
		roundStandings: null,
		watchlist: null,
		previousRoundPositions,
	});
}

function columnsShowingPositionChange(visible: boolean): StandingsColumnConfig[] {
	return getDefaultConfigForMode('standings').columns.map(column =>
		column.key === 'positionChange'
			? { ...column, visible }
			: column);
}

/** The editor over a Screen as saved; the operator's config starts as saved. */
async function mountSettings(saved: Record<string, any> = config.value) {
	config.value = JSON.parse(JSON.stringify(saved));
	const wrapper = mount(Settings, {
		props: {
			screen: {
				id: 1,
				modeConfigs: { standings: saved },
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: { USwitch: USwitchStub, UIcon: true },
		},
	});
	await flushPromises();
	return wrapper;
}

function columnLabels(wrapper: Awaited<ReturnType<typeof mountSettings>>) {
	return wrapper.findAll('[data-testid="column-label"]').map(label => label.text());
}

function noDataWarning(wrapper: Awaited<ReturnType<typeof mountSettings>>) {
	return wrapper.find('[data-testid="position-change-no-data"]');
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
	// Warns only from what the Screen's own read answered with the column showing (#905).
	it.each([
		[
			'shown, with no previous Round to compare',
			true,
			true,
			null,
			true,
		],
		[
			'shown, with a previous Round to compare',
			true,
			true,
			previousRound,
			false,
		],
		[
			'hidden by an edit not yet saved',
			true,
			false,
			null,
			false,
		],
		[
			'shown by an edit not yet saved, whose read did not look',
			false,
			true,
			null,
			false,
		],
		['hidden', false, false, null, false],
	])('with the column %s, warns: %s', async (_, savedShows, editedShows, previous, warns) => {
		answerStandings(previous);
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			columns: columnsShowingPositionChange(savedShows),
		});
		saving.value = savedShows !== editedShows;
		config.value = {
			...config.value,
			columns: columnsShowingPositionChange(editedShows),
		};
		await flushPromises();

		expect(noDataWarning(wrapper).exists()).toBe(warns);
	});

	it('waits for the read made with the column shown once its save lands', async () => {
		const hidden = {
			...getDefaultConfigForMode('standings'),
			columns: columnsShowingPositionChange(false),
		};
		const shown = {
			...hidden,
			columns: columnsShowingPositionChange(true),
		};
		const wrapper = await mountSettings(hidden);
		const read = deferred<unknown>();
		mockFetch.mockReturnValue(read.promise);

		config.value = { ...config.value, columns: shown.columns };
		await wrapper.setProps({
			screen: {
				id: 1,
				modeConfigs: { standings: shown },
			} as unknown as Screen,
		});
		await flushPromises();
		expect(noDataWarning(wrapper).exists()).toBe(false);

		read.resolve({
			players: [],
			round: null,
			roundStandings: null,
			watchlist: null,
			previousRoundPositions: null,
		});
		await flushPromises();
		expect(noDataWarning(wrapper).exists()).toBe(true);
	});

	it('goes once Melee-imported Round Standings give the column something to compare', async () => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			columns: columnsShowingPositionChange(true),
		});
		expect(noDataWarning(wrapper).text()).toContain('no data for this Event yet');

		answerStandings(previousRound);
		channel.deliver('melee:roundStandingsSynced', {});
		await flushPromises();

		expect(noDataWarning(wrapper).exists()).toBe(false);
	});
});
