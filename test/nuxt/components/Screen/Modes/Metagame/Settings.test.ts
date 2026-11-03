import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import Settings from '~/components/Screen/Modes/Metagame/Settings.vue';

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

const mockPlayerStore = {
	players: [
		{ id: 1 },
		{ id: 2 },
		{ id: 3 },
	],
	isLoaded: false,
	loadPlayersByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const mockPlayerListStore = {
	lists: [
		{ id: 7, name: 'Feature Table', memberCount: 4 },
	],
	isLoaded: false,
	loadByEventId: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const mockEventStore = {
	event: { id: 1, conversionMetric: 'minPoints', conversionThreshold: 0 },
	loadEvent: vi.fn().mockResolvedValue(undefined),
	$reset: vi.fn(),
};

const defaultConfig = {
	viewMode: 'archetype' as const,
	scope: 'all' as const,
	topN: 8,
	minPoints: 9,
	playerListId: undefined,
	archetypeFilter: undefined,
	sortBy: 'metaShare' as const,
	cardSortBy: 'inclusionRate' as const,
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	pageSize: 10,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	showHeader: true,
	headerText: undefined,
};

const mockConfig = ref<Record<string, any>>({ ...defaultConfig });
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
		subtitle: { type: String, required: false },
	},
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p><slot /></section>',
});

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="settings-toggle" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number, Boolean, Object],
			required: false,
		},
		items: { type: Array, required: false },
	},
	template: '<div data-testid="u-select">{{ (items || []).map(item => item.label).join("|") }}</div>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	template: '<div data-testid="u-input">{{ modelValue }}</div>',
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-input-number">{{ modelValue }}</div>',
});

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)">{{ String(!!modelValue) }}</button>',
});

async function mountComponent() {
	return mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UButton: true,
				NuxtLink: {
					props: ['to'],
					template: '<a :href="to"><slot /></a>',
				},
				USeparator: true,
				UIcon: true,
			},
		},
	});
}

describe('screenMetagameSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(defaultConfig);
		mockPlayerStore.isLoaded = false;
		mockPlayerListStore.isLoaded = false;
	});

	it('offers a Conversion Rate column to a column list saved before it existed, hidden at the end', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.findAll('[data-testid="column-label"]').map(label => label.text()))
			.toEqual([
				'Archetype',
				'Count',
				'Share',
				'Win Rate',
				'Avg Place',
				'Colors',
				'Conversion Rate',
			]);

		await wrapper.findAll('[data-testid="u-switch"]')[6]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			archetypeColumns: [
				...defaultConfig.archetypeColumns,
				{ key: 'conversionRate', visible: true },
			],
		});
	});

	// The Conversion Target is the Event's (ADR-0061): a Screen names it and where to change it, and offers no input for it.
	it.each([
		{
			name: 'hides it with no Conversion Rate shown or sorted',
			conversionColumn: false,
			sortBy: 'metaShare',
			viewMode: 'archetype',
			shown: false,
		},
		{
			name: 'shows it while the Conversion Rate column shows',
			conversionColumn: true,
			sortBy: 'metaShare',
			viewMode: 'archetype',
			shown: true,
		},
		{
			name: 'shows it while archetypes sort by Conversion Rate',
			conversionColumn: false,
			sortBy: 'conversionRate',
			viewMode: 'chart',
			shown: true,
		},
		{
			name: 'hides it on the cards table',
			conversionColumn: true,
			sortBy: 'conversionRate',
			viewMode: 'cards',
			shown: false,
		},
	])('$name, read-only', async ({ conversionColumn, sortBy, viewMode, shown }) => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			viewMode,
			sortBy,
			archetypeColumns: [
				...defaultConfig.archetypeColumns,
				{ key: 'conversionRate', visible: conversionColumn },
			],
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const target = wrapper.find('[data-testid="event-conversion-target"]');
		expect(target.exists()).toBe(shown);
		if (shown) {
			expect(target.text()).toBe('0+ pts');
			expect(wrapper.get('[data-testid="event-conversion-target-link"]').attributes('href')).toBe('/event/1/metagame');
		}
		expect(wrapper.text()).not.toContain('Conversion threshold');
	});

	it('offers sorting archetypes by Conversion Rate', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const sortBy = wrapper.findAll('[data-testid="form-field"]').find(field => field.find('span').text() === 'Sort archetypes by')!;
		expect(sortBy.text()).toContain('Conversion Rate');
		sortBy.getComponent(USelectStub).vm.$emit('update:modelValue', 'conversionRate');
		await nextTick();

		expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'conversionRate' }));
	});

	it('persists reordered columns for the active table', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const reordered = [
			{ key: 'metaShare', visible: true },
			{ key: 'archetype', visible: true },
			{ key: 'count', visible: true },
			{ key: 'winRate', visible: true },
			{ key: 'avgPlace', visible: false },
			{ key: 'colors', visible: false },
		];

		const draggable = wrapper.getComponent({ name: 'VueDraggable' });
		draggable.vm.$emit('update:modelValue', reordered);
		await nextTick();
		draggable.vm.$emit('end');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			archetypeColumns: reordered,
		});
	});

	it('scopes, sorts and limits the chart as it does the archetype table, as one page with no columns', async () => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			viewMode: 'chart',
		};

		const wrapper = await mountComponent();
		await flushPromises();

		const fieldLabels = wrapper.findAll('[data-testid="form-field"]').map(field => field.find('span').text());
		expect(fieldLabels).toEqual(expect.arrayContaining(['Player scope', 'Sort archetypes by', 'Top archetypes']));
		expect(fieldLabels).not.toContain('Card limit');
		expect(fieldLabels).not.toContain('Rows per page');

		const cardTitles = wrapper.findAll('[data-testid="settings-card"]').map(card => card.find('h2').text());
		expect(cardTitles).not.toContain('Pagination');
		expect(wrapper.findComponent({ name: 'VueDraggable' }).exists()).toBe(false);
	});
});
