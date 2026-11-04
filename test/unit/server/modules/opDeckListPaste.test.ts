import type { OpCatalogueCard } from '~~/shared/types/card/op';
import type { OpDeckListEntry } from '~~/shared/types/opDeckList';
import { describe, expect, it } from 'vitest';
import { opDeckListText, opDeckListView, parseOpDeckListText } from '~~/server/modules/op-deck-list-write/paste';

describe('parseOpDeckListText', () => {
	it.each([
		[
			'N CARDNUMBER',
			'4 OP01-016',
			[
				{ number: 'OP01-016', quantity: 4 },
			],
		],
		[
			'Nx CARDNUMBER',
			'4x OP01-016',
			[
				{ number: 'OP01-016', quantity: 4 },
			],
		],
		[
			'NX with no space',
			'4XOP01-016',
			[
				{ number: 'OP01-016', quantity: 4 },
			],
		],
		[
			'N x CARDNUMBER',
			'4 x OP01-016',
			[
				{ number: 'OP01-016', quantity: 4 },
			],
		],
		[
			'a trailing name',
			'4x OP01-016 Nami',
			[
				{ number: 'OP01-016', quantity: 4 },
			],
		],
		[
			'a lower-case number',
			'2x st10-016',
			[
				{ number: 'ST10-016', quantity: 2 },
			],
		],
		[
			'a promo number',
			'1x P-001',
			[
				{ number: 'P-001', quantity: 1 },
			],
		],
		[
			'a Printing id',
			'1xOP01-001_p1',
			[
				{ number: 'OP01-001', quantity: 1 },
			],
		],
		[
			'surrounding whitespace',
			'\t 3x  OP02-004  Edward.Newgate ',
			[
				{ number: 'OP02-004', quantity: 3 },
			],
		],
		[
			'Windows line endings',
			'1x OP01-001\r\n4x OP01-016\r\n',
			[
				{ number: 'OP01-001', quantity: 1 },
				{ number: 'OP01-016', quantity: 4 },
			],
		],
	])('reads %s', (_label, text, expected) => {
		expect(parseOpDeckListText(text)).toEqual(expected);
	});

	it.each([
		['blank lines', '\n   \n'],
		['headings', 'Leader\nCharacters (40)\n// Events\nDeck:'],
		['a line with no card number', '4x Nami'],
		['a zero quantity', '0x OP01-016'],
		['a card number with no quantity', 'OP01-016'],
	])('ignores %s', (_label, text) => {
		expect(parseOpDeckListText(text)).toEqual([]);
	});

	it('keeps paste order and adds a number pasted twice into its first line', () => {
		expect(parseOpDeckListText([
			'Leader',
			'1x OP01-001 Roronoa Zoro',
			'',
			'Characters',
			'2x OP01-016',
			'4x OP01-025',
			'2x OP01-016 Nami',
		].join('\n'))).toEqual([
			{ number: 'OP01-001', quantity: 1 },
			{ number: 'OP01-016', quantity: 4 },
			{ number: 'OP01-025', quantity: 4 },
		]);
	});
});

function card(category: OpCatalogueCard['category'], colors: OpCatalogueCard['colors']): OpCatalogueCard {
	return {
		name: 'Card',
		category,
		colors,
		cost: 1,
		power: 1000,
		counter: null,
		imageUrl: 'https://cards-img.keepr.digital/X.png',
	};
}
function leader(number: string, colors: OpCatalogueCard['colors'] = ['Red']): OpDeckListEntry {
	return {
		number,
		quantity: 1,
		card: card('leader', colors),
	};
}
function character(number: string, quantity: number, colors: OpCatalogueCard['colors'] = ['Red']): OpDeckListEntry {
	return {
		number,
		quantity,
		card: card('character', colors),
	};
}
const unknown = (number: string, quantity: number): OpDeckListEntry => ({ number, quantity, card: null });

/** A legal Red deck: one Leader and 50 Mainboard cards, four copies at most. */
function legalDeck(): OpDeckListEntry[] {
	return [
		leader('OP01-001'),
		...Array.from({ length: 12 }, (_, index) => character(`OP01-${String(100 + index)}`, 4)),
		character('OP01-200', 2),
	];
}

describe('opDeckListView', () => {
	it('names the Leader, counts the Mainboard without it, and warns of nothing in a legal deck', () => {
		expect(opDeckListView(legalDeck())).toMatchObject({
			leaderNumber: 'OP01-001',
			mainboardCount: 50,
			warnings: [],
		});
	});

	it.each([
		[
			'49 Mainboard cards',
			[
				leader('OP01-001'),
				character('OP01-100', 4),
				...Array.from({ length: 45 }, (_, index) => character(`OP02-${String(100 + index)}`, 1)),
			],
			'MAINBOARD_COUNT',
			{ count: 49 },
		],
		[
			'51 Mainboard cards',
			[
				...legalDeck(),
				character('OP01-300', 1),
			],
			'MAINBOARD_COUNT',
			{ count: 51 },
		],
		[
			'five copies of a number',
			[
				leader('OP01-001'),
				character('OP01-100', 5),
				...Array.from({ length: 45 }, (_, index) => character(`OP02-${String(100 + index)}`, 1)),
			],
			'TOO_MANY_COPIES',
			{ number: 'OP01-100', quantity: 5 },
		],
		[
			'no Leader',
			legalDeck().slice(1),
			'NO_LEADER',
			{},
		],
		[
			'two Leaders',
			[
				leader('OP01-002'),
				...legalDeck(),
			],
			'MULTIPLE_LEADERS',
			{
				numbers: ['OP01-002', 'OP01-001'],
			},
		],
		[
			'a card off the Leader\'s colours',
			[
				...legalDeck().slice(0, -1),
				character('OP01-200', 1),
				character('OP01-201', 1, ['Blue']),
			],
			'OFF_COLOR',
			{
				numbers: ['OP01-201'],
			},
		],
		[
			'a number bandai-keepr does not know',
			[
				...legalDeck().slice(0, -1),
				character('OP01-200', 1),
				unknown('OP99-999', 1),
			],
			'UNKNOWN_CARD',
			{
				numbers: ['OP99-999'],
			},
		],
	] as const)('warns of %s', (_label, entries, code, fields) => {
		const { warnings } = opDeckListView([...entries]);
		expect(warnings.map(warning => warning.code)).toEqual([code]);
		expect(warnings[0]).toMatchObject(fields);
	});

	it.each([
		[
			'shares one colour of a dual-colour Leader',
			['Red', 'Green'],
			['Green'],
		],
		[
			'is dual-colour and shares one colour',
			['Red'],
			['Red', 'Blue'],
		],
	] as const)('lets a card that %s stay on colour', (_label, leaderColors, cardColors) => {
		const deck = legalDeck();
		deck[0] = leader('OP01-001', [...leaderColors]);
		deck[1] = character('OP01-100', 4, [...cardColors]);
		const recoloured = deck.map(entry => entry.card?.category === 'character' && entry !== deck[1]
			? {
					...entry,
					card: {
						...entry.card,
						colors: [...leaderColors],
					},
				}
			: entry);
		expect(opDeckListView(recoloured).warnings).toEqual([]);
	});

	it('counts a number-only entry in the Mainboard', () => {
		const deck = [
			...legalDeck().slice(0, -1),
			unknown('OP99-999', 2),
		];
		expect(opDeckListView(deck)).toMatchObject({ mainboardCount: 50 });
	});

	it('judges colours against the first Leader when there are two', () => {
		const deck = [
			leader('OP01-001', ['Red']),
			leader('OP01-002', ['Blue']),
			...legalDeck().slice(1),
		];
		const { warnings, leaderNumber } = opDeckListView(deck);
		expect(leaderNumber).toBe('OP01-001');
		expect(warnings.map(warning => warning.code)).toEqual(['MULTIPLE_LEADERS']);
	});
});

// A TCG+ export or a Leader picker marks the Leader, which may be an Unresolved Deck Card.
describe('opDeckListView with a marked Leader', () => {
	it.each([
		[
			'a known Leader',
			legalDeck(),
			'OP01-001',
			{ leaderNumber: 'OP01-001', mainboardCount: 50 },
			[],
		],
		[
			'a number the catalogue lacks, against which no colour is judged',
			[
				unknown('OP99-001', 1),
				...legalDeck().slice(1, -1),
				character('OP01-201', 2, ['Blue']),
			],
			'OP99-001',
			{ leaderNumber: 'OP99-001', mainboardCount: 50 },
			['UNKNOWN_CARD'],
		],
		[
			'a Leader beside another leader card, which it wins over',
			[
				leader('OP01-002'),
				...legalDeck(),
			],
			'OP01-001',
			{ leaderNumber: 'OP01-001', mainboardCount: 50 },
			['MULTIPLE_LEADERS'],
		],
	] as const)('takes %s', (_label, entries, marked, view, codes) => {
		const answer = opDeckListView([...entries], marked);
		expect(answer).toMatchObject(view);
		expect(answer.warnings.map(warning => warning.code)).toEqual(codes);
	});
});

describe('opDeckListText', () => {
	it('writes the paste format, Leader first, which reads back as the same entries', () => {
		const text = opDeckListText([
			character('OP01-100', 4),
			unknown('OP99-999', 2),
			leader('OP01-001'),
		], 'OP01-001');

		expect(text).toBe('1x OP01-001 Card\n4x OP01-100 Card\n2x OP99-999');
		expect(parseOpDeckListText(text)).toEqual([
			{ number: 'OP01-001', quantity: 1 },
			{ number: 'OP01-100', quantity: 4 },
			{ number: 'OP99-999', quantity: 2 },
		]);
	});
});
