import { describe, expect, it } from 'vitest';
import {
	metagameArchetypesQuerySchema,
	metagameCardsQuerySchema,
	metagameParamsSchema,
	metagameQuerySchema,
} from '~~/server/schemas/api/metagame';

// ──────────────── metagameQuerySchema (base) ────────────────

describe('metagameQuerySchema', () => {
	it('defaults scope to all when omitted', () => {
		const result = metagameQuerySchema.safeParse({});
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.scope).toBe('all');
	});

	it('accepts scope all', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'all' });
		expect(result.success).toBe(true);
	});

	it('accepts scope topN with topN provided', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'topN', topN: 8 });
		expect(result.success).toBe(true);
	});

	it('accepts scope playerList with playerListId provided', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'playerList', playerListId: 42 });
		expect(result.success).toBe(true);
	});

	it('accepts topN at min boundary (1)', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'topN', topN: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts topN at max boundary (500)', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'topN', topN: 500 });
		expect(result.success).toBe(true);
	});

	it('coerces string topN to number', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'topN', topN: '8' });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.topN).toBe(8);
	});

	it('coerces string playerListId to number', () => {
		const result = metagameQuerySchema.safeParse({ scope: 'playerList', playerListId: '42' });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.playerListId).toBe(42);
	});
});

// ──────────────── metagameArchetypesQuerySchema ────────────────

describe('metagameArchetypesQuerySchema', () => {
	it('defaults sortBy to metaShare when omitted', () => {
		const result = metagameArchetypesQuerySchema.safeParse({ scope: 'all' });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.sortBy).toBe('metaShare');
	});

	it('accepts sortBy count', () => {
		const result = metagameArchetypesQuerySchema.safeParse({ scope: 'all', sortBy: 'count' });
		expect(result.success).toBe(true);
	});

	it('accepts sortBy winRate', () => {
		const result = metagameArchetypesQuerySchema.safeParse({ scope: 'all', sortBy: 'winRate' });
		expect(result.success).toBe(true);
	});

	it('inherits base query refinements', () => {
		const result = metagameArchetypesQuerySchema.safeParse({ scope: 'topN' });
		expect(result.success).toBe(false);
	});
});

// ──────────────── metagameCardsQuerySchema ────────────────

describe('metagameCardsQuerySchema', () => {
	it('defaults sortBy to inclusionRate and limit to 50', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sortBy).toBe('inclusionRate');
			expect(result.data.limit).toBe(50);
		}
	});

	it('accepts sortBy avgCopies', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', sortBy: 'avgCopies' });
		expect(result.success).toBe(true);
	});

	it('accepts sortBy totalCopies', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', sortBy: 'totalCopies' });
		expect(result.success).toBe(true);
	});

	it('accepts optional archetypeId filter', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', archetypeId: 5 });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.archetypeId).toBe(5);
	});

	it('accepts limit at min boundary (1)', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', limit: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts limit at max boundary (500)', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', limit: 500 });
		expect(result.success).toBe(true);
	});

	it('coerces string limit to number', () => {
		const result = metagameCardsQuerySchema.safeParse({ scope: 'all', limit: '25' });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.limit).toBe(25);
	});
});

// ──────────────── metagameParamsSchema ────────────────

describe('metagameParamsSchema', () => {
	it('coerces string id to number', () => {
		const result = metagameParamsSchema.safeParse({ id: '1' });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.id).toBe(1);
	});

	it('accepts numeric id', () => {
		const result = metagameParamsSchema.safeParse({ id: 10 });
		expect(result.success).toBe(true);
	});
});
