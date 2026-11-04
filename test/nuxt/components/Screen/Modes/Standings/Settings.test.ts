import type { StandingsColumnConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref, toRaw } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { nuxtUiStubs, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
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
async function mountSettings(saved: Record<string, any> = config.value, themeOverrides: Record<string, unknown> = {}) {
	config.value = structuredClone(toRaw(saved));
	const wrapper = mount(Settings, {
		props: {
			screen: {
				id: 1,
				currentMode: 'standings',
				themeOverrides,
				modeConfigs: { standings: saved },
			} as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				...screenSettingsLayoutStubs,
				USwitch: USwitchStub,
				USelect: USelectStub,
				UIcon: true,
			},
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
	it('offers each Round as "Phase · Round", after the current standings', async () => {
		const wrapper = await mountSettings();
		const pickers = wrapper.findAll('select').map(select => select.findAll('option').map(option => option.text()));

		expect(pickers).toContainEqual([
			'Current standings',
			'Swiss · Round 1',
			'Top Cut · Round 1',
		]);
	});
});

const DATA = { id: 'standings:data', title: 'Data', collapsible: false };
const TABLE = {
	id: 'standings:table',
	title: 'Table',
	collapsible: true,
	groups: ['table'],
};
const HEADER = {
	id: 'standings:header',
	title: 'Header',
	collapsible: true,
	groups: ['header'],
};
const PAGINATION = {
	id: 'standings:pagination',
	title: 'Pagination',
	collapsible: true,
	groups: [],
};

describe('the Standings settings layout', () => {
	// Data, the reveal's live controls, then one card per element, each Mode Token in its group's Look (ADR-0072).
	it.each([
		[
			'all',
			[
				{
					...DATA,
					groups: ['data'],
				},
				TABLE,
				HEADER,
				PAGINATION,
			],
		],
		[
			'reveal',
			[
				{
					...DATA,
					groups: ['data'],
				},
				{
					id: 'standings:reveal-controls',
					title: 'Reveal Controls',
					collapsible: false,
					groups: [],
				},
				TABLE,
				HEADER,
				PAGINATION,
			],
		],
	])('lays out the %s view mode\'s cards in order', async (viewMode, layout) => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			viewMode,
		});

		expect(settingsLayout(wrapper)).toEqual(layout);
	});

	// The reveal's motion is a reveal-only Look, mounted in every view mode so it never falls to the Screen-wide look.
	it.each([
		['all', false],
		['topN', false],
		['reveal', true],
	])('shows the reveal\'s Look in the %s view mode: %s', async (viewMode, shown) => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			viewMode,
		});

		const look = wrapper.get<HTMLElement>('[data-settings-group="data"]');

		expect(look.element.style.display !== 'none').toBe(shown);
	});

	// Each view mode's own fields sit directly under the view mode select that reveals them.
	it.each([
		[
			'all',
			['viewMode'],
		],
		[
			'topN',
			['viewMode', 'topNCount'],
		],
		[
			'slice',
			['viewMode', 'sliceStart', 'sliceEnd'],
		],
		[
			'watchlist',
			['viewMode'],
		],
		[
			'reveal',
			['viewMode', 'revealCount', 'revealOrder'],
		],
	])('shows the %s view mode\'s fields under it in Data', async (viewMode, fields) => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			viewMode,
		});
		const data = wrapper.get('[data-settings-card="standings:data"]');

		expect(data.findAll('[data-config-field]').map(field => field.attributes('data-config-field'))).toEqual(fields);
	});

	it('names the Player List picker\'s empty state under the watchlist view mode', async () => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			viewMode: 'watchlist',
		});

		expect(wrapper.get('[data-settings-card="standings:data"]').text()).toContain('No player lists available');
	});

	it.each([
		[
			'the defaults',
			{},
			{},
			{
				'standings:table': '4 of 6 columns shown',
				'standings:header': 'Auto title',
				'standings:pagination': '8 per page · Manual paging',
			},
		],
		[
			'a custom header and overridden table tokens',
			{ headerText: 'Final Standings', autoPageEnabled: true },
			{ 'standings.surface': '#000000', 'standings.rise': '#00ff00' },
			{
				'standings:table': '4 of 6 columns shown · 2 Screen Theme Overrides',
				'standings:header': '“Final Standings”',
				'standings:pagination': '8 per page · Auto-page every 10 s',
			},
		],
	])('summarises each closed card for %s', async (_case, edits, themeOverrides, summaries) => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			...edits,
		}, themeOverrides);

		expect(settingsSummaries(wrapper)).toEqual(summaries);
	});

	type Wrapper = Awaited<ReturnType<typeof mountSettings>>;
	it.each([
		{
			name: 'picks a Round, back on page 1',
			viewMode: 'all',
			act: (w: Wrapper) => w.get('[data-settings-card="standings:data"] select').setValue('31'),
			patch: { roundId: 31, currentPage: 1 },
		},
		{
			name: 'sets the top N count',
			viewMode: 'topN',
			act: (w: Wrapper) => w.get('[data-config-field="topNCount"] input').setValue('12'),
			patch: { topNCount: 12 },
		},
		{
			name: 'sets the slice end',
			viewMode: 'slice',
			act: (w: Wrapper) => w.get('[data-config-field="sliceEnd"] input').setValue('24'),
			patch: { sliceEnd: 24 },
		},
		{
			name: 'sets the reveal order',
			viewMode: 'reveal',
			act: (w: Wrapper) => w.get('[data-config-field="revealOrder"] select').setValue('topDown'),
			patch: { revealOrder: 'topDown' },
		},
		{
			name: 'reveals the next Player',
			viewMode: 'reveal',
			act: (w: Wrapper) => w.findAll('button').find(button => button.text() === 'Reveal Next')!.trigger('click'),
			patch: { revealedCount: 1 },
		},
	])('$name', async ({ viewMode, act, patch }) => {
		const wrapper = await mountSettings({
			...getDefaultConfigForMode('standings'),
			viewMode,
		});
		writes.length = 0;

		await act(wrapper);

		expect(writes.at(-1)).toEqual(patch);
	});
});
