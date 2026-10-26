import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import { applyFeatureMatchSessionEvent } from '~~/shared/modules/feature-match-session';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';

const bestOfThree: FeatureMatchSourceSnapshot = {
	eventId: 1,
	slotId: 1,
	matchId: null,
	externalId: null,
	externalSource: null,
	tableNumber: 1,
	bestOf: 3,
	playerDisplayMode: 'score',
	game: 'mtg',
	defaults: DEFAULT_FEATURE_MATCH_DEFAULTS,
	player1: {
		playerId: 1,
		data: { name: 'Mia' },
	},
	player2: {
		playerId: 2,
		data: { name: 'Rei' },
	},
	createdAt: 1000,
};

/** Records the trailing Player's wins first, so any deciding win comes last. */
function atScore(player1Wins: number, player2Wins: number): FeatureMatchState {
	let state = createInitialFeatureMatchState();
	const player1 = Array.from({ length: player1Wins }).fill('player1');
	const player2 = Array.from({ length: player2Wins }).fill('player2');
	const wins = player1Wins >= player2Wins
		? [
				...player2,
				...player1,
			]
		: [
				...player1,
				...player2,
			];
	for (const player of wins)
		state = applyFeatureMatchSessionEvent(state, bestOfThree, 'RecordGameWin', { player }).currentState;
	return state;
}

function score(state: FeatureMatchState) {
	return [state.player1.gameWins, state.player2.gameWins];
}

describe('game wins in a Feature Match Session', () => {
	it('decides the match when a Player reaches the wins its best-of needs', () => {
		expect(atScore(1, 1).isComplete).toBe(false);
		expect(atScore(2, 1).isComplete).toBe(true);
	});

	it.each(['player1', 'player2'])('records no further win for %s once the match is decided', (player) => {
		const decided = atScore(2, 0);

		const after = applyFeatureMatchSessionEvent(decided, bestOfThree, 'RecordGameWin', { player }).currentState;

		expect(after).toEqual(decided);
	});

	it('reopens the match when the deciding win is undone, so the right Player can take it', () => {
		const reopened = applyFeatureMatchSessionEvent(atScore(2, 1), bestOfThree, 'UndoGameWin', { player: 'player1' }).currentState;
		expect(reopened.isComplete).toBe(false);

		const corrected = applyFeatureMatchSessionEvent(reopened, bestOfThree, 'RecordGameWin', { player: 'player2' }).currentState;

		expect(score(corrected)).toEqual([1, 2]);
		expect(corrected.isComplete).toBe(true);
	});

	it('keeps the match decided when the loser\'s win is undone', () => {
		const after = applyFeatureMatchSessionEvent(atScore(2, 1), bestOfThree, 'UndoGameWin', { player: 'player2' }).currentState;

		expect(score(after)).toEqual([2, 0]);
		expect(after.isComplete).toBe(true);
	});
});
