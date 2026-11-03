import { describe, expect, it } from 'vitest';
import { opDeckLayout } from '~~/shared/utils/opDeckLayout';
import { opDeckListEntry as entry } from '~~/test/helpers/opCards';

/** A Deck List in paste order: a Leader, then cards out of category and cost order. */
const PASTED = [
	entry('OP01-001', 1, 'leader', null),
	entry('OP01-030', 2, 'stage', 1),
	entry('OP01-020', 4, 'character', 5),
	entry('OP01-026', 3, 'event', 2),
	entry('OP01-013', 4, 'character', 2),
	entry('OP01-011', 4, 'character', 2),
	entry('OP01-029', 2, 'event', 0),
	entry('OP99-999', 1, null),
];

describe('opDeckLayout', () => {
	it('groups the Mainboard Character, Event, Stage, by cost then number, leaving the Leader out', () => {
		expect(opDeckLayout(PASTED).groups.map(group => ({
			key: group.key,
			count: group.count,
			numbers: group.cards.map(card => card.number),
		}))).toEqual([
			{
				key: 'character',
				count: 12,
				numbers: ['OP01-011', 'OP01-013', 'OP01-020'],
			},
			{
				key: 'event',
				count: 5,
				numbers: ['OP01-029', 'OP01-026'],
			},
			{
				key: 'stage',
				count: 2,
				numbers: ['OP01-030'],
			},
			{
				key: 'unknown',
				count: 1,
				numbers: ['OP99-999'],
			},
		]);
	});

	it.each([
		{
			name: 'only Characters',
			entries: [
				entry('OP01-013', 4, 'character', 2),
			],
			keys: ['character'],
		},
		{
			name: 'only a Leader',
			entries: [
				entry('OP01-001', 1, 'leader', null),
			],
			keys: [],
		},
		{ name: 'nothing', entries: [], keys: [] },
	])('shows no empty group: $name', ({ entries, keys }) => {
		expect(opDeckLayout(entries).groups.map(group => group.key)).toEqual(keys);
	});

	it.each([
		{
			name: 'from 0 when a card costs 0, with empty costs between',
			entries: PASTED,
			curve: [
				[0, 2],
				[1, 2],
				[2, 11],
				[3, 0],
				[4, 0],
				[5, 4],
			],
		},
		{
			name: 'from 1 when no card costs 0',
			entries: [
				entry('OP01-013', 4, 'character', 2),
				entry('OP01-020', 3, 'character', 3),
			],
			curve: [
				[1, 0],
				[2, 4],
				[3, 3],
			],
		},
		{
			name: 'empty for cards with no known cost',
			entries: [
				entry('OP01-001', 1, 'leader', null),
				entry('OP99-999', 4, null),
			],
			curve: [],
		},
	])('counts the Mainboard by cost, $name', ({ entries, curve }) => {
		expect(opDeckLayout(entries).costCurve.map(bucket => [bucket.cost, bucket.count])).toEqual(curve);
	});
});
