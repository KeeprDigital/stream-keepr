import { describe, expect, it } from 'vitest';
import { createArchetypeSchema, setArchetypeKeyCardsSchema, updateArchetypeSchema } from '~~/server/schemas/api/archetype';

describe('createArchetypeSchema', () => {
	it.each([
		['eventId', 2],
		['leaderCardNumber', 'OP01-001'],
		['customised', true],
	])('refuses %s, which the server owns', (field, value) => {
		expect(createArchetypeSchema.safeParse({ name: 'Azorius Control', [field]: value }).success).toBe(false);
	});

	it('takes no Pinned Chart Series, which only an edit sets', () => {
		expect(createArchetypeSchema.safeParse({ name: 'Azorius Control', chartSeries: 3 }).success).toBe(false);
	});
});

describe('updateArchetypeSchema', () => {
	// A One Piece Archetype's Leader and customised flag are derived (ADR-0074).
	it.each([
		['leaderCardNumber', 'OP01-001'],
		['customised', false],
	])('refuses %s, which the server owns', (field, value) => {
		expect(updateArchetypeSchema.safeParse({ [field]: value }).success).toBe(false);
	});

	// A Pinned Chart Series names one of the Theme's eight chart series, or none.
	it.each([
		[0, false],
		[1, true],
		[8, true],
		[9, false],
		[2.5, false],
		[null, true],
	])('takes chart series %j → %s', (chartSeries, accepted) => {
		expect(updateArchetypeSchema.safeParse({ chartSeries }).success).toBe(accepted);
	});
});

describe('setArchetypeKeyCardsSchema', () => {
	it.each([
		[
			'five card IDs',
			{
				cardIds: [1, 2, 3, 4, 5],
			},
			true,
		],
		[
			'six card IDs',
			{
				cardIds: [1, 2, 3, 4, 5, 6],
			},
			false,
		],
		[
			'five card names',
			{
				cardNames: ['a', 'b', 'c', 'd', 'e'],
			},
			true,
		],
		[
			'six card names',
			{
				cardNames: ['a', 'b', 'c', 'd', 'e', 'f'],
			},
			false,
		],
		[
			'an empty list, which clears the key cards',
			{ cardIds: [] },
			true,
		],
		['neither IDs nor names', {}, false],
		[
			'both IDs and names',
			{
				cardIds: [1],
				cardNames: ['Lightning Bolt'],
			},
			false,
		],
	])('takes %s: %j → %s', (_case, input, accepted) => {
		expect(setArchetypeKeyCardsSchema.safeParse(input).success).toBe(accepted);
	});

	it('trims card names and refuses a blank one', () => {
		expect(setArchetypeKeyCardsSchema.parse({
			cardNames: ['  Lightning Bolt  '],
		}).cardNames).toEqual(['Lightning Bolt']);
		expect(setArchetypeKeyCardsSchema.safeParse({
			cardNames: ['   '],
		}).success).toBe(false);
	});
});
