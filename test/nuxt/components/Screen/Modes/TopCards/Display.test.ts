import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { fitColumns } from '~~/shared/utils/cardGrid';
import Display from '~/components/Screen/Modes/TopCards/Display.vue';
import { CARD_BADGE_POSITION_CLASSES } from '~/utils/cardBadgePosition';

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
	showHeader: true,
	headerText: undefined,
	showRankBadges: true,
	rankBadgePosition: 'top-left',
	rankBadgeTextSize: 14,
	statBadge: 'inclusionRate',
	statBadgePosition: 'bottom-right',
	statBadgeTextSize: 14,
	showPointsBadges: false,
	pointsBadgePosition: 'top-right',
	pointsBadgeTextSize: 14,
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
		rankBadgeClass: { type: String, required: true },
		rankBadgeStyle: { type: Object, required: true },
		statBadgeClass: { type: String, required: true },
		statBadgeStyle: { type: Object, required: true },
		pointsText: { type: String, required: false },
		pointsBadgeClass: { type: String, required: false },
		pointsBadgeStyle: { type: Object, required: false },
	},
	template: `<div
		data-testid="top-cards-item"
		:data-sizing="sizing"
		:data-width="width"
		:data-rank-badge-class="rankBadgeClass"
		:data-rank-badge-size="rankBadgeStyle.fontSize"
		:data-stat-badge-class="statBadgeClass"
		:data-stat-badge-size="statBadgeStyle.fontSize"
		:data-points="pointsText ?? undefined"
		:data-points-badge-class="pointsBadgeClass"
		:data-points-badge-size="pointsBadgeStyle?.fontSize"
	>{{ rank }}:{{ entry.name }}:{{ statText ?? "-" }}:{{ showRank }}:{{ showName }}</div>`,
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
		expect(items.map(item => item.text())).toEqual(['7:Counterspell:60%:true:false']);
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
		expect(items[0]!.text()).toBe('1:Lightning Bolt:80%:true:false');
		expect(items[1]!.text()).toBe('2:Counterspell:60%:true:false');
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

	// The Screen's own sizes, not the Theme's, size its cards and gap (ADR-0054).
	it('sizes its cards and gap from its config', async () => {
		config.value = {
			...config.value,
			cardSizing: 'fixed',
			cardWidth: 200,
			cardGap: 30,
		};

		const wrapper = await mountComponent();

		expect((wrapper.get('[data-testid="top-cards-grid"]').element as HTMLElement).style.gap).toBe('30px');
		expect(wrapper.get('[data-testid="top-cards-item"]').attributes('data-width')).toBe('200px');
	});

	// Each badge takes its own place and text size, as a Deck Screen's badges do.
	it.each([
		{
			rankBadgePosition: 'top-left',
			rankBadgeTextSize: 14,
			statBadgePosition: 'bottom-right',
			statBadgeTextSize: 14,
		},
		{
			rankBadgePosition: 'bottom',
			rankBadgeTextSize: 24,
			statBadgePosition: 'top-right',
			statBadgeTextSize: 10,
		},
	] as const)('places and sizes each badge: rank $rankBadgePosition, stat $statBadgePosition', async (badges) => {
		config.value = {
			...config.value,
			...badges,
		};

		const wrapper = await mountComponent();

		const card = wrapper.get('[data-testid="top-cards-item"]');
		expect(card.attributes('data-rank-badge-class')).toBe(CARD_BADGE_POSITION_CLASSES[badges.rankBadgePosition]);
		expect(card.attributes('data-rank-badge-size')).toBe(`${badges.rankBadgeTextSize}px`);
		expect(card.attributes('data-stat-badge-class')).toBe(CARD_BADGE_POSITION_CLASSES[badges.statBadgePosition]);
		expect(card.attributes('data-stat-badge-size')).toBe(`${badges.statBadgeTextSize}px`);
	});

	// Points come from the Event's points system: a card it leaves out, or a Screen not badging them, shows none.
	it.each([
		{ showPointsBadges: true, highlanderPoints: 2, shown: '2' },
		{ showPointsBadges: true, highlanderPoints: 0, shown: '0' },
		{ showPointsBadges: true, highlanderPoints: null, shown: undefined },
		{ showPointsBadges: false, highlanderPoints: 2, shown: undefined },
	])('badges a card with $highlanderPoints points, badges $showPointsBadges: $shown', async ({ showPointsBadges, highlanderPoints, shown }) => {
		config.value = {
			...config.value,
			showPointsBadges,
			pointsBadgePosition: 'left',
			pointsBadgeTextSize: 20,
		};
		entries.value[0] = { ...entries.value[0], highlanderPoints };

		const wrapper = await mountComponent();

		const card = wrapper.get('[data-testid="top-cards-item"]');
		expect(card.attributes('data-points')).toBe(shown);
		expect(card.attributes('data-points-badge-class')).toBe(CARD_BADGE_POSITION_CLASSES.left);
		expect(card.attributes('data-points-badge-size')).toBe('20px');
	});

	it('passes no stat text when the stat badge is off', async () => {
		config.value = { ...config.value, statBadge: 'none' };

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-testid="top-cards-item"]')[0]!.text()).toBe('1:Lightning Bolt:-:true:false');
	});

	it('shows deck count when selected as the stat', async () => {
		config.value = { ...config.value, statBadge: 'deckCount' };

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-testid="top-cards-item"]')[0]!.text()).toBe('1:Lightning Bolt:4:true:false');
	});
});
