import { describe, expect, it } from 'vitest';
import { getMtgGameData, getOpGameData, getPlayerIdentityValue, resolvePlayerDeckIdentity } from '~~/shared/utils/gameData';
import { LUFFY as luffy } from '~~/test/helpers/opCards';

describe('getMtgGameData', () => {
	it('returns defaults for null', () => {
		expect(getMtgGameData(null)).toEqual({ type: 'mtg', deckName: null, deckColors: null });
	});

	it('returns defaults for undefined', () => {
		expect(getMtgGameData(undefined)).toEqual({ type: 'mtg', deckName: null, deckColors: null });
	});

	it('extracts mtg data when type is mtg', () => {
		const data = { type: 'mtg' as const, deckName: 'Burn', deckColors: 'R' };
		expect(getMtgGameData(data)).toEqual({ type: 'mtg', deckName: 'Burn', deckColors: 'R' });
	});

	it('returns defaults when type is op (wrong game)', () => {
		const data = { type: 'op' as const, leader: luffy };
		expect(getMtgGameData(data)).toEqual({ type: 'mtg', deckName: null, deckColors: null });
	});
});

type OpGameDataInput = Parameters<typeof getOpGameData>[0];

describe('getOpGameData', () => {
	it('returns defaults for null', () => {
		expect(getOpGameData(null)).toEqual({ type: 'op', leader: null });
	});

	it('extracts op data when type is op', () => {
		const data = { type: 'op' as const, leader: luffy };
		expect(getOpGameData(data)).toEqual({ type: 'op', leader: luffy });
	});

	// Free text typed before the Leader picker names no card, so it reads as no Leader.
	it('reads a free-text Leader stored before the picker as none', () => {
		const legacy = { type: 'op', leader: 'Luffy' } as unknown as OpGameDataInput;
		expect(getOpGameData(legacy)).toEqual({ type: 'op', leader: null });
	});

	it('returns defaults when type is mtg (wrong game)', () => {
		const data = { type: 'mtg' as const, deckName: 'Burn', deckColors: 'R' };
		expect(getOpGameData(data)).toEqual({ type: 'op', leader: null });
	});
});

describe('getPlayerIdentityValue', () => {
	it('returns null for null gameData', () => {
		expect(getPlayerIdentityValue('mtg', null)).toBeNull();
	});

	it('returns deckName for mtg game data with discriminator', () => {
		expect(getPlayerIdentityValue('mtg', { type: 'mtg', deckName: 'Burn', deckColors: 'R' })).toBe('Burn');
	});

	it('returns leader for op game data with discriminator', () => {
		expect(getPlayerIdentityValue('op', { type: 'op', leader: luffy })).toBe('Monkey.D.Luffy');
	});
});

describe('resolvePlayerDeckIdentity', () => {
	it('names the Player\'s Archetype with its colours', () => {
		expect(resolvePlayerDeckIdentity({ name: 'Grixis Control', colors: 'UBR' }, { type: 'mtg', deckName: 'Imported', deckColors: 'G' }))
			.toEqual({ name: 'Grixis Control', colors: 'UBR' });
	});

	it('falls back to the Player\'s deck name without an Archetype', () => {
		expect(resolvePlayerDeckIdentity(null, { type: 'mtg', deckName: 'Mono-Red Aggro', deckColors: 'R' }))
			.toEqual({ name: 'Mono-Red Aggro', colors: 'R' });
	});

	it('is blank when the Player has neither', () => {
		expect(resolvePlayerDeckIdentity(null, null)).toEqual({ name: null, colors: null });
	});
});
