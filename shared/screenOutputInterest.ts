import type { ScreenMode } from './types/enums';
import type { MessagePayload, MessageType } from './types/messages';
import type { ModeConfigTypeMap } from './types/screenConfig';
import { SCREEN_MODES } from './screenModes';

/**
 * Which Screens care about which change.
 *
 * One pure rule, with no I/O: `outputChangeOf` says what an Event message
 * changed, as a Screen Output could show it, and `screenHears` says whether a
 * Screen in a mode, as configured, shows that. A Screen that hears a change
 * re-reads; one that does not holds nothing the change touched.
 *
 * It errs one way only. Hearing a change the Screen does not show costs one
 * re-read; missing one it shows leaves stale data on air. So wherever the
 * answer turns on what a rendering holds and the caller does not, it is yes.
 */

/**
 * The kinds of change a Screen Output can show. `screen`, `screenCard` and
 * `broadcastGraphicsLiveSession` belong to one Screen; the rest are the
 * Event's.
 */
export const OUTPUT_CHANGE_KINDS = [
	'event',
	'theme',
	'screen',
	'screenCard',
	'broadcastGraphicsLiveSession',
	'player',
	'playerDeck',
	'phase',
	'round',
	'match',
	'roundStandings',
	'featureMatchSlot',
	'featureMatchSession',
	'archetype',
	'playerList',
	'talent',
	'broadcastDeckList',
] as const;

export type OutputChangeKind = typeof OUTPUT_CHANGE_KINDS[number];

/**
 * What every Screen Output follows whatever its mode: its own Screen, and the
 * Event context it renders in, the Event's Theme included (ADR-0022). No mode
 * declares these.
 */
const EVERY_SCREEN_FOLLOWS = ['event', 'theme', 'screen'] as const satisfies readonly OutputChangeKind[];

/** A kind a Screen Mode Definition may declare its output follows. */
export type DeclaredOutputChangeKind = Exclude<OutputChangeKind, typeof EVERY_SCREEN_FOLLOWS[number]>;

/**
 * The ids a change may name, each by what it identifies: a `playerDeck` change
 * names the Players whose decks changed, a `match` or `roundStandings` change
 * the Round it is in, a `match` change the Matches too where its message
 * names them, a `featureMatchSession` change its Slot.
 */
const CHANGE_ID_FIELDS = [
	'playerIds',
	'phaseIds',
	'roundIds',
	'matchIds',
	'slotIds',
	'archetypeIds',
	'playerListIds',
	'talentIds',
	'broadcastDeckListIds',
] as const;

type ChangeIdField = typeof CHANGE_ID_FIELDS[number];

/**
 * One change a Screen Output can show. An id field left out means the message
 * names none, a wholesale sync or a delete naming only what is gone: the
 * change may touch anything of its kind, so no narrowing by that id rules it
 * out.
 */
export interface OutputChange extends Readonly<Partial<Record<ChangeIdField, readonly number[]>>> {
	readonly kind: OutputChangeKind;
	/** The Screen the change belongs to, for the kinds that belong to one. */
	readonly screenId?: number;
}

/** The Players a Feature Match Slot seats now, whoever they are: the caller says (`ScreenHearsContext`). */
export interface SeatedPlayers {
	readonly seatedIn: number;
}

/**
 * The Match a Feature Match Slot follows now, or that Match's Round or Phase,
 * by the field it narrows: the caller says (`ScreenHearsContext`).
 */
export interface FollowedBySlot {
	readonly followedBy: number;
}

/** The id fields the Match a Slot follows can narrow. */
type SlotFollowedField = 'matchIds' | 'roundIds' | 'phaseIds';

/**
 * How a mode's config narrows a kind it follows: only changes naming one of
 * these ids. A change naming no id of a narrowed field is still heard.
 */
export interface OutputFollowNarrowing extends Readonly<Partial<Record<Exclude<ChangeIdField, 'playerIds' | SlotFollowedField>, readonly number[]>>>,
	Readonly<Partial<Record<SlotFollowedField, readonly number[] | FollowedBySlot>>> {
	readonly playerIds?: readonly number[] | SeatedPlayers;
}

/**
 * Whether a mode's output follows one kind of change: `true` for every such
 * change, or what its config says: none of them (`false`), all of them
 * (`true`), or those naming the ids the config names.
 */
export type OutputFollow<Config> = true | ((config: Config) => boolean | OutputFollowNarrowing);

/**
 * What a Screen Mode's output follows: each kind of change its rendering
 * shows, beyond what every Screen follows. A kind left out is ignored.
 */
export type ScreenModeOutputFollows<Config = any> = Readonly<Partial<Record<DeclaredOutputChangeKind, OutputFollow<Config>>>>;

const NOTHING_AN_OUTPUT_SHOWS: readonly OutputChange[] = [];

function wholeKinds(...kinds: OutputChangeKind[]): readonly OutputChange[] {
	return kinds.map(kind => ({ kind }));
}

/**
 * What each Event message changed. A mapped type over the message type union,
 * so a new message type fails to compile until its output meaning is decided.
 */
const OUTPUT_CHANGES: { [K in MessageType]: (payload: MessagePayload<K>) => readonly OutputChange[] } = {
	'event:updated': () => wholeKinds('event'),
	'event:deleted': () => wholeKinds('event'),
	'theme:updated': () => wholeKinds('theme'),

	'talent:created': ({ talent }) => [
		{
			kind: 'talent',
			talentIds: [talent.id],
		},
	],
	'talent:updated': ({ talent }) => [
		{
			kind: 'talent',
			talentIds: [talent.id],
		},
	],
	'talent:deleted': ({ talentId }) => [
		{
			kind: 'talent',
			talentIds: [talentId],
		},
	],

	'player:created': ({ player }) => [
		{
			kind: 'player',
			playerIds: [player.id],
		},
	],
	'player:updated': ({ player }) => [
		{
			kind: 'player',
			playerIds: [player.id],
		},
	],
	'player:deleted': ({ playerId }) => [
		{
			kind: 'player',
			playerIds: [playerId],
		},
	],
	// Naming no Player, it may have re-projected any of them (ADR-0084).
	'player:deckProjectionsChanged': ({ playerIds }) => [
		playerIds
			? { kind: 'player', playerIds }
			: { kind: 'player' },
	],
	'playerDeck:reviewed': ({ deck }) => [
		{
			kind: 'playerDeck',
			playerIds: [deck.playerId],
		},
	],
	'playerDeck:cardsResolved': ({ playerIds }) => [
		{ kind: 'playerDeck', playerIds },
	],

	'phase:created': ({ phase }) => [
		{
			kind: 'phase',
			phaseIds: [phase.id],
		},
	],
	'phase:updated': ({ phase }) => [
		{
			kind: 'phase',
			phaseIds: [phase.id],
		},
	],
	'phase:deleted': ({ phaseId }) => [
		{
			kind: 'phase',
			phaseIds: [phaseId],
		},
	],

	'round:created': ({ round }) => [
		{
			kind: 'round',
			roundIds: [round.id],
		},
	],
	'round:updated': ({ round }) => [
		{
			kind: 'round',
			roundIds: [round.id],
		},
	],
	'round:deleted': ({ roundId }) => [
		{
			kind: 'round',
			roundIds: [roundId],
		},
	],
	'round:matchesRefreshed': ({ roundId }) => [
		{
			kind: 'match',
			roundIds: [roundId],
		},
	],

	// A Match names the Round it is in now; one moved between Rounds does not name the Round it left.
	'match:created': ({ match }) => [
		{
			kind: 'match',
			roundIds: [match.roundId],
			matchIds: [match.id],
		},
	],
	'match:updated': ({ match }) => [
		{
			kind: 'match',
			roundIds: [match.roundId],
			matchIds: [match.id],
		},
	],
	// Names no Match: the delete unlinked each Slot following it, which by now follows none.
	'match:deleted': () => wholeKinds('match'),

	'featureMatch:created': ({ featureMatch }) => [
		{
			kind: 'featureMatchSlot',
			slotIds: [featureMatch.id],
		},
	],
	'featureMatch:updated': ({ featureMatch }) => [
		{
			kind: 'featureMatchSlot',
			slotIds: [featureMatch.id],
		},
	],
	'featureMatch:deleted': ({ featureMatchId }) => [
		{
			kind: 'featureMatchSlot',
			slotIds: [featureMatchId],
		},
	],
	'featureMatch:reordered': ({ featureMatches }) => [
		{
			kind: 'featureMatchSlot',
			slotIds: featureMatches.map(slot => slot.featureMatchId),
		},
	],

	// A Feature Match Assignment carries its Feature Match Note, which only
	// operators read. A rendering following a Slot's Assignment follows the Slot.
	'featureMatchAssignment:created': () => NOTHING_AN_OUTPUT_SHOWS,
	'featureMatchAssignment:updated': () => NOTHING_AN_OUTPUT_SHOWS,
	'featureMatchAssignment:deleted': () => NOTHING_AN_OUTPUT_SHOWS,

	'featureMatchSession:eventApplied': ({ slotId }) => [
		{
			kind: 'featureMatchSession',
			slotIds: [slotId],
		},
	],

	'broadcastGraphicsLiveSession:commandApplied': ({ screenId }) => [
		{ kind: 'broadcastGraphicsLiveSession', screenId },
	],
	'broadcastGraphicsLiveSession:epochEnded': ({ screenId }) => [
		{ kind: 'broadcastGraphicsLiveSession', screenId },
	],

	'playerList:created': ({ playerList }) => [
		{
			kind: 'playerList',
			playerListIds: [playerList.id],
		},
	],
	'playerList:updated': ({ playerList }) => [
		{
			kind: 'playerList',
			playerListIds: [playerList.id],
		},
	],
	'playerList:deleted': ({ listId }) => [
		{
			kind: 'playerList',
			playerListIds: [listId],
		},
	],
	'playerList:membersChanged': ({ listId }) => [
		{
			kind: 'playerList',
			playerListIds: [listId],
		},
	],

	'broadcastDeckList:created': ({ listId }) => [
		{
			kind: 'broadcastDeckList',
			broadcastDeckListIds: [listId],
		},
	],
	'broadcastDeckList:updated': ({ listId }) => [
		{
			kind: 'broadcastDeckList',
			broadcastDeckListIds: [listId],
		},
	],
	'broadcastDeckList:deleted': ({ listId }) => [
		{
			kind: 'broadcastDeckList',
			broadcastDeckListIds: [listId],
		},
	],

	'archetype:created': ({ archetype }) => [
		{
			kind: 'archetype',
			archetypeIds: [archetype.id],
		},
	],
	'archetype:updated': ({ archetype }) => [
		{
			kind: 'archetype',
			archetypeIds: [archetype.id],
		},
	],
	'archetype:deleted': ({ archetypeId }) => [
		{
			kind: 'archetype',
			archetypeIds: [archetypeId],
		},
	],
	'archetype:keyCardsUpdated': ({ archetypeId }) => [
		{
			kind: 'archetype',
			archetypeIds: [archetypeId],
		},
	],

	// Melee's wholesale syncs, and a TCG+ Import, rewrite whole kinds. They name
	// no id here, the Phases and Rounds a structure sync lists included: every
	// rendering of those kinds re-reads on them today, whichever it shows.
	'melee:dataReset': () => wholeKinds('player', 'playerDeck', 'phase', 'round', 'match', 'roundStandings', 'featureMatchSlot'),
	'melee:structureSynced': () => wholeKinds('phase', 'round'),
	'melee:playersSynced': () => wholeKinds('player'),
	'melee:decklistsSynced': () => wholeKinds('playerDeck'),
	'tcgplus:imported': () => wholeKinds('player', 'playerDeck'),

	'melee:featureMatchesSynced': ({ slotIds }) => [
		{ kind: 'featureMatchSlot', slotIds },
	],
	'melee:matchResultsSynced': ({ roundId, matchIds }) => [
		{
			kind: 'match',
			roundIds: [roundId],
			matchIds,
		},
	],
	// Names no Match: it may have added, re-seated or removed any in the Round.
	'melee:pairingsSynced': ({ roundId }) => [
		{
			kind: 'match',
			roundIds: [roundId],
		},
	],
	'melee:roundStandingsSynced': ({ roundId }) => [
		{
			kind: 'roundStandings',
			roundIds: [roundId],
		},
	],

	'card:updated': ({ screenId }) => [
		{ kind: 'screenCard', screenId },
	],
	// The card an operator is looking at before saving it: no rendering shows it.
	'card:preview': () => NOTHING_AN_OUTPUT_SHOWS,
	'card:cleared': ({ screenId }) => [
		{ kind: 'screenCard', screenId },
	],

	'screen:created': ({ screenId }) => [
		{ kind: 'screen', screenId },
	],
	'screen:updated': ({ screenId }) => [
		{ kind: 'screen', screenId },
	],
	'screen:deleted': ({ screenId }) => [
		{ kind: 'screen', screenId },
	],

	// Commands to a Screen's outputs, on that Screen's own channel: no change to what one shows.
	'screen:command:refresh': () => NOTHING_AN_OUTPUT_SHOWS,
	'screen:command:identify': () => NOTHING_AN_OUTPUT_SHOWS,
	'screen:command:debug': () => NOTHING_AN_OUTPUT_SHOWS,

	// What a Screen's channel tells its outputs of the changes above: no change of their own.
	'output:eventContextChanged': () => NOTHING_AN_OUTPUT_SHOWS,
	'output:modeDataChanged': () => NOTHING_AN_OUTPUT_SHOWS,
};

/** Every message type, for a caller applying the rule to whatever its channel carries. */
export const OUTPUT_CHANGE_MESSAGE_TYPES = Object.keys(OUTPUT_CHANGES) as MessageType[];

/**
 * The changes one Event message represents, with the ids it names; none for a
 * message carrying nothing an output shows.
 */
export function outputChangeOf<K extends MessageType>(type: K, payload: MessagePayload<K>): readonly OutputChange[] {
	return OUTPUT_CHANGES[type](payload);
}

/** The Screen asked about: its id, its current mode, and that mode's saved config, completed from its defaults. */
export interface HearingScreen<M extends ScreenMode = ScreenMode> {
	readonly id: number;
	readonly mode: M;
	readonly config: ModeConfigTypeMap[M];
}

/** What `screenHears` cannot read from the Screen itself. */
export interface ScreenHearsContext {
	/**
	 * The Feature Match Slot the Screen shows, as it stands after the write:
	 * the Players it seats, and the Match it follows with that Match's Round
	 * and Phase, `null` when it follows none. `match` left out is not told.
	 */
	readonly slot?: {
		readonly id: number;
		readonly playerIds: readonly number[];
		readonly match?: { readonly id: number; readonly roundId: number; readonly phaseId: number } | null;
	} | null;
}

/** The ids one narrowed field admits; `null` while they cannot be known, which admits every id. */
function admittedIds(
	field: ChangeIdField,
	named: readonly number[] | SeatedPlayers | FollowedBySlot,
	context: ScreenHearsContext,
): readonly number[] | null {
	if ('seatedIn' in named) {
		// Over-approximation: who a Slot seats is the Slot's data, not the
		// config's. Told nothing, or of another Slot, every Player is heard.
		return context.slot?.id === named.seatedIn
			? context.slot.playerIds
			: null;
	}
	if ('followedBy' in named) {
		// Over-approximation: told nothing, or of another Slot, every id is heard.
		const match = context.slot?.id === named.followedBy
			? context.slot.match
			: undefined;
		if (match === undefined)
			return null;
		// A Slot following no Match shows none, so no named Match is its own.
		// Its Round and Phase stay unknown: the change may be the delete that
		// took its Match away, which names only the Round or Phase deleted.
		if (field === 'matchIds') {
			return match
				? [match.id]
				: [];
		}
		if (!match)
			return null;
		return [
			field === 'roundIds'
				? match.roundId
				: match.phaseId,
		];
	}
	return named;
}

function narrowingAdmits(narrowing: OutputFollowNarrowing, change: OutputChange, context: ScreenHearsContext): boolean {
	return CHANGE_ID_FIELDS.every((field) => {
		const named = narrowing[field];
		const changed = change[field];
		// A change naming no id of this field may touch any of them.
		if (named === undefined || changed === undefined)
			return true;
		const admitted = admittedIds(field, named, context);
		return admitted === null || changed.some(id => admitted.includes(id));
	});
}

/** What a Screen's mode declares for one kind, as its config narrows it: every such change, none, or those naming these ids. */
function declaredFollow(screen: HearingScreen, kind: OutputChangeKind): boolean | OutputFollowNarrowing {
	const follow = SCREEN_MODES[screen.mode].outputFollows[kind as DeclaredOutputChangeKind];
	if (!follow)
		return false;
	return follow === true || follow(screen.config);
}

/**
 * The Feature Match Slot whose seated Players narrow what a Screen hears of
 * one kind of change, or `null` when none does. Who it seats is for the
 * caller to read and pass as `ScreenHearsContext.slot`.
 */
export function seatedSlotOf(screen: HearingScreen, kind: OutputChangeKind): number | null {
	const narrowed = declaredFollow(screen, kind);
	return typeof narrowed === 'object' && narrowed.playerIds !== undefined && 'seatedIn' in narrowed.playerIds
		? narrowed.playerIds.seatedIn
		: null;
}

/**
 * The Feature Match Slot whose row decides whether a Screen hears `change`, or
 * `null` when none does: the mode narrows the change's kind by what a Slot
 * seats or follows, and the change names an id that narrowing can rule out.
 * The caller reads that Slot and passes it as `ScreenHearsContext.slot`.
 */
export function slotNarrowingOf(screen: HearingScreen, change: OutputChange): number | null {
	const narrowed = declaredFollow(screen, change.kind);
	if (typeof narrowed !== 'object')
		return null;
	for (const field of CHANGE_ID_FIELDS) {
		const named = narrowed[field];
		if (named === undefined || change[field] === undefined || Array.isArray(named))
			continue;
		if ('seatedIn' in named)
			return named.seatedIn;
		if ('followedBy' in named)
			return named.followedBy;
	}
	return null;
}

/**
 * Whether a Screen's output shows `change`, and so should re-read.
 *
 * Every Screen follows its own Screen, its Event and its Theme. Beyond those
 * the answer comes from what its mode's Screen Mode Definition declares its
 * output follows (`outputFollows`), narrowed by the Screen's config.
 */
export function screenHears<M extends ScreenMode>(
	screen: HearingScreen<M>,
	change: OutputChange,
	context: ScreenHearsContext = {},
): boolean {
	if (change.screenId !== undefined && change.screenId !== screen.id)
		return false;
	if ((EVERY_SCREEN_FOLLOWS as readonly OutputChangeKind[]).includes(change.kind))
		return true;

	const narrowed = declaredFollow(screen, change.kind);
	return typeof narrowed === 'boolean'
		? narrowed
		: narrowingAdmits(narrowed, change, context);
}
