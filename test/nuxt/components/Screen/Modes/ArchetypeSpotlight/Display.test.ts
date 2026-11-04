import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import Display from '~/components/Screen/Modes/ArchetypeSpotlight/Display.vue';

const config = ref<any>(null);
const error = ref<string | null>(null);
const isEmpty = ref(false);
const headerText = ref('Spotlight: Mono Red');
const conversionLabel = ref('Top 8');
const spotlight = ref<any>(null);
const pageData = ref<any[]>([]);
const topCards = ref<any[]>([]);
const totalPages = ref(1);
const currentPage = ref(1);
const game = ref<'mtg' | 'op'>('mtg');
const readsStandings = ref(true);

// Canned records keyed by pilot, not a copy of the real formatting, which the
// composable's own test covers: the component only places what it is handed.
const cannedRecords = new Map<number, string>();

// The mode's data is faked, so nothing reads the Screen context it is handed.
mockNuxtImport('useScreenContext', () => () => ({}));
mockNuxtImport('useArchetypeSpotlightModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	isEmpty: computed(() => isEmpty.value),
	headerText: computed(() => headerText.value),
	conversionLabel: computed(() => conversionLabel.value),
	game: computed(() => game.value),
	readsStandings: computed(() => readsStandings.value),
	spotlight: computed(() => spotlight.value),
	pageData: computed(() => pageData.value),
	topCards: computed(() => topCards.value),
	totalPages: computed(() => totalPages.value),
	currentPage: computed(() => currentPage.value),
	formatRecord: (pilot: any) => cannedRecords.get(pilot.id) ?? '0-0',
}));

function pilot(id: number, name: string, position: number | null) {
	return {
		id,
		name,
		position,
		points: 12,
		wins: 4,
		losses: 1,
		draws: 0,
	};
}

function card(id: number, name: string, inclusionRate: number) {
	return {
		id,
		name,
		cardType: 'Instant',
		scryfallId: null,
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		inclusionRate,
		avgCopies: 4,
		totalCopies: 8,
		mainboardCount: 8,
		sideboardCount: 0,
		mainboardDeckCount: 2,
		sideboardDeckCount: 0,
		deckCount: 2,
	};
}

async function mountComponent() {
	// ScreenModeBase is left real so the empty case asserts the broadcast
	// contract itself: that state renders nothing at all.
	return mount(Display);
}

describe('screenModesArchetypeSpotlightDisplay', () => {
	beforeEach(() => {
		config.value = { archetypeId: 7, showHeader: true, rowsPerPage: 8 };
		error.value = null;
		isEmpty.value = false;
		headerText.value = 'Spotlight: Mono Red';
		conversionLabel.value = 'Top 8';
		spotlight.value = {
			archetype: { id: 7, name: 'Mono Red', colors: 'R' },
			playerCount: 2,
			metaShare: 25,
			convertedCount: 1,
			conversionRate: 50,
		};
		pageData.value = [
			pilot(11, 'Nadia Rivers', 1),
			pilot(12, 'Oskar Lind', null),
		];
		topCards.value = [
			card(1, 'Lightning Bolt', 100),
			card(2, 'Skewer the Critics', 66.67),
		];
		totalPages.value = 1;
		currentPage.value = 1;
		game.value = 'mtg';
		readsStandings.value = true;
		cannedRecords.clear();
	});

	it('shows the header, and hides it when the mode config disables it', async () => {
		expect((await mountComponent()).get('.spotlight-header h2').text()).toBe('Spotlight: Mono Red');

		config.value = { ...config.value, showHeader: false };
		const hidden = await mountComponent();
		expect(hidden.find('.spotlight-header').exists()).toBe(false);
		expect(hidden.find('.spotlight-pilots').exists()).toBe(true);
	});

	it('shows the Archetype\'s pilot count, meta share and Conversion Rate for its target', async () => {
		const stats = (await mountComponent()).findAll('.spotlight-stat');

		expect(stats.map(stat => [
			stat.get('.stat-label').text(),
			stat.get('.stat-value').text(),
		])).toEqual([
			['Pilots', '2'],
			['Meta Share', '25%'],
			['Conversion (Top 8)', '50% (1/2)'],
		]);
	});

	it('shows a dash for a Conversion Rate the read has none for', async () => {
		spotlight.value = { ...spotlight.value, convertedCount: null, conversionRate: null };

		const conversion = (await mountComponent()).findAll('.spotlight-stat')[2]!;

		expect(conversion.get('.stat-value').text()).toBe('-');
	});

	it('lists each pilot with their position, name and record, in the order given', async () => {
		cannedRecords.set(11, '7-0-1');
		cannedRecords.set(12, '3-3');

		const rows = (await mountComponent()).findAll('.pilot-row');

		expect(rows.map(row => [
			row.get('.pilot-position').text(),
			row.get('.pilot-name').text(),
			row.get('.pilot-record').text(),
		])).toEqual([
			['1', 'Nadia Rivers', '7-0-1'],
			['-', 'Oskar Lind', '3-3'],
		]);
	});

	it('shows the top included cards with their inclusion rate, most included first', async () => {
		const cards = (await mountComponent()).findAll('[data-testid="top-cards-item"]');

		expect(cards.map(item => item.get('[data-testid="top-cards-name"]').text())).toEqual(['Lightning Bolt', 'Skewer the Critics']);
		expect(cards.map(item => item.get('[data-testid="top-cards-stat-badge"]').text())).toEqual(['100%', '66.67%']);
	});

	it('leaves the cards out when the Archetype has none to show', async () => {
		topCards.value = [];

		expect((await mountComponent()).find('.spotlight-cards').exists()).toBe(false);
	});

	it('shows which page of pilots is up only while there is more than one', async () => {
		expect((await mountComponent()).find('.broadcast-table-page-indicator').exists()).toBe(false);

		totalPages.value = 3;
		currentPage.value = 2;
		expect((await mountComponent()).get('.broadcast-table-page-indicator').text()).toBe('2 / 3');
	});

	// An OP Metagame reads participation only (ADR-0074).
	it('on a One Piece Event, shows no Conversion, place or record, and the Leader\'s colours as pips', async () => {
		game.value = 'op';
		readsStandings.value = false;
		spotlight.value = {
			...spotlight.value,
			archetype: { id: 7, name: 'Monkey.D.Luffy', colors: 'Red/Green' },
		};

		const wrapper = await mountComponent();

		expect(wrapper.findAll('.spotlight-stat .stat-label').map(label => label.text())).toEqual(['Pilots', 'Meta Share']);
		expect(wrapper.findAll('.pilot-row').map(row => row.text())).toEqual(['Nadia Rivers', 'Oskar Lind']);
		expect(wrapper.find('.pilot-grid').text()).toBe('Pilot');
		expect(wrapper.findAll('.spotlight-summary [data-op-color]').map(pip => pip.attributes('data-op-color'))).toEqual(['Red', 'Green']);
	});

	it('renders nothing while the mode is empty', async () => {
		isEmpty.value = true;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toBe('');
		expect(wrapper.find('.archetype-spotlight-display').exists()).toBe(false);
	});
});
