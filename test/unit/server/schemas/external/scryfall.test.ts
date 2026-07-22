import { describe, expect, it } from 'vitest';
import {
	scryfallCardSchema,
	scryfallCollectionResponseSchema,
} from '~~/server/schemas/external/scryfall';

// ── scryfallCardSchema ────────────────────────────────────────────────────────

describe('scryfallCardSchema', () => {
	const validCard = {
		id: 'f2a61a9f-6f33-44c9-be89-3c72a3e7c9e5',
		name: 'Lightning Bolt',
		set: 'lea',
		mana_cost: '{R}',
		cmc: 1,
		color_identity: ['R'],
		type_line: 'Instant',
	};

	it('accepts a valid card', () => {
		expect(scryfallCardSchema.parse(validCard)).toEqual(validCard);
	});

	it('passes through unknown fields (passthrough)', () => {
		const result = scryfallCardSchema.parse({ ...validCard, oracle_text: 'Deal 3 damage.' });
		expect(result).toHaveProperty('oracle_text', 'Deal 3 damage.');
	});

	it('accepts card without optional fields', () => {
		const minimal = { id: 'f2a61a9f-6f33-44c9-be89-3c72a3e7c9e5', name: 'Plains', set: 'lea' };
		expect(scryfallCardSchema.parse(minimal)).toEqual(minimal);
	});

	it('accepts double-faced card with card_faces', () => {
		const dfcCard = {
			...validCard,
			name: 'Delver of Secrets // Insectile Aberration',
			card_faces: [{ mana_cost: '{U}' }, { mana_cost: undefined }],
		};
		const result = scryfallCardSchema.parse(dfcCard);
		expect(result.name).toBe('Delver of Secrets // Insectile Aberration');
		expect(result.card_faces).toEqual([{ mana_cost: '{U}' }, { mana_cost: undefined }]);
	});

	it('accepts null cmc (tokens, emblems)', () => {
		expect(scryfallCardSchema.parse({ ...validCard, cmc: null }).cmc).toBeNull();
	});

	it('accepts null color_identity', () => {
		expect(scryfallCardSchema.parse({ ...validCard, color_identity: null }).color_identity).toBeNull();
	});

	it('accepts null type_line', () => {
		expect(scryfallCardSchema.parse({ ...validCard, type_line: null }).type_line).toBeNull();
	});

	it('accepts null mana_cost on a card face', () => {
		const dfcCard = {
			...validCard,
			card_faces: [{ mana_cost: '{U}' }, { mana_cost: null }],
		};
		expect(scryfallCardSchema.parse(dfcCard).card_faces?.[1]?.mana_cost).toBeNull();
	});
});

// ── scryfallCollectionResponseSchema ─────────────────────────────────────────

describe('scryfallCollectionResponseSchema', () => {
	const validResponse = {
		object: 'list' as const,
		not_found: [],
		data: [
			{
				id: 'f2a61a9f-6f33-44c9-be89-3c72a3e7c9e5',
				name: 'Lightning Bolt',
				set: 'lea',
			},
		],
	};

	it('accepts a valid collection response', () => {
		expect(scryfallCollectionResponseSchema.parse(validResponse)).toEqual(validResponse);
	});

	it('accepts empty data array', () => {
		expect(scryfallCollectionResponseSchema.parse({ ...validResponse, data: [] }).data).toEqual([]);
	});

	it('accepts not_found entries with extra fields (passthrough)', () => {
		const result = scryfallCollectionResponseSchema.parse({
			...validResponse,
			not_found: [{ name: 'Foo', set: 'bar' }],
		});
		expect(result.not_found[0]).toHaveProperty('set', 'bar');
	});

	it('passes through extra top-level fields', () => {
		const result = scryfallCollectionResponseSchema.parse({ ...validResponse, total_cards: 1 });
		expect(result).toHaveProperty('total_cards', 1);
	});
});
