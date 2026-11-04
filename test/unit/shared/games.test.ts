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
	SCREEN_MODE_CARD_GAMES,
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
	// A One Piece Card Game Event has Players (ADR-0074); what needs Rounds, Matches or Melee stays Magic's.
	it.each([
		['players', true],
		['matches', false],
		['eventStructure', false],
		['sync', false],
		['metagame', true],
		['archetypeReview', false],
		['cards', true],
		['integrations', false],
	] as const)('offers %s to a One Piece Event: %s', (page, offered) => {
		expect(isOfferedToCardGame(EVENT_PAGE_CARD_GAMES[page], 'op')).toBe(offered);
		expect(isOfferedToCardGame(EVENT_PAGE_CARD_GAMES[page], 'mtg')).toBe(true);
	});
});

describe('the Screen Modes each Card Game is offered', () => {
	// A One Piece Card Game Event's Metagame reads participation only (ADR-0074); what needs results stays Magic's.
	it.each([
		['background', true],
		['card', true],
		['deck', true],
		['standings', false],
		['top-cut', false],
		['feature-match', true],
		['feature-match-overlay', true],
		['broadcast-graphics', true],
		['metagame', true],
		['top-cards', true],
		['player-history', false],
		['pairings', false],
		['archetype-spotlight', true],
		['head-to-head', false],
		['round-clock', false],
		['talent', true],
	] as const)('offers %s to a One Piece Event: %s', (mode, offered) => {
		expect(isOfferedToCardGame(SCREEN_MODE_CARD_GAMES[mode], 'op')).toBe(offered);
		expect(isOfferedToCardGame(SCREEN_MODE_CARD_GAMES[mode], 'mtg')).toBe(true);
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
