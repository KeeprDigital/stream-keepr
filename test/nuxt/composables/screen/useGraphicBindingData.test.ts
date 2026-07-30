import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
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
		player1: { lifeTotal, gameWins: 1, counters: [] },
		player2: { lifeTotal: 20, gameWins: 0, counters: [] },
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

const mockEventStore = { event: { id: 1, name: 'Regional', game: 'mtg', talents: [] } };
const mockFeatureMatchStore = {
	featureMatches: [{
		id: 5,
		matchId: 40,
		tableNumber: 3,
		roundName: 'Round 5',
		formatName: null,
		bestOf: 3,
		player1Data: { name: 'Stale Name' },
		player2Data: null,
		activeSessionId: 90,
		activeSession: LOADED_SESSION,
	}],
};
const mockFeatureMatchStateStore = {
	featureMatchStates: new Map<number, FeatureMatchState>(),
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));
mockNuxtImport('useMatchStore', () => () => ({ matches: [] }));
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
});
