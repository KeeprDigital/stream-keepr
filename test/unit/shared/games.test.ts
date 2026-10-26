import { describe, expect, it } from 'vitest';
import {
	GAME_CONFIGS,
	getCounterTypeConfigs,
	getGameDefaults,
	getPlayerIdentityLabel,
	getStartingHandSize,
	getStartingTurnNumber,
} from '~~/shared/config/games';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';

describe('game config lookups', () => {
	it('hands out a copy of a game\'s defaults, so editing it leaves the config alone', () => {
		const defaults = getGameDefaults('mtg');
		defaults.startingLife = 1;

		expect(GAME_CONFIGS.mtg.defaults.startingLife).not.toBe(1);
	});

	it('falls back to neutral values for a game with no config', () => {
		const unknown = 'retired' as never;

		expect(getGameDefaults(unknown)).toEqual(DEFAULT_FEATURE_MATCH_DEFAULTS);
		expect(getCounterTypeConfigs(unknown)).toEqual([]);
		expect(getStartingTurnNumber(unknown)).toBe(0);
		expect(getStartingHandSize(unknown)).toBe(0);
		expect(getPlayerIdentityLabel(unknown)).toBe('Deck');
	});
});
