import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs, UInputMenuStub, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/PlayerHistory/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));

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

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => ({
	players: [
		{ id: 5, name: 'Ada' },
	],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)">{{ String(!!modelValue) }}</button>',
});

async function mountComponent(themeOverrides: Record<string, unknown> = {}) {
	return mount(Settings, {
		props: {
			screen: { id: 1, currentMode: 'player-history', themeOverrides } as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				...screenSettingsLayoutStubs,
				USwitch: USwitchStub,
				USelect: USelectStub,
				UInputMenu: UInputMenuStub,
				UIcon: true,
			},
		},
	});
}

/** A Screen that stored its columns before opponent archetype and game score existed. */
const storedBeforeNewColumns = [
	{ key: 'outcome', visible: true },
	{ key: 'round', visible: true },
	{ key: 'opponent', visible: true },
	{ key: 'table', visible: false },
];

describe('screenPlayerHistorySettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('player-history'),
			columns: storedBeforeNewColumns,
		};
	});

	it('offers columns added after a Screen stored its list, enabling one in place', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.findAll('[data-testid="column-row"] [data-testid="u-switch"]')[5]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			columns: [
				...storedBeforeNewColumns,
				{ key: 'opponentArchetype', visible: false },
				{ key: 'gameScore', visible: true },
			],
		});
	});

	// Data, then one card per element, each Mode Token in its group's Look (ADR-0072).
	it('lays out its cards in order', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'player-history:data',
				title: 'Data',
				collapsible: false,
				groups: [],
			},
			{
				id: 'player-history:table',
				title: 'Table',
				collapsible: true,
				groups: ['outcome-badge'],
			},
			{
				id: 'player-history:header',
				title: 'Header',
				collapsible: true,
				groups: [],
			},
			{
				id: 'player-history:pagination',
				title: 'Pagination',
				collapsible: true,
				groups: [],
			},
		]);
	});

	it.each([
		[
			'no override',
			{},
			{
				'player-history:table': '3 of 6 columns shown',
				'player-history:header': 'Auto title',
				'player-history:pagination': '8 per page · Manual paging',
			},
		],
		[
			'overridden outcome badge tokens',
			{ 'player-history.outcome-win': '#00ff00', 'player-history.outcome-loss': '#ff0000' },
			{
				'player-history:table': '3 of 6 columns shown · 2 Screen Theme Overrides',
				'player-history:header': 'Auto title',
				'player-history:pagination': '8 per page · Manual paging',
			},
		],
	])('summarises each closed card with %s', async (_case, themeOverrides, summaries) => {
		const wrapper = await mountComponent(themeOverrides);
		await flushPromises();

		expect(settingsSummaries(wrapper)).toEqual(summaries);
	});

	it('picks a Player, back on page 1', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.get('[data-settings-card="player-history:data"] [role="option"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ playerId: 5, currentPage: 1 });
	});
});
