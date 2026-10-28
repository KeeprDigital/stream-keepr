import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { fitColumns } from '~~/shared/utils/cardGrid';
import Display from '~/components/Screen/Modes/TopCards/Display.vue';

// The space the grid measures; 0 until it is laid out.
const measured = vi.hoisted(() => ({ width: 0, height: 0 }));
vi.mock('@vueuse/core', async (importOriginal) => {
	const { ref } = await import('vue');
	return {
		...await importOriginal<typeof import('@vueuse/core')>(),
		useElementSize: () => ({
			width: ref(measured.width),
			height: ref(measured.height),
		}),
	};
});

const defaultConfig = {
	scope: 'all',
	topN: 8,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	excludedCardTypes: ['Land'],
	columns: 5,
	autoColumns: false,
	cardSizing: 'fit',
	cardWidth: 160,
	cardGap: 12,
	badgeSize: 14,
	showHeader: true,
	headerText: undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate',
};

const config = ref<any>({ ...defaultConfig });

const entries = ref<any[]>([
	{
		id: 1,
		name: 'Lightning Bolt',
		inclusionRate: 80,
		avgCopies: 3.6,
		totalCopies: 18,
		deckCount: 4,
		cardType: 'Instant',
		scryfallId: null,
	},
	{
		id: 2,
		name: 'Counterspell',
		inclusionRate: 60,
		avgCopies: 3,
		totalCopies: 12,
		deckCount: 3,
		cardType: 'Instant',
		scryfallId: null,
	},
]);

// The page the composable projects: by default every card, ranked from 1.
const pageEntries = ref<any[] | null>(null);
const currentPage = ref(1);
const totalPages = ref(1);
const pageCapacity = ref(2);

mockNuxtImport('useTopCardsModeData', () => () => ({
	config: computed(() => config.value),
	loading: ref(false),
	error: ref<string | null>(null),
	isEmpty: computed(() => false),
	emptyMessage: computed(() => 'No card data available'),
	headerText: computed(() => config.value.headerText ?? 'Most Played Cards'),
	entries: computed(() => entries.value),
	pageEntries: computed(() => pageEntries.value ?? entries.value.map((entry, index) => ({ entry, rank: index + 1 }))),
	currentPage: computed(() => currentPage.value),
	totalPages: computed(() => totalPages.value),
	pageCapacity: computed(() => pageCapacity.value),
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: '<div data-testid="mode-base"><slot /></div>',
});

const TopCardsCardStub = defineComponent({
	props: {
		entry: { type: Object, required: true },
		rank: { type: Number, required: true },
		showName: { type: Boolean, required: true },
		showRank: { type: Boolean, required: true },
		statText: { type: String, required: false },
		sizing: { type: String, required: true },
		width: { type: String, required: false },
		badgeSize: { type: String, required: false },
	},
	template: '<div data-testid="top-cards-item" :data-sizing="sizing" :data-width="width" :data-badge-size="badgeSize">{{ rank }}:{{ entry.name }}:{{ statText ?? "-" }}:{{ showRank }}:{{ showName }}</div>',
});

async function mountComponent() {
	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				ScreenModesTopCardsCard: TopCardsCardStub,
			},
		},
	});
}

describe('screenTopCardsDisplay', () => {
	beforeEach(() => {
		config.value = { ...defaultConfig };
		entries.value = [
			{
				id: 1,
				name: 'Lightning Bolt',
				inclusionRate: 80,
				avgCopies: 3.6,
				totalCopies: 18,
				deckCount: 4,
				cardType: 'Instant',
				scryfallId: null,
			},
			{
				id: 2,
				name: 'Counterspell',
				inclusionRate: 60,
				avgCopies: 3,
				totalCopies: 12,
				deckCount: 3,
				cardType: 'Instant',
				scryfallId: null,
			},
		];
		pageEntries.value = null;
		currentPage.value = 1;
		totalPages.value = 1;
		pageCapacity.value = 2;
		measured.width = 0;
		measured.height = 0;
	});

	it('renders only the current page, ranking each card across the whole ranking', async () => {
		pageEntries.value = [
			{ entry: entries.value[1], rank: 7 },
		];
		currentPage.value = 2;
		totalPages.value = 3;

		const wrapper = await mountComponent();

		const items = wrapper.findAll('[data-testid="top-cards-item"]');
		expect(items.map(item => item.text())).toEqual(['7:Counterspell:60%:true:true']);
		expect(wrapper.get('[data-testid="top-cards-page-indicator"]').text()).toBe('2 / 3');
	});

	it('shows no page indicator when every card fits on one page', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="top-cards-page-indicator"]').exists()).toBe(false);
	});

	it('renders a ranked tile per entry with the selected stat', async () => {
		const wrapper = await mountComponent();

		const items = wrapper.findAll('[data-testid="top-cards-item"]');
		expect(items).toHaveLength(2);
		expect(items[0]!.text()).toBe('1:Lightning Bolt:80%:true:true');
		expect(items[1]!.text()).toBe('2:Counterspell:60%:true:true');
	});

	it('shows the header', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('.top-cards-title h2').text()).toBe('Most Played Cards');
	});

	it('hides the header when disabled', async () => {
		config.value = { ...config.value, showHeader: false };

		const wrapper = await mountComponent();

		expect(wrapper.find('.top-cards-title').exists()).toBe(false);
	});

	// Columns come from the space the grid measures: Fit picks the largest cards for a
	// full page, Fixed fits as many as there is room for, and set columns stay set.
	it.each([
		{
			name: 'set columns',
			cardSizing: 'fit',
			autoColumns: false,
			size: [1920, 900],
			columns: '5',
			rows: '2',
		},
		{
			name: 'Fit auto columns, measured',
			cardSizing: 'fit',
			autoColumns: true,
			size: [600, 1400],
			columns: String(fitColumns({
				count: 10,
				width: 600,
				height: 1400,
				gap: 12,
				labelHeight: 28,
			})),
			rows: undefined,
		},
		{
			name: 'Fit auto columns, before the grid is measured',
			cardSizing: 'fit',
			autoColumns: true,
			size: [0, 0],
			columns: '5',
			rows: '2',
		},
		{
			name: 'Fixed auto columns',
			cardSizing: 'fixed',
			autoColumns: true,
			size: [1920, 900],
			columns: 'auto-fill',
			rows: undefined,
		},
	])('lays the grid out in its columns: $name', async ({ cardSizing, autoColumns, size, columns, rows }) => {
		config.value = { ...config.value, cardSizing, autoColumns };
		pageCapacity.value = 10;
		[measured.width, measured.height] = size as [number, number];

		const wrapper = await mountComponent();

		const grid = wrapper.get('[data-testid="top-cards-grid"]');
		expect(grid.attributes('data-card-sizing')).toBe(cardSizing);
		expect(grid.attributes('data-columns')).toBe(columns);
		if (rows)
			expect(grid.attributes('data-rows')).toBe(rows);
		expect(wrapper.findAll('[data-testid="top-cards-item"]').map(item => item.attributes('data-sizing'))).toEqual([cardSizing, cardSizing]);
	});

	// The Screen's own sizes, not the Theme's, size its cards, gap and badges (ADR-0054).
	it('sizes its cards, gap and badges from its config', async () => {
		config.value = {
			...config.value,
			cardSizing: 'fixed',
			cardWidth: 200,
			cardGap: 30,
			badgeSize: 20,
		};

		const wrapper = await mountComponent();

		expect((wrapper.get('[data-testid="top-cards-grid"]').element as HTMLElement).style.gap).toBe('30px');
		const card = wrapper.get('[data-testid="top-cards-item"]');
		expect(card.attributes('data-width')).toBe('200px');
		expect(card.attributes('data-badge-size')).toBe('20px');
	});

	it('passes no stat text when the stat badge is off', async () => {
		config.value = { ...config.value, statBadge: 'none' };

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-testid="top-cards-item"]')[0]!.text()).toBe('1:Lightning Bolt:-:true:true');
	});

	it('shows deck count when selected as the stat', async () => {
		config.value = { ...config.value, statBadge: 'deckCount' };

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-testid="top-cards-item"]')[0]!.text()).toBe('1:Lightning Bolt:4:true:true');
	});
});
