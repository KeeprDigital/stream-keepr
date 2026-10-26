import { describe, expect, it } from 'vitest';
import {
	createInitialFeatureMatchState,
	DEFAULT_STARTING_LIFE,
	resetPlayerFeatureMatchStateForNewGame,
} from '~~/shared/types/featureMatchState';

describe('createInitialFeatureMatchState', () => {
	it('starts game one with both players at the starting life, sideboards hidden and nobody active', () => {
		const state = createInitialFeatureMatchState(40, 'countup', 0, true, 1);

		for (const player of [state.player1, state.player2]) {
			expect(player).toMatchObject({
				lifeTotal: 40,
				gameWins: 0,
				counters: [],
				sideboardRevealed: false,
			});
		}
		expect(state.player1).not.toBe(state.player2);
		expect(state).toMatchObject({
			currentGame: 1,
			turnNumber: 1,
			isComplete: false,
			activePlayer: null,
			firstPlayer: null,
		});
		expect(state.clock).toMatchObject({
			type: 'countup',
			durationMs: 0,
			countUpAfterCountdown: true,
			elapsedMs: 0,
			isRunning: false,
			lastStartedAt: null,
		});
	});
});

describe('resetPlayerFeatureMatchStateForNewGame', () => {
	const existingState = {
		lifeTotal: 15,
		gameWins: 2,
		counters: [
			{ type: 'poison', value: 3 },
		],
		cardsKept: 6,
		sideboardRevealed: true,
	};

	it('resets life and per-game state but keeps Match-scoped state: wins and the sideboard reveal', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState);

		expect(result).toMatchObject({
			lifeTotal: DEFAULT_STARTING_LIFE,
			counters: [],
			gameWins: 2,
			sideboardRevealed: true,
		});
		expect(result.cardsKept).toBeUndefined();
	});

	it('uses the game\'s starting life, and keeps counters when asked to', () => {
		const result = resetPlayerFeatureMatchStateForNewGame(existingState, 40, false);

		expect(result.lifeTotal).toBe(40);
		expect(result.counters).toEqual([
			{ type: 'poison', value: 3 },
		]);
		expect(result.cardsKept).toBeUndefined();
	});
});
