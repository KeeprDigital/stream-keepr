import { describe, expect, it } from 'vitest';
import {
	createInitialClockState,
	createInitialFeatureMatchState,
	createInitialOvertimeState,
	createInitialPlayerFeatureMatchState,
	DEFAULT_CLOCK_DURATION_MS,
	DEFAULT_CLOCK_TYPE,
	DEFAULT_STARTING_LIFE,
	resetPlayerFeatureMatchStateForNewGame,
} from '~~/shared/types/featureMatchState';

describe('createInitialPlayerFeatureMatchState', () => {
	it('creates player with default starting life', () => {
		const state = createInitialPlayerFeatureMatchState();
		expect(state.lifeTotal).toBe(DEFAULT_STARTING_LIFE);
		expect(state.gameWins).toBe(0);
		expect(state.counters).toEqual([]);
	});

	it('creates player with custom starting life', () => {
		const state = createInitialPlayerFeatureMatchState(40);
		expect(state.lifeTotal).toBe(40);
	});

	it('creates player with the sideboard hidden', () => {
		const state = createInitialPlayerFeatureMatchState();
		expect(state.sideboardRevealed).toBe(false);
	});
});

describe('createInitialClockState', () => {
	it('creates clock with default values', () => {
		const clock = createInitialClockState();
		expect(clock.type).toBe(DEFAULT_CLOCK_TYPE);
		expect(clock.durationMs).toBe(DEFAULT_CLOCK_DURATION_MS);
		expect(clock.elapsedMs).toBe(0);
		expect(clock.isRunning).toBe(false);
		expect(clock.lastStartedAt).toBeNull();
		expect(clock.countUpAfterCountdown).toBe(false);
	});

	it('creates clock with custom type', () => {
		const clock = createInitialClockState('countup');
		expect(clock.type).toBe('countup');
	});

	it('creates clock with custom duration', () => {
		const clock = createInitialClockState('countdown', 1800000);
		expect(clock.durationMs).toBe(1800000);
	});

	it('creates clock with countUpAfterCountdown enabled', () => {
		const clock = createInitialClockState('countdown', DEFAULT_CLOCK_DURATION_MS, true);
		expect(clock.countUpAfterCountdown).toBe(true);
	});
});

describe('createInitialFeatureMatchState', () => {
	it('creates match state with all defaults', () => {
		const state = createInitialFeatureMatchState();
		expect(state.player1.lifeTotal).toBe(DEFAULT_STARTING_LIFE);
		expect(state.player2.lifeTotal).toBe(DEFAULT_STARTING_LIFE);
		expect(state.clock.type).toBe(DEFAULT_CLOCK_TYPE);
		expect(state.clock.durationMs).toBe(DEFAULT_CLOCK_DURATION_MS);
		expect(state.currentGame).toBe(1);
		expect(state.turnNumber).toBe(0);
		expect(state.isComplete).toBe(false);
		expect(state.activePlayer).toBeNull();
		expect(state.firstPlayer).toBeNull();
	});

	it('creates match state with custom starting life', () => {
		const state = createInitialFeatureMatchState(40);
		expect(state.player1.lifeTotal).toBe(40);
		expect(state.player2.lifeTotal).toBe(40);
	});

	it('creates match state with custom clock settings', () => {
		const state = createInitialFeatureMatchState(20, 'countup', 0, false);
		expect(state.clock.type).toBe('countup');
		expect(state.clock.durationMs).toBe(0);
	});

	it('creates match state with custom starting turn number', () => {
		const state = createInitialFeatureMatchState(20, 'countdown', DEFAULT_CLOCK_DURATION_MS, false, 1);
		expect(state.turnNumber).toBe(1);
	});

	it('passes countUpAfterCountdown through to clock', () => {
		const state = createInitialFeatureMatchState(20, 'countdown', DEFAULT_CLOCK_DURATION_MS, true);
		expect(state.clock.countUpAfterCountdown).toBe(true);
	});
});

describe('createInitialOvertimeState', () => {
	it('creates overtime with specified total turns', () => {
		const overtime = createInitialOvertimeState(5);
		expect(overtime.active).toBe(true);
		expect(overtime.turnsRemaining).toBe(5);
		expect(overtime.totalTurns).toBe(5);
	});

	it('creates overtime with 0 turns', () => {
		const overtime = createInitialOvertimeState(0);
		expect(overtime.turnsRemaining).toBe(0);
		expect(overtime.totalTurns).toBe(0);
	});
});

describe('resetPlayerFeatureMatchStateForNewGame', () => {
	const existingState = {
		lifeTotal: 15,
		gameWins: 2,
		counters: [{ type: 'poison', value: 3 }],
		cardsKept: 6,
		sideboardRevealed: true,
	};

	it('resets life to default and clears counters', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState);
		expect(result.lifeTotal).toBe(DEFAULT_STARTING_LIFE);
		expect(result.counters).toEqual([]);
		expect(result.cardsKept).toBeUndefined();
	});

	it('preserves game wins', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState);
		expect(result.gameWins).toBe(2);
	});

	it('uses custom starting life', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState, 40);
		expect(result.lifeTotal).toBe(40);
	});

	it('preserves counters when resetCounters is false', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState, DEFAULT_STARTING_LIFE, false);
		expect(result.counters).toEqual([{ type: 'poison', value: 3 }]);
	});

	it('clears cardsKept regardless of resetCounters', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState, DEFAULT_STARTING_LIFE, false);
		expect(result.cardsKept).toBeUndefined();
	});

	it('preserves sideboardRevealed — the reveal is match-scoped, not game-scoped', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState);
		expect(result.sideboardRevealed).toBe(true);
	});
});

describe('constants', () => {
	it('dEFAULT_STARTING_LIFE is 20', () => {
		expect(DEFAULT_STARTING_LIFE).toBe(20);
	});

	it('dEFAULT_CLOCK_DURATION_MS is 50 minutes', () => {
		expect(DEFAULT_CLOCK_DURATION_MS).toBe(50 * 60 * 1000);
	});

	it('dEFAULT_CLOCK_TYPE is countdown', () => {
		expect(DEFAULT_CLOCK_TYPE).toBe('countdown');
	});
});
