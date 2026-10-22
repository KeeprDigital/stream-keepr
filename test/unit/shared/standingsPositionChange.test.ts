import { describe, expect, it } from 'vitest';
import { formatPositionChange, positionChange } from '~~/shared/utils/standingsPositionChange';

const previousRound = new Map<number, number | null>([
	[1, 4],
	[2, 1],
	[3, 7],
	[4, null],
]);

describe('positionChange', () => {
	it('is up by the places a Player climbed since the previous Round', () => {
		expect(positionChange(1, 1, previousRound)).toEqual({ kind: 'up', by: 3 });
	});

	it('is down by the places a Player dropped since the previous Round', () => {
		expect(positionChange(2, 2, previousRound)).toEqual({ kind: 'down', by: 1 });
	});

	it('is unchanged when a Player holds their position', () => {
		expect(positionChange(3, 7, previousRound)).toEqual({ kind: 'unchanged' });
	});

	it('is new for a Player absent from the previous Round', () => {
		expect(positionChange(99, 5, previousRound)).toEqual({ kind: 'new' });
	});

	it('has nothing to compare when there is no previous Round', () => {
		expect(positionChange(1, 1, null)).toEqual({ kind: 'none' });
	});

	it('has nothing to compare when the Player has no position now', () => {
		expect(positionChange(1, null, previousRound)).toEqual({ kind: 'none' });
	});

	it('has nothing to compare when the previous Round held the Player without a position', () => {
		expect(positionChange(4, 3, previousRound)).toEqual({ kind: 'none' });
	});
});

describe('formatPositionChange', () => {
	it('shows a climb and a drop with their arrows', () => {
		expect(formatPositionChange({ kind: 'up', by: 3 })).toBe('▲3');
		expect(formatPositionChange({ kind: 'down', by: 1 })).toBe('▼1');
	});

	it('shows a neutral marker rather than a number when nothing moved or nothing compares', () => {
		expect(formatPositionChange({ kind: 'unchanged' })).toBe('–');
		expect(formatPositionChange({ kind: 'none' })).toBe('–');
	});

	it('marks a Player new to the standings', () => {
		expect(formatPositionChange({ kind: 'new' })).toBe('new');
	});
});
