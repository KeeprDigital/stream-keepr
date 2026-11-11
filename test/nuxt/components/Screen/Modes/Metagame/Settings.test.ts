import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { NuxtLinkStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
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
	event: {
		id: 1,
		game: 'mtg',
		conversionMetric: 'minPoints',
		conversionThreshold: 0,
	} as Record<string, unknown>,
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
				...screenSettingsLayoutStubs,
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USwitch: USwitchStub,
				UButton: true,
				NuxtLink: NuxtLinkStub,
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
		mockEventStore.event.game = 'mtg';
	});

	// Each Mode Token's Look sits in the card for what it styles (ADR-0072):
	// the Table's outside chart view; the Chart holds none.
	it.each([
		[
			'archetype',
			'Table',
			'metagame:table',
			['table'],
		],
		[
			'cards',
			'Table',
			'metagame:table',
			['table'],
		],
		[
			'chart',
			'Chart',
			'metagame:chart',
			[],
		],
	] as const)('lays out its cards in %s view', async (viewMode, title, id, groups) => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			viewMode,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		const paged = viewMode !== 'chart';
		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'metagame:data',
				title: 'Data',
				collapsible: false,
				groups: [],
			},
			{
				id,
				title,
				collapsible: true,
				groups: [...groups],
			},
			{
				id: 'metagame:size-and-surface',
				title: 'Size & Surface',
				collapsible: true,
				groups: ['size-and-surface'],
			},
			{
				id: 'metagame:header',
				title: 'Header',
				collapsible: true,
				groups: [],
			},
			...(paged
				? [
						{
							id: 'metagame:pagination',
							title: 'Pagination',
							collapsible: true,
							groups: [],
						},
					]
				: []),
		]);
	});

	it('summarises each closed card', async () => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			headerText: 'Day 2',
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(settingsSummaries(wrapper)).toEqual({
			'metagame:table': '4 of 7 columns shown',
			'metagame:size-and-surface': 'Follows the Theme',
			'metagame:header': '“Day 2”',
			'metagame:pagination': '10 per page · Manual paging',
		});
	});

	it('links the chart to the Metagame page, where an Archetype pins its series', async () => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			viewMode: 'chart',
		};
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="pinned-chart-series-link"]').attributes('href')).toBe('/event/1/metagame');
	});

	it('writes a cleared archetype limit as the null that shows every archetype', async () => {
		mockConfig.value = {
			...structuredClone(defaultConfig),
			archetypeLimit: 8,
		};
		const wrapper = await mountComponent();
		await flushPromises();

		wrapper.get('[data-config-field="archetypeLimit"]').getComponent(UInputNumberStub).vm.$emit('update:modelValue', null);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ archetypeLimit: null, currentPage: 1 });
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

	// A One Piece Metagame reads participation only, and its cards no mana cost or Sideboard (ADR-0074).
	describe('on a One Piece Event', () => {
		beforeEach(() => {
			mockEventStore.event.game = 'op';
		});

		it('offers only the scopes and orders it reads, and no Conversion Target', async () => {
			mockConfig.value = {
				...structuredClone(defaultConfig),
				sortBy: 'conversionRate',
			};
			const wrapper = await mountComponent();
			await flushPromises();

			const select = (label: string) => wrapper.findAll('[data-testid="form-field"]').find(field => field.find('span').text() === label)!.get('[data-testid="u-select"]').text();
			expect(select('Player scope')).toBe('All Players|Player List');
			expect(select('Sort archetypes by')).toBe('Meta Share|Count');
			expect(wrapper.find('[data-testid="event-conversion-target"]').exists()).toBe(false);
		});

		it.each([
			[
				'archetype',
				[
					'Archetype',
					'Count',
					'Share',
					'Colors',
				],
			],
			[
				'cards',
				[
					'Card',
					'Type',
					'Inclusion',
					'Avg Copies',
					'Total Copies',
					'Decks',
					'Main',
				],
			],
		] as const)('offers the %s table only the columns it reads', async (viewMode, labels) => {
			mockConfig.value = {
				...structuredClone(defaultConfig),
				viewMode,
			};
			const wrapper = await mountComponent();
			await flushPromises();

			expect(wrapper.findAll('[data-testid="column-label"]').map(label => label.text())).toEqual(labels);
		});

		it('keeps the columns it does not offer where they were stored, when a column is toggled', async () => {
			const wrapper = await mountComponent();
			await flushPromises();

			await wrapper.findAll('[data-testid="u-switch"]')[3]!.trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledWith({
				archetypeColumns: [
					{ key: 'archetype', visible: true },
					{ key: 'count', visible: true },
					{ key: 'metaShare', visible: true },
					{ key: 'colors', visible: true },
					{ key: 'winRate', visible: true },
					{ key: 'avgPlace', visible: false },
					{ key: 'conversionRate', visible: false },
				],
			});
		});
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
