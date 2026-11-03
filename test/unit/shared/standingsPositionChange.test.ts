import type { PositionChange, PreviousRoundPositionMap } from '~~/shared/utils/standingsPositionChange';
import { describe, expect, it } from 'vitest';
import { formatPositionChange, positionChange } from '~~/shared/utils/standingsPositionChange';

const previousRound = new Map<number, number | null>([
	[1, 4],
	[2, 1],
	[3, 7],
	[4, null],
]);

describe('positionChange', () => {
	it.each<[string, number, number | null, PreviousRoundPositionMap | null, PositionChange]>([
		[
			'up by the places a Player climbed',
			1,
			1,
			previousRound,
			{ kind: 'up', by: 3 },
		],
		[
			'down by the places a Player dropped',
			2,
			2,
			previousRound,
			{ kind: 'down', by: 1 },
		],
		[
			'unchanged when a Player holds their position',
			3,
			7,
			previousRound,
			{ kind: 'unchanged' },
		],
		[
			'new for a Player absent from the previous Round',
			99,
			5,
			previousRound,
			{ kind: 'new' },
		],
		[
			'none when there is no previous Round',
			1,
			1,
			null,
			{ kind: 'none' },
		],
		[
			'none when the Player has no position now',
			1,
			null,
			previousRound,
			{ kind: 'none' },
		],
		[
			'none when the previous Round held the Player without a position',
			4,
			3,
			previousRound,
			{ kind: 'none' },
		],
	])('is %s', (_, playerId, position, previous, expected) => {
		expect(positionChange(playerId, position, previous)).toEqual(expected);
	});
});

describe('formatPositionChange', () => {
	// `–` means the Player held their place; a blank cell means nothing compares (#905).
	it.each<[PositionChange, string]>([
		[
			{ kind: 'up', by: 3 },
			'▲3',
		],
		[
			{ kind: 'down', by: 1 },
			'▼1',
		],
		[
			{ kind: 'unchanged' },
			'–',
		],
		[
			{ kind: 'new' },
			'new',
		],
		[
			{ kind: 'none' },
			'',
		],
	])('shows %o as %j', (change, shown) => {
		expect(formatPositionChange(change)).toBe(shown);
	});
});
