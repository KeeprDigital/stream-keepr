import { describe, expect, it } from 'vitest';
import {
	metagameArchetypesQuerySchema,
	metagameCardsQuerySchema,
	metagameQuerySchema,
} from '~~/server/schemas/api/metagame';

describe.each([
	['metagameQuerySchema', metagameQuerySchema],
	['metagameArchetypesQuerySchema', metagameArchetypesQuerySchema],
	['metagameCardsQuerySchema', metagameCardsQuerySchema],
] as const)('%s scope', (_name, schema) => {
	it('defaults to the whole Event', () => {
		expect(schema.parse({}).scope).toBe('all');
	});

	it.each([
		[
			'topN',
			{ topN: 8 },
		],
		[
			'playerList',
			{ playerListId: 42 },
		],
		[
			'minPoints',
			{ minPoints: 9 },
		],
	])('requires %s to name its parameter', (scope, parameter) => {
		expect(schema.safeParse({ scope, ...parameter }).success).toBe(true);
		expect(schema.safeParse({ scope }).success).toBe(false);
	});

	it.each([
		['topN', 1, 500],
		['minPoints', 0, 999],
	])('bounds %s to %i..%i', (scope, min, max) => {
		expect(schema.safeParse({ scope, [scope]: min }).success).toBe(true);
		expect(schema.safeParse({ scope, [scope]: max }).success).toBe(true);
		expect(schema.safeParse({ scope, [scope]: min - 1 }).success).toBe(false);
		expect(schema.safeParse({ scope, [scope]: max + 1 }).success).toBe(false);
	});
});

describe('metagameArchetypesQuerySchema', () => {
	it('defaults to Meta Share order with no conversion target or limit', () => {
		expect(metagameArchetypesQuerySchema.parse({ scope: 'all' })).toEqual({ scope: 'all', sortBy: 'metaShare' });
	});

	it.each([
		[
			'a topN target',
			{ conversionMetric: 'topN', conversionThreshold: '8' },
			true,
		],
		[
			'a minPoints target',
			{ conversionMetric: 'minPoints', conversionThreshold: 0 },
			true,
		],
		[
			'the maximum threshold',
			{ conversionMetric: 'topN', conversionThreshold: 999 },
			true,
		],
		[
			'a threshold above the maximum',
			{ conversionMetric: 'topN', conversionThreshold: 1000 },
			false,
		],
		[
			'a metric without a threshold',
			{ conversionMetric: 'topN' },
			false,
		],
		[
			'a threshold without a metric',
			{ conversionThreshold: 8 },
			false,
		],
		[
			'an unknown metric',
			{ conversionMetric: 'wins', conversionThreshold: 3 },
			false,
		],
	])('takes a conversion target of %s → %s', (_case, target, accepted) => {
		expect(metagameArchetypesQuerySchema.safeParse({ scope: 'all', ...target }).success).toBe(accepted);
	});
});

describe.each([
	['metagameArchetypesQuerySchema', metagameArchetypesQuerySchema],
	['metagameCardsQuerySchema', metagameCardsQuerySchema],
] as const)('%s limit', (_name, schema) => {
	it('bounds the limit to 1..500', () => {
		expect(schema.safeParse({ scope: 'all', limit: 1 }).success).toBe(true);
		expect(schema.safeParse({ scope: 'all', limit: 500 }).success).toBe(true);
		expect(schema.safeParse({ scope: 'all', limit: 0 }).success).toBe(false);
		expect(schema.safeParse({ scope: 'all', limit: 501 }).success).toBe(false);
	});
});

describe('metagameCardsQuerySchema', () => {
	it('defaults to Inclusion Rate order, 50 cards, the full Deck List and no excluded types', () => {
		expect(metagameCardsQuerySchema.parse({ scope: 'all' })).toEqual({
			scope: 'all',
			sortBy: 'inclusionRate',
			limit: 50,
			board: 'full',
		});
	});

	it('refuses the retired board value both', () => {
		expect(metagameCardsQuerySchema.safeParse({ scope: 'all', board: 'both' }).success).toBe(false);
	});

	it('parses comma-separated excludeTypes into card-type buckets', () => {
		expect(metagameCardsQuerySchema.parse({ scope: 'all', excludeTypes: 'Land,Other' }).excludeTypes).toEqual(['Land', 'Other']);
	});

	it.each(['Land,Tribal', ''])('refuses excludeTypes %j', (excludeTypes) => {
		expect(metagameCardsQuerySchema.safeParse({ scope: 'all', excludeTypes }).success).toBe(false);
	});

	it.each([
		['true', true],
		['false', false],
	])('reads pointedOnly %j as %j', (pointedOnly, expected) => {
		expect(metagameCardsQuerySchema.parse({ scope: 'all', pointedOnly }).pointedOnly).toBe(expected);
	});

	it.each(['yes', '1', ''])('refuses pointedOnly %j', (pointedOnly) => {
		expect(metagameCardsQuerySchema.safeParse({ scope: 'all', pointedOnly }).success).toBe(false);
	});
});
