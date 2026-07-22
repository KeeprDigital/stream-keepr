import { describe, expect, it } from 'vitest';
import {
	archetypeParamsSchema,
	createArchetypeSchema,
	setArchetypeKeyCardsSchema,
	updateArchetypeSchema,
} from '~~/server/schemas/api/archetype';

// ──────────────── createArchetypeSchema ────────────────

describe('createArchetypeSchema', () => {
	it('accepts valid input with name only', () => {
		const result = createArchetypeSchema.safeParse({ name: 'Azorius Control' });
		expect(result.success).toBe(true);
	});

	it('accepts full input with name and colors', () => {
		const result = createArchetypeSchema.safeParse({
			name: 'Azorius Control',
			colors: 'WU',
		});
		expect(result.success).toBe(true);
	});

	it('accepts null colors', () => {
		const result = createArchetypeSchema.safeParse({ name: 'Test', colors: null });
		expect(result.success).toBe(true);
	});
});

// ──────────────── updateArchetypeSchema ────────────────

describe('updateArchetypeSchema', () => {
	it('accepts partial update with name only', () => {
		const result = updateArchetypeSchema.safeParse({ name: 'Renamed' });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with colors only', () => {
		const result = updateArchetypeSchema.safeParse({ colors: 'WUB' });
		expect(result.success).toBe(true);
	});

	it('accepts empty object (no changes)', () => {
		const result = updateArchetypeSchema.safeParse({});
		expect(result.success).toBe(true);
	});
});

// ──────────────── setArchetypeKeyCardsSchema ────────────────

describe('setArchetypeKeyCardsSchema', () => {
	it('accepts empty cardIds array', () => {
		const result = setArchetypeKeyCardsSchema.safeParse({ cardIds: [] });
		expect(result.success).toBe(true);
	});

	it('accepts up to 5 card IDs', () => {
		const result = setArchetypeKeyCardsSchema.safeParse({ cardIds: [1, 2, 3, 4, 5] });
		expect(result.success).toBe(true);
	});

	it('trims card names', () => {
		const result = setArchetypeKeyCardsSchema.safeParse({ cardNames: ['  Lightning Bolt  '] });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.cardNames).toEqual(['Lightning Bolt']);
	});
});

// ──────────────── archetypeParamsSchema ────────────────

describe('archetypeParamsSchema', () => {
	it('coerces string params to numbers', () => {
		const result = archetypeParamsSchema.safeParse({ id: '1', archetypeId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.archetypeId).toBe(5);
		}
	});
});
