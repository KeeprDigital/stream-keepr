import { describe, expect, it } from 'vitest';
import {
	createRoundSchema,
	roundParamsSchema,
	updateRoundSchema,
} from '~~/server/schemas/api/round';

// ──────────────── createRoundSchema ────────────────

describe('createRoundSchema', () => {
	const validInput = {
		name: 'Round 1',
		roundNumber: 1,
		phaseId: 1,
	};

	it('accepts valid input with required fields only', () => {
		const result = createRoundSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('rejects integration-owned provenance on manual creates (unknown keys on a strict schema)', () => {
		const result = createRoundSchema.safeParse({
			...validInput,
			externalId: 'ext-round-1',
			externalSource: 'melee',
			lastSyncedAt: new Date(),
		});
		expect(result.success).toBe(false);
	});

	// Required fields

	// name bounds

	it('accepts name of exactly 200 characters', () => {
		const result = createRoundSchema.safeParse({ ...validInput, name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 1 character', () => {
		const result = createRoundSchema.safeParse({ ...validInput, name: 'A' });
		expect(result.success).toBe(true);
	});

	// roundNumber constraints
	it('accepts roundNumber of 1', () => {
		const result = createRoundSchema.safeParse({ ...validInput, roundNumber: 1 });
		expect(result.success).toBe(true);
	});

	// phaseId constraints

	// Stripped fields
});

// ──────────────── updateRoundSchema ────────────────

describe('updateRoundSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updateRoundSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with name only', () => {
		const result = updateRoundSchema.safeParse({ name: 'Round 2' });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with roundNumber only', () => {
		const result = updateRoundSchema.safeParse({ roundNumber: 3 });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with multiple fields', () => {
		const result = updateRoundSchema.safeParse({
			name: 'Top 8',
			roundNumber: 9,
			phaseId: 2,
		});
		expect(result.success).toBe(true);
	});

	// Same constraints as create

	it('accepts name of exactly 200 characters', () => {
		const result = updateRoundSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('rejects external identity and sync timestamps on manual updates (unknown keys on a strict schema)', () => {
		const result = updateRoundSchema.safeParse({
			name: 'Round 2',
			externalId: 'forged',
			externalSource: 'melee',
			lastSyncedAt: new Date(),
		});
		expect(result.success).toBe(false);
	});
});

// ──────────────── roundParamsSchema ────────────────

describe('roundParamsSchema', () => {
	it('coerces string id and roundId to numbers', () => {
		const result = roundParamsSchema.safeParse({ id: '1', roundId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.roundId).toBe(2);
		}
	});

	it('accepts numeric id and roundId', () => {
		const result = roundParamsSchema.safeParse({ id: 42, roundId: 99 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.roundId).toBe(99);
		}
	});
});
