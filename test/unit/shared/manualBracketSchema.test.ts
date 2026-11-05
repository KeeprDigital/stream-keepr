import { describe, expect, it } from 'vitest';
import { manualBracketSchema } from '~~/shared/screenModeConfigs/topCut';

/** A Manual Bracket holds no more Seeds, columns or positions than its size seats (ADR-0075). */

const seeds = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `S${index + 1}` }));
const positions = (count: number) => Array.from({ length: count }, () => ({ winner: 0 as const }));

describe('manualBracketSchema', () => {
	it.each([
		[
			'as many Seeds as its size',
			{
				size: 4,
				entrants: seeds(4),
				results: [],
			},
			true,
		],
		[
			'a Seed past its size',
			{
				size: 4,
				entrants: seeds(5),
				results: [],
			},
			false,
		],
		[
			'a column for each round to the Final',
			{
				size: 8,
				entrants: [],
				results: [
					[],
					[],
					positions(1),
				],
			},
			true,
		],
		[
			'a column past the Final',
			{
				size: 8,
				entrants: [],
				results: [[], [], [], []],
			},
			false,
		],
		[
			'a full first column',
			{
				size: 8,
				entrants: [],
				results: [
					positions(4),
				],
			},
			true,
		],
		[
			'a position past its column',
			{
				size: 8,
				entrants: [],
				results: [
					[],
					positions(3),
				],
			},
			false,
		],
		[
			'a game score up to the most games',
			{
				size: 4,
				entrants: [],
				results: [
					[
						{
							winner: 1,
							gameWins: [0, 9],
						},
					],
				],
			},
			true,
		],
		[
			'a game score past the most games',
			{
				size: 4,
				entrants: [],
				results: [
					[
						{
							winner: 1,
							gameWins: [0, 10],
						},
					],
				],
			},
			false,
		],
	])('decides whether it accepts %s', (_, manual, accepted) => {
		expect(manualBracketSchema.safeParse(manual).success).toBe(accepted);
	});

	it.each([
		[
			'a typed name, trimmed',
			{ name: '  Kim  ' },
			{ name: 'Kim' },
		],
		[
			'a Player',
			{ playerId: 3 },
			{ playerId: 3 },
		],
	])('holds %s as an entrant', (_, entrant, held) => {
		expect(manualBracketSchema.parse({
			size: 4,
			entrants: [entrant],
			results: [],
		}).entrants).toEqual([held]);
	});

	it.each([
		[
			'a blank name',
			{ name: '   ' },
		],
		[
			'both a Player and a name',
			{ playerId: 3, name: 'Kim' },
		],
	])('refuses %s as an entrant', (_, entrant) => {
		expect(manualBracketSchema.safeParse({
			size: 4,
			entrants: [entrant],
			results: [],
		}).success).toBe(false);
	});
});
