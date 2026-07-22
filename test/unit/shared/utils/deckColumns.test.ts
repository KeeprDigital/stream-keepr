import { describe, expect, it } from 'vitest';
import { getDeckColumnCount, splitDeckGroupsIntoColumns } from '~~/shared/utils/deckColumns';

function makeGroup(name: string, count: number) {
	return [name, Array.from({ length: count }, (_, index) => index)] as const;
}

describe('deckColumns', () => {
	it('splits ordered deck groups into balanced contiguous columns', () => {
		const groups = [
			makeGroup('Creature', 15),
			makeGroup('Planeswalker', 1),
			makeGroup('Instant', 13),
			makeGroup('Sorcery', 9),
			makeGroup('Artifact', 3),
			makeGroup('Land', 19),
		];

		const columns = splitDeckGroupsIntoColumns(groups, 3);

		expect(columns.map(column => column.map(([type]) => type))).toEqual([
			['Creature', 'Planeswalker'],
			['Instant', 'Sorcery'],
			['Artifact', 'Land'],
		]);
	});

	it('caps the number of columns at the number of groups', () => {
		const groups = [
			makeGroup('Creature', 4),
			makeGroup('Instant', 4),
			makeGroup('Land', 4),
		];

		const columns = splitDeckGroupsIntoColumns(groups, 6);

		expect(columns.map(column => column.map(([type]) => type))).toEqual([
			['Creature'],
			['Instant'],
			['Land'],
		]);
	});

	it('returns one column for zero or invalid measured width', () => {
		expect(getDeckColumnCount(0, 160, 24, 4)).toBe(1);
		expect(getDeckColumnCount(-10, 160, 24, 4)).toBe(1);
	});

	it('calculates the same column count as the old compact modal layout', () => {
		expect(getDeckColumnCount(620, 160, 24, 6)).toBe(3);
		expect(getDeckColumnCount(380, 160, 24, 6)).toBe(2);
		expect(getDeckColumnCount(220, 160, 24, 6)).toBe(1);
	});
});
