import { describe, expect, it } from 'vitest';
import {
	createPhaseSchema,
	phaseParamsSchema,
	updatePhaseSchema,
} from '~~/server/schemas/api/phase';

// ──────────────── createPhaseSchema ────────────────

describe('createPhaseSchema', () => {
	const validInput = {
		name: 'Swiss',
	};

	it('accepts valid input with required fields only', () => {
		const result = createPhaseSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('rejects integration-owned provenance on manual creates (unknown keys on a strict schema)', () => {
		const result = createPhaseSchema.safeParse({
			...validInput,
			sortOrder: 0,
			externalId: 'ext-phase-1',
			externalSource: 'melee',
		});
		expect(result.success).toBe(false);
	});

	// Required fields

	// name bounds

	it('accepts name of exactly 1 character', () => {
		const result = createPhaseSchema.safeParse({ ...validInput, name: 'A' });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = createPhaseSchema.safeParse({ ...validInput, name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	// sortOrder constraints
	it('accepts sortOrder of 0', () => {
		const result = createPhaseSchema.safeParse({ ...validInput, sortOrder: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts positive sortOrder', () => {
		const result = createPhaseSchema.safeParse({ ...validInput, sortOrder: 5 });
		expect(result.success).toBe(true);
	});

	// Stripped fields
});

// ──────────────── updatePhaseSchema ────────────────

describe('updatePhaseSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updatePhaseSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with name only', () => {
		const result = updatePhaseSchema.safeParse({ name: 'Top 8' });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with sortOrder only', () => {
		const result = updatePhaseSchema.safeParse({ sortOrder: 2 });
		expect(result.success).toBe(true);
	});

	it('rejects integration-owned provenance on manual updates (unknown keys on a strict schema)', () => {
		const result = updatePhaseSchema.safeParse({
			name: 'Top 8',
			sortOrder: 1,
			externalId: 'ext-2',
			externalSource: 'melee',
		});
		expect(result.success).toBe(false);
	});

	// Same constraints as create

	it('accepts name of exactly 200 characters', () => {
		const result = updatePhaseSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('accepts sortOrder of 0', () => {
		const result = updatePhaseSchema.safeParse({ sortOrder: 0 });
		expect(result.success).toBe(true);
	});
});

// ──────────────── phaseParamsSchema ────────────────

describe('phaseParamsSchema', () => {
	it('coerces string id and phaseId to numbers', () => {
		const result = phaseParamsSchema.safeParse({ id: '1', phaseId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.phaseId).toBe(2);
		}
	});

	it('accepts numeric id and phaseId', () => {
		const result = phaseParamsSchema.safeParse({ id: 42, phaseId: 99 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.phaseId).toBe(99);
		}
	});
});
