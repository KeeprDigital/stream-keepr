import { describe, expect, it } from 'vitest';
import { applyFeatureMatchOvertimeStep, applyFeatureMatchTurnStep } from '~~/shared/modules/feature-match-session';
import { createInitialFeatureMatchState, createInitialOvertimeState } from '~~/shared/types/featureMatchState';

function turnState() {
	return {
		...createInitialFeatureMatchState(),
		turnNumber: 1,
		firstPlayer: 'player1' as const,
		activePlayer: 'player1' as const,
	};
}

describe('feature match session turn and overtime rules', () => {
	it('advances turns by alternating active player before incrementing the turn number', () => {
		const afterOneStep = applyFeatureMatchTurnStep(turnState(), 1);

		expect(afterOneStep).toMatchObject({
			turnNumber: 1,
			firstPlayer: 'player1',
			activePlayer: 'player2',
		});

		const afterTwoSteps = applyFeatureMatchTurnStep(turnState(), 2);

		expect(afterTwoSteps).toMatchObject({
			turnNumber: 2,
			firstPlayer: 'player1',
			activePlayer: 'player1',
		});
	});

	it('rewinds turns without going before turn one', () => {
		const state = {
			...turnState(),
			turnNumber: 2,
			activePlayer: 'player1' as const,
		};

		const rewound = applyFeatureMatchTurnStep(state, -1);

		expect(rewound).toMatchObject({
			turnNumber: 1,
			activePlayer: 'player2',
		});

		const clamped = applyFeatureMatchTurnStep(turnState(), -10);

		expect(clamped).toMatchObject({
			turnNumber: 1,
			activePlayer: 'player1',
		});
	});

	it('leaves turn state unchanged when no first or active player has been chosen', () => {
		const state = createInitialFeatureMatchState();

		expect(applyFeatureMatchTurnStep(state, 1)).toBe(state);
	});

	it('applies a very large historical turn delta without iterative work', () => {
		const advanced = applyFeatureMatchTurnStep(turnState(), 1_000_000);

		expect(advanced.turnNumber).toBe(500_001);
		expect(advanced.activePlayer).toBe('player1');
	});

	it('preserves the historical turn-zero transition and rewind boundary', () => {
		const state = { ...turnState(), turnNumber: 0 };
		const otherPlayerAtTurnZero = applyFeatureMatchTurnStep(state, 1);

		expect(otherPlayerAtTurnZero).toMatchObject({
			turnNumber: 0,
			activePlayer: 'player2',
		});
		expect(applyFeatureMatchTurnStep(otherPlayerAtTurnZero, 1)).toMatchObject({
			turnNumber: 1,
			activePlayer: 'player1',
		});
		expect(applyFeatureMatchTurnStep(otherPlayerAtTurnZero, -100)).toMatchObject({
			turnNumber: 0,
			activePlayer: 'player1',
		});
	});

	it('counts down overtime turns and deactivates overtime at zero', () => {
		const state = {
			...turnState(),
			overtime: createInitialOvertimeState(2),
		};

		const afterFirstExtraTurn = applyFeatureMatchOvertimeStep(state, 1);
		expect(afterFirstExtraTurn).toMatchObject({
			activePlayer: 'player2',
			overtime: { active: true, turnsRemaining: 1, totalTurns: 2 },
		});

		const afterLastExtraTurn = applyFeatureMatchOvertimeStep(afterFirstExtraTurn, 1);
		expect(afterLastExtraTurn).toMatchObject({
			activePlayer: 'player1',
			overtime: { active: false, turnsRemaining: 0, totalTurns: 2 },
		});
	});

	it('rewinds overtime turns up to the configured total', () => {
		const state = {
			...turnState(),
			activePlayer: 'player2' as const,
			overtime: { active: false, turnsRemaining: 0, totalTurns: 2 },
		};

		const rewound = applyFeatureMatchOvertimeStep(state, -3);

		expect(rewound).toMatchObject({
			activePlayer: 'player1',
			overtime: { active: true, turnsRemaining: 2, totalTurns: 2 },
		});
	});

	it('clamps a very large overtime step to the remaining turns', () => {
		const state = {
			...turnState(),
			overtime: createInitialOvertimeState(5),
		};

		const advanced = applyFeatureMatchOvertimeStep(state, 1_000_000);

		expect(advanced).toMatchObject({
			activePlayer: 'player2',
			overtime: { active: false, turnsRemaining: 0, totalTurns: 5 },
		});
	});
});
