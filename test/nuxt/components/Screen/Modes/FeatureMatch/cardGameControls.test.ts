import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive, ref } from 'vue';
import { featureMatchModeConfigContract } from '~~/shared/screenModeConfigs/featureMatch';
import { createInitialOvertimeState } from '~~/shared/types/featureMatchState';
import { createMockEvent, createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import Display from '~/components/Screen/Modes/FeatureMatch/Display.vue';

/*
 * The Feature Match Controls Screen Mode with the real game mode and player
 * sides: only the data reads and the controls' own components are stood in.
 */

const event = ref(createMockEvent());
const matchState = createMockFeatureMatchState({
	turnNumber: 2,
	firstPlayer: 'player1',
	activePlayer: 'player1',
	overtime: createInitialOvertimeState(5),
	player1: {
		...createMockFeatureMatchState().player1,
		counters: [
			{ type: 'poison', value: 1 },
		],
	},
});
const match = createMockFeatureMatch({ id: 1 });

mockNuxtImport('useEventStore', () => () => reactive({
	eventId: 1,
	event: computed(() => event.value),
	displayEvent: computed(() => event.value),
}));
mockNuxtImport('useFeatureMatchModeData', () => () => ({
	config: computed(() => ({ ...featureMatchModeConfigContract.defaults, featureMatchId: 1 })),
	match: computed(() => match),
	matchState: computed(() => matchState),
	loading: ref(false),
	error: ref(null),
	ready: ref(true),
}));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	featureMatchStates: new Map([
		[1, matchState],
	]),
	startOvertime: vi.fn(),
}));
mockNuxtImport('useClockDisplay', () => () => ({
	displayTime: computed(() => '30:00'),
	showsClock: computed(() => true),
	timeColorClass: computed(() => ''),
	isExpired: computed(() => false),
	isInOvertime: computed(() => false),
}));
mockNuxtImport('usePlayerFeatureMatchData', () => (_matchId: unknown, side: () => 'player1' | 'player2') => ({
	player: computed(() => matchState[side()]),
	playerName: computed(() => side()),
	playerPronouns: computed(() => undefined),
	deckName: computed(() => undefined),
	bestOf: computed(() => 1),
	seatLabel: computed(() => undefined),
	playerRecord: computed(() => undefined),
	playerLgs: computed(() => undefined),
}));
mockNuxtImport('usePlayerControls', () => () => ({}));
mockNuxtImport('useScreenOutputReads', () => () => ({
	playerDecks: vi.fn(),
}));
mockNuxtImport('usePlayerDeckCounters', () => () => ({
	availableCounterTypes: ref([]),
}));
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

function part(name: string) {
	return defineComponent({ template: `<div data-match-state-part="${name}" />` });
}

function mountControls(game: Game) {
	event.value = createMockEvent({
		game,
		featureMatchDefaultTurnTrackingEnabled: true,
		featureMatchDefaultActivePlayerTrackingEnabled: true,
		featureMatchDefaultMulliganTrackingEnabled: true,
		featureMatchDefaultExtraTurnsEnabled: true,
	});
	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: { template: '<div><slot /></div>' },
				UINumericCounter: part('life'),
				FeatureMatchStateGameWins: part('game-wins'),
				FeatureMatchStateCounterList: part('counters'),
				FeatureMatchStateTurnCounter: part('turn'),
				FeatureMatchStateOvertimeTurnsCounter: part('overtime'),
				UIcon: defineComponent({
					props: { name: String },
					template: '<i :data-icon="name" />',
				}),
			},
		},
	});
}

function parts(wrapper: ReturnType<typeof mountControls>) {
	return [
		...new Set(wrapper.findAll('[data-match-state-part]').map(node => node.attributes('data-match-state-part'))),
	].sort();
}

describe('feature Match Controls by Card Game', () => {
	it.each([
		[
			'mtg',
			[
				'counters',
				'game-wins',
				'life',
				'overtime',
				'turn',
			],
		],
		[
			'op',
			['game-wins', 'turn'],
		],
	] as const)('on a %s Event, offers the match state parts %j', (game, expected) => {
		expect(parts(mountControls(game))).toEqual(expected);
	});

	it('shows a One Piece match its clock, and its active and first player', () => {
		const wrapper = mountControls('op');

		expect(wrapper.text()).toContain('30:00');
		expect(wrapper.find('[data-player-side="player1"]').attributes('data-active')).toBe('true');
		expect(wrapper.find('[data-player-side="player2"]').attributes('data-active')).toBe('false');
		expect(wrapper.find('[data-player-side="player1"] [data-icon="i-lucide-flag"]').exists()).toBe(true);
	});
});
