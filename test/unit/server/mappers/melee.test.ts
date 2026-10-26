import { describe, expect, it } from 'vitest';
import {
	normalizeMeleePlayerName,
	parseDeckListCompanion,
	parseDeckListRecords,
} from '~~/server/mappers/melee';

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
			{
				l: 'en',
				n: 'Lightning Bolt',
				s: 'STA',
				q: 4,
				c: 0,
				t: 'Instant',
			},
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
			{
				l: 'en',
				n: 'Negate',
				s: null,
				q: 2,
				c: 99,
				t: 'Instant',
			},
		];
		const result = parseDeckListRecords(records);

		expect(result[0]!.compartment).toBe('sideboard');
	});

	it('excludes companion records from normal deck cards', () => {
		const records = [
			{
				l: 'lutri',
				n: 'Lutri, the Spellchaser',
				s: null,
				q: 1,
				c: 4,
				t: 'Creature',
			},
			{
				l: 'bolt',
				n: 'Lightning Bolt',
				s: null,
				q: 1,
				c: 0,
				t: 'Instant',
			},
		];

		const result = parseDeckListRecords(records);

		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe('Lightning Bolt');
	});

	it('maps compartment 0 to mainboard', () => {
		const records = [
			{
				l: 'en',
				n: 'Counterspell',
				s: null,
				q: 4,
				c: 0,
				t: 'Instant',
			},
		];
		const result = parseDeckListRecords(records);

		expect(result[0]!.compartment).toBe('mainboard');
	});

	it('sets scryfallId to null for all cards', () => {
		const records = [
			{
				l: 'en',
				n: 'Opt',
				s: 'STA',
				q: 4,
				c: 0,
				t: 'Instant',
			},
		];
		const result = parseDeckListRecords(records);

		expect(result[0]!.scryfallId).toBeNull();
	});

	it('sorts cards by type then name', () => {
		const records = [
			{
				l: 'en',
				n: 'Wrath of God',
				s: null,
				q: 2,
				c: 0,
				t: 'Sorcery',
			},
			{
				l: 'en',
				n: 'Adanto Vanguard',
				s: null,
				q: 4,
				c: 0,
				t: 'Creature',
			},
			{
				l: 'en',
				n: 'Llanowar Elves',
				s: null,
				q: 4,
				c: 0,
				t: 'Creature',
			},
			{
				l: 'en',
				n: 'Lightning Bolt',
				s: null,
				q: 4,
				c: 0,
				t: 'Instant',
			},
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
			{
				l: 'en',
				n: 'Forest',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Plains',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Mountain',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Island',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Swamp',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Lightning Bolt',
				s: null,
				q: 4,
				c: 0,
				t: 'Instant',
			},
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
			{
				l: 'en',
				n: 'Plains',
				s: null,
				q: 4,
				c: 0,
				t: 'Basic Land',
			},
			{
				l: 'en',
				n: 'Breeding Pool',
				s: null,
				q: 2,
				c: 0,
				t: 'Land',
			},
			{
				l: 'en',
				n: 'Sol Ring',
				s: null,
				q: 1,
				c: 0,
				t: 'Artifact',
			},
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
			{
				l: 'en',
				n: 'Dark Ritual',
				s: null,
				q: 4,
				c: 0,
				t: 'Instant',
			},
		];
		const result = parseDeckListRecords(records);

		expect(result[0]!.setCode).toBeNull();
	});
});

describe('parseDeckListCompanion', () => {
	it('maps compartment 4 to a companion entry', () => {
		const result = parseDeckListCompanion([
			{
				l: 'lutri',
				n: 'Lutri, the Spellchaser',
				s: null,
				q: 1,
				c: 4,
				t: 'Creature',
			},
		]);

		expect(result).toEqual({
			name: 'Lutri, the Spellchaser',
			setCode: null,
			cardType: 'Creature',
			scryfallId: null,
		});
	});
});
