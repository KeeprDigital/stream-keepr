import type { HearingScreen, ScreenHearsContext } from '~~/shared/screenOutputInterest';
import type { ScreenMode } from '~~/shared/types/enums';
import type { MessageType } from '~~/shared/types/messages';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import type { EventMessageSampleIds } from '~~/test/helpers/eventMessageSamples';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { describe, expect, it } from 'vitest';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { talentScreenTalentIds } from '~~/shared/screenModeConfigs/talent';
import { outputChangeOf, screenHears } from '~~/shared/screenOutputInterest';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { eventMessageSamples } from '~~/test/helpers/eventMessageSamples';
import { deckDependencies } from '~/composables/screen/useDeckModeData';
import { headToHeadDependencies } from '~/composables/screen/useHeadToHeadModeData';
import { pairingsDependencies } from '~/composables/screen/usePairingsModeData';
import { playerHistoryDependencies } from '~/composables/screen/usePlayerHistoryModeData';
import { roundClockDependencies } from '~/composables/screen/useRoundClockModeData';
import { standingsDependencies } from '~/composables/screen/useStandingsModeData';
import { talentDependencies } from '~/composables/screen/useTalentModeData';
import { manualBracketDependencies, topCutDependencies } from '~/composables/screen/useTopCutModeData';
import { metagameBreakdownDependencies } from '~/modules/metagame/screenDependencies';

/**
 * The migration's guard: whenever a rendering re-reads on an Event message
 * today, `screenHears` says its Screen hears that message. The rule may hear
 * more than a rendering re-reads on, never less.
 */

/** What the Screen's config names. */
const SHOWN: EventMessageSampleIds = {
	screenId: 10,
	playerId: 21,
	opponentId: 22,
	phaseId: 31,
	roundId: 41,
	matchId: 51,
	slotId: 61,
	playerListId: 71,
	talentId: 81,
	archetypeId: 91,
	broadcastDeckListId: 101,
};
/** What a rendering holds from its read without its config naming it. */
const HELD: EventMessageSampleIds = {
	screenId: 12,
	playerId: 23,
	opponentId: 24,
	phaseId: 32,
	roundId: 42,
	matchId: 52,
	slotId: 62,
	playerListId: 72,
	talentId: 82,
	archetypeId: 92,
	broadcastDeckListId: 102,
};
/** What the Screen neither names nor holds. */
const OTHER: EventMessageSampleIds = {
	screenId: 19,
	playerId: 28,
	opponentId: 29,
	phaseId: 39,
	roundId: 49,
	matchId: 59,
	slotId: 69,
	playerListId: 79,
	talentId: 89,
	archetypeId: 99,
	broadcastDeckListId: 109,
};

const MESSAGES = {
	'naming what it shows': eventMessageSamples(SHOWN),
	'naming what it holds': eventMessageSamples(HELD),
	'naming something else': eventMessageSamples(OTHER),
	// A Match the rendering holds, since moved to another Round and re-seated.
	'moving a Match it holds away': eventMessageSamples({ ...OTHER, matchId: SHOWN.matchId }),
	// The Match a Slot follows, which only the Slot names, moved and re-seated the same way.
	'moving the Match its Slot follows away': eventMessageSamples({ ...OTHER, matchId: HELD.matchId }),
} as const;

type Dependencies = ScreenModeDependencies<any>;

interface ParityCase {
	/** The declaration the dependencies are, so every one of its message types is shown to be exercised. */
	declaration: string;
	name: string;
	screen: HearingScreen;
	context?: ScreenHearsContext;
	dependsOn: Dependencies;
	/** What the rendering holds of its last read. */
	held: unknown;
	/** The message types the rule narrows as far as the rendering does: it hears those exactly when the rendering re-reads. */
	exactly?: MessageType[];
}

function screenIn<M extends ScreenMode>(mode: M, config: Partial<ModeConfigTypeMap[M]> = {}): HearingScreen<M> {
	return {
		id: SHOWN.screenId,
		mode,
		config: {
			...getDefaultConfigForMode(mode),
			...config,
		},
	};
}

const seated: ScreenHearsContext = {
	slot: {
		id: SHOWN.slotId,
		playerIds: [SHOWN.playerId, SHOWN.opponentId],
	},
};
const seatedIds = seated.slot!.playerIds;
/** The Slot as the server reads it after a write: following the Match its rendering holds, or none. */
function following(match: NonNullable<ScreenHearsContext['slot']>['match']): ScreenHearsContext {
	return {
		slot: { ...seated.slot!, match },
	};
}
const OVERLAY_NARROWS: MessageType[] = ['match:updated', 'round:updated', 'phase:updated'];

/**
 * The Slot and its Session a Slot-showing mode holds in the stores, which
 * follow these messages for it: `useScreenFeatureMatchSlot.ts:74-89` reads what
 * `realtime-event-session/featureMatchHandlers.ts:10-16` writes.
 */
const SLOT_STORES: Dependencies = {
	'featureMatch:updated': ({ featureMatch }) => featureMatch.id === SHOWN.slotId,
	'featureMatch:deleted': ({ featureMatchId }) => featureMatchId === SHOWN.slotId,
	'featureMatchSession:eventApplied': ({ slotId }) => slotId === SHOWN.slotId,
};

/**
 * The Feature Match Overlay's inline dependencies, which cannot be imported:
 * `useFeatureMatchOverlayModeData.ts:42-48`, and its sideboards' two channel
 * handlers, `useFeatureMatchOverlaySideboardData.ts:328-342`.
 */
const OVERLAY: Dependencies = {
	...SLOT_STORES,
	'match:updated': ({ match }, held) => match.id === held.sourceMatch?.id,
	'round:updated': ({ round }, held) => round.id === held.round?.id,
	'phase:updated': ({ phase }, held) => phase.id === held.phase?.id,
	'player:updated': ({ player }) => seatedIds.includes(player.id),
	'playerDeck:cardsResolved': ({ playerIds }) => playerIds.some(id => seatedIds.includes(id)),
};

/** A One Piece Deck List's Player source, inline at `useOpDeckModeData.ts:218-223`. */
const OP_DECK_PLAYER: Dependencies = {
	'player:updated': ({ player }) => player.id === SHOWN.playerId,
	'tcgplus:imported': true,
};

/** The Card store's own messages, `realtime-event-session/screenCardHandlers.ts:14-16`, less the operator's preview. */
const CARD_STORE: Dependencies = {
	'card:updated': ({ screenId }) => screenId === SHOWN.screenId,
	'card:cleared': ({ screenId }) => screenId === SHOWN.screenId,
};

/** The Live Session store's messages, `realtime-event-session/broadcastGraphicsHandlers.ts:9-19`. */
const LIVE_SESSION_STORE: Dependencies = {
	'broadcastGraphicsLiveSession:commandApplied': ({ screenId }) => screenId === SHOWN.screenId,
	'broadcastGraphicsLiveSession:epochEnded': ({ screenId }) => screenId === SHOWN.screenId,
};

/** What every rendering holds: its Screen, and its Event context with the Theme (`screenCardHandlers.ts:11`, `eventTalentHandlers.ts:11-12`). */
const EVERY_RENDERING: Dependencies = {
	'screen:updated': ({ screenId }) => screenId === SHOWN.screenId,
	'event:updated': true,
	'theme:updated': true,
};

function standingsCase(name: string, config: Partial<ModeConfigTypeMap['standings']>): ParityCase {
	const screen = screenIn('standings', config);
	// As `useStandingsModeData` derives them from its config.
	const watchlistId = () => screen.config.viewMode === 'watchlist'
		? screen.config.playerListId ?? null
		: null;
	return {
		declaration: 'standingsDependencies',
		name,
		screen,
		dependsOn: standingsDependencies(watchlistId, () => isColumnVisible(screen.config.columns, 'positionChange')),
		held: {
			round: screen.config.roundId
				? { id: screen.config.roundId }
				: null,
		},
	};
}

function metagameCases(mode: 'metagame' | 'top-cards' | 'archetype-spotlight'): ParityCase[] {
	return [
		{ scope: 'all' as const, playerListId: SHOWN.playerListId },
		{ scope: 'playerList' as const, playerListId: SHOWN.playerListId },
	].map((scoping) => {
		const screen = screenIn(mode, scoping);
		return {
			declaration: 'metagameBreakdownDependencies',
			name: `${mode} scoped to ${scoping.scope}`,
			screen,
			dependsOn: metagameBreakdownDependencies(() => screen.config),
			held: null,
		};
	});
}

const headToHeadHeld = {
	player1: { id: SHOWN.playerId },
	player2: { id: SHOWN.opponentId },
	earlierMatches: [
		{ matchId: HELD.matchId, roundId: HELD.roundId },
	],
};
const phaseBracketHeld = {
	phase: { id: SHOWN.phaseId },
	bracket: {
		columns: [
			{
				roundId: HELD.roundId,
				positions: [
					{
						matchId: HELD.matchId,
						entrants: [
							{ playerId: HELD.playerId },
							null,
						],
					},
				],
			},
		],
	},
};
const manualBracket = {
	size: 4,
	entrants: [
		{ playerId: SHOWN.playerId },
	],
	results: [],
} satisfies ModeConfigTypeMap['top-cut']['manualBracket'];
const manualBracketHeld = {
	phase: null,
	bracket: {
		columns: [
			{
				roundId: null,
				positions: [
					{
						matchId: null,
						entrants: [
							{ playerId: SHOWN.playerId },
							null,
						],
					},
				],
			},
		],
	},
};
const playerDeckSource = { type: 'player', playerId: SHOWN.playerId } as const;
const broadcastDeckSource = { type: 'broadcast', broadcastDeckListId: SHOWN.broadcastDeckListId } as const;
const slotDeckSource = { type: 'featureMatchSlot', slotId: SHOWN.slotId, side: 'player1' } as const;
const talentScreen = screenIn('talent', { talentId: SHOWN.talentId });

const CASES: ParityCase[] = [
	standingsCase('Standings', {}),
	standingsCase('Standings fixed at a Round', { roundId: SHOWN.roundId }),
	standingsCase('Standings of a watchlist showing Position Change', {
		viewMode: 'watchlist',
		playerListId: SHOWN.playerListId,
		roundId: SHOWN.roundId,
		columns: [
			{ key: 'positionChange', visible: true },
		],
	}),
	{
		declaration: 'pairingsDependencies',
		name: 'Pairings',
		screen: screenIn('pairings', { roundId: SHOWN.roundId }),
		dependsOn: pairingsDependencies(() => SHOWN.roundId),
		held: {
			round: { id: SHOWN.roundId },
			matches: [
				{
					matchId: SHOWN.matchId,
					player1: { id: SHOWN.playerId },
					player2: { id: HELD.playerId },
				},
			],
		},
	},
	{
		declaration: 'roundClockDependencies',
		name: 'Round Clock of the Current Round',
		screen: screenIn('round-clock'),
		dependsOn: roundClockDependencies(() => undefined),
		held: {
			round: { id: HELD.roundId },
		},
	},
	{
		declaration: 'roundClockDependencies',
		name: 'Round Clock of a picked Round',
		screen: screenIn('round-clock', { roundId: SHOWN.roundId }),
		dependsOn: roundClockDependencies(() => SHOWN.roundId),
		held: {
			round: { id: SHOWN.roundId },
		},
	},
	{
		declaration: 'playerHistoryDependencies',
		name: 'Player History',
		screen: screenIn('player-history', { playerId: SHOWN.playerId }),
		dependsOn: playerHistoryDependencies(() => SHOWN.playerId),
		held: {
			player: { id: SHOWN.playerId },
			rows: [
				{
					id: SHOWN.matchId,
					roundId: SHOWN.roundId,
					opponentId: SHOWN.opponentId,
					opponentDeckName: 'Burn',
				},
				{
					id: HELD.matchId,
					roundId: HELD.roundId,
					opponentId: HELD.playerId,
					opponentDeckName: null,
				},
			],
		},
	},
	{
		declaration: 'headToHeadDependencies',
		name: 'Head-to-Head of a Slot',
		screen: screenIn('head-to-head', { featureMatchId: SHOWN.slotId }),
		context: seated,
		dependsOn: headToHeadDependencies(() => SHOWN.slotId),
		held: headToHeadHeld,
	},
	{
		declaration: 'headToHeadDependencies',
		name: 'Head-to-Head of two Players',
		screen: screenIn('head-to-head', { playerSource: 'players', player1Id: SHOWN.playerId, player2Id: SHOWN.opponentId }),
		dependsOn: headToHeadDependencies(() => null),
		held: headToHeadHeld,
	},
	...[false, true].map((showArchetypes): ParityCase => ({
		declaration: 'topCutDependencies',
		name: `Top Cut Bracket of a Phase, Archetypes ${showArchetypes ? 'shown' : 'hidden'}`,
		screen: screenIn('top-cut', { phaseId: SHOWN.phaseId, showArchetypes }),
		dependsOn: topCutDependencies(() => SHOWN.phaseId, () => showArchetypes),
		held: phaseBracketHeld,
	})),
	...[false, true].map((showArchetypes): ParityCase => ({
		declaration: 'manualBracketDependencies',
		name: `Manual Bracket, Archetypes ${showArchetypes ? 'shown' : 'hidden'}`,
		screen: screenIn('top-cut', { bracketSource: 'manual', manualBracket, showArchetypes }),
		dependsOn: manualBracketDependencies(() => showArchetypes),
		held: manualBracketHeld,
	})),
	{
		// A One Piece Card Game Event shows its Manual Bracket whatever the source says (ADR-0075).
		declaration: 'manualBracketDependencies',
		name: 'Manual Bracket of a One Piece Event whose source says Phase',
		screen: screenIn('top-cut', { bracketSource: 'phase', manualBracket, showArchetypes: true }),
		dependsOn: manualBracketDependencies(() => true),
		held: manualBracketHeld,
	},
	{
		declaration: 'talentDependencies',
		name: 'Talent',
		screen: talentScreen,
		dependsOn: talentDependencies(talentId => talentScreenTalentIds(talentScreen.config).includes(talentId)),
		held: { talents: [] },
	},
	{
		declaration: 'deckDependencies',
		name: 'Deck List of a Player',
		screen: screenIn('deck', { deckSource: playerDeckSource }),
		dependsOn: deckDependencies(() => playerDeckSource),
		held: {
			type: 'player',
			player: {
				updatedAt: new Date('2026-01-01T00:00:00.000Z'),
			},
			deck: { archetypeId: HELD.archetypeId },
		},
	},
	{
		declaration: 'deckDependencies',
		name: 'Deck List of a Broadcast Deck List',
		screen: screenIn('deck', { deckSource: broadcastDeckSource }),
		dependsOn: deckDependencies(() => broadcastDeckSource),
		held: {
			type: 'broadcast',
			list: { revision: 1 },
		},
	},
	{
		declaration: 'inline',
		name: 'One Piece Deck List of a Player',
		screen: screenIn('deck', { deckSource: playerDeckSource }),
		dependsOn: OP_DECK_PLAYER,
		held: null,
	},
	{
		declaration: 'inline',
		name: 'One Piece Deck List of a Slot side',
		screen: screenIn('deck', { deckSource: slotDeckSource }),
		dependsOn: SLOT_STORES,
		held: null,
	},
	...metagameCases('metagame'),
	...metagameCases('top-cards'),
	...metagameCases('archetype-spotlight'),
	{
		declaration: 'inline',
		name: 'Feature Match Overlay',
		screen: screenIn('feature-match-overlay', { featureMatchId: SHOWN.slotId }),
		context: following({ id: HELD.matchId, roundId: HELD.roundId, phaseId: HELD.phaseId }),
		dependsOn: OVERLAY,
		held: {
			sourceMatch: { id: HELD.matchId },
			round: { id: HELD.roundId },
			phase: { id: HELD.phaseId },
		},
		exactly: OVERLAY_NARROWS,
	},
	{
		declaration: 'inline',
		name: 'Feature Match Overlay, told nothing of its Slot\'s Match',
		screen: screenIn('feature-match-overlay', { featureMatchId: SHOWN.slotId }),
		context: seated,
		dependsOn: OVERLAY,
		held: {
			sourceMatch: { id: HELD.matchId },
			round: { id: HELD.roundId },
			phase: { id: HELD.phaseId },
		},
	},
	{
		declaration: 'inline',
		name: 'Feature Match Overlay of a Slot following no Match',
		screen: screenIn('feature-match-overlay', { featureMatchId: SHOWN.slotId }),
		context: following(null),
		dependsOn: OVERLAY,
		held: { sourceMatch: null },
		exactly: ['match:updated'],
	},
	{
		declaration: 'inline',
		name: 'Feature Match Controls',
		screen: screenIn('feature-match', { featureMatchId: SHOWN.slotId }),
		dependsOn: SLOT_STORES,
		held: null,
	},
	{
		declaration: 'inline',
		name: 'Card Spotlight',
		screen: screenIn('card'),
		dependsOn: CARD_STORE,
		held: null,
	},
	{
		declaration: 'inline',
		name: 'Broadcast Graphics',
		screen: screenIn('broadcast-graphics'),
		dependsOn: LIVE_SESSION_STORE,
		held: null,
	},
	{
		declaration: 'inline',
		name: 'Background',
		screen: screenIn('background'),
		dependsOn: EVERY_RENDERING,
		held: null,
	},
];

/** Every message a case's rendering depends on, in each naming, and whether it re-reads on it today given what it holds. */
const DEPENDENCIES = CASES.flatMap(parityCase =>
	(Object.keys(parityCase.dependsOn) as MessageType[]).flatMap(type =>
		Object.entries(MESSAGES).map(([naming, samples]) => {
			const dependency = parityCase.dependsOn[type] as true | ((message: unknown, held: unknown) => boolean);
			return {
				parityCase,
				name: parityCase.name,
				type,
				naming,
				payload: samples[type],
				rereads: dependency === true || dependency(samples[type], parityCase.held),
			};
		})));
const REREADS = DEPENDENCIES.filter(({ rereads }) => rereads);
/** The messages a rendering ignores of a type its Screen's rule narrows as far as it does. */
const IGNORED_EXACTLY = DEPENDENCIES.filter(({ parityCase, type, rereads }) => !rereads && parityCase.exactly?.includes(type));

describe('a Screen hears every message its rendering re-reads on', () => {
	it.each(REREADS)('$name: $type $naming', ({ parityCase, type, payload }) => {
		const hears = outputChangeOf(type, payload).some(change => screenHears(parityCase.screen, change, parityCase.context));
		expect(hears).toBe(true);
	});

	// Where the rule is told what the rendering holds, it stays as silent as the rendering.
	it.each(IGNORED_EXACTLY)('$name hears no $type $naming', ({ parityCase, type, payload }) => {
		const hears = outputChangeOf(type, payload).some(change => screenHears(parityCase.screen, change, parityCase.context));
		expect(hears).toBe(false);
	});

	// No dependency goes unproven because no case made its rendering re-read.
	it.each([
		...new Set(CASES.map(parityCase => parityCase.declaration)),
	])('every message type %s names re-reads in some case', (declaration) => {
		const declared = new Set(CASES.filter(parityCase => parityCase.declaration === declaration).flatMap(parityCase => Object.keys(parityCase.dependsOn)));
		const reread = new Set(REREADS.filter(({ parityCase }) => parityCase.declaration === declaration).map(({ type }) => type));
		expect([...declared].filter(type => !reread.has(type as MessageType))).toEqual([]);
	});
});
