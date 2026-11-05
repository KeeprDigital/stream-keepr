import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { UFormFieldStub, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/TopCut/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

/**
 * The Top Cut Bracket settings editor picks the Phase of the Screen's Event its bracket
 * is derived from, its size, and whether each Player's Seed and Archetype show.
 */

/** A select's options, as their labels and the values they write. */
function options(wrapper: Awaited<ReturnType<typeof mountEditor>>, field: string) {
	return wrapper.findAll(`[data-field="${field}"] option`).map(option => [
		option.text(),
		option.attributes('value'),
	]);
}

const config = ref<Record<string, unknown>>({});
const writes: Record<string, unknown>[] = [];
const phaseStore = {
	isLoaded: false,
	phases: [
		{
			id: 4,
			eventId: 1,
			name: 'Top 8',
			sortOrder: 2,
		},
		{
			id: 3,
			eventId: 1,
			name: 'Swiss',
			sortOrder: 1,
		},
	],
	loadPhasesByEventId: vi.fn(),
	$reset: vi.fn(),
};

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = {
			...config.value,
			...patch,
		};
	},
	resetConfig: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => phaseStore);
const eventStore = reactive({
	event: { id: 1, game: 'mtg' } as { id: number; game: 'mtg' | 'op' },
});
mockNuxtImport('useEventStore', () => () => eventStore);
const playerStore = {
	isLoaded: true,
	players: [],
	loadPlayersByEventId: vi.fn(),
};
mockNuxtImport('usePlayerStore', () => () => playerStore);

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		return () => h('button', {
			'type': 'button',
			'data-testid': 'settings-toggle',
			'data-on': String(props.modelValue),
			'onClick': () => emit('update:modelValue', !props.modelValue),
		}, props.label);
	},
});

async function mountEditor(themeOverrides: Record<string, unknown> = {}) {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1, currentMode: 'top-cut', themeOverrides } as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...screenSettingsLayoutStubs,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInput: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('screenModesTopCutSettings', () => {
	beforeEach(() => {
		config.value = {
			...getDefaultConfigForMode('top-cut'),
		};
		writes.length = 0;
		phaseStore.loadPhasesByEventId.mockClear();
		eventStore.event.game = 'mtg';
	});

	it('offers the Event\'s Phases in their order, loading them when the store holds none', async () => {
		const wrapper = await mountEditor();

		expect(phaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
		expect(options(wrapper, 'phaseId')).toEqual([
			['Select a phase…', 'null'],
			['Swiss', '3'],
			['Top 8', '4'],
		]);
	});

	/** Which of the Data card's controls show: the source picker, the Phase picker, the Manual Bracket editor. */
	function dataControls(wrapper: Awaited<ReturnType<typeof mountEditor>>) {
		return {
			source: wrapper.find('[data-config-field="bracketSource"]').exists(),
			phase: wrapper.find('[data-field="phaseId"]').exists(),
			manual: wrapper.find('[data-testid="manual-bracket-editor"]').exists(),
		};
	}

	it.each([
		[
			'a Phase on a Magic Event',
			'mtg',
			'phase',
			{ source: true, phase: true, manual: false },
		],
		[
			'entered by hand on a Magic Event',
			'mtg',
			'manual',
			{ source: true, phase: false, manual: true },
		],
		// A One Piece Card Game Event holds no Phases (ADR-0075).
		[
			'whatever it holds on a One Piece Event',
			'op',
			'phase',
			{ source: false, phase: false, manual: true },
		],
	] as const)('edits a bracket from %s', async (_, game, bracketSource, shown) => {
		eventStore.event.game = game;
		config.value = { ...config.value, bracketSource };
		const wrapper = await mountEditor();

		expect(dataControls(wrapper)).toEqual(shown);
	});

	it('writes the picked source as the Screen\'s bracketSource', async () => {
		const wrapper = await mountEditor();
		await wrapper.find('[data-config-field="bracketSource"] select').setValue('manual');

		expect(writes.at(-1)).toEqual({ bracketSource: 'manual' });
		expect(dataControls(wrapper).manual).toBe(true);
	});

	it('writes a Manual Bracket edit as the Screen\'s whole manualBracket', async () => {
		config.value = { ...config.value, bracketSource: 'manual' };
		const wrapper = await mountEditor();
		await wrapper.find('[data-field="manualBracket.size"] select').setValue('4');

		expect(writes.at(-1)).toEqual({
			manualBracket: { size: 4, entrants: [], results: [] },
		});
	});

	it('writes the picked Phase as the Screen\'s phaseId', async () => {
		const wrapper = await mountEditor();
		await wrapper.find('[data-field="phaseId"] select').setValue('4');

		expect(writes.at(-1)).toEqual({ phaseId: 4 });
	});

	it('offers the bracket sizes, sizing from the first Round until one is picked, and says a smaller one is ignored', async () => {
		const wrapper = await mountEditor();

		expect(options(wrapper, 'bracketSizeOverride').map(([, value]) => value)).toEqual([
			'null',
			...TOP_CUT_BRACKET_SIZES.map(String),
		]);
		expect(wrapper.find('[data-field="bracketSizeOverride"] p').text()).toMatch(/smaller .* ignored/);
	});

	it.each([
		[
			'8',
			{ bracketSizeOverride: 8 },
		],
		[
			'32',
			{ bracketSizeOverride: 32 },
		],
		[
			'null',
			{ bracketSizeOverride: null },
		],
	])('writes the picked size %s as the Screen\'s bracketSizeOverride', async (value, write) => {
		config.value = { ...config.value, bracketSizeOverride: 16 };
		const wrapper = await mountEditor();
		await wrapper.find('[data-field="bracketSizeOverride"] select').setValue(value);

		expect(writes.at(-1)).toEqual(write);
	});

	function toggle(wrapper: Awaited<ReturnType<typeof mountEditor>>, field: string) {
		return wrapper.get(`[data-config-field="${field}"]`);
	}

	it('leaves seeds and Archetypes off for a Screen that never set them, so it renders as before', async () => {
		const wrapper = await mountEditor();

		expect(toggle(wrapper, 'showSeeds').attributes('data-on')).toBe('false');
		expect(toggle(wrapper, 'showArchetypes').attributes('data-on')).toBe('false');
	});

	it.each([
		['Show Seeds', 'showSeeds'],
		['Show Archetypes', 'showArchetypes'],
	])('writes %s as the Screen\'s %s', async (label, field) => {
		const wrapper = await mountEditor();

		expect(toggle(wrapper, field).text()).toBe(label);
		await toggle(wrapper, field).trigger('click');
		expect(writes.at(-1)).toEqual({ [field]: true });
		await toggle(wrapper, field).trigger('click');
		expect(writes.at(-1)).toEqual({ [field]: false });
	});

	// Data, then one card per element of the bracket, each Mode Token in its group's Look (ADR-0072).
	it('lays out its cards in order', async () => {
		const wrapper = await mountEditor();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'top-cut:data',
				title: 'Data',
				collapsible: false,
				groups: [],
			},
			{
				id: 'top-cut:entrants',
				title: 'Entrants',
				collapsible: true,
				groups: ['entrants'],
			},
			{
				id: 'top-cut:bracket',
				title: 'Bracket',
				collapsible: true,
				groups: ['bracket'],
			},
			{
				id: 'top-cut:champion',
				title: 'Champion',
				collapsible: true,
				groups: ['champion'],
			},
			{
				id: 'top-cut:header',
				title: 'Header',
				collapsible: true,
				groups: ['header'],
			},
		]);
	});

	it.each([
		[
			'no override',
			{},
			{},
			{
				'top-cut:entrants': 'Seeds hidden · Archetypes hidden',
				'top-cut:bracket': 'Follows the Theme',
				'top-cut:champion': 'Follows the Theme',
				'top-cut:header': 'Auto title',
			},
		],
		[
			'seeds shown and overridden bracket and champion tokens',
			{ showSeeds: true, headerText: 'Top 8' },
			{ 'top-cut.connector': '#ffffff', 'top-cut.winner-surface': '#00ff00', 'top-cut.champion-border': '#ffd700' },
			{
				'top-cut:entrants': 'Seeds shown · Archetypes hidden',
				'top-cut:bracket': '2 Screen Theme Overrides',
				'top-cut:champion': '1 Screen Theme Override',
				'top-cut:header': '“Top 8”',
			},
		],
	])('summarises each closed card with %s', async (_case, edits, themeOverrides, summaries) => {
		config.value = {
			...config.value,
			...edits,
		};
		const wrapper = await mountEditor(themeOverrides);

		expect(settingsSummaries(wrapper)).toEqual(summaries);
	});
});
