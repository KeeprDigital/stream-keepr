import type { MetagameChartBar } from '~~/shared/utils/metagameChart';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import Display from '~/components/Screen/Modes/Metagame/Display.vue';

const config = ref<any>({
	viewMode: 'archetype',
	showHeader: true,
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
});

const pageData = ref<any[]>([
	{
		id: 1,
		name: 'Mono Red',
		count: 12,
		metaShare: 25,
		winRate: 61.5,
		avgPosition: 3.2,
		colors: 'R',
	},
]);

const chartBars = ref<MetagameChartBar[]>([]);
const game = ref<'mtg' | 'op'>('mtg');

// The mode's data is faked, so nothing reads the Screen context it is handed.
mockNuxtImport('useScreenContext', () => () => ({}));
mockNuxtImport('useMetagameModeData', () => () => ({
	config: computed(() => config.value),
	game: computed(() => game.value),
	loading: ref(false),
	error: ref<string | null>(null),
	isEmpty: computed(() => false),
	emptyMessage: computed(() => 'No metagame data available'),
	headerText: computed(() => config.value.viewMode === 'cards'
		? 'Most Played Cards'
		: 'Full Field Metagame'),
	pageData: computed(() => pageData.value),
	// The page size field the mode's Page Rotation declares.
	pageSize: computed(() => config.value.pageSize),
	chartBars: computed(() => chartBars.value),
	currentPage: computed(() => 1),
	totalPages: computed(() => 2),
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		loading: { type: Boolean, required: false },
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: '<div data-testid="mode-base"><slot /></div>',
});

const ManaDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: false },
		manaCost: { type: String, required: false },
	},
	template: '<div data-testid="mana-display">{{ colors || manaCost }}</div>',
});

async function mountComponent() {
	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				MtgManaColorDisplay: ManaDisplayStub,
			},
		},
	});
}

describe('screenMetagameDisplay', () => {
	beforeEach(() => {
		config.value = {
			viewMode: 'archetype',
			showHeader: true,
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
		};
		pageData.value = [
			{
				id: 1,
				name: 'Mono Red',
				count: 12,
				metaShare: 25,
				winRate: 61.5,
				avgPosition: 3.2,
				colors: 'R',
				conversionRate: 37.5,
			},
		];
		chartBars.value = [];
		game.value = 'mtg';
	});

	it('sizes rows for the page size before the rows are measured', async () => {
		config.value = { ...config.value, pageSize: 10 };

		const style = (await mountComponent()).get('.metagame-rows').attributes('style');

		// The sizes derived from the height are `tableRowLayout`'s own test.
		expect(style).toContain('--metagame-row-height: 44px;');
		expect(style).toContain('--metagame-row-font-size:');
	});

	it('renders each Archetype\'s Conversion Rate where the operator placed its column', async () => {
		config.value = {
			...config.value,
			archetypeColumns: [
				{ key: 'archetype', visible: true },
				{ key: 'conversionRate', visible: true },
				{ key: 'count', visible: true },
			],
		};

		const wrapper = await mountComponent();

		expect(wrapper.findAll('.metagame-header-cell').map(cell => cell.text())).toEqual(['Archetype', 'Conversion', 'Count']);
		expect(wrapper.findAll('.metagame-row .metagame-cell').map(cell => cell.text())).toEqual(['Mono Red', '37.5%', '12']);
	});

	it('shows an absent Conversion Rate as a dash', async () => {
		config.value = {
			...config.value,
			archetypeColumns: [
				{ key: 'archetype', visible: true },
				{ key: 'conversionRate', visible: true },
			],
		};
		pageData.value = [
			{ ...pageData.value[0], conversionRate: null },
		];

		const wrapper = await mountComponent();

		expect(wrapper.findAll('.metagame-row .metagame-cell').map(cell => cell.text())).toEqual(['Mono Red', '-']);
	});

	it('renders a stored column list saved before Conversion Rate existed unchanged', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.findAll('.metagame-header-cell').map(cell => cell.text())).toEqual([
			'Archetype',
			'Count',
			'Share',
			'Win Rate',
		]);
	});

	it('renders the colors column when it is visible', async () => {
		config.value = {
			...config.value,
			archetypeColumns: config.value.archetypeColumns.map((column: any) =>
				column.key === 'colors'
					? { ...column, visible: true }
					: column,
			),
		};

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="metagame-header-row"]').text()).toContain('Colors');
		expect(wrapper.get('[data-testid="mana-display"]').text()).toBe('R');
	});

	// A One Piece Metagame reads participation only, and its cards no mana cost or Sideboard (ADR-0074).
	describe('on a One Piece Event', () => {
		beforeEach(() => {
			game.value = 'op';
		});

		it('shows no standings column, wherever a stored config places one', async () => {
			config.value = {
				...config.value,
				archetypeColumns: [
					{ key: 'archetype', visible: true },
					{ key: 'winRate', visible: true },
					{ key: 'avgPlace', visible: true },
					{ key: 'conversionRate', visible: true },
					{ key: 'metaShare', visible: true },
				],
			};

			const wrapper = await mountComponent();

			expect(wrapper.findAll('.metagame-header-cell').map(cell => cell.text())).toEqual(['Archetype', 'Share']);
		});

		it('shows no mana cost or Sideboard count for a card', async () => {
			config.value = { ...config.value, viewMode: 'cards' };
			pageData.value = [
				{
					id: 3,
					name: 'Usopp',
					cardType: 'Character',
					manaCost: null,
					inclusionRate: 50,
					avgCopies: 4,
					totalCopies: 8,
					deckCount: 2,
					mainboardCount: 8,
					sideboardCount: 0,
				},
			];

			const wrapper = await mountComponent();

			expect(wrapper.findAll('.metagame-header-cell').map(cell => cell.text())).toEqual([
				'Card',
				'Type',
				'Inclusion',
				'Avg Copies',
				'Total Copies',
				'Decks',
				'Main',
			]);
			expect(wrapper.findAll('.metagame-row .metagame-cell').map(cell => cell.text())).toEqual([
				'Usopp',
				'Character',
				'50%',
				'4',
				'8',
				'2',
				'8',
			]);
		});

		it('shows an Archetype\'s Leader colours as One Piece pips', async () => {
			config.value = {
				...config.value,
				archetypeColumns: [
					{ key: 'archetype', visible: true },
					{ key: 'colors', visible: true },
				],
			};
			pageData.value = [
				{ ...pageData.value[0], name: 'Monkey.D.Luffy', colors: 'Red/Green' },
			];

			const wrapper = await mountComponent();

			expect(wrapper.findAll('[data-op-color]').map(pip => pip.attributes('data-op-color'))).toEqual(['Red', 'Green']);
			expect(wrapper.find('[data-testid="mana-display"]').exists()).toBe(false);
		});
	});

	describe('chart display', () => {
		beforeEach(() => {
			config.value = { ...config.value, viewMode: 'chart' };
			chartBars.value = [
				{
					id: 4,
					name: 'Boros Energy',
					colors: 'RW',
					metaShare: 50,
					length: 1,
					colorSlot: 4,
				},
				{
					id: 9,
					name: 'Eldrazi Ramp',
					colors: null,
					metaShare: 33.33,
					length: 0.6666,
					colorSlot: 1,
				},
				{
					id: -1,
					name: 'Other',
					colors: null,
					metaShare: 16.67,
					length: 0.3334,
					colorSlot: null,
				},
			];
		});

		it('draws a bar per archetype, labelled with its name and meta share, instead of the table', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.find('[data-testid="metagame-header-row"]').exists()).toBe(false);
			const bars = wrapper.findAll('[data-testid="metagame-chart-bar"]');
			expect(bars.map(bar => [
				bar.get('[data-testid="metagame-chart-name"]').text(),
				bar.get('[data-testid="metagame-chart-share"]').text(),
			])).toEqual([
				['Boros Energy', '50%'],
				['Eldrazi Ramp', '33.33%'],
				['Other', '16.67%'],
			]);
		});

		it('fills each bar from its colour slot\'s chart series, and Other from the neutral fill', async () => {
			const wrapper = await mountComponent();

			const fills = wrapper.findAll('[data-testid="metagame-chart-fill"]');
			expect(fills.map(fill => fill.attributes('data-color-slot'))).toEqual(['4', '1', 'other']);
			expect(fills[0]!.attributes('style')).toContain('chart-series-4');
			expect(fills[2]!.attributes('style')).toContain('chart-other');
		});

		it('shows each Archetype\'s mana colours beside its name', async () => {
			const wrapper = await mountComponent();

			const bars = wrapper.findAll('[data-testid="metagame-chart-bar"]');
			expect(bars[0]!.get('[data-testid="mana-display"]').text()).toBe('RW');
			expect(bars[1]!.find('[data-testid="mana-display"]').exists()).toBe(false);
		});

		it('keeps the header above the chart', async () => {
			const wrapper = await mountComponent();

			expect(wrapper.text()).toContain('Full Field Metagame');
		});
	});
});
