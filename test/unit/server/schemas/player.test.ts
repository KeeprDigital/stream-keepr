import { describe, expect, it } from 'vitest';
import { createPlayerSchema, updatePlayerSchema } from '~~/server/schemas/api/player';

describe.each([
	[
		'createPlayerSchema',
		createPlayerSchema,
		{
			name: 'Reid Duke',
			gameData: { type: 'mtg', deckName: 'Burn' },
		},
	],
	[
		'updatePlayerSchema',
		updatePlayerSchema,
		{ name: 'Updated Name' },
	],
] as const)('%s', (_name, schema, manual) => {
	it.each([
		[
			'externalId',
			{ externalId: 'forged-id' },
		],
		[
			'externalSource',
			{ externalSource: 'melee' },
		],
	])('accepts a manual write but refuses the server-managed %s', (_field, managed) => {
		expect(schema.safeParse(manual).success).toBe(true);
		expect(schema.safeParse({
			...manual,
			...managed,
		}).success).toBe(false);
	});
});

describe('updatePlayerSchema', () => {
	it('refuses legacy player-level deck review state', () => {
		expect(updatePlayerSchema.safeParse({
			gameData: { type: 'mtg', deckName: 'Control' },
		}).success).toBe(true);
		expect(updatePlayerSchema.safeParse({
			gameData: { type: 'mtg', deckName: 'Control', deckReviewed: true },
		}).success).toBe(false);
	});
});
