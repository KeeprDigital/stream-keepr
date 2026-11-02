import { describe, expect, it } from 'vitest';
import {
	EVERY_CARD_GAME,
	GAME_CONFIGS,
	getCounterTypeConfigs,
	getGameDefaults,
	getPlayerIdentityLabel,
	getStartingHandSize,
	getStartingTurnNumber,
	isOfferedToCardGame,
	MTG_ONLY,
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

describe('card Game support', () => {
	// Before the Event's Card Game is known, only what every Card Game supports is offered.
	it.each([
		[MTG_ONLY, 'mtg', true],
		[MTG_ONLY, 'op', false],
		[MTG_ONLY, undefined, false],
		[EVERY_CARD_GAME, 'op', true],
		[EVERY_CARD_GAME, undefined, true],
	] as const)('offers what declares %j to a %s Event: %s', (cardGames, game, offered) => {
		expect(isOfferedToCardGame(cardGames, game)).toBe(offered);
	});
});
