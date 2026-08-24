import { describe, expect, it } from 'vitest';
import {
	inspectMeleeGameCompatibility,
	mapMeleeGame,
} from '~~/server/modules/melee-sync/gameCompatibility';

describe('melee game compatibility', () => {
	it.each([
		['Magic: The Gathering', 'mtg'],
		['Magic: The Gathering Arena', 'mtg'],
		['MTG', 'mtg'],
		// Melee's tournament API serializes the game as a PascalCase enum name
		// (observed live against melee.gg, 2026-08).
		['MagicTheGathering', 'mtg'],
		['One Piece Card Game', 'op'],
		['ONE PIECE TCG', 'op'],
		['OnePiece', 'op'],
	] as const)('maps the unambiguous Melee game %s', (sourceGame, expected) => {
		expect(mapMeleeGame(sourceGame)).toBe(expected);
	});

	it('leaves future or unknown source games unmapped', () => {
		expect(mapMeleeGame('Star Wars: Unlimited')).toBeNull();
	});

	it('distinguishes compatible, mismatched, and unknown source games', () => {
		expect(inspectMeleeGameCompatibility('mtg', 'Magic: The Gathering')).toEqual({
			status: 'compatible',
			meleeGame: 'mtg',
		});
		expect(inspectMeleeGameCompatibility('mtg', 'One Piece Card Game')).toEqual({
			status: 'mismatch',
			meleeGame: 'op',
		});
		expect(inspectMeleeGameCompatibility('mtg', 'Future Game')).toEqual({
			status: 'unknown',
			meleeGame: null,
		});
	});
});
