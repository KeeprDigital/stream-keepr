import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { resolveGraphicInputBindings } from '~~/shared/modules/graphics';

/**
 * The Event Data Live Control resolves bound values and picker options from.
 *
 * The rule under test is the one that makes sharing a resolution function worth
 * anything: Live Control has to resolve against the *same facts* the server accepts
 * against. A Feature Match Slot's live scalars change constantly, and the slot row a
 * page loaded with goes stale immediately — so they have to come from the store the
 * Realtime Event Session keeps current.
 */

function state(lifeTotal: number): FeatureMatchState {
	return {
		player1: { lifeTotal, gameWins: 1, counters: [], sideboardRevealed: false },
		player2: { lifeTotal: 20, gameWins: 0, counters: [], sideboardRevealed: false },
		clock: {
			type: 'countdown',
			durationMs: 0,
			elapsedMs: 0,
			isRunning: false,
			lastStartedAt: null,
			countUpAfterCountdown: false,
		},
		currentGame: 2,
		turnNumber: 4,
		isComplete: false,
	};
}

const LOADED_SESSION = {
	id: 90,
	slotId: 5,
	sourceSnapshot: { tableNumber: 9, player1: { data: { name: 'Ava R.' } } },
	// What the slot row happened to carry when the page loaded.
	currentState: state(20),
};

const mockEventStore = reactive({
	event: {
		id: 1,
		name: 'Regional',
		game: 'mtg',
		talents: [] as Array<{ id: number; name: string; socialProfiles: Record<string, string> }>,
	},
});
const SLOT_ROW = {
	id: 5,
	matchId: 40,
	tableNumber: 3,
	roundName: 'Round 5' as string | null,
	formatName: null,
	bestOf: 3,
	player1Data: { name: 'Stale Name' } as { name: string } | null,
	player2Data: null,
	activeSessionId: 90 as number | null,
	activeSession: LOADED_SESSION as typeof LOADED_SESSION | null,
};
const mockFeatureMatchStore = { featureMatches: [SLOT_ROW] as (typeof SLOT_ROW)[] };
const mockPlayerStore = { players: [] as { id: number; name?: string | null }[] };
const mockMatchStore = {
	matches: [] as {
		id: number;
		player1Data?: { name?: string | null } | null;
		player2Data?: { name?: string | null } | null;
	}[],
};
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map<number, FeatureMatchState>(),
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('usePhaseStore', () => () => ({ phases: [] }));
mockNuxtImport('useRoundStore', () => () => ({ rounds: [] }));
mockNuxtImport('useArchetypeStore', () => () => ({ archetypes: [] }));
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);

const SLOT_SOURCE = { key: 'slot', label: 'Slot', kind: 'feature-match-slot' as const };
const LIFE_INPUT = {
	type: 'number' as const,
	key: 'life',
	label: 'Life',
	required: false,
	updatePolicy: 'live' as const,
	default: null,
	integer: true,
};

describe('useGraphicBindingData', () => {
	beforeEach(() => {
		mockFeatureMatchStateStore.featureMatchStates = new Map();
		mockFeatureMatchStateStore.featureMatchSessions = new Map();
		mockFeatureMatchStateStore.sessionIdBySlotId = new Map();
		mockFeatureMatchStore.featureMatches = [SLOT_ROW];
		mockPlayerStore.players = [];
		mockMatchStore.matches = [];
		mockEventStore.event.talents = [];
	});

	it('resolves fixed Social Profiles from the complete Talent data kept current by realtime', () => {
		mockEventStore.event.talents = [{
			id: 8,
			name: 'Jules Kim',
			socialProfiles: { twitch: 'JulesLive' },
		}];
		const { dataSet } = useGraphicBindingData();
		const graphic = {
			inputs: [{ ...LIFE_INPUT, key: 'profile', type: 'text' as const, default: '', maxLength: 100 }],
			sources: [{ key: 'talent', label: 'Talent', kind: 'talent' as const }],
			bindings: [{ inputKey: 'profile', sourceKey: 'talent', fieldId: 'talent.twitchProfileUrl' }],
		};

		expect(resolveGraphicInputBindings(graphic, { talent: 8 }, dataSet.value)).toEqual({
			profile: 'https://www.twitch.tv/JulesLive',
		});

		// A complete realtime Talent update replaces this map in the Event store. The
		// computed binding dataset reads it directly, so no polling or parallel cache is
		// required before Live Control sees the new derived URL.
		mockEventStore.event.talents = [{
			id: 8,
			name: 'Jules Kim',
			socialProfiles: { twitch: 'JulesOnAir' },
		}];
		expect(resolveGraphicInputBindings(graphic, { talent: 8 }, dataSet.value)).toEqual({
			profile: 'https://www.twitch.tv/JulesOnAir',
		});
	});

	it('reads a Feature Match Slot\'s live scalars from the realtime state store', () => {
		mockFeatureMatchStateStore.sessionIdBySlotId.set(5, 90);
		mockFeatureMatchStateStore.featureMatchSessions.set(90, LOADED_SESSION);
		// The operator has taken this player to 12 since the page loaded.
		mockFeatureMatchStateStore.featureMatchStates.set(5, state(12));

		const { dataSet } = useGraphicBindingData();
		const bound = resolveGraphicInputBindings(
			{
				inputs: [LIFE_INPUT],
				sources: [SLOT_SOURCE],
				bindings: [{ inputKey: 'life', sourceKey: 'slot', fieldId: 'featureMatchSlot.player1Life' }],
			},
			{ slot: 5 },
			dataSet.value,
		);

		// 12, not the 20 the slot row was loaded with — otherwise Live Control would show
		// a value the server would never accept.
		expect(bound).toEqual({ life: 12 });
	});

	it('still resolves identity from the production snapshot', () => {
		mockFeatureMatchStateStore.sessionIdBySlotId.set(5, 90);
		mockFeatureMatchStateStore.featureMatchSessions.set(90, LOADED_SESSION);
		mockFeatureMatchStateStore.featureMatchStates.set(5, state(12));

		const { dataSet } = useGraphicBindingData();
		const bound = resolveGraphicInputBindings(
			{
				inputs: [{ ...LIFE_INPUT, key: 'name', type: 'text', default: '', maxLength: 40 }],
				sources: [
					SLOT_SOURCE,
					{ key: 'p1', label: 'Player 1', kind: 'player', from: { sourceKey: 'slot', relation: 'player1' } },
				],
				bindings: [{ inputKey: 'name', sourceKey: 'p1', fieldId: 'player.name' }],
			},
			{ slot: 5 },
			dataSet.value,
		);

		// Live scalars move; the identity production committed to does not.
		expect(bound).toEqual({ name: 'Ava R.' });
	});

	it('falls back to the loaded session when the realtime store has nothing yet', () => {
		const { dataSet } = useGraphicBindingData();
		const bound = resolveGraphicInputBindings(
			{
				inputs: [LIFE_INPUT],
				sources: [SLOT_SOURCE],
				bindings: [{ inputKey: 'life', sourceKey: 'slot', fieldId: 'featureMatchSlot.player1Life' }],
			},
			{ slot: 5 },
			dataSet.value,
		);

		expect(bound).toEqual({ life: 20 });
	});

	it('offers no picker options for the current Event, which needs no picking', () => {
		const { selectionOptions } = useGraphicBindingData();

		expect(selectionOptions('event')).toEqual([]);
		expect(selectionOptions('feature-match-slot')).toEqual([{ label: 'Slot 5 — Round 5', value: 5 }]);
	});

	/**
	 * A picker option an operator can still tell apart when the entity has no name to
	 * show. Every one of these falls back to the entity's own id rather than to a blank
	 * row, because an unlabelled picker entry is one an operator cannot choose
	 * deliberately.
	 */
	it('names a Match by its two players, and by its id when it has neither', () => {
		mockMatchStore.matches = [
			{ id: 40, player1Data: { name: 'Ava R.' }, player2Data: { name: 'Bo K.' } },
			{ id: 41, player1Data: null, player2Data: null },
		];

		expect(useGraphicBindingData().selectionOptions('match')).toEqual([
			{ label: 'Ava R. vs Bo K.', value: 40 },
			{ label: 'Match 41', value: 41 },
		]);
	});

	it('names a Match by the one side it has, rather than pairing it with nothing', () => {
		mockMatchStore.matches = [{ id: 42, player1Data: { name: 'Ava R.' }, player2Data: null }];

		expect(useGraphicBindingData().selectionOptions('match')).toEqual([{ label: 'Ava R.', value: 42 }]);
	});

	it('names a Feature Match Slot by its id when no Round has been promoted into it', () => {
		mockFeatureMatchStore.featureMatches = [{ ...SLOT_ROW, id: 6, roundName: null }];

		expect(useGraphicBindingData().selectionOptions('feature-match-slot'))
			.toEqual([{ label: 'Slot 6', value: 6 }]);
	});

	it('names a Player by their id when Event Data carries no name for them', () => {
		mockPlayerStore.players = [{ id: 3, name: 'Ava R.' }, { id: 4, name: null }];

		expect(useGraphicBindingData().selectionOptions('player')).toEqual([
			{ label: 'Ava R.', value: 3 },
			{ label: 'Player 4', value: 4 },
		]);
	});
});
