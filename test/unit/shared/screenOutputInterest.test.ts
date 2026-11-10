import type { OutputChange, OutputChangeKind, ScreenHearsContext } from '~~/shared/screenOutputInterest';
import type { ScreenMode } from '~~/shared/types/enums';
import type { MessageType } from '~~/shared/types/messages';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { OUTPUT_CHANGE_KINDS, outputChangeOf, screenHears, slotNarrowingOf } from '~~/shared/screenOutputInterest';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { eventMessageSamples } from '~~/test/helpers/eventMessageSamples';

/**
 * Which Screens care about which change: what each Event message says changed,
 * and whether a Screen in a mode, as configured, shows it.
 */

const SCREEN = 10;
const OTHER_SCREEN = 11;
const PLAYER = 21;
const OPPONENT = 22;
const OTHER_PLAYER = 29;
const PHASE = 31;
const OTHER_PHASE = 39;
const ROUND = 41;
const OTHER_ROUND = 49;
const MATCH = 51;
const OTHER_MATCH = 59;
const SLOT = 61;
const OTHER_SLOT = 69;
const LIST = 71;
const OTHER_LIST = 79;
const TALENT = 81;
const OTHER_TALENT = 89;
const DECK_LIST = 101;
const OTHER_DECK_LIST = 109;

const SAMPLES = eventMessageSamples({
	screenId: SCREEN,
	playerId: PLAYER,
	opponentId: OPPONENT,
	phaseId: PHASE,
	roundId: ROUND,
	matchId: MATCH,
	slotId: SLOT,
	playerListId: LIST,
	talentId: TALENT,
	archetypeId: 91,
	broadcastDeckListId: DECK_LIST,
});
const MESSAGE_TYPES = Object.keys(SAMPLES) as MessageType[];

/** A Screen in `mode`, its config completed from the mode's contract defaults. */
function screenIn<M extends ScreenMode>(mode: M, config: Partial<ModeConfigTypeMap[M]> = {}) {
	return {
		id: SCREEN,
		mode,
		config: {
			...getDefaultConfigForMode(mode),
			...config,
		},
	};
}

const positionChangeShown = [
	{ key: 'name', visible: true },
	{ key: 'positionChange', visible: true },
] satisfies ModeConfigTypeMap['standings']['columns'];
const manualBracket = {
	size: 4,
	entrants: [
		{ playerId: PLAYER },
		{ name: 'A typed name' },
	],
	results: [],
} satisfies ModeConfigTypeMap['top-cut']['manualBracket'];
function seats(slotId: number): ScreenHearsContext {
	return {
		slot: {
			id: slotId,
			playerIds: [PLAYER, OPPONENT],
		},
	};
}
/** The Slot as read after the write: the Match it follows, with that Match's Round and Phase, or none. */
function follows(slotId: number, match: 'its Match' | 'no Match'): ScreenHearsContext {
	return {
		slot: {
			...seats(slotId).slot!,
			match: match === 'its Match'
				? { id: MATCH, roundId: ROUND, phaseId: PHASE }
				: null,
		},
	};
}

describe('outputChangeOf', () => {
	it.each<[MessageType, OutputChange[]]>([
		[
			'event:updated',
			[
				{ kind: 'event' },
			],
		],
		[
			'event:deleted',
			[
				{ kind: 'event' },
			],
		],
		[
			'theme:updated',
			[
				{ kind: 'theme' },
			],
		],
		[
			'talent:updated',
			[
				{
					kind: 'talent',
					talentIds: [TALENT],
				},
			],
		],
		[
			'talent:deleted',
			[
				{
					kind: 'talent',
					talentIds: [TALENT],
				},
			],
		],
		[
			'player:created',
			[
				{
					kind: 'player',
					playerIds: [PLAYER],
				},
			],
		],
		[
			'player:updated',
			[
				{
					kind: 'player',
					playerIds: [PLAYER],
				},
			],
		],
		[
			'player:deleted',
			[
				{
					kind: 'player',
					playerIds: [PLAYER],
				},
			],
		],
		[
			'playerDeck:reviewed',
			[
				{
					kind: 'playerDeck',
					playerIds: [PLAYER],
				},
			],
		],
		[
			'playerDeck:cardsResolved',
			[
				{
					kind: 'playerDeck',
					playerIds: [PLAYER],
				},
			],
		],
		[
			'phase:updated',
			[
				{
					kind: 'phase',
					phaseIds: [PHASE],
				},
			],
		],
		[
			'phase:deleted',
			[
				{
					kind: 'phase',
					phaseIds: [PHASE],
				},
			],
		],
		[
			'round:updated',
			[
				{
					kind: 'round',
					roundIds: [ROUND],
				},
			],
		],
		[
			'round:deleted',
			[
				{
					kind: 'round',
					roundIds: [ROUND],
				},
			],
		],
		[
			'round:matchesRefreshed',
			[
				{
					kind: 'match',
					roundIds: [ROUND],
				},
			],
		],
		[
			'match:created',
			[
				{
					kind: 'match',
					roundIds: [ROUND],
					matchIds: [MATCH],
				},
			],
		],
		[
			'match:updated',
			[
				{
					kind: 'match',
					roundIds: [ROUND],
					matchIds: [MATCH],
				},
			],
		],
		[
			'match:deleted',
			[
				{ kind: 'match' },
			],
		],
		[
			'featureMatch:updated',
			[
				{
					kind: 'featureMatchSlot',
					slotIds: [SLOT],
				},
			],
		],
		[
			'featureMatch:deleted',
			[
				{
					kind: 'featureMatchSlot',
					slotIds: [SLOT],
				},
			],
		],
		[
			'featureMatch:reordered',
			[
				{
					kind: 'featureMatchSlot',
					slotIds: [SLOT],
				},
			],
		],
		[
			'featureMatchSession:eventApplied',
			[
				{
					kind: 'featureMatchSession',
					slotIds: [SLOT],
				},
			],
		],
		[
			'broadcastGraphicsLiveSession:commandApplied',
			[
				{ kind: 'broadcastGraphicsLiveSession', screenId: SCREEN },
			],
		],
		[
			'broadcastGraphicsLiveSession:epochEnded',
			[
				{ kind: 'broadcastGraphicsLiveSession', screenId: SCREEN },
			],
		],
		[
			'playerList:updated',
			[
				{
					kind: 'playerList',
					playerListIds: [LIST],
				},
			],
		],
		[
			'playerList:deleted',
			[
				{
					kind: 'playerList',
					playerListIds: [LIST],
				},
			],
		],
		[
			'playerList:membersChanged',
			[
				{
					kind: 'playerList',
					playerListIds: [LIST],
				},
			],
		],
		[
			'broadcastDeckList:updated',
			[
				{
					kind: 'broadcastDeckList',
					broadcastDeckListIds: [DECK_LIST],
				},
			],
		],
		[
			'archetype:updated',
			[
				{
					kind: 'archetype',
					archetypeIds: [91],
				},
			],
		],
		[
			'archetype:keyCardsUpdated',
			[
				{
					kind: 'archetype',
					archetypeIds: [91],
				},
			],
		],
		[
			'melee:featureMatchesSynced',
			[
				{
					kind: 'featureMatchSlot',
					slotIds: [SLOT],
				},
			],
		],
		[
			'melee:matchResultsSynced',
			[
				{
					kind: 'match',
					roundIds: [ROUND],
					matchIds: [MATCH],
				},
			],
		],
		[
			'melee:pairingsSynced',
			[
				{
					kind: 'match',
					roundIds: [ROUND],
				},
			],
		],
		[
			'melee:roundStandingsSynced',
			[
				{
					kind: 'roundStandings',
					roundIds: [ROUND],
				},
			],
		],
		[
			'card:updated',
			[
				{ kind: 'screenCard', screenId: SCREEN },
			],
		],
		[
			'card:cleared',
			[
				{ kind: 'screenCard', screenId: SCREEN },
			],
		],
		[
			'screen:updated',
			[
				{ kind: 'screen', screenId: SCREEN },
			],
		],
		[
			'screen:deleted',
			[
				{ kind: 'screen', screenId: SCREEN },
			],
		],
	])('%s names what it changed', (type, changes) => {
		expect(outputChangeOf(type, SAMPLES[type])).toEqual(changes);
	});

	// A wholesale sync names no id, so no narrowing can miss what it rewrote.
	it.each<[MessageType, OutputChangeKind[]]>([
		[
			'melee:dataReset',
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'roundStandings',
				'featureMatchSlot',
			],
		],
		[
			'melee:structureSynced',
			['phase', 'round'],
		],
		[
			'melee:playersSynced',
			['player'],
		],
		[
			'melee:decklistsSynced',
			['playerDeck'],
		],
		[
			'tcgplus:imported',
			['player', 'playerDeck'],
		],
	])('%s changes whole kinds, naming no id', (type, kinds) => {
		expect(outputChangeOf(type, SAMPLES[type])).toEqual(kinds.map(kind => ({ kind })));
	});

	// Operator-only data, and what travels on a Screen's own channel (its commands, and
	// the notices of these changes), which are no change to what an output shows.
	// One starting to reach outputs must be a decision made here.
	it('says nothing an output shows changed for exactly the operator-only messages', () => {
		expect(MESSAGE_TYPES.filter(type => outputChangeOf(type, SAMPLES[type]).length === 0)).toEqual([
			'featureMatchAssignment:created',
			'featureMatchAssignment:updated',
			'featureMatchAssignment:deleted',
			'card:preview',
			'screen:command:refresh',
			'screen:command:identify',
			'screen:command:debug',
			'output:eventContextChanged',
			'output:modeDataChanged',
		]);
	});
});

describe('screenHears', () => {
	const EVERY_SCREEN_FOLLOWS: OutputChangeKind[] = ['event', 'theme', 'screen'];
	const SCREEN_ADDRESSED: OutputChangeKind[] = ['screen', 'screenCard', 'broadcastGraphicsLiveSession'];

	/** A change of the whole kind: it names no id, but its own Screen where the kind belongs to one. */
	function wholeKind(kind: OutputChangeKind, screenId = SCREEN): OutputChange {
		return SCREEN_ADDRESSED.includes(kind)
			? { kind, screenId }
			: { kind };
	}

	describe.each(SCREEN_MODE_VALUES)('a %s Screen', (mode) => {
		it.each(EVERY_SCREEN_FOLLOWS)('hears its own %s change', (kind) => {
			expect(screenHears(screenIn(mode), wholeKind(kind))).toBe(true);
		});

		it.each(SCREEN_ADDRESSED)('does not hear another Screen\'s %s change', (kind) => {
			expect(screenHears(screenIn(mode), wholeKind(kind, OTHER_SCREEN))).toBe(false);
		});
	});

	// The kinds each mode's output follows beyond its Screen, Event and Theme,
	// as its config stands; every other kind it ignores entirely.
	it.each<[string, ReturnType<typeof screenIn>, OutputChangeKind[]]>([
		[
			'Background',
			screenIn('background'),
			[],
		],
		[
			'Card Spotlight',
			screenIn('card'),
			['screenCard'],
		],
		[
			'Deck List of no Player',
			screenIn('deck'),
			[],
		],
		[
			'Deck List of a Player',
			screenIn('deck', {
				deckSource: { type: 'player', playerId: PLAYER },
			}),
			['player', 'playerDeck', 'archetype'],
		],
		[
			'Deck List of a Broadcast Deck List',
			screenIn('deck', {
				deckSource: { type: 'broadcast', broadcastDeckListId: DECK_LIST },
			}),
			['broadcastDeckList'],
		],
		[
			'Deck List of a Slot side',
			screenIn('deck', {
				deckSource: { type: 'featureMatchSlot', slotId: SLOT, side: 'player1' },
			}),
			['featureMatchSlot', 'featureMatchSession'],
		],
		[
			'Standings',
			screenIn('standings'),
			['player', 'round', 'roundStandings'],
		],
		[
			'Standings fixed at a Round',
			screenIn('standings', { roundId: ROUND }),
			['player', 'round', 'roundStandings'],
		],
		[
			'Standings showing Position Change',
			screenIn('standings', { columns: positionChangeShown }),
			[
				'player',
				'phase',
				'round',
				'roundStandings',
			],
		],
		[
			'Standings of a watchlist',
			screenIn('standings', { viewMode: 'watchlist', playerListId: LIST }),
			[
				'player',
				'round',
				'roundStandings',
				'playerList',
			],
		],
		[
			'Standings holding an unused watchlist',
			screenIn('standings', { viewMode: 'all', playerListId: LIST }),
			['player', 'round', 'roundStandings'],
		],
		[
			'Top Cut Bracket of a Phase',
			screenIn('top-cut', { phaseId: PHASE }),
			[
				'player',
				'phase',
				'round',
				'match',
				'roundStandings',
			],
		],
		[
			'Top Cut Bracket of a Phase showing Archetypes',
			screenIn('top-cut', { phaseId: PHASE, showArchetypes: true }),
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'roundStandings',
				'archetype',
			],
		],
		[
			'Manual Bracket',
			screenIn('top-cut', { bracketSource: 'manual', manualBracket }),
			['player'],
		],
		[
			'Manual Bracket showing Archetypes',
			screenIn('top-cut', { bracketSource: 'manual', manualBracket, showArchetypes: true }),
			['player', 'playerDeck', 'archetype'],
		],
		[
			'Feature Match Controls of no Slot',
			screenIn('feature-match'),
			[],
		],
		[
			'Feature Match Controls',
			screenIn('feature-match', { featureMatchId: SLOT }),
			[
				'player',
				'playerDeck',
				'featureMatchSlot',
				'featureMatchSession',
			],
		],
		[
			'Feature Match Overlay of no Slot',
			screenIn('feature-match-overlay'),
			[],
		],
		[
			'Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'featureMatchSlot',
				'featureMatchSession',
			],
		],
		[
			'Broadcast Graphics',
			screenIn('broadcast-graphics'),
			['broadcastGraphicsLiveSession'],
		],
		[
			'Metagame',
			screenIn('metagame'),
			[
				'player',
				'playerDeck',
				'roundStandings',
				'archetype',
			],
		],
		[
			'Metagame of a Player List',
			screenIn('metagame', { scope: 'playerList', playerListId: LIST }),
			[
				'player',
				'playerDeck',
				'roundStandings',
				'archetype',
				'playerList',
			],
		],
		[
			'Metagame holding an unused Player List',
			screenIn('metagame', { scope: 'all', playerListId: LIST }),
			[
				'player',
				'playerDeck',
				'roundStandings',
				'archetype',
			],
		],
		[
			'Most Played Cards of a Player List',
			screenIn('top-cards', { scope: 'playerList', playerListId: LIST }),
			[
				'player',
				'playerDeck',
				'roundStandings',
				'archetype',
				'playerList',
			],
		],
		[
			'Archetype Spotlight of a Player List',
			screenIn('archetype-spotlight', { scope: 'playerList', playerListId: LIST }),
			[
				'player',
				'playerDeck',
				'roundStandings',
				'archetype',
				'playerList',
			],
		],
		[
			'Player History of no Player',
			screenIn('player-history'),
			[],
		],
		[
			'Player History',
			screenIn('player-history', { playerId: PLAYER }),
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'archetype',
			],
		],
		[
			'Pairings of no Round',
			screenIn('pairings'),
			[],
		],
		[
			'Pairings',
			screenIn('pairings', { roundId: ROUND }),
			['player', 'round', 'match'],
		],
		[
			'Head-to-Head of nothing',
			screenIn('head-to-head'),
			[],
		],
		[
			'Head-to-Head of a Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'roundStandings',
				'featureMatchSlot',
				'featureMatchSession',
				'archetype',
			],
		],
		[
			'Head-to-Head of two Players',
			screenIn('head-to-head', {
				playerSource: 'players',
				player1Id: PLAYER,
				player2Id: OPPONENT,
				featureMatchId: SLOT,
			}),
			[
				'player',
				'playerDeck',
				'phase',
				'round',
				'match',
				'roundStandings',
				'archetype',
			],
		],
		[
			'Round Clock of the Current Round',
			screenIn('round-clock'),
			['phase', 'round', 'match'],
		],
		[
			'Round Clock of a picked Round',
			screenIn('round-clock', { roundId: ROUND }),
			['round'],
		],
		[
			'Talent of no Talent',
			screenIn('talent'),
			[],
		],
		[
			'Talent',
			screenIn('talent', { talentId: TALENT }),
			['talent'],
		],
	])('%s follows only its kinds', (_name, screen, follows) => {
		const heard = OUTPUT_CHANGE_KINDS.filter(kind => !EVERY_SCREEN_FOLLOWS.includes(kind) && screenHears(screen, wholeKind(kind), seats(SLOT)));
		expect(heard).toEqual(follows);
	});

	// Both sides of every narrowing: the id the config names, and another.
	it.each<[string, ReturnType<typeof screenIn>, OutputChange, boolean]>([
		[
			'Pairings hears its Round',
			screenIn('pairings', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			true,
		],
		[
			'Pairings ignores another Round',
			screenIn('pairings', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			false,
		],
		[
			'Round Clock hears its picked Round',
			screenIn('round-clock', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			true,
		],
		[
			'Round Clock ignores a Round it did not pick',
			screenIn('round-clock', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			false,
		],
		[
			'Round Clock following the Current Round hears any Round',
			screenIn('round-clock'),
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			true,
		],
		[
			'Standings hears the Round it is fixed at',
			screenIn('standings', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			true,
		],
		[
			'Standings ignores another Round',
			screenIn('standings', { roundId: ROUND }),
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			false,
		],
		[
			'Standings fixed at no Round ignores every named Round',
			screenIn('standings'),
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			false,
		],
		[
			'Standings showing Position Change hears any Round',
			screenIn('standings', { roundId: ROUND, columns: positionChangeShown }),
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			true,
		],

		[
			'Feature Match Controls hears its Slot',
			screenIn('feature-match', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'Feature Match Controls ignores another Slot',
			screenIn('feature-match', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'Feature Match Controls hears its Slot\'s Session',
			screenIn('feature-match', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'Feature Match Controls ignores another Slot\'s Session',
			screenIn('feature-match', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'Feature Match Overlay hears its Slot',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [OTHER_SLOT, SLOT],
			},
			true,
		],
		[
			'Feature Match Overlay ignores another Slot',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'Feature Match Overlay hears its Slot\'s Session',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'Feature Match Overlay ignores another Slot\'s Session',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'Head-to-Head hears its Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'Head-to-Head ignores another Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSlot',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'Head-to-Head hears its Slot\'s Session',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'Head-to-Head ignores another Slot\'s Session',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'featureMatchSession',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'a Deck List of a Slot side hears its Slot',
			screenIn('deck', {
				deckSource: { type: 'featureMatchSlot', slotId: SLOT, side: 'player2' },
			}),
			{
				kind: 'featureMatchSlot',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'a Deck List of a Slot side ignores another Slot',
			screenIn('deck', {
				deckSource: { type: 'featureMatchSlot', slotId: SLOT, side: 'player2' },
			}),
			{
				kind: 'featureMatchSlot',
				slotIds: [OTHER_SLOT],
			},
			false,
		],
		[
			'a Deck List of a Slot side hears its Slot\'s Session',
			screenIn('deck', {
				deckSource: { type: 'featureMatchSlot', slotId: SLOT, side: 'player2' },
			}),
			{
				kind: 'featureMatchSession',
				slotIds: [SLOT],
			},
			true,
		],
		[
			'a Deck List of a Slot side ignores another Slot\'s Session',
			screenIn('deck', {
				deckSource: { type: 'featureMatchSlot', slotId: SLOT, side: 'player2' },
			}),
			{
				kind: 'featureMatchSession',
				slotIds: [OTHER_SLOT],
			},
			false,
		],

		[
			'a Deck List hears its Player',
			screenIn('deck', {
				deckSource: { type: 'player', playerId: PLAYER },
			}),
			{
				kind: 'player',
				playerIds: [PLAYER],
			},
			true,
		],
		[
			'a Deck List ignores another Player',
			screenIn('deck', {
				deckSource: { type: 'player', playerId: PLAYER },
			}),
			{
				kind: 'player',
				playerIds: [OTHER_PLAYER],
			},
			false,
		],
		[
			'a Deck List hears its Player\'s deck',
			screenIn('deck', {
				deckSource: { type: 'player', playerId: PLAYER },
			}),
			{
				kind: 'playerDeck',
				playerIds: [OTHER_PLAYER, PLAYER],
			},
			true,
		],
		[
			'a Deck List ignores another Player\'s deck',
			screenIn('deck', {
				deckSource: { type: 'player', playerId: PLAYER },
			}),
			{
				kind: 'playerDeck',
				playerIds: [OTHER_PLAYER],
			},
			false,
		],
		[
			'Head-to-Head hears a Player it picks',
			screenIn('head-to-head', { playerSource: 'players', player1Id: PLAYER, player2Id: OPPONENT }),
			{
				kind: 'player',
				playerIds: [OPPONENT],
			},
			true,
		],
		[
			'Head-to-Head ignores a Player it does not pick',
			screenIn('head-to-head', { playerSource: 'players', player1Id: PLAYER, player2Id: OPPONENT }),
			{
				kind: 'player',
				playerIds: [OTHER_PLAYER],
			},
			false,
		],
		[
			'a Manual Bracket hears a Player it seeds',
			screenIn('top-cut', { bracketSource: 'manual', manualBracket }),
			{
				kind: 'player',
				playerIds: [PLAYER],
			},
			true,
		],
		[
			'a Manual Bracket ignores a Player it does not seed',
			screenIn('top-cut', { bracketSource: 'manual', manualBracket }),
			{
				kind: 'player',
				playerIds: [OTHER_PLAYER],
			},
			false,
		],

		[
			'Standings hears its watchlist',
			screenIn('standings', { viewMode: 'watchlist', playerListId: LIST }),
			{
				kind: 'playerList',
				playerListIds: [LIST],
			},
			true,
		],
		[
			'Standings ignores another Player List',
			screenIn('standings', { viewMode: 'watchlist', playerListId: LIST }),
			{
				kind: 'playerList',
				playerListIds: [OTHER_LIST],
			},
			false,
		],
		[
			'Metagame hears the Player List scoping it',
			screenIn('metagame', { scope: 'playerList', playerListId: LIST }),
			{
				kind: 'playerList',
				playerListIds: [LIST],
			},
			true,
		],
		[
			'Metagame ignores another Player List',
			screenIn('metagame', { scope: 'playerList', playerListId: LIST }),
			{
				kind: 'playerList',
				playerListIds: [OTHER_LIST],
			},
			false,
		],

		[
			'Talent hears its Talent',
			screenIn('talent', { talentId: TALENT }),
			{
				kind: 'talent',
				talentIds: [TALENT],
			},
			true,
		],
		[
			'Talent ignores another Talent',
			screenIn('talent', { talentId: TALENT }),
			{
				kind: 'talent',
				talentIds: [OTHER_TALENT],
			},
			false,
		],
		[
			'Talent hears a Talent of its lineup',
			screenIn('talent', {
				selection: 'lineup',
				talentIds: [OTHER_TALENT, TALENT],
			}),
			{
				kind: 'talent',
				talentIds: [TALENT],
			},
			true,
		],
		[
			'Talent ignores the one Talent it holds while showing a lineup',
			screenIn('talent', {
				selection: 'lineup',
				talentId: TALENT,
				talentIds: [OTHER_TALENT],
			}),
			{
				kind: 'talent',
				talentIds: [TALENT],
			},
			false,
		],

		[
			'a Deck List hears its Broadcast Deck List',
			screenIn('deck', {
				deckSource: { type: 'broadcast', broadcastDeckListId: DECK_LIST },
			}),
			{
				kind: 'broadcastDeckList',
				broadcastDeckListIds: [DECK_LIST],
			},
			true,
		],
		[
			'a Deck List ignores another Broadcast Deck List',
			screenIn('deck', {
				deckSource: { type: 'broadcast', broadcastDeckListId: DECK_LIST },
			}),
			{
				kind: 'broadcastDeckList',
				broadcastDeckListIds: [OTHER_DECK_LIST],
			},
			false,
		],
	])('%s', (_name, screen, change, hears) => {
		expect(screenHears(screen, change)).toBe(hears);
	});

	// A mode showing the Players its Slot seats is told who they are; told
	// nothing, or of another Slot, it hears every Player rather than miss one.
	describe.each([
		[
			'Feature Match Controls',
			screenIn('feature-match', { featureMatchId: SLOT }),
		],
		[
			'Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
		],
		[
			'Head-to-Head of a Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
		],
	])('%s', (_name, screen) => {
		it.each<[string, number, ScreenHearsContext | undefined, boolean]>([
			[
				'hears a seated Player',
				OPPONENT,
				seats(SLOT),
				true,
			],
			[
				'ignores an unseated Player',
				OTHER_PLAYER,
				seats(SLOT),
				false,
			],
			[
				'hears any Player, told of no Slot',
				OTHER_PLAYER,
				undefined,
				true,
			],
			[
				'hears any Player, told of another Slot',
				OTHER_PLAYER,
				seats(OTHER_SLOT),
				true,
			],
		])('%s', (_case, playerId, context, hears) => {
			expect(screenHears(screen, {
				kind: 'player',
				playerIds: [playerId],
			}, context)).toBe(hears);
		});
	});

	// A Feature Match Overlay shows the one Match its Slot follows, and that
	// Match's Round and Phase. Told nothing of them, it hears every one; a
	// change naming none is a delete or a sync, which may have unlinked the Slot.
	it.each<[string, OutputChange, ScreenHearsContext | undefined, boolean]>([
		[
			'hears the Match its Slot follows',
			{
				kind: 'match',
				roundIds: [ROUND],
				matchIds: [MATCH],
			},
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'hears that Match moved to another Round',
			{
				kind: 'match',
				roundIds: [OTHER_ROUND],
				matchIds: [MATCH],
			},
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'ignores another Match',
			{
				kind: 'match',
				roundIds: [ROUND],
				matchIds: [OTHER_MATCH],
			},
			follows(SLOT, 'its Match'),
			false,
		],
		[
			'ignores every named Match while its Slot follows none',
			{
				kind: 'match',
				roundIds: [ROUND],
				matchIds: [MATCH],
			},
			follows(SLOT, 'no Match'),
			false,
		],
		[
			'hears a Match change naming no Match',
			{
				kind: 'match',
				roundIds: [OTHER_ROUND],
			},
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'hears a Match change naming no Match while its Slot follows none',
			{ kind: 'match' },
			follows(SLOT, 'no Match'),
			true,
		],
		[
			'hears any Match, told of no Slot',
			{
				kind: 'match',
				matchIds: [OTHER_MATCH],
			},
			undefined,
			true,
		],
		[
			'hears any Match, told only who its Slot seats',
			{
				kind: 'match',
				matchIds: [OTHER_MATCH],
			},
			seats(SLOT),
			true,
		],
		[
			'hears any Match, told of another Slot',
			{
				kind: 'match',
				matchIds: [OTHER_MATCH],
			},
			follows(OTHER_SLOT, 'its Match'),
			true,
		],
		[
			'hears its Match\'s Round',
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'ignores another Round',
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			follows(SLOT, 'its Match'),
			false,
		],
		[
			'hears any Round while its Slot follows no Match',
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			follows(SLOT, 'no Match'),
			true,
		],
		[
			'hears any Round, told only who its Slot seats',
			{
				kind: 'round',
				roundIds: [OTHER_ROUND],
			},
			seats(SLOT),
			true,
		],
		[
			'hears a Round change naming no Round',
			{ kind: 'round' },
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'hears its Match\'s Phase',
			{
				kind: 'phase',
				phaseIds: [PHASE],
			},
			follows(SLOT, 'its Match'),
			true,
		],
		[
			'ignores another Phase',
			{
				kind: 'phase',
				phaseIds: [OTHER_PHASE],
			},
			follows(SLOT, 'its Match'),
			false,
		],
		[
			'hears any Phase while its Slot follows no Match',
			{
				kind: 'phase',
				phaseIds: [OTHER_PHASE],
			},
			follows(SLOT, 'no Match'),
			true,
		],
		[
			'hears any Phase, told of another Slot',
			{
				kind: 'phase',
				phaseIds: [OTHER_PHASE],
			},
			follows(OTHER_SLOT, 'its Match'),
			true,
		],
	])('a Feature Match Overlay %s', (_case, change, context, hears) => {
		const screen = screenIn('feature-match-overlay', { featureMatchId: SLOT });
		expect(screenHears(screen, change, context)).toBe(hears);
	});

	// Only its Players does a Head-to-Head of a Slot take from the Slot: the
	// earlier Matches between them are its read's to know.
	it('a Head-to-Head of a Slot hears every Match, whichever its Slot follows', () => {
		const screen = screenIn('head-to-head', { featureMatchId: SLOT });
		expect(screenHears(screen, {
			kind: 'match',
			roundIds: [ROUND],
			matchIds: [OTHER_MATCH],
		}, follows(SLOT, 'its Match'))).toBe(true);
	});

	// The caller reads a Slot only for a change its row can rule out.
	it.each<[string, ReturnType<typeof screenIn>, OutputChange, number | null]>([
		[
			'a named Match, for a Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'match',
				matchIds: [MATCH],
			},
			SLOT,
		],
		[
			'a named Round, for a Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'round',
				roundIds: [ROUND],
			},
			SLOT,
		],
		[
			'a named Phase, for a Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'phase',
				phaseIds: [PHASE],
			},
			SLOT,
		],
		[
			'a named Player, for a Head-to-Head of a Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'player',
				playerIds: [PLAYER],
			},
			SLOT,
		],
		[
			'a Match change naming only its Round',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{
				kind: 'match',
				roundIds: [ROUND],
			},
			null,
		],
		[
			'a change naming nothing',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
			{ kind: 'player' },
			null,
		],
		[
			'a named Match, for a Head-to-Head of a Slot',
			screenIn('head-to-head', { featureMatchId: SLOT }),
			{
				kind: 'match',
				matchIds: [MATCH],
			},
			null,
		],
		[
			'a Feature Match Overlay of no Slot',
			screenIn('feature-match-overlay'),
			{
				kind: 'match',
				matchIds: [MATCH],
			},
			null,
		],
		[
			'a kind the mode does not follow',
			screenIn('standings'),
			{
				kind: 'match',
				matchIds: [MATCH],
			},
			null,
		],
	])('slotNarrowingOf names the Slot to read for %s', (_case, screen, change, slotId) => {
		expect(slotNarrowingOf(screen, change)).toBe(slotId);
	});

	// The deck counters a control Screen offers, and an Overlay's sideboards,
	// are read from the decks of the Players their Slot seats.
	describe.each([
		[
			'a Feature Match Controls',
			screenIn('feature-match', { featureMatchId: SLOT }),
		],
		[
			'a Feature Match Overlay',
			screenIn('feature-match-overlay', { featureMatchId: SLOT }),
		],
	])('%s', (_name, screen) => {
		it.each<[string, number, boolean]>([
			['hears a seated Player\'s deck', PLAYER, true],
			['ignores an unseated Player\'s deck', OTHER_PLAYER, false],
		])('%s', (_case, playerId, hears) => {
			expect(screenHears(screen, {
				kind: 'playerDeck',
				playerIds: [playerId],
			}, seats(SLOT))).toBe(hears);
		});
	});
});
