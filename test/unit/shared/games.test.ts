import { describe, expect, it } from 'vitest';
import {
	EVENT_PAGE_OFFERED_TO,
	eventKind,
	EVENTS_WITH_PLAYERS,
	EVERY_EVENT,
	GAME_CONFIGS,
	getCounterTypeConfigs,
	getFeatureMatchStateTracking,
	getMatchFormatDefaults,
	getMetagameRules,
	getPlayerIdentityLabel,
	getStartingHandSize,
	getStartingTurnNumber,
	holdsBroadcastDeckLists,
	isOfferedToEvent,
	TWO_PLAYER_MAGIC_ONLY,
} from '~~/shared/config/games';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';

describe('game config lookups', () => {
	it('hands out a copy of a game\'s defaults, so editing it leaves the config alone', () => {
		const defaults = getMatchFormatDefaults('mtg-two-player');
		defaults.startingLife = 1;

		expect(GAME_CONFIGS.mtg.defaults.startingLife).not.toBe(1);
	});

	// A Commander game is one game at 40 life with no round clock (ADR-0087).
	it('seeds a Commander Event at 40 life, untimed, as a single game with no extra turns', () => {
		expect(getMatchFormatDefaults('mtg-commander')).toMatchObject({
			startingLife: 40,
			clockType: 'untimed',
			bestOf: 1,
			extraTurnsEnabled: false,
		});
	});

	it('falls back to neutral values for a game with no config', () => {
		const unknown = 'retired' as never;

		expect(getMatchFormatDefaults(unknown)).toEqual(DEFAULT_FEATURE_MATCH_DEFAULTS);
		expect(getCounterTypeConfigs(unknown)).toEqual([]);
		expect(getStartingTurnNumber(unknown)).toBe(0);
		expect(getStartingHandSize(unknown)).toBe(0);
		expect(getPlayerIdentityLabel(unknown)).toBe('Deck');
	});
});

describe('what each kind of Event tracks of Feature Match state', () => {
	// A Commander game has no extra turns and no Sideboard to reveal (ADR-0087).
	it('tracks what Magic does on a Commander Event, but for overtime and the Sideboard', () => {
		expect(getFeatureMatchStateTracking('mtg-commander')).toEqual({
			...getFeatureMatchStateTracking('mtg-two-player'),
			overtime: false,
			sideboard: false,
		});
	});
});

describe('the kind of Event', () => {
	// A Commander Event is a Magic: The Gathering Event of the Commander Variant (ADR-0087).
	it.each([
		['mtg', 'two-player', 'mtg-two-player'],
		['mtg', 'commander', 'mtg-commander'],
		['op', null, 'op'],
	] as const)('a %s Event of Variant %s is of kind %s', (game, variant, kind) => {
		expect(eventKind({ game, variant })).toBe(kind);
	});
});

// Only a Two-Player Magic: The Gathering Event holds Broadcast Deck Lists (ADR-0087).
describe('the Events that hold Broadcast Deck Lists', () => {
	it.each([
		['mtg', 'two-player', true],
		['mtg', 'commander', false],
		['op', null, false],
	] as const)('a %s Event of Variant %s holds them: %s', (game, variant, holds) => {
		expect(holdsBroadcastDeckLists({ game, variant })).toBe(holds);
	});
});

describe('what an Event is offered', () => {
	// Before the Event is known, only what every Event is offered is.
	it.each([
		[TWO_PLAYER_MAGIC_ONLY, 'mtg-two-player', true],
		[TWO_PLAYER_MAGIC_ONLY, 'op', false],
		[TWO_PLAYER_MAGIC_ONLY, undefined, false],
		[EVENTS_WITH_PLAYERS, 'op', true],
		[EVENTS_WITH_PLAYERS, 'mtg-commander', false],
		[EVERY_EVENT, 'mtg-commander', true],
		[EVERY_EVENT, undefined, true],
	] as const)('offers what declares %j to a %s Event: %s', (offeredTo, kind, offered) => {
		expect(isOfferedToEvent(offeredTo, kind)).toBe(offered);
	});
});

describe('the Event pages each kind of Event is offered', () => {
	// A One Piece Card Game Event lacks Rounds, Matches and Melee (ADR-0057, ADR-0074); a
	// Commander Event lacks Players too, so it keeps only the Cards page (ADR-0087).
	it.each([
		['mtg-two-player', []],
		[
			'op',
			[
				'matches',
				'eventStructure',
				'archetypeReview',
				'integrations',
			],
		],
		[
			'mtg-commander',
			[
				'players',
				'matches',
				'eventStructure',
				'sync',
				'metagame',
				'archetypeReview',
				'integrations',
			],
		],
	] as const)('withholds from a %s Event the pages %j', (kind, withheld) => {
		const pages = Object.keys(EVENT_PAGE_OFFERED_TO) as (keyof typeof EVENT_PAGE_OFFERED_TO)[];

		expect(pages.filter(page => !isOfferedToEvent(EVENT_PAGE_OFFERED_TO[page], kind))).toEqual(withheld);
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
