import { describe, expect, it } from 'vitest';
import { calculateDeckCurve, calculateDeckPips, calculateDeckStats, CURVE_MAX_BUCKET } from '~~/shared/utils/deckStats';

// ── Helpers ──────────────────────────────────────────────────────────────────

function card(overrides: {
	compartment?: 'mainboard' | 'sideboard';
	cardType?: string | null;
	quantity?: number;
	manaCost?: string | null;
	cmc?: number | null;
}) {
	return {
		compartment: 'mainboard' as const,
		cardType: null,
		quantity: 1,
		manaCost: null,
		cmc: null,
		...overrides,
	};
}

// ── calculateDeckStats ────────────────────────────────────────────────────────

describe('calculateDeckStats', () => {
	it('returns all-zero stats for an empty array', () => {
		const stats = calculateDeckStats([]);
		expect(stats).toEqual({ creatures: 0, instants: 0, sorceries: 0, enchantments: 0, artifacts: 0, planeswalkers: 0, lands: 0, other: 0 });
	});

	it('counts creatures by quantity', () => {
		const stats = calculateDeckStats([card({ cardType: 'Creature — Elf', quantity: 4 })]);
		expect(stats.creatures).toBe(4);
		expect(stats.other).toBe(0);
	});

	it('counts each type correctly', () => {
		const cards = [
			card({ cardType: 'Creature — Human', quantity: 2 }),
			card({ cardType: 'Instant', quantity: 3 }),
			card({ cardType: 'Sorcery', quantity: 1 }),
			card({ cardType: 'Enchantment', quantity: 2 }),
			card({ cardType: 'Artifact', quantity: 1 }),
			card({ cardType: 'Planeswalker', quantity: 1 }),
			card({ cardType: 'Basic Land — Island', quantity: 4 }),
		];
		const stats = calculateDeckStats(cards);
		expect(stats.creatures).toBe(2);
		expect(stats.instants).toBe(3);
		expect(stats.sorceries).toBe(1);
		expect(stats.enchantments).toBe(2);
		expect(stats.artifacts).toBe(1);
		expect(stats.planeswalkers).toBe(1);
		expect(stats.lands).toBe(4);
		expect(stats.other).toBe(0);
	});

	it('skips sideboard cards', () => {
		const stats = calculateDeckStats([
			card({ cardType: 'Creature', quantity: 4 }),
			card({ cardType: 'Instant', quantity: 2, compartment: 'sideboard' }),
		]);
		expect(stats.creatures).toBe(4);
		expect(stats.instants).toBe(0);
	});

	it('falls through to "other" for unknown types', () => {
		const stats = calculateDeckStats([card({ cardType: 'Battle', quantity: 1 })]);
		expect(stats.other).toBe(1);
	});

	it('ignores cards with null cardType', () => {
		const stats = calculateDeckStats([card({ cardType: null, quantity: 2 })]);
		expect(Object.values(stats).every(v => v === 0)).toBe(true);
	});

	it('handles Artifact Creature as creature (first match wins)', () => {
		const stats = calculateDeckStats([card({ cardType: 'Artifact Creature — Robot', quantity: 1 })]);
		// "creature" appears before "artifact" in the chain, so it's counted as creature
		expect(stats.creatures).toBe(1);
		expect(stats.artifacts).toBe(0);
	});
});

// ── calculateDeckPips ─────────────────────────────────────────────────────────

describe('calculateDeckPips', () => {
	it('returns all-zero pips for an empty array', () => {
		expect(calculateDeckPips([])).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
	});

	it('counts simple colored pips', () => {
		const pips = calculateDeckPips([card({ manaCost: '{W}{W}{1}', quantity: 1 })]);
		expect(pips.W).toBe(2);
		expect(pips.U).toBe(0);
	});

	it('multiplies pips by card quantity', () => {
		const pips = calculateDeckPips([card({ manaCost: '{R}', quantity: 4 })]);
		expect(pips.R).toBe(4);
	});

	it('handles hybrid mana (W/U) — counts both parts', () => {
		const pips = calculateDeckPips([card({ manaCost: '{W/U}', quantity: 1 })]);
		expect(pips.W).toBe(1);
		expect(pips.U).toBe(1);
	});

	it('handles Phyrexian mana (W/P) — counts color part only', () => {
		const pips = calculateDeckPips([card({ manaCost: '{W/P}', quantity: 1 })]);
		expect(pips.W).toBe(1);
		expect(pips.C).toBe(0);
	});

	it('handles colorless {C} pips', () => {
		const pips = calculateDeckPips([card({ manaCost: '{C}{C}', quantity: 2 })]);
		expect(pips.C).toBe(4);
	});

	it('skips cards with no manaCost', () => {
		const pips = calculateDeckPips([card({ manaCost: null, quantity: 4 })]);
		expect(Object.values(pips).every(v => v === 0)).toBe(true);
	});

	it('skips sideboard cards', () => {
		const pips = calculateDeckPips([card({ manaCost: '{U}{U}', quantity: 4, compartment: 'sideboard' })]);
		expect(pips.U).toBe(0);
	});

	it('ignores generic mana costs like {1}, {2}, {X}', () => {
		const pips = calculateDeckPips([card({ manaCost: '{3}{U}', quantity: 1 })]);
		expect(pips.U).toBe(1);
		expect(pips.C).toBe(0);
	});

	it('accumulates pips across multiple cards', () => {
		const cards = [
			card({ manaCost: '{U}{U}', quantity: 4 }),
			card({ manaCost: '{1}{W}', quantity: 2 }),
		];
		const pips = calculateDeckPips(cards);
		expect(pips.U).toBe(8);
		expect(pips.W).toBe(2);
	});
});

// ── calculateDeckCurve ────────────────────────────────────────────────────────

describe('calculateDeckCurve', () => {
	it('returns empty object for empty array', () => {
		expect(calculateDeckCurve([])).toEqual({});
	});

	it('buckets cards by cmc', () => {
		const curve = calculateDeckCurve([
			card({ cmc: 1, quantity: 4 }),
			card({ cmc: 2, quantity: 3 }),
			card({ cmc: 3, quantity: 2 }),
		]);
		expect(curve[1]).toBe(4);
		expect(curve[2]).toBe(3);
		expect(curve[3]).toBe(2);
	});

	it(`buckets CMC >= ${CURVE_MAX_BUCKET} under key ${CURVE_MAX_BUCKET}`, () => {
		const curve = calculateDeckCurve([
			card({ cmc: CURVE_MAX_BUCKET, quantity: 1 }),
			card({ cmc: CURVE_MAX_BUCKET + 1, quantity: 2 }),
			card({ cmc: 12, quantity: 1 }),
		]);
		expect(curve[CURVE_MAX_BUCKET]).toBe(4);
	});

	it('accumulates multiple cards in the same bucket', () => {
		const curve = calculateDeckCurve([
			card({ cmc: 2, quantity: 2 }),
			card({ cmc: 2, quantity: 3 }),
		]);
		expect(curve[2]).toBe(5);
	});

	it('skips sideboard cards', () => {
		const curve = calculateDeckCurve([
			card({ cmc: 2, quantity: 4 }),
			card({ cmc: 1, quantity: 4, compartment: 'sideboard' }),
		]);
		expect(curve[2]).toBe(4);
		expect(curve[1]).toBeUndefined();
	});

	it('skips cards with null cmc', () => {
		const curve = calculateDeckCurve([
			card({ cmc: null, quantity: 24 }),
			card({ cmc: 2, quantity: 4 }),
		]);
		expect(Object.keys(curve)).toHaveLength(1);
		expect(curve[2]).toBe(4);
	});

	it('excludes lands from the curve while keeping MDFCs', () => {
		const curve = calculateDeckCurve([
			card({ cardType: 'Basic Land — Island', cmc: 0, quantity: 12 }),
			card({ cardType: 'Land', cmc: 0, quantity: 4 }),
			card({ cardType: 'Sorcery // Land', cmc: 3, quantity: 2 }),
			card({ cardType: 'Land // Land', cmc: 0, quantity: 1 }),
		]);
		expect(curve[0]).toBe(1);
		expect(curve[3]).toBe(2);
		expect(Object.keys(curve)).toHaveLength(2);
	});

	it('floors fractional cmc values', () => {
		// Split cards like Delver have cmc 0 on one face, computed differently by Scryfall
		const curve = calculateDeckCurve([card({ cmc: 1.5, quantity: 1 })]);
		expect(curve[1]).toBe(1);
	});
});
