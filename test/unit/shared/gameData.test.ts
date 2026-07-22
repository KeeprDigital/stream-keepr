import { describe, expect, it } from 'vitest';
import { getMtgGameData, getOpGameData, getPlayerIdentityValue } from '~~/shared/utils/gameData';

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
		const data = { type: 'op' as const, leader: 'Luffy' };
		expect(getMtgGameData(data)).toEqual({ type: 'mtg', deckName: null, deckColors: null });
	});
});

describe('getOpGameData', () => {
	it('returns defaults for null', () => {
		expect(getOpGameData(null)).toEqual({ type: 'op', leader: null });
	});

	it('extracts op data when type is op', () => {
		const data = { type: 'op' as const, leader: 'Luffy' };
		expect(getOpGameData(data)).toEqual({ type: 'op', leader: 'Luffy' });
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
		expect(getPlayerIdentityValue('op', { type: 'op', leader: 'Luffy' })).toBe('Luffy');
	});
});
