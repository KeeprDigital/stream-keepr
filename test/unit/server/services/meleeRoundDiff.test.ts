import type { DbMatch } from '~~/server/db/schema';
import type { MatchUpsertInput } from '~~/server/services/match';
import type { RoundStandingInput } from '~~/server/services/playerRoundStandings';
import { describe, expect, it } from 'vitest';
import { diffRoundMatches, standingsDiffer } from '~~/server/services/meleeRoundDiff';

// A Round snapshot writes only Matches that differ from the stored rows, and
// names a Match Result change apart from a pairing change.

function incoming(externalId: string, overrides: Partial<MatchUpsertInput> = {}): MatchUpsertInput {
	return {
		eventId: 1,
		roundId: 10,
		externalId,
		externalSource: 'melee',
		tableNumber: 1,
		player1Id: 100,
		player2Id: 200,
		player1Data: { name: 'Ana', wins: 1 },
		player2Data: { name: 'Bo', wins: 0 },
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
		isBye: false,
		sortOrder: 0,
		...overrides,
	};
}

function stored(externalId: string, overrides: Partial<DbMatch> = {}): DbMatch {
	return {
		id: 1,
		eventId: 1,
		roundId: 10,
		externalId,
		externalSource: 'melee',
		tableNumber: 1,
		player1Id: 100,
		player2Id: 200,
		// Stored JSON may come back with keys in another order.
		player1Data: { wins: 1, name: 'Ana' },
		player2Data: { name: 'Bo', wins: 0 },
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
		isBye: false,
		sortOrder: 0,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	};
}

const reported = {
	hasResult: true,
	player1GameWins: 2,
	player2GameWins: 0,
	gameDraws: 0,
};

describe('diffRoundMatches', () => {
	it.each([
		[
			'identical rows',
			[
				stored('a'),
			],
			[
				incoming('a'),
			],
			[],
			[],
			false,
		],
		[
			'a result reported',
			[
				stored('a'),
			],
			[
				incoming('a', reported),
			],
			['a'],
			['a'],
			false,
		],
		[
			'a result un-reported',
			[
				stored('a', reported),
			],
			[
				incoming('a'),
			],
			['a'],
			['a'],
			false,
		],
		[
			'a result corrected 2-0 to 2-1',
			[
				stored('a', reported),
			],
			[
				incoming('a', { ...reported, player2GameWins: 1 }),
			],
			['a'],
			['a'],
			false,
		],
		[
			'a bye flagged',
			[
				stored('a'),
			],
			[
				incoming('a', { isBye: true }),
			],
			['a'],
			['a'],
			false,
		],
		[
			'a table number changed',
			[
				stored('a'),
			],
			[
				incoming('a', { tableNumber: 2 }),
			],
			['a'],
			[],
			true,
		],
		[
			'a Match added',
			[
				stored('a'),
			],
			[
				incoming('a'),
				incoming('b'),
			],
			['b'],
			[],
			true,
		],
		[
			'a Match removed',
			[
				stored('a'),
				stored('b'),
			],
			[
				incoming('a'),
			],
			[],
			[],
			true,
		],
		[
			'only a player record changed',
			[
				stored('a'),
			],
			[
				incoming('a', {
					player1Data: { name: 'Ana', wins: 2 },
				}),
			],
			['a'],
			[],
			true,
		],
		[
			'a Match moved Round',
			[
				stored('a', { roundId: 9 }),
			],
			[
				incoming('a'),
			],
			['a'],
			[],
			true,
		],
	] as const)('%s', (_case, storedRows, incomingRows, toWrite, resultChanged, pairingsChanged) => {
		const diff = diffRoundMatches([...storedRows], [...incomingRows]);

		expect(diff.toWrite.map(row => row.externalId)).toEqual(toWrite);
		expect(diff.resultChangedExternalIds).toEqual(resultChanged);
		expect(diff.pairingsChanged).toBe(pairingsChanged);
	});

	it('reads omitted optional fields as their stored defaults', () => {
		const { eventId, roundId, externalId, externalSource, player1Data } = incoming('a');

		expect(diffRoundMatches(
			[
				stored('a', {
					tableNumber: null,
					player1Id: null,
					player2Id: null,
					player2Data: null,
				}),
			],
			[
				{
					eventId,
					roundId,
					externalId,
					externalSource,
					player1Data,
				},
			],
		)).toEqual({ toWrite: [], resultChangedExternalIds: [], pairingsChanged: false });
	});
});

function standing(playerId: number, position: number, overrides: Partial<RoundStandingInput> = {}): RoundStandingInput {
	return {
		playerId,
		wins: 1,
		losses: 0,
		draws: 0,
		position,
		points: 3,
		...overrides,
	};
}

describe('standingsDiffer', () => {
	it.each([
		[
			'the same rows in another order',
			[
				standing(1, 1),
				standing(2, 2),
			],
			[
				standing(2, 2),
				standing(1, 1),
			],
			false,
		],
		[
			'one position changed',
			[
				standing(1, 1),
				standing(2, 2),
			],
			[
				standing(1, 2),
				standing(2, 1),
			],
			true,
		],
		[
			'points changed',
			[
				standing(1, 1),
			],
			[
				standing(1, 1, { points: 4 }),
			],
			true,
		],
		[
			'a row added',
			[
				standing(1, 1),
			],
			[
				standing(1, 1),
				standing(2, 2),
			],
			true,
		],
		[
			'a row removed',
			[
				standing(1, 1),
				standing(2, 2),
			],
			[
				standing(1, 1),
			],
			true,
		],
		[
			'a row for another Player',
			[
				standing(1, 1),
			],
			[
				standing(2, 1),
			],
			true,
		],
	] as const)('%s', (_case, storedRows, incomingRows, differ) => {
		expect(standingsDiffer([...storedRows], [...incomingRows])).toBe(differ);
	});
});
