import { describe, expect, it } from 'vitest';
import {
	createTalentSchema,
	talentParamsSchema,
	updateTalentSchema,
} from '~~/server/schemas/api/talent';

// ──────────────── createTalentSchema ────────────────

describe('createTalentSchema', () => {
	it('accepts valid name', () => {
		const result = createTalentSchema.safeParse({ name: 'Alice' });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = createTalentSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});
});

// ──────────────── updateTalentSchema ────────────────

describe('updateTalentSchema', () => {
	it('accepts valid name', () => {
		const result = updateTalentSchema.safeParse({ name: 'Bob' });
		expect(result.success).toBe(true);
	});

	it('accepts empty object (name is optional)', () => {
		const result = updateTalentSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = updateTalentSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});
});

// ──────────────── talentParamsSchema ────────────────

describe('talentParamsSchema', () => {
	it('coerces string "1" to number for id', () => {
		const result = talentParamsSchema.safeParse({ id: '1', talentId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
		}
	});

	it('coerces string "2" to number for talentId', () => {
		const result = talentParamsSchema.safeParse({ id: '1', talentId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.talentId).toBe(2);
		}
	});

	it('accepts numeric id and talentId', () => {
		const result = talentParamsSchema.safeParse({ id: 42, talentId: 7 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.talentId).toBe(7);
		}
	});
});
