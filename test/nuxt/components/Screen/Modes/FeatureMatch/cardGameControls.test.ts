import type { DbEvent } from '~~/server/db/schema';
import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive, ref } from 'vue';
import { eventKind, getMatchFormatDefaults } from '~~/shared/config/games';
import { featureMatchModeConfigContract } from '~~/shared/screenModeConfigs/featureMatch';
import { fromFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createInitialOvertimeState } from '~~/shared/types/featureMatchState';
import { createMockEvent, createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { matchStatePart, offeredMatchStateParts } from '~~/test/nuxt/helpers/featureMatchControls';
import Display from '~/components/Screen/Modes/FeatureMatch/Display.vue';

/*
 * The Feature Match Controls Screen Mode with the real `useFeatureMatchGameMode` and player
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

// The mode's data is faked, so nothing reads the Screen context it is handed.
mockNuxtImport('useScreenContext', () => () => ({}));
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

const EVERY_TOGGLE_ON: Partial<DbEvent> = {
	featureMatchDefaultTurnTrackingEnabled: true,
	featureMatchDefaultActivePlayerTrackingEnabled: true,
	featureMatchDefaultMulliganTrackingEnabled: true,
	featureMatchDefaultExtraTurnsEnabled: true,
};

/** An Event of `game` as created, with its Card Game's defaults, then `toggles`. */
function mountControls(game: Game, toggles: Partial<DbEvent> = {}) {
	event.value = createMockEvent({
		game,
		...fromFeatureMatchDefaults(getMatchFormatDefaults(eventKind({ game, variant: toggles.variant }))),
		...toggles,
	});
	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: { template: '<div><slot /></div>' },
				UINumericCounter: matchStatePart('life'),
				FeatureMatchStateGameWins: matchStatePart('game-wins'),
				FeatureMatchStateCounterList: matchStatePart('counters'),
				FeatureMatchStateTurnCounter: matchStatePart('turn'),
				FeatureMatchStateOvertimeTurnsCounter: matchStatePart('overtime'),
				FeatureMatchStateCommanderTable: matchStatePart('commander-table'),
				UIcon: defineComponent({
					props: { name: String },
					template: '<i :data-icon="name" />',
				}),
			},
		},
	});
}

describe('feature Match Controls by Card Game', () => {
	it.each([
		[
			'mtg',
			EVERY_TOGGLE_ON,
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
			{},
			['game-wins', 'turn'],
		],
	] as const)('on a %s Event with toggles %j, offers the match state parts %j', (game, toggles, expected) => {
		expect(offeredMatchStateParts(mountControls(game, toggles))).toEqual(expected);
	});

	// A Commander Event's four Seats show where they sit, whatever the Screen's left side says (ADR-0087).
	it('drives a Commander Event\'s game from its four Seats, with no game count', () => {
		const wrapper = mountControls('mtg', { variant: 'commander' });

		expect(offeredMatchStateParts(wrapper)).toEqual(['commander-table']);
		expect(wrapper.findAll('[data-player-side]')).toHaveLength(0);
		expect(wrapper.text()).not.toContain('Game 1');
		expect(wrapper.text()).toContain('30:00');
	});

	it('shows a One Piece match its clock, and its active and first player', () => {
		const wrapper = mountControls('op');

		expect(wrapper.text()).toContain('30:00');
		expect(wrapper.find('[data-player-side="player1"]').attributes('data-active')).toBe('true');
		expect(wrapper.find('[data-player-side="player2"]').attributes('data-active')).toBe('false');
		expect(wrapper.find('[data-player-side="player1"] [data-icon="i-lucide-flag"]').exists()).toBe(true);
	});
});
