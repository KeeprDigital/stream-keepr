import { describe, expect, it } from 'vitest';
import {
	EVENT_PAGE_CARD_GAMES,
	EVERY_CARD_GAME,
	GAME_CONFIGS,
	getCounterTypeConfigs,
	getGameDefaults,
	getMetagameRules,
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

describe('the Event pages each Card Game is offered', () => {
	// A One Piece Card Game Event has Players and a TCG+ Import Sync (ADR-0074); what needs Rounds, Matches or Melee stays Magic's.
	it('keeps exactly the pages needing Rounds, Matches or Melee from a One Piece Event, and none from a Magic one', () => {
		const pages = Object.keys(EVENT_PAGE_CARD_GAMES) as (keyof typeof EVENT_PAGE_CARD_GAMES)[];

		expect(pages.filter(page => !isOfferedToCardGame(EVENT_PAGE_CARD_GAMES[page], 'op')))
			.toEqual([
				'matches',
				'eventStructure',
				'archetypeReview',
				'integrations',
			]);
		expect(pages.filter(page => !isOfferedToCardGame(EVENT_PAGE_CARD_GAMES[page], 'mtg'))).toEqual([]);
	});
});

describe('what each Card Game\'s Metagame reads', () => {
	// TCG+ exports Deck Lists but no standings, so an OP Metagame reads participation only (ADR-0074).
	it.each([
		[
			'mtg',
			[
				'all',
				'topN',
				'playerList',
				'minPoints',
			],
			true,
		],
		[
			'op',
			['all', 'playerList'],
			false,
		],
	] as const)('a %s Metagame offers the scopes %j, reading standings: %s', (game, scopes, readsStandings) => {
		expect(getMetagameRules(game)).toEqual({ scopes, readsStandings });
	});
});
