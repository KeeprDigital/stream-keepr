import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import Display from '~/components/Screen/Modes/TopCards/Display.vue';

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
const resolvedColumns = ref(5);
const pageRowCount = ref(1);

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
	resolvedColumns: computed(() => resolvedColumns.value),
	pageRowCount: computed(() => pageRowCount.value),
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
	},
	template: '<div data-testid="top-cards-item" :data-sizing="sizing">{{ rank }}:{{ entry.name }}:{{ statText ?? "-" }}:{{ showRank }}:{{ showName }}</div>',
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
		resolvedColumns.value = 5;
		pageRowCount.value = 1;
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

	// A Fit grid shares the height between a page's rows; a Fixed grid has no rows to share.
	it.each([
		{ cardSizing: 'fit', rows: '2' },
		{ cardSizing: 'fixed', rows: undefined },
	])('lays a $cardSizing grid out in the columns its data resolves', async ({ cardSizing, rows }) => {
		config.value = { ...config.value, cardSizing };
		resolvedColumns.value = 4;
		pageRowCount.value = 2;

		const wrapper = await mountComponent();

		const grid = wrapper.get('[data-testid="top-cards-grid"]');
		expect(grid.attributes('data-card-sizing')).toBe(cardSizing);
		expect(grid.attributes('data-columns')).toBe('4');
		expect(grid.attributes('data-rows')).toBe(rows);
		expect(wrapper.findAll('[data-testid="top-cards-item"]').map(item => item.attributes('data-sizing'))).toEqual([cardSizing, cardSizing]);
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
