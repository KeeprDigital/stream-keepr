import type { BracketEntrant, BracketMatchInput, BracketRoundInput, SeededPlayer, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { describe, expect, it } from 'vitest';
import { deriveTopCutBracket } from '~~/shared/modules/top-cut-bracket';

/**
 * A Top Cut bracket is derived from a Phase's Rounds, in order, and their
 * Matches (#752): one column per Round, Matches paired so each one's winner
 * advances into the next column, and every position no Match fills yet pending.
 */

let nextMatchId = 1;

function player(id: number, name = `P${id}`): BracketEntrant {
	return { playerId: id, name };
}

function match(table: number | null, player1: BracketEntrant | null, player2: BracketEntrant | null, result?: [number, number]): BracketMatchInput {
	return {
		matchId: nextMatchId++,
		tableNumber: table,
		player1,
		player2,
		isBye: false,
		hasResult: result != null,
		player1GameWins: result?.[0] ?? null,
		player2GameWins: result?.[1] ?? null,
		gameDraws: result ? 0 : null,
	};
}

function round(roundId: number, name: string, matches: BracketMatchInput[]): BracketRoundInput {
	return { roundId, name, matches };
}

/** Players 1 to `count`, each seeded by their id. */
function seeded(count: number): SeededPlayer[] {
	return Array.from({ length: count }, (_, index) => ({
		seed: index + 1,
		entrant: player(index + 1),
	}));
}

/** A first Round pairing these seeds, at tables in the order given. */
function pairedRound(pairs: ReadonlyArray<readonly [number, number]>): BracketRoundInput {
	return round(1, 'First Round', pairs.map(([a, b], index) => match(index + 1, player(a), player(b))));
}

/** Each column as its positions' entrant names, `-` for an empty seat. */
function seats(bracket: TopCutBracket): string[][] {
	return bracket.columns.map(column => column.positions.map(position =>
		position.entrants.map(entrant => entrant?.name ?? '-').join(' v ')));
}

describe('deriveTopCutBracket', () => {
	it('lays out a Top 8 from its first Round in table order, and advances each winner into a pending column', () => {
		const bracket = deriveTopCutBracket([
			round(10, 'Quarterfinals', [
				match(3, player(2), player(7), [2, 0]),
				match(1, player(1), player(8), [2, 1]),
				match(4, player(3), player(6)),
				match(2, player(4), player(5), [0, 2]),
			]),
		]);

		expect(bracket.size).toBe(8);
		expect(bracket.columns.map(column => [column.roundId, column.name])).toEqual([
			[10, 'Quarterfinals'],
			[null, 'Semifinals'],
			[null, 'Final'],
		]);
		expect(seats(bracket)).toEqual([
			[
				'P1 v P8',
				'P4 v P5',
				'P2 v P7',
				'P3 v P6',
			],
			['P1 v P5', 'P2 v -'],
			['- v -'],
		]);
		expect(bracket.columns[0]!.positions.map(position => [position.status, position.winner])).toEqual([
			['reported', 0],
			['reported', 1],
			['reported', 0],
			['unreported', null],
		]);
		expect(bracket.columns[1]!.positions.map(position => [position.status, position.matchId])).toEqual([
			['awaiting', null],
			['awaiting', null],
		]);
		expect(bracket.champion).toBeNull();
	});

	it('pairs the first Round as the next Round\'s Matches were paired from it, whatever its table order', () => {
		const bracket = deriveTopCutBracket([
			round(10, 'Quarterfinals', [
				match(1, player(1), player(8), [2, 0]),
				match(2, player(2), player(7), [2, 1]),
				match(3, player(3), player(6), [1, 2]),
				match(4, player(4), player(5), [2, 0]),
			]),
			// Table 1 and 4's winners meet, so they share a Semifinal.
			round(11, 'Semifinals', [
				match(1, player(1), player(4)),
				match(2, player(2), player(6), [2, 1]),
			]),
		]);

		expect(seats(bracket)).toEqual([
			[
				'P1 v P8',
				'P4 v P5',
				'P2 v P7',
				'P3 v P6',
			],
			['P1 v P4', 'P2 v P6'],
			['- v P2'],
		]);
		expect(bracket.columns.map(column => column.roundId)).toEqual([10, 11, null]);
		expect(bracket.columns[1]!.positions.map(position => position.status)).toEqual(['unreported', 'reported']);
	});

	it('seats each Match\'s first side above its second, and crowns the Final\'s winner once it is reported', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Semifinals', [
				match(1, player(1), player(4), [2, 0]),
				match(2, player(2), player(3), [0, 2]),
			]),
			round(2, 'Finals', [
				match(1, player(3), player(1), [2, 1]),
			]),
		]);

		expect(bracket.size).toBe(4);
		expect(seats(bracket)).toEqual([
			['P2 v P3', 'P1 v P4'],
			['P3 v P1'],
		]);
		expect(bracket.champion).toEqual(player(3));
	});

	it('crowns no one for an unreported or drawn Final', () => {
		const unreported = deriveTopCutBracket([
			round(1, 'Final', [
				match(1, player(1), player(2)),
			]),
		]);
		const drawn = deriveTopCutBracket([
			round(1, 'Final', [
				match(1, player(1), player(2), [1, 1]),
			]),
		]);

		expect(unreported.champion).toBeNull();
		expect(drawn.columns[0]!.positions[0]).toMatchObject({
			status: 'reported',
			winner: null,
			gameWins: [1, 1],
		});
		expect(drawn.champion).toBeNull();
	});

	it('advances a bye the first Round records as a Match', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Quarterfinals', [
				match(1, player(4), player(5), [2, 0]),
				match(2, player(3), player(6)),
				{
					...match(null, player(1), null),
					isBye: true,
				},
				{
					...match(null, player(2), null),
					isBye: true,
				},
			]),
		]);

		expect(bracket.size).toBe(8);
		expect(bracket.columns[0]!.positions.map(position => position.status)).toEqual(['reported', 'unreported', 'bye', 'bye']);
		expect(seats(bracket)).toEqual([
			[
				'P4 v P5',
				'P3 v P6',
				'P1 v -',
				'P2 v -',
			],
			['P4 v -', 'P1 v P2'],
			['- v -'],
		]);
	});

	it('seats a bye the first Round leaves out where the next Round\'s pairings place its Player', () => {
		// A Top 6: seeds 1 and 2 skip the first Round, which holds only two Matches.
		const bracket = deriveTopCutBracket([
			round(1, 'Quarterfinals', [
				match(1, player(3), player(6), [2, 0]),
				match(2, player(4), player(5), [0, 2]),
			]),
			round(2, 'Semifinals', [
				match(1, player(1), player(5)),
				match(2, player(2), player(3)),
			]),
			round(3, 'Final', []),
		]);

		expect(bracket.size).toBe(8);
		expect(seats(bracket)).toEqual([
			[
				'P1 v -',
				'P4 v P5',
				'P2 v -',
				'P3 v P6',
			],
			['P1 v P5', 'P2 v P3'],
			['- v -'],
		]);
		expect(bracket.columns[0]!.positions.map(position => [position.status, position.winner])).toEqual([
			['bye', 0],
			['reported', 1],
			['bye', 0],
			['reported', 0],
		]);
		expect(bracket.columns[2]).toMatchObject({ roundId: 3, name: 'Final' });
	});

	it('sizes a bracket whose first Round leaves its byes out from the Round after it, before the Final exists', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Quarterfinals', [
				match(1, player(3), player(6), [2, 0]),
				match(2, player(4), player(5), [0, 2]),
			]),
			round(2, 'Semifinals', [
				match(1, player(1), player(5)),
				match(2, player(2), player(3)),
			]),
		]);

		expect(bracket.size).toBe(8);
		expect(bracket.columns.map(column => [column.name, column.positions.length])).toEqual([
			['Quarterfinals', 4],
			['Semifinals', 2],
			['Final', 1],
		]);
		expect(bracket.columns[0]!.positions.map(position => position.status)).toEqual(['bye', 'reported', 'bye', 'reported']);
	});

	it('shows no Round past the Final, such as a playoff for third place', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Semifinals', [
				match(1, player(1), player(4), [2, 0]),
				match(2, player(2), player(3), [2, 0]),
			]),
			round(2, 'Final', [
				match(1, player(1), player(2)),
			]),
			round(3, 'Third Place', [
				match(1, player(4), player(3)),
			]),
		]);

		expect(bracket.size).toBe(4);
		expect(seats(bracket)).toEqual([
			['P1 v P4', 'P2 v P3'],
			['P1 v P2'],
		]);
	});

	it('follows a side the Match records by name alone', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Semifinals', [
				match(1, { playerId: null, name: 'Alice' }, { playerId: null, name: 'Bob' }, [2, 0]),
				match(2, { playerId: null, name: 'Cara' }, { playerId: null, name: 'Dan' }, [2, 0]),
			]),
			round(2, 'Final', [
				match(1, { playerId: null, name: 'Cara' }, { playerId: null, name: 'Alice' }),
			]),
		]);

		expect(seats(bracket)).toEqual([
			['Cara v Dan', 'Alice v Bob'],
			['Cara v Alice'],
		]);
	});

	it.each([
		[
			4,
			['Semifinals', 'Final'],
		],
		[
			8,
			['Quarterfinals', 'Semifinals', 'Final'],
		],
		[
			16,
			[
				'Round of 16',
				'Quarterfinals',
				'Semifinals',
				'Final',
			],
		],
	])('sizes a Top %i from its first Round', (size, names) => {
		const firstRound = Array.from({ length: size / 2 }, (_, index) => match(index + 1, player(index * 2 + 1), player(index * 2 + 2)));
		const bracket = deriveTopCutBracket([
			round(1, names[0]!, firstRound),
		]);

		expect(bracket.size).toBe(size);
		expect(bracket.columns.map(column => column.name)).toEqual(names);
		expect(bracket.columns.map(column => column.positions.length)).toEqual(names.map((_, column) => size / 2 ** (column + 1)));
	});

	it('shows a Phase whose Rounds hold no Matches yet as wholly pending', () => {
		const bracket = deriveTopCutBracket([
			round(1, 'Top 8', []),
			round(2, 'Top 4', []),
			round(3, 'Finals', []),
		]);

		expect(bracket.columns.map(column => [
			column.name,
			column.positions.map(position => position.status),
		])).toEqual([
			[
				'Top 8',
				[
					'awaiting',
					'awaiting',
					'awaiting',
					'awaiting',
				],
			],
			[
				'Top 4',
				['awaiting', 'awaiting'],
			],
			[
				'Finals',
				['awaiting'],
			],
		]);
	});

	it('is empty for a Phase with no Rounds', () => {
		expect(deriveTopCutBracket([])).toEqual({ size: 0, columns: [], champion: null });
	});

	describe('a set size', () => {
		it.each([
			['unset', null, 2, 4],
			[
				'larger than the first Round implies',
				8,
				2,
				8,
			],
			[
				'as large as the first Round implies',
				8,
				4,
				8,
			],
			['larger by two Rounds', 16, 2, 16],
			[
				'smaller than the first Round implies, which is ignored',
				4,
				4,
				8,
			],
		])('sizes the bracket when %s', (_, size, matches, expected) => {
			const bracket = deriveTopCutBracket([
				round(1, 'First Round', Array.from({ length: matches }, (_, index) => match(index + 1, player(index * 2 + 1), player(index * 2 + 2)))),
			], { size });

			expect(bracket.size).toBe(expected);
			expect(bracket.columns.map(column => column.positions.length)).toEqual(
				Array.from({
					length: Math.log2(expected),
				}, (_, column) => expected / 2 ** (column + 1)),
			);
		});

		it('sizes a Phase whose Rounds hold no Matches yet', () => {
			const bracket = deriveTopCutBracket([
				round(1, 'Top 8', []),
			], { size: 8 });

			expect(bracket.columns.map(column => [column.name, column.positions.length])).toEqual([
				['Top 8', 4],
				['Semifinals', 2],
				['Final', 1],
			]);
		});
	});

	describe('placed by Seed', () => {
		it.each([
			[
				4,
				[
					[2, 3],
					[1, 4],
				],
				['P1 v P4', 'P2 v P3'],
			],
			[
				8,
				[
					[3, 6],
					[2, 7],
					[4, 5],
					[1, 8],
				],
				[
					'P1 v P8',
					'P4 v P5',
					'P2 v P7',
					'P3 v P6',
				],
			],
			[
				16,
				[
					[6, 11],
					[3, 14],
					[7, 10],
					[2, 15],
					[5, 12],
					[4, 13],
					[8, 9],
					[1, 16],
				],
				[
					'P1 v P16',
					'P8 v P9',
					'P4 v P13',
					'P5 v P12',
					'P2 v P15',
					'P7 v P10',
					'P3 v P14',
					'P6 v P11',
				],
			],
			[
				32,
				Array.from({ length: 16 }, (_, index) => [16 - index, 17 + index] as const),
				[
					'P1 v P32',
					'P16 v P17',
					'P8 v P25',
					'P9 v P24',
					'P4 v P29',
					'P13 v P20',
					'P5 v P28',
					'P12 v P21',
					'P2 v P31',
					'P15 v P18',
					'P7 v P26',
					'P10 v P23',
					'P3 v P30',
					'P14 v P19',
					'P6 v P27',
					'P11 v P22',
				],
			],
		] as const)('seats a Top %i\'s first Round in standard order, whatever its table order', (size, pairs, expected) => {
			const bracket = deriveTopCutBracket([
				pairedRound(pairs),
			], {
				seeds: seeded(size),
			});

			expect(seats(bracket)[0]).toEqual(expected);
		});

		it('gives the top Seeds the byes of a Top 6 set to size 8, and leaves the Semifinals pending', () => {
			const bracket = deriveTopCutBracket([
				round(1, 'Quarterfinals', [
					match(1, player(3), player(6), [2, 0]),
					match(2, player(4), player(5)),
				]),
			], {
				size: 8,
				seeds: seeded(40),
			});

			expect(seats(bracket)).toEqual([
				[
					'P1 v -',
					'P4 v P5',
					'P2 v -',
					'P3 v P6',
				],
				['P1 v -', 'P2 v P3'],
				['- v -'],
			]);
			expect(bracket.columns.map(column => column.positions.map(position => position.status))).toEqual([
				['bye', 'unreported', 'bye', 'reported'],
				['awaiting', 'awaiting'],
				['awaiting'],
			]);
		});

		it.each([
			[
				'a Top 7',
				[
					[2, 7],
					[3, 6],
					[4, 5],
				],
				null,
				[
					'P1 v -',
					'P4 v P5',
					'P2 v P7',
					'P3 v P6',
				],
			],
			// No Seed better than the worst one seated sits out, so no one takes a bye.
			[
				'a Top 4 set to size 8',
				[
					[1, 4],
					[2, 3],
				],
				8,
				['P1 v P4', '- v -', 'P2 v P3', '- v -'],
			],
		] as const)('gives byes only to Seeds better than every one %s seats', (_, pairs, size, expected) => {
			const bracket = deriveTopCutBracket([
				pairedRound(pairs),
			], {
				size,
				seeds: seeded(40),
			});

			expect(seats(bracket)[0]).toEqual(expected);
		});

		it.each([
			[
				'crossing its table order',
				[
					[1, 3],
					[2, 4],
				],
			],
			[
				'along its table order',
				[
					[1, 4],
					[2, 3],
				],
			],
		] as const)('keeps every first-Round position when the next Round is paired %s', (_, semifinals) => {
			const quarterfinals = round(1, 'Quarterfinals', [
				match(1, player(2), player(7), [2, 0]),
				match(2, player(3), player(6), [2, 0]),
				match(3, player(1), player(8), [2, 0]),
				match(4, player(4), player(5), [2, 0]),
			]);
			const before = deriveTopCutBracket([quarterfinals], {
				seeds: seeded(8),
			});
			const after = deriveTopCutBracket([
				quarterfinals,
				round(2, 'Semifinals', semifinals.map(([a, b], index) => match(index + 1, player(a), player(b)))),
			], {
				seeds: seeded(8),
			});

			expect(seats(after)[0]).toEqual(seats(before)[0]);
			expect(seats(after)[0]).toEqual([
				'P1 v P8',
				'P4 v P5',
				'P2 v P7',
				'P3 v P6',
			]);
		});

		it('places each later Match where its Players advance from', () => {
			const bracket = deriveTopCutBracket([
				round(1, 'Quarterfinals', [
					match(1, player(3), player(6), [2, 0]),
					match(2, player(4), player(5), [0, 2]),
				]),
				round(2, 'Semifinals', [
					match(1, player(2), player(3)),
					match(2, player(5), player(1)),
				]),
			], {
				seeds: seeded(8),
			});

			expect(seats(bracket)).toEqual([
				[
					'P1 v -',
					'P4 v P5',
					'P2 v -',
					'P3 v P6',
				],
				['P5 v P1', 'P2 v P3'],
				['- v -'],
			]);
		});

		it('fills the positions Seeds leave free with unseeded Matches in table order', () => {
			const bracket = deriveTopCutBracket([
				round(1, 'Quarterfinals', [
					match(1, { playerId: null, name: 'Alice' }, { playerId: null, name: 'Bob' }),
					match(2, player(2), player(7)),
					match(3, { playerId: null, name: 'Cara' }, { playerId: null, name: 'Dan' }),
					match(4, player(1), player(8)),
				]),
			], {
				seeds: seeded(8),
			});

			expect(seats(bracket)[0]).toEqual([
				'P1 v P8',
				'Alice v Bob',
				'P2 v P7',
				'Cara v Dan',
			]);
		});

		it('places by table order when no first-Round Player has a Seed', () => {
			const bracket = deriveTopCutBracket([
				pairedRound([
					[3, 6],
					[2, 7],
					[4, 5],
					[1, 8],
				]),
			], { seeds: [] });

			expect(seats(bracket)[0]).toEqual([
				'P3 v P6',
				'P2 v P7',
				'P4 v P5',
				'P1 v P8',
			]);
		});
	});
});
