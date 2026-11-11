import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import Display from '~/components/Screen/Modes/Deck/MtgDisplay.vue';

// The space the boards measure; 0 until they are laid out, when their cards have no size yet.
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

let mutableConfig: Record<string, unknown>;

const mainboard = ref<DeckListCardWithData[]>([]);
const sideboard = ref<DeckListCardWithData[]>([]);
const companionCard = ref<DeckListCardWithData | null>(null);
const deckStats = ref<Array<{ type: string; count: number }>>([]);
const highlander = ref<HighlanderDeckSummary | null>(null);
const tokenCards = ref<DeckListCardWithData[]>([]);
const primaryName = ref('Alice');
const secondaryName = ref('Mono Blue');
const deckColors = ref('U');
const displayedDeckVersion = ref(1);
const pendingSwapVersion = ref(0);
const commitPendingDeck = vi.fn();

// The mode's data is faked, so nothing reads the Screen context it is handed.
mockNuxtImport('useScreenContext', () => () => ({}));
mockNuxtImport('useDeckModeData', () => () => ({
	config: computed(() => mutableConfig),
	primaryHeader: primaryName,
	secondaryHeader: secondaryName,
	deckColors,
	companionCard,
	highlander,
	tokenCards,
	deckStats,
	mainboard,
	sideboard,
	loading: ref(false),
	error: ref(null),
	hasDisplayedDeck: computed(() => displayedDeckVersion.value > 0),
	displayedDeckVersion,
	pendingSwapVersion,
	commitPendingDeck,
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		loading: { type: Boolean, required: false },
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: '<div><slot /></div>',
});

const ManaColorDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: false },
	},
	template: '<div data-testid="mana-colors" :data-colors="colors" />',
});

const DeckCardStub = defineComponent({
	props: {
		showHighlanderPoints: { type: Boolean, required: false },
		highlanderPointsPositionClass: { type: String, required: false },
		card: { type: Object, required: true },
		tag: { type: String, required: false },
		quantityBadgeStyle: { type: Object, required: false },
		highlanderPointsBadgeStyle: { type: Object, required: false },
	},
	template: '<div data-testid="deck-card" :data-tag="tag" :data-name="card.name" :data-quantity-size="quantityBadgeStyle?.fontSize" :data-points-size="highlanderPointsBadgeStyle?.fontSize" :data-show-highlander-points="String(showHighlanderPoints)" :data-point-position="highlanderPointsPositionClass" />',
});

function createCard(overrides: Partial<DeckListCardWithData> = {}): DeckListCardWithData {
	return {
		name: 'Mana Drain',
		quantity: 1,
		compartment: 'mainboard',
		cardType: 'Instant',
		scryfallId: null,
		highlanderPoints: 1,
		mtgCard: null,
		...overrides,
	};
}

function createHighlanderSummary(overrides: Partial<HighlanderDeckSummary> = {}): HighlanderDeckSummary {
	return {
		system: '7ph',
		status: 'illegal',
		points: 4,
		maxPoints: 3,
		hasReserveListCards: false,
		pointedCards: [
			{
				name: 'Mana Drain',
				points: 1,
				compartments: ['sideboard'],
				totalQuantity: 1,
			},
			{
				name: 'Lutri, the Spellchaser',
				points: 3,
				compartments: [],
				totalQuantity: 1,
				pointedAs: 'companion',
			},
		],
		duplicateCards: [],
		unknownCards: [],
		...overrides,
	};
}

async function mountComponent(stubs: Record<string, boolean> = {}) {
	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				MtgManaColorDisplay: ManaColorDisplayStub,
				ScreenModesDeckCard: DeckCardStub,
				...stubs,
			},
		},
	});
}

// Every mounted display follows the one faked mode data, so none outlives its test.
enableAutoUnmount(afterEach);

describe('screenDeckDisplay', () => {
	beforeEach(() => {
		mutableConfig = {
			playerId: 1,
			board: 'full',
			sideboardPlacement: 'beside',
			mainboard: { view: 'grid', columns: 4, listColumns: 2 },
			sideboard: { view: 'stack' },
			showDeckName: true,
			showDeckColors: true,
			showDeckStats: true,
			showDeckMetaPill: true,
			deckMetaPillSize: 'large',
			showHighlanderTotal: true,
			showHighlanderPointedCards: true,
			highlanderPointedCardsSize: 'large',
			showHighlanderPoints: true,
			highlanderPointsPosition: 'bottom-right',
			highlanderPointsSize: 'small',
		};
		displayedDeckVersion.value = 1;
		pendingSwapVersion.value = 0;
		commitPendingDeck.mockReset();
		mainboard.value = [
			createCard(),
		];
		sideboard.value = [];
		companionCard.value = null;
		measured.width = 0;
		measured.height = 0;
		deckStats.value = [
			{ type: 'Instants', count: 12 },
		];
		highlander.value = createHighlanderSummary();
		tokenCards.value = [];
		primaryName.value = 'Alice';
		secondaryName.value = 'Mono Blue';
		deckColors.value = 'U';
	});

	it('fills the deck meta pill and the pointed card chips', async () => {
		const wrapper = await mountComponent();

		const metaPill = wrapper.get('[data-testid="deck-meta-pill"]');
		expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(true);
		// The companion is a card image, never part of the deck information.
		expect(metaPill.text()).not.toContain('Companion');
		expect(wrapper.get('[data-testid="highlander-total-inline"]').text()).toContain('4/3 Points');
		expect(metaPill.text()).toContain('Instants');
		expect(wrapper.text()).toContain('Mono Blue');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Mana Drain');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Sideboard');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Lutri, the Spellchaser');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Companion');
	});

	it('gives each board its own list columns and hides the sideboard at board: mainboard', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'list', listColumns: 3 },
			sideboard: { view: 'list', listColumns: 2 },
		};
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
		];

		let wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-list"]').attributes('style')).toContain('repeat(3, minmax(0, 1fr))');
		expect(wrapper.get('[data-testid="sideboard-list"]').attributes('style')).toContain('repeat(2, minmax(0, 1fr))');
		expect(wrapper.text()).toContain('Sideboard');

		mutableConfig = {
			...mutableConfig,
			board: 'mainboard',
		};

		wrapper = await mountComponent();
		expect(wrapper.find('[data-testid="sideboard-list"]').exists()).toBe(false);
	});

	it('gives each board its own grid columns at board: full', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'grid', columns: 4 },
			sideboard: { view: 'grid', columns: 6 },
			sideboardPlacement: 'below',
		};
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-grid"]').attributes('data-columns')).toBe('4');
		expect(wrapper.get('[data-testid="sideboard-grid"]').attributes('data-columns')).toBe('6');
	});

	// A list is not laid out, so a grid beside or under one is laid out alone, in the space the list leaves it.
	it.each([
		{ placement: 'below', listGrow: 'flex-grow: 0', gridGrow: 'flex-grow: 1' },
		{ placement: 'beside', listGrow: 'flex-grow: 2', gridGrow: 'flex-grow: 4' },
	] as const)('lays a grid $placement a list out in the space the list leaves it', async ({ placement, listGrow, gridGrow }) => {
		measured.width = 960;
		measured.height = 480;
		mutableConfig = {
			...mutableConfig,
			sideboardPlacement: placement,
			mainboard: { view: 'list', listColumns: 2 },
			sideboard: { view: 'grid', columns: 4 },
		};
		sideboard.value = Array.from({ length: 8 }, (_, index) => createCard({ name: `Side ${index}`, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-section"]').attributes('style')).toContain(listGrow);
		expect(wrapper.get('[data-testid="sideboard-section"]').attributes('style')).toContain(gridGrow);
		const grid = wrapper.get('[data-testid="sideboard-grid"]');
		expect(grid.attributes('data-columns')).toBe('4');
		expect(Number.parseFloat((grid.get('.grid').element as HTMLElement).style.gridTemplateColumns.match(/, (.+)\)$/)![1]!)).toBeGreaterThan(0);
	});

	// The next card covers all of a stacked card but its board's stack-reveal slice; the last shows whole.
	// The Screen's own sizes, not the Theme's, size each board and every badge, pill and chip (ADR-0054).
	it('sizes its boards, badges, pill and chips from its config', async () => {
		measured.width = 1920;
		measured.height = 960;
		mutableConfig = {
			...mutableConfig,
			mainboard: {
				view: 'grid',
				columns: 4,
				maxCardSize: 120,
				cardGap: 20,
			},
			sideboard: { view: 'stack', stackReveal: 40 },
			quantityBadgeSize: 21,
			pointsBadgeSize: 22,
			metaPillSize: 23,
			pointedCardSize: 24,
		};
		sideboard.value = ['Force of Will', 'Flusterstorm'].map(name => createCard({ name, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		// The mainboard's max card size holds the whole deck, the stacked strip with it.
		const grid = wrapper.get('[data-testid="mainboard-grid"]');
		const gridStyle = (grid.get('.grid').element as HTMLElement).style;
		expect(gridStyle.gridTemplateColumns).toBe('repeat(4, 120px)');
		expect(gridStyle.gap).toBe('20px');
		const mainCard = grid.get('[data-testid="deck-card"]');
		expect(mainCard.attributes('data-quantity-size')).toBe('21px');
		expect(mainCard.attributes('data-points-size')).toBe('22px');
		const strip = wrapper.get('[data-testid="sideboard-stack-column"]');
		expect(strip.findAll('.stack-card').map(card => [(card.element as HTMLElement).style.width, (card.element as HTMLElement).style.height]))
			.toEqual([
				['120px', '40px'],
				['120px', ''],
			]);
		expect((wrapper.get('[data-testid="deck-meta-pill"]').element as HTMLElement).style.fontSize).toBe('23px');
		expect((wrapper.get('[data-testid="highlander-pointed-card-chip"]').element as HTMLElement).style.fontSize).toBe('24px');
	});

	it('shows each card but the last of the beside stack by its reveal', async () => {
		sideboard.value = ['Force of Will', 'Flusterstorm', 'Pyroblast'].map(name => createCard({ name, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="sideboard-stack-column"]').findAll('.stack-card').map(card => (card.element as HTMLElement).style.height)).toEqual([
			'30px',
			'30px',
			'',
		]);
	});

	// A sideboard stacks only beside the mainboard; anywhere else its stack reads as a grid.
	it.each([
		{ name: 'beside the mainboard', config: {}, strip: true },
		{
			name: 'below the mainboard',
			config: { sideboardPlacement: 'below' },
			strip: false,
		},
		{
			name: 'alone',
			config: { board: 'sideboard' },
			strip: false,
		},
	])('renders a stacked sideboard $name as a strip: $strip', async ({ config, strip }) => {
		mutableConfig = {
			...mutableConfig,
			...config,
		};
		sideboard.value = ['Force of Will', 'Flusterstorm'].map(name => createCard({ name, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="sideboard-stack-column"]').exists()).toBe(strip);
		expect(wrapper.find('[data-testid="sideboard-grid"]').exists()).toBe(!strip);
		expect(wrapper.findAll('[data-testid="sideboard-section"] [data-testid="deck-card"]')).toHaveLength(2);
	});

	it('does not reserve an empty Mainboard section beside a populated Sideboard', async () => {
		mainboard.value = [];
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="mainboard-section"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="sideboard-stack-column"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="sideboard-grid"]').findAll('[data-testid="deck-card"]')).toHaveLength(1);
	});

	it('renders no cards at board: sideboard when the sideboard is empty', async () => {
		mutableConfig = {
			...mutableConfig,
			board: 'sideboard',
		};
		sideboard.value = [];

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="deck-card"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="sideboard-section"]').exists()).toBe(false);
	});

	it('renders a Broadcast Deck List with source-neutral header and metadata while suppressing Highlander UI', async () => {
		mutableConfig = {
			...mutableConfig,
			deckSource: { type: 'broadcast', broadcastDeckListId: 7 },
			board: 'sideboard',
		};
		primaryName.value = 'Sunday Finals Control';
		secondaryName.value = 'Azorius Control';
		deckColors.value = 'WU';
		mainboard.value = [];
		sideboard.value = [
			createCard({
				name: 'Rest in Peace',
				compartment: 'sideboard',
				highlanderPoints: null,
			}),
		];
		deckStats.value = [
			{ type: 'Creatures', count: 0 },
		];
		highlander.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.get('h2').text()).toBe('Sunday Finals Control');
		expect(wrapper.get('.deck-header p').text()).toBe('Azorius Control');
		expect(wrapper.get('[data-testid="mana-colors"]').attributes('data-colors')).toBe('WU');
		expect(wrapper.text()).toContain('Creatures');
		expect(wrapper.get('[data-testid="sideboard-section"]').findAll('[data-testid="deck-card"]')).toHaveLength(1);
		expect(wrapper.find('[data-testid="mainboard-section"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="highlander-total-inline"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="highlander-pointed-cards"]').exists()).toBe(false);
	});

	// Who and what are each their own line, shown or hidden on its own.
	it.each([
		{ config: {}, player: true, deck: true },
		{
			config: { showPlayerName: false },
			player: false,
			deck: true,
		},
		{
			config: { showDeckName: false },
			player: true,
			deck: false,
		},
	])('shows the header lines $config', async ({ config, player, deck }) => {
		mutableConfig = {
			...mutableConfig,
			...config,
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="deck-player-name"]').exists()).toBe(player);
		expect(wrapper.find('[data-testid="deck-name"]').exists()).toBe(deck);
	});

	it('shows the details row in its text size with or without its pill', async () => {
		mutableConfig = { ...mutableConfig, showDeckMetaPill: false, metaPillSize: 22 };

		const wrapper = await mountComponent();

		expect((wrapper.get('[data-testid="deck-meta-pill"]').element as HTMLElement).style.fontSize).toBe('22px');
	});

	// The companion is the sideboard's first card, tagged, and listed once; with no sideboard it stands alone.
	it.each([
		{ name: 'beside a sideboard', config: {}, inSideboard: true },
		{
			name: 'with no sideboard shown',
			config: { board: 'mainboard' },
			inSideboard: false,
		},
	])('shows the companion as a card $name', async ({ config, inSideboard }) => {
		mutableConfig = {
			...mutableConfig,
			...config,
		};
		companionCard.value = createCard({ name: 'Lurrus of the Dream-Den', compartment: 'sideboard' });
		sideboard.value = ['Lurrus of the Dream-Den', 'Force of Will'].map(name => createCard({ name, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		const holder = wrapper.get(inSideboard ? '[data-testid="sideboard-section"]' : '[data-testid="companion-section"]');
		const cards = holder.findAll('[data-testid="deck-card"]');
		expect(cards[0]!.attributes('data-tag')).toBe('Companion');
		expect(cards.map(card => card.attributes('data-name'))).toEqual(inSideboard
			? ['Lurrus of the Dream-Den', 'Force of Will']
			: ['Lurrus of the Dream-Den']);
	});

	it('hides the companion when it is turned off', async () => {
		mutableConfig = { ...mutableConfig, showCompanion: false };
		companionCard.value = createCard({ name: 'Lurrus of the Dream-Den', compartment: 'sideboard' });
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-tag="Companion"]')).toHaveLength(0);
	});

	// Measured, the boards share one card size and are sized and placed as one group.
	it('lays every board out at one card size from the space it measures', async () => {
		measured.width = 1920;
		measured.height = 960;
		mutableConfig = {
			...mutableConfig,
			mainboard: {
				view: 'grid',
				alignment: 'left',
			},
			sideboard: { view: 'stack', alignment: 'bottom' },
		};
		mainboard.value = Array.from({ length: 23 }, (_, index) => createCard({ name: `Card ${index}` }));
		sideboard.value = Array.from({ length: 15 }, (_, index) => createCard({ name: `Side ${index}`, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		const grid = wrapper.get('[data-testid="mainboard-grid"]');
		const px = (value: string) => Number.parseFloat(value);
		const cardWidth = px((wrapper.get('[data-testid="sideboard-stack-column"] .stack-card').element as HTMLElement).style.width);
		const columns = (grid.get('.grid').element as HTMLElement).style.gridTemplateColumns.match(/^repeat\((\d+), (.+)\)$/)!;
		expect(columns[1]).toBe(grid.attributes('data-columns'));
		expect(px(columns[2]!)).toBeCloseTo(cardWidth, 3);
		expect(px((wrapper.get('[data-testid="sideboard-section"]').element as HTMLElement).style.width)).toBeCloseTo(cardWidth, 3);
		// The group sits at the mainboard's alignment; the sideboard sits along the mainboard at its own.
		expect((wrapper.get('.deck-layout').element as HTMLElement).style.justifyContent).toBe('start');
		expect((wrapper.get('[data-testid="sideboard-section"]').element as HTMLElement).style.alignSelf).toBe('end');
	});

	// Below the mainboard, the sideboard and its heading sit at its own alignment across the whole space.
	it('places a sideboard below the mainboard at its own edge, heading and all', async () => {
		measured.width = 1920;
		measured.height = 960;
		mutableConfig = {
			...mutableConfig,
			sideboardPlacement: 'below',
			mainboard: {
				view: 'grid',
				alignment: 'center',
			},
			sideboard: {
				view: 'grid',
				alignment: 'right',
			},
		};
		mainboard.value = Array.from({ length: 21 }, (_, index) => createCard({ name: `Card ${index}` }));
		sideboard.value = Array.from({ length: 9 }, (_, index) => createCard({ name: `Side ${index}`, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		const section = wrapper.get('[data-testid="sideboard-section"]');
		expect((section.element as HTMLElement).style.alignSelf).toBe('end');
		expect((section.get('h3').element as HTMLElement).style.textAlign).toBe('right');
		expect((wrapper.get('[data-testid="mainboard-section"]').element as HTMLElement).style.alignSelf).toBe('center');
	});

	// A sideboard aligned away from the mainboard goes to that far edge; otherwise the two sit together.
	it.each([
		{
			name: 'bottom-left sideboard below',
			placement: 'below',
			sideboardAlignment: 'bottom-left',
			toEdge: true,
			edge: 'marginTop',
		},
		{
			name: 'top sideboard below',
			placement: 'below',
			sideboardAlignment: 'top',
			toEdge: false,
			edge: 'marginTop',
		},
		{
			name: 'right sideboard beside',
			placement: 'beside',
			sideboardAlignment: 'right',
			toEdge: true,
			edge: 'marginLeft',
		},
		{
			name: 'centred sideboard beside',
			placement: 'beside',
			sideboardAlignment: 'center',
			toEdge: false,
			edge: 'marginLeft',
		},
	] as const)('places a $name at the far edge: $toEdge', async ({ placement, sideboardAlignment, toEdge, edge }) => {
		measured.width = 1920;
		measured.height = 960;
		mutableConfig = {
			...mutableConfig,
			sideboardPlacement: placement,
			mainboard: {
				view: 'grid',
				alignment: 'top-left',
			},
			sideboard: {
				view: placement === 'beside'
					? 'stack'
					: 'grid',
				alignment: sideboardAlignment,
			},
		};
		mainboard.value = Array.from({ length: 21 }, (_, index) => createCard({ name: `Card ${index}` }));
		sideboard.value = Array.from({ length: 9 }, (_, index) => createCard({ name: `Side ${index}`, compartment: 'sideboard' }));

		const wrapper = await mountComponent();

		expect((wrapper.get('[data-testid="sideboard-section"]').element as HTMLElement).style[edge]).toBe(toEdge ? 'auto' : '');
	});

	it('does not render token metadata on the Deck display', async () => {
		tokenCards.value = [
			createCard({ name: 'Treasure Token', compartment: 'sideboard' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.text()).not.toContain('Tokens');
		expect(wrapper.text()).not.toContain('Treasure Token');
		expect(wrapper.find('.token-card-section').exists()).toBe(false);
	});

	it('shows Highlander points on grid cards when enabled', async () => {
		const wrapper = await mountComponent();
		const card = wrapper.get('[data-testid="deck-card"]');

		expect(card.attributes('data-show-highlander-points')).toBe('true');
	});

	it('renders blank when no deck is currently displayed', async () => {
		displayedDeckVersion.value = 0;
		mainboard.value = [];
		sideboard.value = [];
		deckStats.value = [];
		highlander.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="deck-meta-pill"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="deck-card"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});

	// The deck on show is the newest one pending, however the swaps interleave: a
	// deck that becomes pending just as another is committed is not left waiting.
	it.each([
		{
			name: 'swaps to a pending deck',
			showing: 1,
			decks: ['Bob'],
		},
		{
			name: 'swaps on to a deck that became pending as the last one was committed',
			showing: 1,
			decks: ['Bob', 'Carol'],
		},
		{
			name: 'shows its first deck',
			showing: 0,
			decks: ['Bob'],
		},
		{
			name: 'swaps on to a deck that became pending as its first one was committed',
			showing: 0,
			decks: ['Bob', 'Carol'],
		},
	])('$name', async ({ showing, decks }) => {
		displayedDeckVersion.value = showing;
		const arriving = [...decks];
		let pending: string | undefined;
		function arrive() {
			pending = arriving.shift();
			if (pending)
				pendingSwapVersion.value += 1;
		}
		commitPendingDeck.mockImplementation(() => {
			if (!pending)
				return;
			primaryName.value = pending;
			displayedDeckVersion.value += 1;
			arrive();
		});
		// The real transition, because its after-leave is what commits a swap.
		const wrapper = await mountComponent({ transition: false });

		arrive();

		await vi.waitFor(() => expect(wrapper.text()).toContain(decks.at(-1)));
	});

	it('shows list-view point badges only when enabled', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'list' },
			showHighlanderPoints: true,
		};

		let wrapper = await mountComponent();
		expect(wrapper.find('[data-testid="highlander-list-badge"]').exists()).toBe(true);

		mutableConfig = {
			...mutableConfig,
			showHighlanderPoints: false,
		};

		wrapper = await mountComponent();
		expect(wrapper.find('[data-testid="highlander-list-badge"]').exists()).toBe(false);
	});
});
