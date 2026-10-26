import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import PlayerSide from '~/components/Screen/Modes/FeatureMatch/PlayerSide.vue';

const mockPlayer: {
	lifeTotal: number;
	cardsKept: number;
	gameWins: number;
	counters: Array<{ type: string; value: number }>;
} = {
	lifeTotal: 20,
	cardsKept: 7,
	gameWins: 1,
	counters: [],
};

let showCounters = false;
let allowCounterControls = false;
let allowLifeControls = true;
let allowGameWinControls = true;
let showName = false;
let showPronouns = false;
let showRecord = false;
let mockPronouns: string | undefined;
let mockRecord: string | undefined;

mockNuxtImport('usePlayerFeatureMatchData', () => () => ({
	player: computed(() => mockPlayer),
	playerName: computed(() => 'Player One'),
	playerPronouns: computed(() => mockPronouns),
	deckName: computed(() => undefined),
	bestOf: computed(() => 3),
	seatLabel: computed(() => undefined),
	playerRecord: computed(() => mockRecord),
	playerLgs: computed(() => undefined),
}));

mockNuxtImport('usePlayerControls', () => () => ({
	adjustLife: vi.fn(),
	setLife: vi.fn(),
	setCardsKept: vi.fn(),
}));

mockNuxtImport('usePlayerDisplayConfig', () => () => ({
	showName: computed(() => showName),
	showPronouns: computed(() => showPronouns),
	showDeckName: computed(() => false),
	showCounters: computed(() => showCounters),
	showRecord: computed(() => showRecord),
	showMulliganInfo: computed(() => false),
	showLgs: computed(() => false),
	allowLifeControls: computed(() => allowLifeControls),
	allowGameWinControls: computed(() => allowGameWinControls),
	allowCounterControls: computed(() => allowCounterControls),
	mulliganPhase: computed(() => false),
	startingHandSize: computed(() => 7),
	activePlayerTrackingEnabled: computed(() => false),
	seatLabel: computed(() => undefined),
}));

/**
 * The control Screen reads its Players' decks through the Screen (#604): the
 * counter types it offers come from a reader the Screen Output read backs.
 */
const { mockPlayerDecks, mockUsePlayerDeckCounters } = vi.hoisted(() => ({
	mockPlayerDecks: vi.fn(),
	mockUsePlayerDeckCounters: vi.fn(),
}));
mockNuxtImport('useScreenOutputReads', () => () => ({ playerDecks: mockPlayerDecks }));
mockNuxtImport('usePlayerDeckCounters', () => mockUsePlayerDeckCounters);

mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	$reset: vi.fn(),
	featureMatchStates: new Map(),
}));

const GameWinsStub = defineComponent({
	props: {
		orientation: { type: String, required: false },
		touch: { type: Boolean, required: false },
		readonly: { type: Boolean, required: false },
	},
	template: '<div data-testid="game-wins" :data-orientation="orientation" :data-touch="String(touch)" :data-readonly="String(!!readonly)" />',
});

const CounterListStub = defineComponent({
	props: {
		touch: { type: Boolean, required: false },
		touchColumns: { type: Number, required: false },
		readonly: { type: Boolean, required: false },
	},
	template: '<div data-testid="counter-list" :data-touch="String(touch)" :data-touch-columns="String(touchColumns ?? 1)" :data-readonly="String(!!readonly)" />',
});

const UINumericCounterStub = defineComponent({
	props: {
		hero: { type: Boolean, required: false },
		orientation: { type: String, required: false },
		touch: { type: Boolean, required: false },
		readonly: { type: Boolean, required: false },
	},
	template: '<div data-testid="life-counter" :data-hero="String(!!hero)" :data-orientation="orientation" :data-touch="String(!!touch)" :data-readonly="String(!!readonly)" />',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	return mount(PlayerSide, {
		props: {
			matchId: 1,
			playerSide: 'player1',
			side: 'left',
			...props,
		},
		global: {
			stubs: {
				FeatureMatchStateGameWins: GameWinsStub,
				FeatureMatchStateCounterList: CounterListStub,
				UINumericCounter: UINumericCounterStub,
				UIcon: true,
			},
		},
	});
}

describe('screenFeatureMatchPlayerSide', () => {
	beforeEach(() => {
		showCounters = false;
		allowCounterControls = false;
		allowLifeControls = true;
		allowGameWinControls = true;
		showName = false;
		showPronouns = false;
		showRecord = false;
		mockPronouns = undefined;
		mockRecord = undefined;
		mockPlayer.counters = [];
		mockPlayerDecks.mockReset();
		mockUsePlayerDeckCounters.mockReset().mockImplementation(() => ({
			availableCounterTypes: ref(undefined),
		}));
	});

	it('reads its Player\'s deck counters through the Screen Output read', async () => {
		await mountComponent({ matchId: 4, playerSide: 'player2' });

		const [matchId, playerSide, read] = mockUsePlayerDeckCounters.mock.calls[0]! as [() => number, () => string, (id: number) => unknown];
		expect(matchId()).toBe(4);
		expect(playerSide()).toBe('player2');
		void read(9);
		expect(mockPlayerDecks).toHaveBeenCalledWith(9);
	});

	it('passes vertical touch-oriented game win controls to the screen layout', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('.player-life-cluster').exists()).toBe(false);
		expect(wrapper.get('.life-main').find('[data-testid="life-counter"]').exists()).toBe(true);

		const lifeCounter = wrapper.get('[data-testid="life-counter"]');
		expect(lifeCounter.attributes('data-hero')).toBe('true');
		expect(lifeCounter.attributes('data-orientation')).toBe('vertical');
		expect(lifeCounter.attributes('data-touch')).toBe('true');

		expect(wrapper.get('.player-wins').classes()).toContain('player-wins-left');

		const gameWins = wrapper.get('[data-testid="game-wins"]');
		expect(gameWins.attributes('data-orientation')).toBe('vertical');
		expect(gameWins.attributes('data-touch')).toBe('true');
		expect(gameWins.attributes('data-readonly')).toBe('false');
		expect(wrapper.get('.player-life').find('[data-testid="game-wins"]').exists()).toBe(true);
	});

	it('uses three touch columns for the player-facing counter list', async () => {
		showCounters = true;
		allowCounterControls = true;
		mockPlayer.counters = [
			{ type: 'poison', value: 1 },
		];

		const wrapper = await mountComponent();

		const counterList = wrapper.get('[data-testid="counter-list"]');
		expect(counterList.attributes('data-touch')).toBe('true');
		expect(counterList.attributes('data-touch-columns')).toBe('3');
		expect(counterList.attributes('data-readonly')).toBe('false');
	});

	it('keeps controls visible but readonly when permissions are disabled', async () => {
		allowLifeControls = false;
		allowGameWinControls = false;
		allowCounterControls = false;
		showCounters = true;
		mockPlayer.counters = [
			{ type: 'poison', value: 1 },
		];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="life-counter"]').attributes('data-readonly')).toBe('true');
		expect(wrapper.get('[data-testid="game-wins"]').attributes('data-readonly')).toBe('true');
		expect(wrapper.get('[data-testid="counter-list"]').attributes('data-readonly')).toBe('true');
	});

	it('renders pronouns before record in the meta area', async () => {
		showName = true;
		showPronouns = true;
		showRecord = true;
		mockPronouns = 'They/Them';
		mockRecord = '5-1';

		const wrapper = await mountComponent();
		const metaText = wrapper.get('.player-meta').text();

		expect(metaText.indexOf('They/Them')).toBeLessThan(metaText.indexOf('5-1'));
	});
});
