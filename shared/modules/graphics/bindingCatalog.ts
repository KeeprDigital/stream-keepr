import type { SocialProfiles } from '../../socialProfiles';
import type { Game, PositionFormat, RecordSeparator } from '../../types/enums';
import type { FeatureMatchState } from '../../types/featureMatchState';
import type { PlayerGameData } from '../../types/game';
import type {
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicSourceSelectionKind,
} from '../../types/graphics';
import { canonicalSocialProfileUrl, SUPPORTED_SOCIAL_NETWORKS } from '../../socialProfiles';
import { formatOrdinal } from '../../utils/formatters';
import { getMtgGameData, getOpGameData } from '../../utils/gameData';

/**
 * The Graphic Input Binding field catalog.
 *
 * ## Why a catalog rather than Event Data itself
 *
 * A Graphic Input Binding maps one Graphic Input to one *named field*, and this
 * module is the list of names. It is deliberately not a projection of storage or of
 * the API: a stored column is free to be renamed, split, or made nullable, and a
 * placed Broadcast Graphic that survives a season cannot have its bindings break
 * because of it. Everything an operator can bind to is written out here by hand,
 * with a stable id, a label they read, and the one Graphic Input type it fits.
 *
 * Three consequences follow, and each is a rule rather than a convenience:
 *
 * - **Common versus game-specific.** A field with no `game` is common to every
 *   Event; a field naming one is offered only on that game's Events. A Magic deck
 *   name and a One Piece leader are the same idea in different games and are
 *   deliberately *not* merged into one "identity" field, because a lower third
 *   saying "Leader" on a Magic broadcast is worse than one field fewer.
 * - **Atomic and broadcast-formatted, both named.** `player.wins` is the stored
 *   number; `player.record` is the composed "4-1" an operator actually wants in a
 *   lower third, using the Event's own separator and zero-draw rule. Formatting
 *   lives here, once, rather than in a Graphic Text Template — because a
 *   `{inputKey}` placeholder has no formatting vocabulary by design.
 * - **No collections and no clocks.** Every field resolves to one scalar. A
 *   ticking clock and a counter list are Graphic Items with their own definitions,
 *   so binding them here would be inventing a second, worse renderer for them.
 *
 * ## Resolution is total and never coerced
 *
 * A field resolves to a value or to `undefined`. `undefined` means the binding is
 * unavailable, which every caller treats as "cannot go on air" rather than as a
 * reason to substitute the Graphic Input's declared default. Nothing here clamps,
 * truncates, or invents a value: a Player with no recorded position has no
 * position, and a lower third bound to it shows nothing rather than a zero.
 *
 * The three `toggle` fields are the stated exception. A boolean has no absence to
 * render, and "this Match has no recorded result" is exactly what `false` means
 * there, so they resolve `false` rather than `undefined` — otherwise a toggle-gated
 * Graphic Item would become inoperable rather than simply off. Every non-toggle field
 * follows the rule without exception.
 */

/** Whether a field is one stored value or a composed broadcast rendering of several. */
export const GRAPHIC_BINDING_FIELD_SHAPE_VALUES = ['atomic', 'formatted'] as const;

export type GraphicBindingFieldShape = typeof GRAPHIC_BINDING_FIELD_SHAPE_VALUES[number];

/** The Event facts the catalog reads, including how this Event formats for broadcast. */
export interface GraphicBindingEvent {
	name: string;
	description?: string | null;
	game: Game;
	displayRecordSeparator?: RecordSeparator;
	displayHideZeroDraws?: boolean;
	displayPositionFormat?: PositionFormat;
	commentator1TalentId?: number | null;
	commentator2TalentId?: number | null;
}

/**
 * A Player as a binding reads one.
 *
 * Deliberately the shape a production snapshot and a live Event Player have in
 * common, because a Player derived from a Match or Feature Match Slot resolves from
 * that snapshot while a directly selected one follows current Event Data. Both
 * answer the same field names, so the catalog needs one entry per field rather than
 * one per provenance.
 */
export interface GraphicBindingPlayer {
	name?: string | null;
	pronouns?: string | null;
	wins?: number | null;
	losses?: number | null;
	draws?: number | null;
	position?: number | null;
	points?: number | null;
	archetypeId?: number | null;
	lgs?: string | null;
	gameData?: PlayerGameData | null;
}

export interface GraphicBindingTalent {
	name: string;
	socialProfiles: SocialProfiles;
}

export interface GraphicBindingPhase {
	name: string;
}

export interface GraphicBindingRound {
	name: string;
	roundNumber: number;
	phaseId: number;
}

export interface GraphicBindingMatch {
	roundId: number;
	tableNumber?: number | null;
	player1Data?: GraphicBindingPlayer | null;
	player2Data?: GraphicBindingPlayer | null;
	hasResult?: boolean;
	isBye?: boolean;
	resultString?: string | null;
	player1GameWins?: number | null;
	player2GameWins?: number | null;
}

/**
 * A Feature Match Slot as a binding reads one.
 *
 * Its identity fields come from the active Feature Match Session's source snapshot
 * while one is running, and its live fields from that session's current state — the
 * settled rule that a slot under production reports what production is showing
 * rather than what the tournament has since become.
 */
export interface GraphicBindingFeatureMatchSlot {
	matchId?: number | null;
	tableNumber?: number | null;
	roundName?: string | null;
	formatName?: string | null;
	bestOf?: number;
	player1Data?: GraphicBindingPlayer | null;
	player2Data?: GraphicBindingPlayer | null;
	activeSession?: {
		sourceSnapshot?: {
			tableNumber?: number | null;
			roundName?: string | null;
			formatName?: string | null;
			bestOf?: number;
			player1?: { data?: GraphicBindingPlayer | null } | null;
			player2?: { data?: GraphicBindingPlayer | null } | null;
		} | null;
		currentState?: FeatureMatchState | null;
	} | null;
}

export interface GraphicBindingArchetype {
	name: string;
	colors?: string | null;
}

/**
 * The Event Data one placed Broadcast Graphic's Graphic Source Selections resolve
 * against.
 *
 * Keyed by entity id rather than listed, because a Graphic Source Selection is
 * single-entity: the set is the entities some selection names, never a collection a
 * binding may search. The server assembles it from the database and Live Control
 * from its Event Data stores, and both hand it to the same pure resolution.
 */
export interface GraphicBindingDataSet {
	event: GraphicBindingEvent | null;
	players: Readonly<Record<number, GraphicBindingPlayer>>;
	talents: Readonly<Record<number, GraphicBindingTalent>>;
	phases: Readonly<Record<number, GraphicBindingPhase>>;
	rounds: Readonly<Record<number, GraphicBindingRound>>;
	matches: Readonly<Record<number, GraphicBindingMatch>>;
	featureMatchSlots: Readonly<Record<number, GraphicBindingFeatureMatchSlot>>;
	archetypes: Readonly<Record<number, GraphicBindingArchetype>>;
}

export function createEmptyGraphicBindingDataSet(): GraphicBindingDataSet {
	return {
		event: null,
		players: {},
		talents: {},
		phases: {},
		rounds: {},
		matches: {},
		featureMatchSlots: {},
		archetypes: {},
	};
}

/** One named, typed, bindable field on one Graphic Source Selection kind. */
export interface GraphicBindingField<TEntity = unknown> {
	/** The stable id a Graphic Input Binding stores. Never renamed. */
	id: string;
	/** What an operator reads when choosing a field. */
	label: string;
	/** The one Graphic Input type this field may bind to. */
	type: GraphicInputDeclaration['type'];
	shape: GraphicBindingFieldShape;
	/** Present when only this game's Events have the field. */
	game?: Game;
	resolve: (entity: TEntity, data: GraphicBindingDataSet) => GraphicInputValue | undefined;
}

/** Which entity each Graphic Source Selection kind resolves to. */
export interface GraphicBindingEntityByKind {
	'event': GraphicBindingEvent;
	'player': GraphicBindingPlayer;
	'talent': GraphicBindingTalent;
	'phase': GraphicBindingPhase;
	'round': GraphicBindingRound;
	'match': GraphicBindingMatch;
	'feature-match-slot': GraphicBindingFeatureMatchSlot;
	'archetype': GraphicBindingArchetype;
}

export type GraphicBindingCatalog = {
	[Kind in GraphicSourceSelectionKind]: readonly GraphicBindingField<GraphicBindingEntityByKind[Kind]>[];
};

/** A stored string field: absent, null, and blank are all "no value". */
function textOf(value: string | null | undefined): string | undefined {
	if (value === null || value === undefined)
		return undefined;
	return value.trim() === '' ? undefined : value;
}

function numberOf(value: number | null | undefined): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A Player's record, in this Event's broadcast form.
 *
 * The separator and the zero-draw rule are Event configuration because they are a
 * production style choice, and this is the same rule the Feature Match Overlay and
 * standings already render — one Event shows one record format everywhere.
 *
 * A Player with no recorded results has no record: the fields are absent rather
 * than zero, and reporting "0-0" would be inventing a result.
 */
function formattedRecord(player: GraphicBindingPlayer, event: GraphicBindingEvent | null): string | undefined {
	const wins = numberOf(player.wins);
	const losses = numberOf(player.losses);
	const draws = numberOf(player.draws);
	if (wins === undefined && losses === undefined && draws === undefined)
		return undefined;

	const separator = event?.displayRecordSeparator ?? '-';
	const hideZeroDraws = event?.displayHideZeroDraws ?? true;
	const parts = [wins ?? 0, losses ?? 0];
	if (!(hideZeroDraws && (draws ?? 0) === 0))
		parts.push(draws ?? 0);

	return parts.join(separator);
}

function formattedPosition(player: GraphicBindingPlayer, event: GraphicBindingEvent | null): string | undefined {
	const position = numberOf(player.position);
	if (position === undefined)
		return undefined;
	return event?.displayPositionFormat === 'number' ? String(position) : formatOrdinal(position);
}

function formattedTable(tableNumber: number | null | undefined): string | undefined {
	const table = numberOf(tableNumber);
	return table === undefined ? undefined : `Table ${table}`;
}

/** The Feature Match Session source snapshot a slot reports its identity from, if any. */
function slotSnapshot(slot: GraphicBindingFeatureMatchSlot) {
	return slot.activeSession?.sourceSnapshot ?? null;
}

/** The live Feature Match state a slot reports its live scalars from, if any. */
function slotLiveState(slot: GraphicBindingFeatureMatchSlot): FeatureMatchState | null {
	return slot.activeSession?.currentState ?? null;
}

const EVENT_FIELDS: readonly GraphicBindingField<GraphicBindingEvent>[] = [
	{ id: 'event.name', label: 'Event name', type: 'text', shape: 'atomic', resolve: event => textOf(event.name) },
	{ id: 'event.description', label: 'Event description', type: 'text', shape: 'atomic', resolve: event => textOf(event.description) },
	{
		id: 'event.gameName',
		label: 'Game name',
		type: 'text',
		shape: 'formatted',
		// The stored value is a code (`mtg`); a broadcast wants the game's own name. A
		// switch rather than a ternary so adding a game is a compile error here rather
		// than a broadcast silently captioned with the wrong game.
		resolve: (event) => {
			switch (event.game) {
				case 'mtg':
					return 'Magic: The Gathering';
				case 'op':
					return 'One Piece';
			}
		},
	},
];

const PLAYER_FIELDS: readonly GraphicBindingField<GraphicBindingPlayer>[] = [
	{ id: 'player.name', label: 'Name', type: 'text', shape: 'atomic', resolve: player => textOf(player.name) },
	{ id: 'player.pronouns', label: 'Pronouns', type: 'text', shape: 'atomic', resolve: player => textOf(player.pronouns) },
	{ id: 'player.wins', label: 'Wins', type: 'number', shape: 'atomic', resolve: player => numberOf(player.wins) },
	{ id: 'player.losses', label: 'Losses', type: 'number', shape: 'atomic', resolve: player => numberOf(player.losses) },
	{ id: 'player.draws', label: 'Draws', type: 'number', shape: 'atomic', resolve: player => numberOf(player.draws) },
	{ id: 'player.points', label: 'Points', type: 'number', shape: 'atomic', resolve: player => numberOf(player.points) },
	{ id: 'player.position', label: 'Standing', type: 'number', shape: 'atomic', resolve: player => numberOf(player.position) },
	{
		id: 'player.record',
		label: 'Record (W-L-D)',
		type: 'text',
		shape: 'formatted',
		resolve: (player, data) => formattedRecord(player, data.event),
	},
	{
		id: 'player.positionDisplay',
		label: 'Standing (formatted)',
		type: 'text',
		shape: 'formatted',
		resolve: (player, data) => formattedPosition(player, data.event),
	},
	{
		id: 'player.archetypeName',
		label: 'Archetype',
		type: 'text',
		shape: 'atomic',
		// One field of one related entity, reached by the Player's own Archetype
		// reference — the same fixed relationship an operator would otherwise have to
		// select a second time.
		resolve: (player, data) => {
			const archetypeId = numberOf(player.archetypeId);
			if (archetypeId === undefined)
				return undefined;
			return textOf(data.archetypes[archetypeId]?.name);
		},
	},
	{ id: 'player.lgs', label: 'Local game store', type: 'text', shape: 'atomic', resolve: player => textOf(player.lgs) },
	{
		id: 'player.deckName',
		label: 'Deck name',
		type: 'text',
		shape: 'atomic',
		game: 'mtg',
		resolve: player => textOf(getMtgGameData(player.gameData).deckName),
	},
	{
		id: 'player.deckColors',
		label: 'Deck colours',
		type: 'text',
		shape: 'atomic',
		game: 'mtg',
		resolve: player => textOf(getMtgGameData(player.gameData).deckColors),
	},
	{
		id: 'player.leader',
		label: 'Leader',
		type: 'text',
		shape: 'atomic',
		game: 'op',
		resolve: player => textOf(getOpGameData(player.gameData).leader),
	},
];

const TALENT_FIELDS: readonly GraphicBindingField<GraphicBindingTalent>[] = [
	{ id: 'talent.name', label: 'Name', type: 'text', shape: 'atomic', resolve: talent => textOf(talent.name) },
	...SUPPORTED_SOCIAL_NETWORKS.flatMap(network => [
		{
			id: `talent.${network.key}Handle`,
			label: `${network.label} handle`,
			type: 'text' as const,
			shape: 'atomic' as const,
			resolve: (talent: GraphicBindingTalent) => textOf(talent.socialProfiles[network.key]),
		},
		{
			id: `talent.${network.key}ProfileUrl`,
			label: `${network.label} profile URL`,
			type: 'text' as const,
			shape: 'formatted' as const,
			resolve: (talent: GraphicBindingTalent) => {
				const handle = textOf(talent.socialProfiles[network.key]);
				return handle === undefined ? undefined : canonicalSocialProfileUrl(network.key, handle);
			},
		},
	]),
];

const PHASE_FIELDS: readonly GraphicBindingField<GraphicBindingPhase>[] = [
	{ id: 'phase.name', label: 'Phase name', type: 'text', shape: 'atomic', resolve: phase => textOf(phase.name) },
];

const ROUND_FIELDS: readonly GraphicBindingField<GraphicBindingRound>[] = [
	{ id: 'round.name', label: 'Round name', type: 'text', shape: 'atomic', resolve: round => textOf(round.name) },
	{ id: 'round.number', label: 'Round number', type: 'number', shape: 'atomic', resolve: round => numberOf(round.roundNumber) },
];

const MATCH_FIELDS: readonly GraphicBindingField<GraphicBindingMatch>[] = [
	{ id: 'match.tableNumber', label: 'Table number', type: 'number', shape: 'atomic', resolve: match => numberOf(match.tableNumber) },
	{ id: 'match.tableLabel', label: 'Table (formatted)', type: 'text', shape: 'formatted', resolve: match => formattedTable(match.tableNumber) },
	{ id: 'match.result', label: 'Result', type: 'text', shape: 'atomic', resolve: match => textOf(match.resultString) },
	{ id: 'match.player1GameWins', label: 'Player 1 game wins', type: 'number', shape: 'atomic', resolve: match => numberOf(match.player1GameWins) },
	{ id: 'match.player2GameWins', label: 'Player 2 game wins', type: 'number', shape: 'atomic', resolve: match => numberOf(match.player2GameWins) },
	{
		id: 'match.gameWinsLine',
		label: 'Game wins (formatted)',
		type: 'text',
		shape: 'formatted',
		resolve: (match) => {
			const first = numberOf(match.player1GameWins);
			const second = numberOf(match.player2GameWins);
			return first === undefined || second === undefined ? undefined : `${first} - ${second}`;
		},
	},
	// The three toggle fields are the module's one documented exception to "resolve
	// nothing rather than invent something": a boolean has no absence to report, and a
	// Match with no recorded result has, factually, not got one. Absent reads as false
	// rather than as unavailable, so a toggle-gated Graphic Item stays operable.
	{ id: 'match.hasResult', label: 'Has a result', type: 'toggle', shape: 'atomic', resolve: match => match.hasResult ?? false },
	{ id: 'match.isBye', label: 'Is a bye', type: 'toggle', shape: 'atomic', resolve: match => match.isBye ?? false },
];

/**
 * A Feature Match Slot's bindable fields: identity from the production snapshot,
 * plus the discrete live scalars.
 *
 * Life totals, game wins, the current game, and the turn number are discrete
 * scalars that change on an operator action, which is what makes them bindable at
 * all. The clock is deliberately absent — it advances continuously, so a bound
 * value would be a stale number the moment it was accepted, and rendering it is the
 * Clock Graphic Item's job. Counters are a collection for the same kind of reason.
 */
const FEATURE_MATCH_SLOT_FIELDS: readonly GraphicBindingField<GraphicBindingFeatureMatchSlot>[] = [
	{
		id: 'featureMatchSlot.tableNumber',
		label: 'Table number',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotSnapshot(slot)?.tableNumber ?? slot.tableNumber),
	},
	{
		id: 'featureMatchSlot.tableLabel',
		label: 'Table (formatted)',
		type: 'text',
		shape: 'formatted',
		resolve: slot => formattedTable(slotSnapshot(slot)?.tableNumber ?? slot.tableNumber),
	},
	{
		id: 'featureMatchSlot.roundName',
		label: 'Round name',
		type: 'text',
		shape: 'atomic',
		resolve: slot => textOf(slotSnapshot(slot)?.roundName ?? slot.roundName),
	},
	{
		id: 'featureMatchSlot.formatName',
		label: 'Format name',
		type: 'text',
		shape: 'atomic',
		resolve: slot => textOf(slotSnapshot(slot)?.formatName ?? slot.formatName),
	},
	{
		id: 'featureMatchSlot.bestOf',
		label: 'Best of',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotSnapshot(slot)?.bestOf ?? slot.bestOf),
	},
	{
		id: 'featureMatchSlot.player1Life',
		label: 'Player 1 life total',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.player1.lifeTotal),
	},
	{
		id: 'featureMatchSlot.player2Life',
		label: 'Player 2 life total',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.player2.lifeTotal),
	},
	{
		id: 'featureMatchSlot.player1GameWins',
		label: 'Player 1 game wins',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.player1.gameWins),
	},
	{
		id: 'featureMatchSlot.player2GameWins',
		label: 'Player 2 game wins',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.player2.gameWins),
	},
	{
		id: 'featureMatchSlot.gameWinsLine',
		label: 'Game wins (formatted)',
		type: 'text',
		shape: 'formatted',
		resolve: (slot) => {
			const live = slotLiveState(slot);
			return live ? `${live.player1.gameWins} - ${live.player2.gameWins}` : undefined;
		},
	},
	{
		id: 'featureMatchSlot.currentGame',
		label: 'Current game',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.currentGame),
	},
	{
		id: 'featureMatchSlot.turnNumber',
		label: 'Turn number',
		type: 'number',
		shape: 'atomic',
		resolve: slot => numberOf(slotLiveState(slot)?.turnNumber),
	},
	{
		id: 'featureMatchSlot.isComplete',
		label: 'Match complete',
		type: 'toggle',
		shape: 'atomic',
		// Absent reads as false, as with the Match toggles above: a slot with no live
		// session has not completed a match.
		resolve: slot => slotLiveState(slot)?.isComplete ?? false,
	},
];

const ARCHETYPE_FIELDS: readonly GraphicBindingField<GraphicBindingArchetype>[] = [
	{ id: 'archetype.name', label: 'Archetype name', type: 'text', shape: 'atomic', resolve: archetype => textOf(archetype.name) },
	{ id: 'archetype.colors', label: 'Archetype colours', type: 'text', shape: 'atomic', resolve: archetype => textOf(archetype.colors) },
];

export const GRAPHIC_BINDING_CATALOG: GraphicBindingCatalog = {
	'event': EVENT_FIELDS,
	'player': PLAYER_FIELDS,
	'talent': TALENT_FIELDS,
	'phase': PHASE_FIELDS,
	'round': ROUND_FIELDS,
	'match': MATCH_FIELDS,
	'feature-match-slot': FEATURE_MATCH_SLOT_FIELDS,
	'archetype': ARCHETYPE_FIELDS,
};

/** What an author reads when choosing what one Graphic Source Selection selects. */
export const GRAPHIC_SOURCE_SELECTION_KIND_LABELS: Record<GraphicSourceSelectionKind, string> = {
	'event': 'Current Event',
	'player': 'Player',
	'talent': 'Talent',
	'phase': 'Phase',
	'round': 'Round',
	'match': 'Match',
	'feature-match-slot': 'Feature Match Slot',
	'archetype': 'Archetype',
};

/**
 * The fields one Graphic Source Selection kind offers, on this Event's game.
 *
 * Passing no game offers every field, which is what an authoring surface with no
 * Event context needs; passing one offers exactly the fields that Event can
 * resolve.
 */
export function graphicBindingFields<Kind extends GraphicSourceSelectionKind>(
	kind: Kind,
	game?: Game,
): readonly GraphicBindingField<GraphicBindingEntityByKind[Kind]>[] {
	const fields = GRAPHIC_BINDING_CATALOG[kind];
	if (game === undefined)
		return fields;
	return fields.filter(field => field.game === undefined || field.game === game);
}

/** One catalog field by the id a Graphic Input Binding stores. */
export function graphicBindingField(
	kind: GraphicSourceSelectionKind,
	fieldId: string,
): GraphicBindingField<unknown> | undefined {
	return (GRAPHIC_BINDING_CATALOG[kind] as readonly GraphicBindingField<unknown>[])
		.find(field => field.id === fieldId);
}

/**
 * Whether a Graphic Input of this type may bind to this field.
 *
 * Type compatibility is decided by the catalog rather than by conversion: a text
 * Graphic Input bound to a number field would need a formatting decision nobody
 * authored, so the catalog names the broadcast-formatted text field instead.
 */
export function isGraphicBindingFieldCompatible(
	kind: GraphicSourceSelectionKind,
	fieldId: string,
	inputType: GraphicInputDeclaration['type'],
	game?: Game,
): boolean {
	const field = graphicBindingField(kind, fieldId);
	if (!field)
		return false;
	if (field.game !== undefined && game !== undefined && field.game !== game)
		return false;
	return field.type === inputType;
}

/**
 * The fields one Graphic Input may bind to, split the way an author reads them.
 *
 * Two filters at once, because an author choosing a field is asking one question:
 * type compatibility, which the catalog decides rather than conversion, and this
 * Event's game. The split is the catalog's own rule made visible — a Magic deck name
 * and a One Piece leader are separate fields on purpose, so an author has to see
 * which of the two they are choosing.
 *
 * Passing no game keeps every game's fields in `gameSpecific`, which is the lenient
 * no-Event-context case `graphicBindingFields` already documents.
 */
export function bindableGraphicBindingFields(
	kind: GraphicSourceSelectionKind,
	inputType: GraphicInputDeclaration['type'],
	game?: Game,
): { common: GraphicBindingField<unknown>[]; gameSpecific: GraphicBindingField<unknown>[] } {
	const fields = (graphicBindingFields(kind, game) as readonly GraphicBindingField<unknown>[])
		.filter(field => field.type === inputType);

	return {
		common: fields.filter(field => field.game === undefined),
		gameSpecific: fields.filter(field => field.game !== undefined),
	};
}

/** Every field id the catalog defines, across every Graphic Source Selection kind. */
export function graphicBindingFieldIds(): string[] {
	return Object.values(GRAPHIC_BINDING_CATALOG).flatMap(fields => fields.map(field => field.id));
}

/**
 * Whether the catalog defines this field id at all.
 *
 * Enough for a write-time check that a stored `fieldId` is a catalog name rather
 * than an invented path. Whether it is the right field for its Graphic Source
 * Selection's kind and its Graphic Input's type is decided at resolution, where
 * both are known together.
 */
export function isKnownGraphicBindingFieldId(fieldId: string): boolean {
	return graphicBindingFieldIds().includes(fieldId);
}

/**
 * What one catalog field resolves to for one entity.
 *
 * The single cast in this module: the catalog is defined per kind with its entity
 * type, and this is the seam where a `fieldId` looked up at runtime meets the
 * entity a Graphic Source Selection resolved. Callers pass the entity the same kind
 * produced, which the resolution module guarantees.
 */
export function resolveGraphicBindingField<Kind extends GraphicSourceSelectionKind>(
	kind: Kind,
	fieldId: string,
	entity: GraphicBindingEntityByKind[Kind],
	data: GraphicBindingDataSet,
): GraphicInputValue | undefined {
	return graphicBindingField(kind, fieldId)?.resolve(entity, data);
}
