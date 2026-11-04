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

describe('updateRoundSchema timing (ADR-0066)', () => {
	it.each([
		[
			'the shortest duration',
			{ durationMinutes: 1 },
			true,
		],
		[
			'the longest duration',
			{ durationMinutes: 600 },
			true,
		],
		[
			'no duration',
			{ durationMinutes: null },
			true,
		],
		[
			'a duration under the bound',
			{ durationMinutes: 0 },
			false,
		],
		[
			'a duration over the bound',
			{ durationMinutes: 601 },
			false,
		],
		[
			'a fractional duration',
			{ durationMinutes: 50.5 },
			false,
		],
		[
			'a start with its offset',
			{ startedAt: '2026-11-04T10:00:00.000Z' },
			true,
		],
		[
			'no start',
			{ startedAt: null },
			true,
		],
		[
			'a start that names no instant',
			{ startedAt: '10:00' },
			false,
		],
	] as const)('%s', (_case, body, accepted) => {
		expect(updateRoundSchema.safeParse(body).success).toBe(accepted);
	});

	it('reads a start as the instant it names', () => {
		expect(updateRoundSchema.parse({ startedAt: '2026-11-04T11:00:00+01:00' }).startedAt)
			.toEqual(new Date('2026-11-04T10:00:00.000Z'));
	});
});

describe('createRoundSchema', () => {
	// A new Round starts untimed; its timing is an edit.
	it.each([
		[
			'a duration',
			{ durationMinutes: 50 },
		],
		[
			'a start',
			{ startedAt: '2026-11-04T10:00:00.000Z' },
		],
	] as const)('refuses %s', (_case, timing) => {
		expect(createRoundSchema.safeParse({
			name: 'Round 1',
			roundNumber: 1,
			phaseId: 1,
			...timing,
		}).success).toBe(false);
	});
});
