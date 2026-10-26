import { describe, expect, it } from 'vitest';
import { createPhaseSchema, updatePhaseSchema } from '~~/server/schemas/api/phase';

const provenance = { externalId: 'ext-phase-1', externalSource: 'melee' };

describe.each([
	[
		'createPhaseSchema',
		createPhaseSchema,
		{ name: 'Swiss', sortOrder: 0 },
	],
	[
		'updatePhaseSchema',
		updatePhaseSchema,
		{ name: 'Top 8', sortOrder: 1 },
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
