import { describe, expect, it } from 'vitest';
import { createRoundSchema, updateRoundSchema } from '~~/server/schemas/api/round';

const provenance = {
	externalId: 'ext-round-1',
	externalSource: 'melee',
	lastSyncedAt: new Date(),
};

describe.each([
	[
		'createRoundSchema',
		createRoundSchema,
		{ name: 'Round 1', roundNumber: 1, phaseId: 1 },
	],
	[
		'updateRoundSchema',
		updateRoundSchema,
		{ name: 'Round 2' },
	],
] as const)('%s', (_name, schema, manual) => {
	it('accepts a manual write but refuses integration-owned provenance and sync timestamps', () => {
		expect(schema.safeParse(manual).success).toBe(true);
		expect(schema.safeParse({
			...manual,
			...provenance,
		}).success).toBe(false);
	});
});
