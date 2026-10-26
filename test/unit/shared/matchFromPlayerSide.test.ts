import { describe, expect, it } from 'vitest';
import { formatGameScore, readMatchFromPlayerSide } from '../../../shared/utils/matchFromPlayerSide';

function match(overrides: Partial<Parameters<typeof readMatchFromPlayerSide>[0]> = {}) {
	return {
		player1Id: 1,
		player1GameWins: 2,
		player2GameWins: 1,
		gameDraws: 0,
		isBye: false,
		hasResult: true,
		...overrides,
	};
}

describe('readMatchFromPlayerSide', () => {
	it('reads a won Match from player 1\'s side', () => {
		expect(readMatchFromPlayerSide(match(), 1)).toEqual({
			outcome: 'win',
			playerGameWins: 2,
			opponentGameWins: 1,
			gameDraws: 0,
			hasResult: true,
		});
	});

	it('reads the same Match as a loss from player 2\'s side', () => {
		expect(readMatchFromPlayerSide(match(), 2)).toMatchObject({
			outcome: 'loss',
			playerGameWins: 1,
			opponentGameWins: 2,
		});
	});

	it('reads equal game wins as a draw', () => {
		expect(readMatchFromPlayerSide(match({ player1GameWins: 1, player2GameWins: 1, gameDraws: 1 }), 2).outcome).toBe('draw');
	});

	it('reads a bye as a bye, whatever its game wins', () => {
		expect(readMatchFromPlayerSide(match({ isBye: true, player1GameWins: 2, player2GameWins: 0 }), 1).outcome).toBe('bye');
	});

	it('reads an unreported Match as pending', () => {
		expect(readMatchFromPlayerSide(match({ hasResult: false, player1GameWins: null, player2GameWins: null }), 1).outcome).toBe('pending');
	});

	it('reads a result without game wins as pending', () => {
		expect(readMatchFromPlayerSide(match({ player1GameWins: null, player2GameWins: null }), 1).outcome).toBe('pending');
	});
});

describe('formatGameScore', () => {
	it.each([
		[
			'a win',
			match(),
			1,
			'2-1',
		],
		[
			'a loss, from the losing side',
			match(),
			2,
			'1-2',
		],
		[
			'a game draw',
			match({ player1GameWins: 1, player2GameWins: 1, gameDraws: 1 }),
			1,
			'1-1-1',
		],
		[
			'an unplayed draw',
			match({ player1GameWins: 0, player2GameWins: 0, gameDraws: 0 }),
			1,
			'0-0',
		],
	])('scores %s', (_name, played, playerId, expected) => {
		expect(formatGameScore(readMatchFromPlayerSide(played, playerId))).toBe(expected);
	});

	it('omits an unknown game-draw count', () => {
		expect(formatGameScore(readMatchFromPlayerSide(match({ gameDraws: null }), 1))).toBe('2-1');
	});

	it('has no score for a bye', () => {
		expect(formatGameScore(readMatchFromPlayerSide(match({ isBye: true, player1GameWins: 2, player2GameWins: 0 }), 1))).toBeNull();
	});

	it('has no score for an unreported Match', () => {
		expect(formatGameScore(readMatchFromPlayerSide(match({ hasResult: false, player1GameWins: 0, player2GameWins: 0 }), 1))).toBeNull();
	});

	it('has no score for a result without game wins', () => {
		expect(formatGameScore(readMatchFromPlayerSide(match({ player1GameWins: null, player2GameWins: null }), 1))).toBeNull();
	});
});
