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

mockNuxtImport('useScreenOutputReads', () => () => ({
	playerDecks: vi.fn(),
}));
mockNuxtImport('usePlayerDeckCounters', () => () => ({
	availableCounterTypes: ref(undefined),
}));

mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	$reset: vi.fn(),
	featureMatchStates: new Map(),
}));

/** Each control reports only whether it was handed read-only. */
function readonlyStub(testId: string) {
	return defineComponent({
		props: {
			readonly: { type: Boolean, required: false },
		},
		template: `<div data-testid="${testId}" :data-readonly="String(!!readonly)" />`,
	});
}

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
				FeatureMatchStateGameWins: readonlyStub('game-wins'),
				FeatureMatchStateCounterList: readonlyStub('counter-list'),
				UINumericCounter: readonlyStub('life-counter'),
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
	});

	it('shows each control live while the operator may use it', async () => {
		showCounters = true;
		allowCounterControls = true;
		mockPlayer.counters = [
			{ type: 'poison', value: 1 },
		];

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="life-counter"]').attributes('data-readonly')).toBe('false');
		expect(wrapper.get('[data-testid="game-wins"]').attributes('data-readonly')).toBe('false');
		expect(wrapper.get('[data-testid="counter-list"]').attributes('data-readonly')).toBe('false');
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

		expect(metaText).toMatch(/They\/Them.*5-1/s);
	});
});
