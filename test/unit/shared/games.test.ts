import { describe, expect, it } from 'vitest';
import {
	GAME_CONFIGS,
	getCounterTypeConfigs,
	getGameConfig,
	getGameDefaults,
	getPlayerIdentityLabel,
	getStartingHandSize,
	getStartingTurnNumber,
} from '~~/shared/config/games';

describe('gAME_CONFIGS', () => {
	it('has config for mtg', () => {
		expect(GAME_CONFIGS.mtg).toBeDefined();
		expect(GAME_CONFIGS.mtg.label).toBe('Magic: The Gathering');
	});

	it('has config for op', () => {
		expect(GAME_CONFIGS.op).toBeDefined();
		expect(GAME_CONFIGS.op.label).toBe('One Piece');
	});

	it('mtg has default match settings', () => {
		expect(GAME_CONFIGS.mtg.defaults.bestOf).toBe(3);
		expect(GAME_CONFIGS.mtg.defaults.startingLife).toBe(20);
	});

	it('op has default match settings', () => {
		expect(GAME_CONFIGS.op.defaults.bestOf).toBe(1);
		expect(GAME_CONFIGS.op.defaults.startingLife).toBe(0);
	});

	it('mtg has counter types', () => {
		expect(GAME_CONFIGS.mtg.counterTypes.length).toBeGreaterThan(0);
	});

	it('op has no counter types', () => {
		expect(GAME_CONFIGS.op.counterTypes).toHaveLength(0);
	});
});

describe('getGameConfig', () => {
	it('returns mtg config', () => {
		expect(getGameConfig('mtg').label).toBe('Magic: The Gathering');
	});

	it('returns op config', () => {
		expect(getGameConfig('op').label).toBe('One Piece');
	});
});

describe('getGameDefaults', () => {
	it('returns defaults for mtg', () => {
		const defaults = getGameDefaults('mtg');
		expect(defaults.bestOf).toBe(3);
		expect(defaults.startingLife).toBe(20);
		expect(defaults.countUpAfterCountdown).toBe(true);
	});

	it('returns defaults for op', () => {
		const defaults = getGameDefaults('op');
		expect(defaults.bestOf).toBe(1);
		expect(defaults.startingLife).toBe(0);
	});
});

describe('getCounterTypeConfigs', () => {
	it('returns mtg counter types', () => {
		const counters = getCounterTypeConfigs('mtg');
		expect(counters.length).toBeGreaterThan(0);
		const keys = counters.map(c => c.key);
		expect(keys).toContain('poison');
		expect(keys).toContain('energy');
	});

	it('returns empty array for op', () => {
		expect(getCounterTypeConfigs('op')).toEqual([]);
	});
});

describe('getStartingTurnNumber', () => {
	it('returns 0 for mtg', () => {
		expect(getStartingTurnNumber('mtg')).toBe(0);
	});

	it('returns 1 for op', () => {
		expect(getStartingTurnNumber('op')).toBe(1);
	});
});

describe('getStartingHandSize', () => {
	it('returns 7 for mtg', () => {
		expect(getStartingHandSize('mtg')).toBe(7);
	});

	it('returns 0 for op', () => {
		expect(getStartingHandSize('op')).toBe(0);
	});
});

describe('getPlayerIdentityLabel', () => {
	it('returns Deck for mtg', () => {
		expect(getPlayerIdentityLabel('mtg')).toBe('Deck');
	});

	it('returns Leader for op', () => {
		expect(getPlayerIdentityLabel('op')).toBe('Leader');
	});
});
