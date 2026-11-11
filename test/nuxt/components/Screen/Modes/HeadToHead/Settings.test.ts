import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/HeadToHead/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => ({
	players: [
		{ id: 7, name: 'Nadia Rivers' },
		{ id: 8, name: 'Oskar Lind' },
	],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
}));
const mockEvent = ref({ id: 1, pronounsEnabled: true });
mockNuxtImport('useEventStore', () => () => ({
	get event() {
		return mockEvent.value;
	},
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Table 1', value: 4 },
	{ label: 'Table 2', value: 5 },
]));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

/** A select that names its field and offers its items' values, and picks the given value when told to. */
const USelectStub = defineComponent({
	props: {
		modelValue: { type: null, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	setup(props, { attrs, emit }) {
		return () => h('select', {
			'data-testid': attrs['data-testid'],
			'data-values': JSON.stringify((props.items as { value: unknown }[] | undefined ?? []).map(item => item.value)),
			'data-value': JSON.stringify(props.modelValue ?? null),
			'onChange': (event: Event) => emit('update:modelValue', JSON.parse((event.target as HTMLSelectElement).dataset.pick!)),
		});
	},
});

async function mountComponent(themeOverrides: Record<string, unknown> = {}) {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1, currentMode: 'head-to-head', themeOverrides } as unknown as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				...screenSettingsLayoutStubs,
				USelect: USelectStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

/** Picks `value` in the select a test id, or `[data-config-field]` selector, names. */
async function pick(wrapper: Awaited<ReturnType<typeof mountComponent>>, target: string, value: unknown) {
	const select = wrapper.get(target.startsWith('[')
		? `${target} select`
		: `[data-testid="${target}"]`);
	(select.element as unknown as HTMLElement).dataset.pick = JSON.stringify(value);
	await select.trigger('change');
}

describe('screenHeadToHeadSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('head-to-head'),
		};
		mockEvent.value = { id: 1, pronounsEnabled: true };
	});

	it('binds the Screen to a Feature Match Slot of the Event', async () => {
		const wrapper = await mountComponent();

		expect(JSON.parse(wrapper.get('[data-testid="head-to-head-slot"]').attributes('data-values')!)).toEqual([4, 5]);
		expect(wrapper.find('[data-testid="head-to-head-player-1"]').exists()).toBe(false);

		await pick(wrapper, 'head-to-head-slot', 5);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ featureMatchId: 5 });
	});

	it('switches to picking two Players of the Event, keeping the Slot for switching back', async () => {
		mockConfig.value = { ...mockConfig.value, featureMatchId: 4 };
		const wrapper = await mountComponent();

		await pick(wrapper, '[data-config-field="playerSource"]', 'players');
		expect(mockUpdateConfig).toHaveBeenCalledWith({ playerSource: 'players' });
		await flushPromises();

		expect(wrapper.find('[data-testid="head-to-head-slot"]').exists()).toBe(false);
		for (const testId of ['head-to-head-player-1', 'head-to-head-player-2'])
			expect(JSON.parse(wrapper.get(`[data-testid="${testId}"]`).attributes('data-values')!)).toEqual([null, 7, 8]);

		await pick(wrapper, 'head-to-head-player-1', 8);
		await pick(wrapper, 'head-to-head-player-2', 7);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ player1Id: 8 });
		expect(mockUpdateConfig).toHaveBeenCalledWith({ player2Id: 7 });
		expect(mockUpdateConfig).not.toHaveBeenCalledWith(expect.objectContaining({
			featureMatchId: expect.anything(),
		}));
	});

	it('clears a picked Player as the deletion that reads as none', async () => {
		mockConfig.value = { ...mockConfig.value, playerSource: 'players', player1Id: 7 };
		const wrapper = await mountComponent();

		await pick(wrapper, 'head-to-head-player-1', null);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ player1Id: null });
	});

	// The Players binding, then one card per element; the mode declares no Mode Token, so no card holds a Look.
	it('lays out its cards in order', async () => {
		const wrapper = await mountComponent();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'head-to-head:players',
				title: 'Players',
				collapsible: false,
				groups: [],
			},
			{
				id: 'head-to-head:player-details',
				title: 'Player Details',
				collapsible: true,
				groups: [],
			},
			{
				id: 'head-to-head:header',
				title: 'Header',
				collapsible: true,
				groups: [],
			},
		]);
	});

	it.each([
		[
			'no override',
			{},
			{},
			{
				'head-to-head:player-details': 'Pronouns shown · Deck colors shown',
				'head-to-head:header': 'Auto title',
			},
		],
		[
			'hidden details, and a former Mode Token still stored',
			{ showPronouns: false, showDeckColors: false, showHeader: false },
			{ 'head-to-head.surface': '#000000' },
			{
				'head-to-head:player-details': 'Pronouns hidden · Deck colors hidden',
				'head-to-head:header': 'Hidden',
			},
		],
	])('summarises each closed card with %s', async (_case, edits, themeOverrides, summaries) => {
		mockConfig.value = {
			...mockConfig.value,
			...edits,
		};
		const wrapper = await mountComponent(themeOverrides);

		expect(settingsSummaries(wrapper)).toEqual(summaries);
	});

	// Pronouns follow the Event's own setting: off there, the toggle is off and says where to turn it on.
	it.each([
		[
			true,
			'true',
			false,
			'Show each Player\'s pronouns below their name.',
		],
		[
			false,
			'false',
			true,
			'Enable player pronouns in event settings to use this.',
		],
	])('with Event pronouns %s, shows the pronouns toggle on: %s, disabled: %s', async (pronounsEnabled, checked, disabled, description) => {
		mockEvent.value = { id: 1, pronounsEnabled };
		const wrapper = await mountComponent();
		const field = wrapper.get('[data-config-field="showPronouns"]');
		const toggle = field.get('[role="switch"]');

		expect(toggle.attributes('aria-checked')).toBe(checked);
		expect(toggle.attributes('disabled') !== undefined).toBe(disabled);
		expect(field.text()).toContain(description);
	});

	it('writes the deck colors toggle through its contract field', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-config-field="showDeckColors"] [role="switch"]').trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ showDeckColors: false });
	});
});
