import type { HighlanderDeckSummary } from '~~/shared/types/highlander';
import type { DeckListCardWithData } from '~/types/card/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

let mutableConfig: Record<string, unknown>;
const screenLevelConfig = ref<Record<string, unknown>>({});

const mainboard = ref<DeckListCardWithData[]>([]);
const sideboard = ref<DeckListCardWithData[]>([]);
const companion = ref<{ name: string } | null>(null);
const deckStats = ref<Array<{ type: string; count: number }>>([]);
const highlander = ref<HighlanderDeckSummary | null>(null);
const tokenCards = ref<DeckListCardWithData[]>([]);
const displayedDeckVersion = ref(1);
const pendingSwapVersion = ref(0);
const commitPendingDeck = vi.fn();

mockNuxtImport('useDeckModeData', () => () => ({
	config: computed(() => mutableConfig),
	playerName: ref('Alice'),
	deckName: ref('Mono Blue'),
	deckColors: ref('U'),
	companion,
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

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => ({ screenConfig: screenLevelConfig.value })),
	eventId: ref(1),
	interactive: ref(false),
	overlayContainer: ref(null),
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
	template: '<div data-testid="mana-colors" />',
});

const DeckCardStub = defineComponent({
	props: {
		showHighlanderPoints: { type: Boolean, required: false },
		highlanderPointsPositionClass: { type: String, required: false },
		highlanderPointsSizeClass: { type: String, required: false },
	},
	template: '<div data-testid="deck-card" :data-show-highlander-points="String(showHighlanderPoints)" :data-point-position="highlanderPointsPositionClass" :data-point-size="highlanderPointsSizeClass" />',
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
			{ name: 'Mana Drain', points: 1, compartments: ['sideboard'], totalQuantity: 1 },
			{ name: 'Lutri, the Spellchaser', points: 3, compartments: [], totalQuantity: 1, pointedAs: 'companion' },
		],
		duplicateCards: [],
		unknownCards: [],
		...overrides,
	};
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Deck/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				MtgManaColorDisplay: ManaColorDisplayStub,
				ScreenModesDeckCard: DeckCardStub,
			},
		},
	});
}

describe('screenDeckDisplay', () => {
	beforeEach(() => {
		mutableConfig = {
			playerId: 1,
			board: 'full',
			sideboardPlacement: 'beside',
			mainboard: { view: 'grid', columns: 4, listColumns: 2 },
			sideboard: { view: 'stack', stackOverlap: 15 },
			showDeckName: true,
			showDeckColors: true,
			showDeckStats: true,
			showDeckMetaPill: true,
			deckMetaPillSize: 'large',
			deckMetaPillTextColor: '#123456',
			deckMetaPillBgColor: 'linear-gradient(red, blue)',
			deckMetaPillAccentColor: '#ff00aa',
			deckMetaPillBorderColor: '#fedcba',
			showHighlanderTotal: true,
			showHighlanderPointedCards: true,
			highlanderPointedCardsSize: 'large',
			highlanderPointedCardsTextColor: '#123456',
			highlanderPointedCardsBgColor: '#abcdef',
			highlanderPointedCardsAccentColor: '#ff00aa',
			highlanderPointedCardsBorderColor: '#fedcba',
			showHighlanderPoints: true,
			highlanderPointsPosition: 'bottom-right',
			highlanderPointsSize: 'small',
		};
		screenLevelConfig.value = {
			primaryTextColor: '#ffeeaa',
			secondaryTextColor: '#aabbcc',
		};
		displayedDeckVersion.value = 1;
		pendingSwapVersion.value = 0;
		commitPendingDeck.mockReset();
		mainboard.value = [createCard()];
		sideboard.value = [];
		companion.value = { name: 'Lurrus of the Dream-Den' };
		deckStats.value = [{ type: 'Instants', count: 12 }];
		highlander.value = createHighlanderSummary();
		tokenCards.value = [];
	});

	it('renders a styled deck meta pill below the top deck info row', async () => {
		const wrapper = await mountComponent();

		const metaPill = wrapper.get('[data-testid="deck-meta-pill"]');
		expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(true);
		expect(metaPill.text()).toContain('Companion:');
		expect(metaPill.text()).toContain('Lurrus of the Dream-Den');
		expect(wrapper.get('[data-testid="highlander-total-inline"]').text()).toContain('4/3 Points');
		expect(metaPill.text()).toContain('Instants');
		expect(metaPill.classes()).toContain('rounded-full');
		expect(metaPill.classes()).toContain('text-lg');
		expect(metaPill.attributes('style')).toContain('color: #123456;');
		expect(metaPill.attributes('style')).toContain('background: linear-gradient(red, blue);');
		expect(metaPill.attributes('style')).toContain('border-color: #fedcba;');
		expect(wrapper.text()).toContain('Mono Blue');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Mana Drain');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Sideboard');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Lutri, the Spellchaser');
		expect(wrapper.get('[data-testid="highlander-pointed-cards"]').text()).toContain('Companion');
		const chip = wrapper.get('[data-testid="highlander-pointed-card-chip"]');
		expect(chip.classes()).toContain('text-base');
		expect(chip.attributes('style')).toContain('color: #123456;');
		expect(chip.attributes('style')).toContain('background: #abcdef;');
		expect(chip.attributes('style')).toContain('border-color: #fedcba;');
	});

	it('uses shared screen-level text colors for general deck text', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'list', listColumns: 2 },
			sideboard: { view: 'list', listColumns: 2 },
		};
		sideboard.value = [createCard({ name: 'Force of Will', compartment: 'sideboard' })];

		const wrapper = await mountComponent();

		expect(wrapper.get('h2').attributes('style')).toContain('color: #ffeeaa;');
		expect(wrapper.get('.deck-header p').attributes('style')).toContain('color: #aabbcc;');
		expect(wrapper.findAll('h3')[0]!.attributes('style')).toContain('color: #ffeeaa;');
		expect(wrapper.findAll('.quantity')[0]!.attributes('style')).toContain('color: #aabbcc;');
		expect(wrapper.findAll('.name')[0]!.attributes('style')).toContain('color: #ffeeaa;');
		expect(wrapper.findAll('.type')[0]!.attributes('style')).toContain('color: #aabbcc;');
	});

	it('gives each board its own list columns and hides the sideboard at board: mainboard', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'list', listColumns: 3 },
			sideboard: { view: 'list', listColumns: 2 },
		};
		sideboard.value = [createCard({ name: 'Force of Will', compartment: 'sideboard' })];

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
		sideboard.value = [createCard({ name: 'Force of Will', compartment: 'sideboard' })];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-grid"]').attributes('style')).toContain('repeat(4, minmax(0, 1fr))');
		expect(wrapper.get('[data-testid="sideboard-grid"]').attributes('style')).toContain('repeat(6, minmax(0, 1fr))');
	});

	it('sizes beside boards proportionally to their column counts', async () => {
		mutableConfig = {
			...mutableConfig,
			mainboard: { view: 'grid', columns: 4 },
			sideboard: { view: 'grid', columns: 2 },
		};
		sideboard.value = [createCard({ name: 'Force of Will', compartment: 'sideboard' })];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-section"]').attributes('style')).toContain('flex-grow: 4');
		expect(wrapper.get('[data-testid="sideboard-section"]').attributes('style')).toContain('flex-grow: 2');
	});

	it('keeps a beside stacked sideboard content-sized while the mainboard flexes', async () => {
		sideboard.value = [createCard({ name: 'Force of Will', compartment: 'sideboard' })];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="mainboard-section"]').attributes('style')).toContain('flex-grow:');
		expect(wrapper.get('[data-testid="sideboard-section"]').attributes('style') ?? '').not.toContain('flex-grow:');
	});

	it('renders a stacked sideboard as a vertical strip beside the mainboard and a row below it', async () => {
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
			createCard({ name: 'Flusterstorm', compartment: 'sideboard' }),
		];

		let wrapper = await mountComponent();
		expect(wrapper.find('[data-testid="sideboard-stack-column"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="sideboard-stack-row"]').exists()).toBe(false);

		mutableConfig = {
			...mutableConfig,
			sideboardPlacement: 'below',
		};

		wrapper = await mountComponent();
		expect(wrapper.find('[data-testid="sideboard-stack-column"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="sideboard-stack-row"]').exists()).toBe(true);
	});

	it('fills the frame with a lone sideboard, whose stack reads as a horizontal row', async () => {
		mutableConfig = {
			...mutableConfig,
			board: 'sideboard',
		};
		sideboard.value = [
			createCard({ name: 'Force of Will', compartment: 'sideboard' }),
			createCard({ name: 'Flusterstorm', compartment: 'sideboard' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="mainboard-section"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="sideboard-stack-column"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="sideboard-stack-row"]').findAll('[data-testid="deck-card"]')).toHaveLength(2);
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

	it('does not render token metadata on the Deck display', async () => {
		tokenCards.value = [createCard({ name: 'Treasure Token', compartment: 'sideboard' })];

		const wrapper = await mountComponent();

		expect(wrapper.text()).not.toContain('Tokens');
		expect(wrapper.text()).not.toContain('Treasure Token');
		expect(wrapper.find('.token-card-section').exists()).toBe(false);
	});

	it('passes Highlander point badge controls through to grid cards', async () => {
		const wrapper = await mountComponent();
		const card = wrapper.get('[data-testid="deck-card"]');

		expect(card.attributes('data-show-highlander-points')).toBe('true');
		expect(card.attributes('data-point-position')).toBe('-bottom-1 -right-1');
		expect(card.attributes('data-point-size')).toBe('min-w-6 px-2 py-0.5 text-xs');
	});

	it('renders blank when no deck is currently displayed', async () => {
		displayedDeckVersion.value = 0;
		mainboard.value = [];
		sideboard.value = [];
		companion.value = null;
		deckStats.value = [];
		highlander.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="deck-meta-pill"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="deck-card"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
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
