import { describe, expect, it } from 'vitest';
import { createMatchSchema, updateMatchSchema } from '~~/server/schemas/api/match';

const provenance = { externalId: 'ext-match-1', externalSource: 'melee' };

describe.each([
	[
		'createMatchSchema',
		createMatchSchema,
		{ roundId: 1, tableNumber: 5 },
	],
	[
		'updateMatchSchema',
		updateMatchSchema,
		{ tableNumber: 2 },
	],
] as const)('%s', (_name, schema, manual) => {
	it('accepts a manual write but refuses integration-owned provenance', () => {
		expect(schema.safeParse(manual).success).toBe(true);
		expect(schema.safeParse({
			...manual,
			...provenance,
		}).success).toBe(false);
	});
});

describe('manual player snapshots on createMatchSchema', () => {
	it('carry the deck identity and Archetype a manual Match may set', () => {
		expect(createMatchSchema.safeParse({
			roundId: 1,
			player1Data: { name: 'Alice', deckId: 77, archetypeId: 5 },
			player2Data: { name: 'Bob', archetypeId: null },
		}).success).toBe(true);
	});

	it('refuse forged provenance', () => {
		expect(createMatchSchema.safeParse({
			roundId: 1,
			player1Data: { name: 'Alice', ...provenance },
		}).success).toBe(false);
	});
});
