import type { DeckListCard } from '~~/shared/types/deckList';

import { describe, expect, it } from 'vitest';
import {
	normalizeMeleePlayerName,
	parseDeckListCompanion,
	parseDeckListRecords,
} from '~~/server/mappers/melee';
import { calculateDeckPips, calculateDeckStats } from '~~/shared/utils/deckStats';

// ──────────────── Helpers ────────────────

function createDeckListCard(overrides: Partial<DeckListCard> & { name: string; cardType: string }): DeckListCard {
	return {
		setCode: null,
		quantity: 1,
		compartment: 'mainboard',
		scryfallId: null,
		...overrides,
	};
}

// ──────────────── normalizeMeleePlayerName ────────────────

describe('normalizeMeleePlayerName', () => {
	it('trims and collapses whitespace', () => {
		expect(normalizeMeleePlayerName('  Test   Player  ')).toBe('Test Player');
	});

	it('title cases all-uppercase and all-lowercase names', () => {
		expect(normalizeMeleePlayerName('TEST PLAYER')).toBe('Test Player');
		expect(normalizeMeleePlayerName('test player')).toBe('Test Player');
	});

	it('handles common name separators', () => {
		expect(normalizeMeleePlayerName('O\'BRIEN-SMITH')).toBe('O\'Brien-Smith');
	});

	it('preserves intentional mixed casing', () => {
		expect(normalizeMeleePlayerName('McDonald')).toBe('McDonald');
		expect(normalizeMeleePlayerName('JOSH mtg')).toBe('JOSH mtg');
	});
});

// ──────────────── parseDeckListRecords ────────────────

describe('parseDeckListRecords', () => {
	it('returns an empty array for undefined input', () => {
		expect(parseDeckListRecords(undefined)).toEqual([]);
	});

	it('returns an empty array for an empty array', () => {
		expect(parseDeckListRecords([])).toEqual([]);
	});

	it('maps record fields to DeckListCard format', () => {
		const records = [
			{ l: 'en', n: 'Lightning Bolt', s: 'STA', q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: 'Lightning Bolt',
			setCode: 'STA',
			quantity: 4,
			compartment: 'mainboard',
			cardType: 'Instant',
			scryfallId: null,
		});
	});

	it('maps compartment 99 to sideboard', () => {
		const records = [
			{ l: 'en', n: 'Negate', s: null, q: 2, c: 99, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result[0].compartment).toBe('sideboard');
	});

	it('excludes companion records from normal deck cards', () => {
		const records = [
			{ l: 'lutri', n: 'Lutri, the Spellchaser', s: null, q: 1, c: 4, t: 'Creature' },
			{ l: 'bolt', n: 'Lightning Bolt', s: null, q: 1, c: 0, t: 'Instant' },
		];

		const result = parseDeckListRecords(records);

		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe('Lightning Bolt');
	});

	it('maps compartment 0 to mainboard', () => {
		const records = [
			{ l: 'en', n: 'Counterspell', s: null, q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result[0].compartment).toBe('mainboard');
	});

	it('sets scryfallId to null for all cards', () => {
		const records = [
			{ l: 'en', n: 'Opt', s: 'STA', q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result[0].scryfallId).toBeNull();
	});

	it('sorts cards by type then name', () => {
		const records = [
			{ l: 'en', n: 'Wrath of God', s: null, q: 2, c: 0, t: 'Sorcery' },
			{ l: 'en', n: 'Adanto Vanguard', s: null, q: 4, c: 0, t: 'Creature' },
			{ l: 'en', n: 'Llanowar Elves', s: null, q: 4, c: 0, t: 'Creature' },
			{ l: 'en', n: 'Lightning Bolt', s: null, q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result.map(c => c.name)).toEqual([
			'Adanto Vanguard', // Creature (1)
			'Llanowar Elves', // Creature (1)
			'Lightning Bolt', // Instant (4)
			'Wrath of God', // Sorcery (5)
		]);
	});

	it('sorts basic lands last in WUBRG order', () => {
		const records = [
			{ l: 'en', n: 'Forest', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Plains', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Mountain', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Island', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Swamp', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Lightning Bolt', s: null, q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result.map(c => c.name)).toEqual([
			'Lightning Bolt', // Non-land card first
			'Plains', // W
			'Island', // U
			'Swamp', // B
			'Mountain', // R
			'Forest', // G
		]);
	});

	it('sorts basic lands after all non-basic-land types', () => {
		const records = [
			{ l: 'en', n: 'Plains', s: null, q: 4, c: 0, t: 'Basic Land' },
			{ l: 'en', n: 'Breeding Pool', s: null, q: 2, c: 0, t: 'Land' },
			{ l: 'en', n: 'Sol Ring', s: null, q: 1, c: 0, t: 'Artifact' },
		];
		const result = parseDeckListRecords(records);

		expect(result.map(c => c.name)).toEqual([
			'Sol Ring', // Artifact (6)
			'Breeding Pool', // Land (8) - not a basic land
			'Plains', // Basic land - always last
		]);
	});

	it('handles null setCode values', () => {
		const records = [
			{ l: 'en', n: 'Dark Ritual', s: null, q: 4, c: 0, t: 'Instant' },
		];
		const result = parseDeckListRecords(records);

		expect(result[0].setCode).toBeNull();
	});
});

describe('parseDeckListCompanion', () => {
	it('maps compartment 4 to a companion entry', () => {
		const result = parseDeckListCompanion([
			{ l: 'lutri', n: 'Lutri, the Spellchaser', s: null, q: 1, c: 4, t: 'Creature' },
		]);

		expect(result).toEqual({
			name: 'Lutri, the Spellchaser',
			setCode: null,
			cardType: 'Creature',
			scryfallId: null,
		});
	});
});

// ──────────────── calculateDeckStats ────────────────

describe('calculateDeckStats', () => {
	it('returns all zeros for an empty card array', () => {
		expect(calculateDeckStats([])).toEqual({
			creatures: 0,
			instants: 0,
			sorceries: 0,
			enchantments: 0,
			artifacts: 0,
			planeswalkers: 0,
			lands: 0,
			other: 0,
		});
	});

	it('counts creatures by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Grizzly Bears', cardType: 'Creature', quantity: 4 }),
			createDeckListCard({ name: 'Tarmogoyf', cardType: 'Creature', quantity: 3 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.creatures).toBe(7);
	});

	it('counts instants by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Lightning Bolt', cardType: 'Instant', quantity: 4 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.instants).toBe(4);
	});

	it('counts sorceries by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Wrath of God', cardType: 'Sorcery', quantity: 2 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.sorceries).toBe(2);
	});

	it('counts enchantments by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Sylvan Library', cardType: 'Enchantment', quantity: 1 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.enchantments).toBe(1);
	});

	it('counts artifacts by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Sol Ring', cardType: 'Artifact', quantity: 1 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.artifacts).toBe(1);
	});

	it('counts planeswalkers by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Jace, the Mind Sculptor', cardType: 'Planeswalker', quantity: 2 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.planeswalkers).toBe(2);
	});

	it('counts lands by quantity', () => {
		const cards = [
			createDeckListCard({ name: 'Breeding Pool', cardType: 'Land', quantity: 4 }),
		];
		const result = calculateDeckStats(cards);

		expect(result.lands).toBe(4);
	});

	it('counts unknown types as other', () => {
		const cards = [
			createDeckListCard({ name: 'Asmoranomardicadaistinaculdacar', cardType: 'Legendary Creature - Human Wizard', quantity: 1 }),
		];
		// 'Legendary Creature - Human Wizard' includes 'creature' so it should count as creature
		const result = calculateDeckStats(cards);
		expect(result.creatures).toBe(1);
	});

	it('handles multi-type cards by matching first type in priority order', () => {
		// 'Artifact Creature' contains 'creature' first in the check order
		const cards = [
			createDeckListCard({ name: 'Walking Ballista', cardType: 'Artifact Creature', quantity: 3 }),
		];
		const result = calculateDeckStats(cards);

		// cardType.includes('creature') matches first
		expect(result.creatures).toBe(3);
		expect(result.artifacts).toBe(0);
	});

	it('only counts mainboard cards', () => {
		const cards = [
			createDeckListCard({ name: 'Lightning Bolt', cardType: 'Instant', quantity: 4, compartment: 'mainboard' }),
			createDeckListCard({ name: 'Negate', cardType: 'Instant', quantity: 2, compartment: 'sideboard' }),
		];
		const result = calculateDeckStats(cards);

		expect(result.instants).toBe(4);
	});

	it('counts a full deck correctly', () => {
		const cards = [
			createDeckListCard({ name: 'Ragavan', cardType: 'Creature', quantity: 4 }),
			createDeckListCard({ name: 'Bolt', cardType: 'Instant', quantity: 4 }),
			createDeckListCard({ name: 'Preordain', cardType: 'Sorcery', quantity: 4 }),
			createDeckListCard({ name: 'Mox Opal', cardType: 'Artifact', quantity: 4 }),
			createDeckListCard({ name: 'Blood Moon', cardType: 'Enchantment', quantity: 3 }),
			createDeckListCard({ name: 'Jace', cardType: 'Planeswalker', quantity: 2 }),
			createDeckListCard({ name: 'Mountain', cardType: 'Land', quantity: 18 }),
			createDeckListCard({ name: 'Teferi', cardType: 'Planeswalker', quantity: 1, compartment: 'sideboard' }),
		];
		const result = calculateDeckStats(cards);

		expect(result).toEqual({
			creatures: 4,
			instants: 4,
			sorceries: 4,
			artifacts: 4,
			enchantments: 3,
			planeswalkers: 2,
			lands: 18,
			other: 0,
		});
	});
});

// ──────────────── calculateDeckPips ────────────────
// manaCost is now a property on each card (stored in the DB after sync)

describe('calculateDeckPips', () => {
	it('returns all zeros for an empty card array', () => {
		const result = calculateDeckPips([]);

		expect(result).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
	});

	it('counts single-color mana pips', () => {
		const cards = [
			{ manaCost: '{R}', quantity: 4, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.R).toBe(4);
		expect(result.W).toBe(0);
	});

	it('counts multi-color mana pips', () => {
		const cards = [
			{ manaCost: '{W}{U}{U}', quantity: 2, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.W).toBe(2); // 1 W pip × 2 copies
		expect(result.U).toBe(4); // 2 U pips × 2 copies
	});

	it('ignores generic mana costs', () => {
		const cards = [
			{ manaCost: '{1}{U}', quantity: 4, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.U).toBe(4);
		expect(result.W).toBe(0);
		expect(result.B).toBe(0);
		expect(result.R).toBe(0);
		expect(result.G).toBe(0);
		expect(result.C).toBe(0);
	});

	it('handles hybrid mana by counting each color', () => {
		const cards = [
			{ manaCost: '{1}{G/W}{G/W}', quantity: 3, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.G).toBe(6); // 2 G pips × 3 copies
		expect(result.W).toBe(6); // 2 W pips × 3 copies
	});

	it('handles colorless mana symbol {C}', () => {
		const cards = [
			{ manaCost: '{3}{C}', quantity: 4, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.C).toBe(4);
	});

	it('only counts mainboard cards', () => {
		const cards = [
			{ manaCost: '{R}', quantity: 4, compartment: 'mainboard' as const },
			{ manaCost: '{R}', quantity: 2, compartment: 'sideboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.R).toBe(4); // Only mainboard
	});

	it('skips cards with null mana cost', () => {
		const cards = [
			{ manaCost: null, quantity: 1, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
	});

	it('skips cards with undefined mana cost', () => {
		const cards = [
			{ manaCost: undefined, quantity: 2, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(Object.values(result).every(v => v === 0)).toBe(true);
	});

	it('counts pips across multiple cards', () => {
		const cards = [
			{ manaCost: '{R}', quantity: 4, compartment: 'mainboard' as const },
			{ manaCost: '{W}{U}{U}', quantity: 3, compartment: 'mainboard' as const },
			{ manaCost: '{B}{G}', quantity: 2, compartment: 'mainboard' as const },
		];
		const result = calculateDeckPips(cards);

		expect(result.W).toBe(3); // 1×3
		expect(result.U).toBe(6); // 2×3
		expect(result.B).toBe(2); // 1×2
		expect(result.R).toBe(4); // 1×4
		expect(result.G).toBe(2); // 1×2
		expect(result.C).toBe(0);
	});
});
