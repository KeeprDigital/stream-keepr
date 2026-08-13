import type { ExternalSource, Game, PlayerDisplayMode, PlayerSide } from './enums';
import type { FeatureMatchDefaults } from './featureMatchDefaults';
import type { FeatureMatchState } from './featureMatchState';
import type { PlayerGameData } from './game';

export const FEATURE_MATCH_SESSION_STATUS_VALUES = ['active', 'closed'] as const;
export type FeatureMatchSessionStatus = typeof FEATURE_MATCH_SESSION_STATUS_VALUES[number];

export const FEATURE_MATCH_SESSION_EVENT_TYPE_VALUES = [
	'SessionStarted',
	'SnapshotCorrected',
	'AdjustLife',
	'SetLife',
	'SetCounters',
	'SetCardsKept',
	'AdjustClock',
	'SetClock',
	'StartClock',
	'PauseClock',
	'ResetClock',
	'RestartClock',
	'SelectFirstPlayer',
	'SetFirstPlayer',
	'SetActivePlayer',
	'SetTurnNumber',
	'RecordGameWin',
	'UndoGameWin',
	'ResetState',
	'StartOvertime',
	'StepTurn',
	'StepOvertime',
	'SwapPlayers',
] as const;

export type FeatureMatchSessionEventType = typeof FEATURE_MATCH_SESSION_EVENT_TYPE_VALUES[number];
export type FeatureMatchCommandType = Exclude<FeatureMatchSessionEventType, 'SessionStarted'>;

/**
 * Commands a writer who got in first does not invalidate, so a losing one is
 * re-reduced onto the newer Session rather than rejected.
 *
 * The relative intents qualify because they compose with whatever landed first.
 * `SnapshotCorrected` qualifies for the other reason a command can: it is
 * absolute but scoped to its own field. It replaces the frozen source snapshot
 * and returns `currentState` untouched, so it cannot lose an operator's life
 * tick — and an operator's command cannot lose the correction, because the
 * retry reduces onto the state that command produced. It is server-only, minted
 * by the reverse sync from the database rather than accepted from a client, so
 * nothing here widens what an operator may send unsequenced.
 */
export const MERGEABLE_FEATURE_MATCH_COMMAND_TYPES = [
	'SnapshotCorrected',
	'AdjustLife',
	'AdjustClock',
	'StepTurn',
	'StepOvertime',
] as const satisfies readonly FeatureMatchCommandType[];

export type MergeableFeatureMatchCommandType = typeof MERGEABLE_FEATURE_MATCH_COMMAND_TYPES[number];

export function isMergeableFeatureMatchCommand(type: FeatureMatchCommandType): type is MergeableFeatureMatchCommandType {
	return (MERGEABLE_FEATURE_MATCH_COMMAND_TYPES as readonly string[]).includes(type);
}

export interface FeatureMatchSnapshotPlayerData {
	name?: string | null;
	pronouns?: string | null;
	externalId?: string | null;
	externalSource?: ExternalSource | null;
	wins?: number | null;
	losses?: number | null;
	draws?: number | null;
	position?: number | null;
	points?: number | null;
	archetypeId?: number | null;
	deckId?: number | null;
	deckList?: string | null;
	lgs?: string | null;
	gameData?: PlayerGameData | null;
}

export interface FeatureMatchSnapshotPlayer {
	playerId: number | null;
	data: FeatureMatchSnapshotPlayerData | null;
}

export interface FeatureMatchSourceSnapshot {
	eventId: number;
	slotId: number;
	matchId: number | null;
	externalId: string | null;
	externalSource: ExternalSource | null;
	tableNumber: number | null;
	roundName?: string | null;
	formatName?: string | null;
	bestOf: number;
	playerDisplayMode: PlayerDisplayMode;
	game: Game;
	defaults: FeatureMatchDefaults;
	player1: FeatureMatchSnapshotPlayer;
	player2: FeatureMatchSnapshotPlayer;
	createdAt: number;
	/**
	 * Whether this Session presents its players in the opposite order to the Slot
	 * it was built from, because an operator issued `SwapPlayers`.
	 *
	 * Which side a player sits on is Session state: the Slot keeps its own pairing
	 * order, and `buildSourceSnapshot` reads the Slot, so every snapshot rebuilt
	 * for a `SnapshotCorrected` arrives in Slot order. Without this the first
	 * reverse sync after a swap silently un-swaps the frozen snapshot while the
	 * live projection stays swapped, and the overlay pairs one player's name with
	 * the other's life total.
	 *
	 * Absent on snapshots written before the flag existed and on every snapshot of
	 * a Session nobody has swapped, both of which mean Slot order.
	 */
	playersSwapped?: boolean;
}

export interface FeatureMatchSessionResponse {
	id: number;
	eventId: number;
	slotId: number;
	status: FeatureMatchSessionStatus;
	sourceSnapshot: FeatureMatchSourceSnapshot;
	currentState: FeatureMatchState;
	sequence: number;
	closedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface FeatureMatchCommandBase<TType extends FeatureMatchCommandType, TPayload> {
	commandId: string;
	type: TType;
	payload: TPayload;
	baseSequence?: number;
}

export type FeatureMatchSessionCommand
	= | FeatureMatchCommandBase<'SnapshotCorrected', { sourceSnapshot: FeatureMatchSourceSnapshot }>
		| FeatureMatchCommandBase<'AdjustLife', { player: PlayerSide; delta: number }>
		| FeatureMatchCommandBase<'SetLife', { player: PlayerSide; lifeTotal: number }>
		| FeatureMatchCommandBase<'SetCounters', { player: PlayerSide; counters: { type: string; value: number }[] }>
		| FeatureMatchCommandBase<'SetCardsKept', { player: PlayerSide; cardsKept: number }>
		| FeatureMatchCommandBase<'AdjustClock', { deltaMs: number }>
		| FeatureMatchCommandBase<'SetClock', { targetMs: number }>
		| FeatureMatchCommandBase<'StartClock', Record<string, never>>
		| FeatureMatchCommandBase<'PauseClock', Record<string, never>>
		| FeatureMatchCommandBase<'ResetClock', { durationMs?: number }>
		| FeatureMatchCommandBase<'RestartClock', Record<string, never>>
		| FeatureMatchCommandBase<'SelectFirstPlayer', { player: PlayerSide }>
		| FeatureMatchCommandBase<'SetFirstPlayer', { player: PlayerSide }>
		| FeatureMatchCommandBase<'SetActivePlayer', { player: PlayerSide | null }>
		| FeatureMatchCommandBase<'SetTurnNumber', { turnNumber: number }>
		| FeatureMatchCommandBase<'RecordGameWin', { player: PlayerSide; resetLife?: boolean; resetCounters?: boolean; startingLife?: number }>
		| FeatureMatchCommandBase<'UndoGameWin', { player: PlayerSide; resetLife?: boolean; resetCounters?: boolean; startingLife?: number }>
		| FeatureMatchCommandBase<'ResetState', { type: 'game' | 'match'; startingLife?: number }>
		| FeatureMatchCommandBase<'StartOvertime', { totalTurns: number }>
		| FeatureMatchCommandBase<'StepTurn', { delta: number }>
		| FeatureMatchCommandBase<'StepOvertime', { delta: number }>
		| FeatureMatchCommandBase<'SwapPlayers', Record<string, never>>;

export interface FeatureMatchSessionEventAppliedPayload {
	slotId: number;
	sessionId: number;
	sequence: number;
	eventType: FeatureMatchSessionEventType;
	sourceSnapshot: FeatureMatchSourceSnapshot;
	currentState: FeatureMatchState;
}

export interface FeatureMatchSessionCommandResult extends FeatureMatchSessionEventAppliedPayload {
	session: FeatureMatchSessionResponse;
}
