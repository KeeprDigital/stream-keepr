import type {
	ClockType,
	DeckListCompartment,
	ExternalSource,
	FeatureMatchOrientation,
	Game,
	PlayerDisplayMode,
	PointsSystem,
	PositionFormat,
	RecordSeparator,
	RoundControlMode,
	ScreenMode,
	UnresolvedDeckEntryType,
} from '~~/shared/types/enums';
import type { FeatureMatchSessionCommand, FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import type { PlayerGameData } from '~~/shared/types/game';
import type { ModeConfigsMap, ScreenConfig } from '~~/shared/types/screenConfig';

export interface TalentResponse {
	id: number;
	eventId: number;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateTalentInput {
	name: string;
}

export interface UpdateTalentInput {
	name?: string;
}

export interface EventListResponse {
	id: number;
	name: string;
	game: Game;
	featureMatchOrientation: FeatureMatchOrientation;
	cardTimeout: number;
	numFeatureMatches: number;
	description: string | null;
	holdingText: string | null;
	commentator1TalentId: number | null;
	commentator2TalentId: number | null;
	meleeEnabled: boolean;
	meleeEventId: string | null;
	initialSetupCompletedAt: Date | null;
	lastEventSyncedAt: Date | null;
	lastPlayersSyncedAt: Date | null;
	lastDecklistsSyncedAt: Date | null;
	lastSyncError: string | null;
	displayRecordSeparator: RecordSeparator;
	displayHideZeroDraws: boolean;
	displayPositionFormat: PositionFormat;
	featureMatchDefaultBestOf: number;
	featureMatchDefaultStartingLife: number;
	featureMatchDefaultClockType: ClockType;
	featureMatchDefaultClockDuration: number;
	featureMatchDefaultCountUpAfterCountdown: boolean;
	featureMatchDefaultTurnTrackingEnabled: boolean;
	featureMatchDefaultActivePlayerTrackingEnabled: boolean;
	featureMatchDefaultExtraTurnsEnabled: boolean;
	featureMatchDefaultExtraTurns: number;
	featureMatchDefaultExtraTurnsLabel: string;
	featureMatchDefaultMulliganTrackingEnabled: boolean;
	standingsEnabled: boolean;
	lgsEnabled: boolean;
	pronounsEnabled: boolean;
	tableNumberEnabled: boolean;
	pointsSystem: PointsSystem | null;
	createdAt: Date;
	updatedAt: Date;
	meleeConfigured: boolean;
}

export interface EventResponse extends EventListResponse {
	talents: TalentResponse[];
}

export interface CreateEventInput {
	name: string;
	game: Game;
	featureMatchOrientation?: FeatureMatchOrientation;
	cardTimeout?: number;
	numFeatureMatches?: number;
	description?: string | null;
	holdingText?: string | null;
	displayRecordSeparator?: RecordSeparator;
	displayHideZeroDraws?: boolean;
	displayPositionFormat?: PositionFormat;
	featureMatchDefaultBestOf?: number;
	featureMatchDefaultStartingLife?: number;
	featureMatchDefaultClockType?: ClockType;
	featureMatchDefaultClockDuration?: number;
	featureMatchDefaultCountUpAfterCountdown?: boolean;
	featureMatchDefaultTurnTrackingEnabled?: boolean;
	featureMatchDefaultActivePlayerTrackingEnabled?: boolean;
	featureMatchDefaultExtraTurnsEnabled?: boolean;
	featureMatchDefaultExtraTurns?: number;
	featureMatchDefaultExtraTurnsLabel?: string;
	featureMatchDefaultMulliganTrackingEnabled?: boolean;
	standingsEnabled?: boolean;
	lgsEnabled?: boolean;
	pronounsEnabled?: boolean;
	tableNumberEnabled?: boolean;
	pointsSystem?: PointsSystem | null;
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, 'game'>> & {
	commentator1TalentId?: number | null;
	commentator2TalentId?: number | null;
};

export interface MeleeConfigInput {
	meleeEnabled: boolean;
	meleeEventId: string | null;
	meleeClientId: string | null;
	meleeClientSecret?: string | null;
}

export interface MeleeConfigResponse {
	meleeEnabled: boolean;
	meleeEventId: string | null;
	meleeClientId: string | null;
	meleeConfigured: boolean;
}

export interface SyncDecklistsResponse {
	success: boolean;
	message: string;
	results: {
		players: number;
		deckLists: number;
		uniqueCards: number;
		updated: number;
		matchesUpdated: number;
		skippedPlayers: number;
		skippedCards: number;
		unresolvedCards: number;
	};
	warnings: string[];
}

export interface MeleeUnresolvedDeckCardResponse {
	id: number;
	eventId: number;
	playerId: number;
	playerName: string;
	deckId: number;
	formatExternalId: string;
	phaseName: string | null;
	deckName: string;
	entryType: UnresolvedDeckEntryType;
	originalName: string;
	setCode: string | null;
	quantity: number;
	compartment: DeckListCompartment | null;
	sortOrder: number;
	cardType: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ResolveMeleeUnresolvedDeckCardInput {
	scryfallId: string;
}

export interface ResolveMeleeUnresolvedDeckCardResponse {
	success: boolean;
	message: string;
	resolvedCardName: string;
	unresolvedId: number;
	resolvedCount: number;
}

export interface PlayerSlotData {
	name?: string | null;
	pronouns?: string | null;
	externalId?: string | null;
	externalSource?: ExternalSource | null;
	wins?: number | null;
	losses?: number | null;
	draws?: number | null;
	position?: number | null;
	points?: number | null;
	/** Stable local submitted-deck identity used by match-scoped consumers. */
	deckId?: number | null;
	deckList?: string | null;
	archetypeId?: number | null;
	lgs?: string | null;
	gameData?: PlayerGameData | null;
}

/**
 * Player snapshot fields accepted from manual API clients. Provenance is
 * always resolved from a referenced Event Player by the server.
 */
export type ManualPlayerSlotData = Omit<PlayerSlotData, 'externalId' | 'externalSource'>;

export interface PlayerResponse {
	id: number;
	eventId: number;
	name: string;
	pronouns: string | null;
	externalId: string | null;
	externalSource: ExternalSource | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	position: number | null;
	points: number | null;
	archetypeId: number | null;
	lgs: string | null;
	gameData: PlayerGameData | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Player snapshot fields accepted from manual API clients on create.
 * Melee identity (externalId/externalSource) is never client-supplied — the
 * server always stores manually created players with no external
 * provenance. See ManualPlayerSlotData for the same rule on match slots.
 */
export interface CreatePlayerInput {
	name: string;
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

export type UpdatePlayerInput = Partial<CreatePlayerInput>;

export interface PhaseResponse {
	id: number;
	eventId: number;
	name: string;
	sortOrder: number;
	externalId: string | null;
	externalSource: ExternalSource | null;
	formatExternalId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreatePhaseInput {
	name: string;
	sortOrder?: number;
}

export type UpdatePhaseInput = Partial<CreatePhaseInput>;

export interface RoundResponse {
	id: number;
	eventId: number;
	phaseId: number;
	externalId: string | null;
	externalSource: ExternalSource | null;
	name: string;
	roundNumber: number;
	controlMode: RoundControlMode;
	lastSyncedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateRoundInput {
	phaseId: number;
	name: string;
	roundNumber: number;
	controlMode?: RoundControlMode;
}

export type UpdateRoundInput = Partial<CreateRoundInput>;

export interface MatchResponse {
	id: number;
	eventId: number;
	roundId: number;
	externalId: string | null;
	externalSource: ExternalSource | null;
	tableNumber: number | null;
	player1Id: number | null;
	player2Id: number | null;
	player1Data: PlayerSlotData | null;
	player2Data: PlayerSlotData | null;
	hasResult: boolean;
	player1GameWins: number | null;
	player2GameWins: number | null;
	gameDraws: number | null;
	isBye: boolean;
	resultString: string | null;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateMatchInput {
	roundId: number;
	tableNumber?: number | null;
	player1Id?: number | null;
	player2Id?: number | null;
	player1Data?: ManualPlayerSlotData | null;
	player2Data?: ManualPlayerSlotData | null;
	hasResult?: boolean;
	player1GameWins?: number | null;
	player2GameWins?: number | null;
	gameDraws?: number | null;
	isBye?: boolean;
	resultString?: string | null;
	sortOrder?: number;
}

export type UpdateMatchInput = Partial<CreateMatchInput>;

export interface FeatureMatchResponse {
	id: number;
	eventId: number;
	matchId: number | null;
	externalId: string | null;
	externalSource: ExternalSource | null;
	tableNumber: number | null;
	roundName: string | null;
	formatName: string | null;
	player1Id: number | null;
	player2Id: number | null;
	player1Data: PlayerSlotData | null;
	player2Data: PlayerSlotData | null;
	bestOf: number;
	sortOrder: number;
	playerDisplayMode: PlayerDisplayMode;
	activeSessionId: number | null;
	activeSession?: FeatureMatchSessionResponse | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateFeatureMatchInput {
	matchId?: number | null;
	tableNumber?: number | null;
	roundName?: string | null;
	formatName?: string | null;
	player1Id?: number | null;
	player2Id?: number | null;
	player1Data?: ManualPlayerSlotData | null;
	player2Data?: ManualPlayerSlotData | null;
	bestOf?: number;
	sortOrder?: number;
	playerDisplayMode?: PlayerDisplayMode;
}

export type UpdateFeatureMatchInput = Partial<CreateFeatureMatchInput>;
export type FeatureMatchSlotResponse = FeatureMatchResponse;
export type CreateFeatureMatchSlotInput = CreateFeatureMatchInput;
export type UpdateFeatureMatchSlotInput = UpdateFeatureMatchInput;
export type FeatureMatchSessionCommandInput = FeatureMatchSessionCommand;

export interface FeatureMatchPromotionResponse {
	promotedSlot: FeatureMatchResponse;
	clearedSlots: FeatureMatchResponse[];
	assignment: FeatureMatchAssignmentResponse;
}

export interface FeatureMatchAssignmentResponse {
	id: number;
	eventId: number;
	roundId: number;
	slotId: number;
	matchId: number;
	note: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateFeatureMatchAssignmentInput {
	roundId: number;
	slotId: number;
	matchId: number;
	note?: string | null;
}

export type UpdateFeatureMatchAssignmentInput = Partial<Pick<CreateFeatureMatchAssignmentInput, 'matchId' | 'note'>>;

export interface ArchetypeResponse {
	id: number;
	eventId: number;
	name: string;
	colors: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateArchetypeInput {
	name: string;
	colors?: string | null;
}

export type UpdateArchetypeInput = Partial<CreateArchetypeInput>;

export interface PlayerListResponse {
	id: number;
	eventId: number;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlayerListSummaryResponse extends PlayerListResponse {
	memberCount: number;
}

export interface CreatePlayerListInput {
	name: string;
}

export interface UpdatePlayerListInput {
	name?: string;
}

export interface ScreenResponse {
	id: number;
	eventId: number;
	name: string;
	slug: string;
	currentMode: ScreenMode;
	modeConfigs: ModeConfigsMap | null;
	screenConfig: ScreenConfig | null;
	stateVersion: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateScreenInput {
	name: string;
	slug: string;
	currentMode?: ScreenMode;
	modeConfigs?: ModeConfigsMap | null;
	screenConfig?: ScreenConfig | null;
	stateVersion?: number;
}

export type UpdateScreenInput = Partial<CreateScreenInput> & {
	stateVersion: number;
};
