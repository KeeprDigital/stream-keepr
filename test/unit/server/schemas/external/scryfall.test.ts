import { describe, expect, it } from 'vitest';
import { scryfallCardSchema } from '~~/server/schemas/external/scryfall';

describe('scryfallCardSchema', () => {
	const card = {
		id: 'f2a61a9f-6f33-44c9-be89-3c72a3e7c9e5',
		name: 'Lightning Bolt',
		set: 'lea',
		mana_cost: '{R}',
		cmc: 1,
		color_identity: ['R'],
		type_line: 'Instant',
	};

	it('preserves collector identity for exact-printing lookups', () => {
		expect(scryfallCardSchema.parse({ ...card, collector_number: '101★' }).collector_number).toBe('101★');
	});

	it.each([
		[
			'no optional fields (a basic land)',
			{ id: card.id, name: 'Plains', set: 'lea' },
		],
		[
			'null cmc (tokens, emblems)',
			{ ...card, cmc: null },
		],
		[
			'null color_identity',
			{ ...card, color_identity: null },
		],
		[
			'null type_line',
			{ ...card, type_line: null },
		],
		[
			'a card face with null or missing mana_cost',
			{
				...card,
				card_faces: [
					{ mana_cost: '{U}' },
					{ mana_cost: null },
					{},
				],
			},
		],
	])('accepts what Scryfall sends for %s', (_case, upstream) => {
		expect(scryfallCardSchema.parse(upstream)).toEqual(upstream);
	});
});
