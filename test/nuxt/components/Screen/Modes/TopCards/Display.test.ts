import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

const screen = ref<any>({
	screenConfig: {
		primaryTextColor: '#123456',
	},
});

const defaultConfig = {
	scope: 'all',
	topN: 8,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	excludedCardTypes: ['Land'],
	columns: 5,
	cardSize: 'medium',
	dynamicCardSize: true,
	cardGap: 12,
	showHeader: true,
	headerText: undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate',
	statBadgeSize: 'medium',
};

const config = ref<any>({ ...defaultConfig });

const entries = ref<any[]>([
	{ id: 1, name: 'Lightning Bolt', inclusionRate: 80, avgCopies: 3.6, totalCopies: 18, deckCount: 4, cardType: 'Instant', scryfallId: null },
	{ id: 2, name: 'Counterspell', inclusionRate: 60, avgCopies: 3, totalCopies: 12, deckCount: 3, cardType: 'Instant', scryfallId: null },
]);

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('useTopCardsModeData', () => () => ({
	config: computed(() => config.value),
	loading: ref(false),
	error: ref<string | null>(null),
	isEmpty: computed(() => false),
	emptyMessage: computed(() => 'No card data available'),
	headerText: computed(() => config.value.headerText ?? 'Most Played Cards'),
	entries: computed(() => entries.value),
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
	},
	template: '<div data-testid="top-cards-item">{{ rank }}:{{ entry.name }}:{{ statText ?? "-" }}:{{ showRank }}:{{ showName }}</div>',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/TopCards/Display.vue';
	const { default: Display } = await import(componentPath);

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
		screen.value = {
			screenConfig: {
				primaryTextColor: '#123456',
			},
		};
		config.value = { ...defaultConfig };
		entries.value = [
			{ id: 1, name: 'Lightning Bolt', inclusionRate: 80, avgCopies: 3.6, totalCopies: 18, deckCount: 4, cardType: 'Instant', scryfallId: null },
			{ id: 2, name: 'Counterspell', inclusionRate: 60, avgCopies: 3, totalCopies: 12, deckCount: 3, cardType: 'Instant', scryfallId: null },
		];
	});

	it('renders a ranked tile per entry with the selected stat', async () => {
		const wrapper = await mountComponent();

		const items = wrapper.findAll('[data-testid="top-cards-item"]');
		expect(items).toHaveLength(2);
		expect(items[0]!.text()).toBe('1:Lightning Bolt:80%:true:true');
		expect(items[1]!.text()).toBe('2:Counterspell:60%:true:true');
	});

	it('shows the header with the primary text color', async () => {
		const wrapper = await mountComponent();

		const header = wrapper.get('.top-cards-title h2');
		expect(header.text()).toBe('Most Played Cards');
		expect(header.attributes('style')).toContain('color: #123456');
	});

	it('hides the header when disabled', async () => {
		config.value = { ...config.value, showHeader: false };

		const wrapper = await mountComponent();

		expect(wrapper.find('.top-cards-title').exists()).toBe(false);
	});

	it('lays the grid out from columns and gap config', async () => {
		const wrapper = await mountComponent();

		const grid = wrapper.get('[data-testid="top-cards-grid"]');
		expect(grid.attributes('style')).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
		expect(grid.attributes('style')).toContain('gap: 12px');
	});

	it('sizes fixed cards from the card size when dynamic sizing is off', async () => {
		config.value = { ...config.value, dynamicCardSize: false };

		const wrapper = await mountComponent();

		const grid = wrapper.get('[data-testid="top-cards-grid"]');
		expect(grid.attributes('style')).toContain('grid-template-columns: repeat(5, max-content)');
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
