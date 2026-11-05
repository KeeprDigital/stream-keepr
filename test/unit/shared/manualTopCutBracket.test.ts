import type { ManualBracket, ManualBracketEntrant, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { describe, expect, it } from 'vitest';
import {
	deriveManualTopCutBracket,
	resizeManualBracket,
	withManualBracketEntrant,
	withManualBracketResult,
} from '~~/shared/modules/top-cut-bracket';

/**
 * A Manual Bracket pairs its entrants by Seed in standard order, gives a bye
 * to whoever meets an empty Seed, and advances whoever the operator marks.
 */

/** Entrants typed as `S<seed>`, for the Seeds given; any other Seed left empty. */
function seeded(size: ManualBracket['size'], seeds: number[]): ManualBracket {
	const entrants = Array.from<ManualBracketEntrant | null>({ length: size }).fill(null);
	for (const seed of seeds)
		entrants[seed - 1] = { name: `S${seed}` };
	return { size, entrants, results: [] };
}

function topN(size: ManualBracket['size'], count: number = size): ManualBracket {
	return seeded(size, Array.from({ length: count }, (_, index) => index + 1));
}

function byName(entrant: ManualBracketEntrant, seed: number) {
	return 'name' in entrant
		? { playerId: null, name: entrant.name, seed }
		: { playerId: entrant.playerId, name: `Player ${entrant.playerId}`, seed };
}

function derive(manual: ManualBracket): TopCutBracket {
	return deriveManualTopCutBracket(manual, byName);
}

/** Each column as its positions: entrant names (`-` for an empty seat), status, and the winner's side. */
function seats(bracket: TopCutBracket): string[][] {
	return bracket.columns.map(column => column.positions.map(position =>
		`${position.entrants.map(entrant => entrant?.name ?? '-').join(' v ')} ${position.status}${position.winner == null
			? ''
			: ` ${position.winner}`}`));
}

function marked(manual: ManualBracket, marks: Array<[column: number, position: number, winner: 0 | 1]>): ManualBracket {
	return marks.reduce((held, [column, position, winner]) => withManualBracketResult(held, column, position, { winner }), manual);
}

describe('deriveManualTopCutBracket', () => {
	it.each([
		[
			4,
			[
				['S1 v S4 unreported', 'S2 v S3 unreported'],
				['- v - awaiting'],
			],
		],
		[
			8,
			[
				[
					'S1 v S8 unreported',
					'S4 v S5 unreported',
					'S2 v S7 unreported',
					'S3 v S6 unreported',
				],
				['- v - awaiting', '- v - awaiting'],
				['- v - awaiting'],
			],
		],
	] as const)('pairs a Top %i by Seed in standard order, each later column pending', (size, columns) => {
		expect(seats(derive(topN(size)))).toEqual(columns);
	});

	it('names each column by how many positions it holds', () => {
		expect(derive(topN(16)).columns.map(column => column.name)).toEqual([
			'Round of 16',
			'Quarterfinals',
			'Semifinals',
			'Final',
		]);
	});

	it('gives the best Seeds a bye when the list is short of the size', () => {
		expect(seats(derive(topN(8, 6)))).toEqual([
			[
				'S1 v - bye 0',
				'S4 v S5 unreported',
				'S2 v - bye 0',
				'S3 v S6 unreported',
			],
			['S1 v - awaiting', 'S2 v - awaiting'],
			['- v - awaiting'],
		]);
	});

	it('gives a bye to whoever meets any Seed left empty, on either side', () => {
		const bracket = derive(seeded(4, [2, 3, 4]));

		expect(seats(bracket)[0]).toEqual(['- v S4 bye 1', 'S2 v S3 unreported']);
	});

	it('advances a marked winner into the next column, with the score given, and crowns the Final\'s winner', () => {
		const manual = withManualBracketResult(
			marked(topN(4), [
				[0, 0, 0],
				[0, 1, 1],
			]),
			1,
			0,
			{
				winner: 1,
				gameWins: [1, 2],
			},
		);
		const bracket = derive(manual);

		expect(seats(bracket)).toEqual([
			['S1 v S4 reported 0', 'S2 v S3 reported 1'],
			['S1 v S3 reported 1'],
		]);
		expect(bracket.columns[0]!.positions[0]!.gameWins).toEqual([null, null]);
		expect(bracket.columns[1]!.positions[0]!.gameWins).toEqual([1, 2]);
		expect(bracket.champion?.name).toBe('S3');
	});

	it('advances a bye\'s entrant past a position no entrant can ever reach', () => {
		// Only Seeds 1 and 2 of 8: their first-column opponents never come, nor does anyone from the other two positions.
		const bracket = derive(seeded(8, [1, 2]));

		expect(seats(bracket)).toEqual([
			[
				'S1 v - bye 0',
				'- v - awaiting',
				'S2 v - bye 0',
				'- v - awaiting',
			],
			['S1 v - bye 0', 'S2 v - bye 0'],
			['S1 v S2 unreported'],
		]);
	});

	it('reads no result at a position that does not seat both its entrants', () => {
		const manual = withManualBracketResult(topN(8), 1, 0, { winner: 0 });

		expect(seats(derive(manual))[1]).toEqual(['- v - awaiting', '- v - awaiting']);
		expect(derive(manual).champion).toBeNull();
	});

	it('shows an entrant the resolver cannot name as an empty Seed', () => {
		const manual: ManualBracket = {
			size: 4,
			entrants: [
				{ playerId: 7 },
				{ name: 'S2' },
				{ name: 'S3' },
				{ name: 'S4' },
			],
			results: [],
		};
		const bracket = deriveManualTopCutBracket(manual, (entrant, seed) => 'name' in entrant
			? byName(entrant, seed)
			: null);

		expect(seats(bracket)[0]).toEqual(['- v S4 bye 1', 'S2 v S3 unreported']);
	});

	it('hands the resolver each entrant\'s Seed', () => {
		const bracket = derive(topN(4));

		expect(bracket.columns[0]!.positions.map(position => position.entrants.map(entrant => entrant?.seed))).toEqual([
			[1, 4],
			[2, 3],
		]);
	});
});

describe('editing a Manual Bracket', () => {
	it.each([
		[
			'sets an empty Seed',
			topN(4, 2),
			4,
			{ name: 'New' },
			[
				{ name: 'S1' },
				{ name: 'S2' },
				null,
				{ name: 'New' },
			],
		],
		[
			'replaces a Seed',
			topN(4),
			2,
			{ playerId: 9 },
			[
				{ name: 'S1' },
				{ playerId: 9 },
				{ name: 'S3' },
				{ name: 'S4' },
			],
		],
		[
			'clears a Seed, keeping the Seeds after it',
			topN(4),
			2,
			null,
			[
				{ name: 'S1' },
				null,
				{ name: 'S3' },
				{ name: 'S4' },
			],
		],
		[
			'drops trailing empty Seeds',
			topN(4, 3),
			3,
			null,
			[
				{ name: 'S1' },
				{ name: 'S2' },
			],
		],
		[
			'ignores a Seed past the size',
			topN(4),
			5,
			{ name: 'Late' },
			[
				{ name: 'S1' },
				{ name: 'S2' },
				{ name: 'S3' },
				{ name: 'S4' },
			],
		],
	] as const)('%s', (_, manual, seed, entrant, entrants) => {
		expect(withManualBracketEntrant(manual, seed, entrant).entrants).toEqual(entrants);
	});

	it('keeps every result when an entrant is corrected, so the corrected entrant takes their place', () => {
		const manual = withManualBracketEntrant(marked(topN(4), [
			[0, 0, 0],
		]), 1, { name: 'Renamed' });

		expect(seats(derive(manual))[1]).toEqual(['Renamed v - awaiting']);
	});

	it.each([
		[
			'marks a result',
			[
				[0, 1, 1],
			],
			[
				[
					null,
					{ winner: 1 },
				],
			],
		],
		[
			'marks a later column',
			[
				[1, 0, 0],
			],
			[
				[],
				[
					{ winner: 0 },
				],
			],
		],
		[
			'ignores a position past its column',
			[
				[0, 2, 0],
			],
			[],
		],
		[
			'ignores a column past the Final',
			[
				[2, 0, 0],
			],
			[],
		],
	] as const)('%s', (_, marks, results) => {
		expect(marked(topN(4), marks as unknown as Array<[number, number, 0 | 1]>).results).toEqual(results);
	});

	it('clears a result, dropping empty columns', () => {
		const manual = withManualBracketResult(marked(topN(4), [
			[1, 0, 0],
		]), 1, 0, null);

		expect(manual.results).toEqual([]);
	});

	it.each([
		['grows, keeping every Seed', 4, 8, 4],
		[
			'shrinks, dropping the Seeds past the new size',
			8,
			4,
			4,
		],
	] as const)('%s and clears every result', (_, from, to, kept) => {
		const resized = resizeManualBracket(marked(topN(from), [
			[0, 0, 0],
		]), to);

		expect(resized.size).toBe(to);
		expect(resized.entrants).toHaveLength(kept);
		expect(resized.results).toEqual([]);
	});
});
