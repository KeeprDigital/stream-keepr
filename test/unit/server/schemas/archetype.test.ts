import { describe, expect, it } from 'vitest';
import { createArchetypeSchema, setArchetypeKeyCardsSchema } from '~~/server/schemas/api/archetype';

describe('createArchetypeSchema', () => {
	it('refuses fields the server owns', () => {
		expect(createArchetypeSchema.safeParse({ name: 'Azorius Control', eventId: 2 }).success).toBe(false);
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
