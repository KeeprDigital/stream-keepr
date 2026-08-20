export * from './featureMatch';
export * from './player';
export * from './realtime';
export * from './screen';

export type Archetype = import('~~/shared/api').ArchetypeResponse & {
	keyCards: import('~~/shared/types/metagame').CardResponse[];
};

export type { FeatureMatchOverlaySelectionTarget } from '~/modules/feature-match-overlay/selection';

export type {
	CreateArchetypeInput,
	CreateEventInput,
	CreateFeatureMatchAssignmentInput,
	CreateFeatureMatchInput,
	CreateMatchInput,
	CreatePhaseInput,
	CreatePlayerInput,
	CreatePlayerListInput,
	CreateRoundInput,
	CreateScreenInput,
	CreateTalentInput,
	EventResponse as Event,
	FeatureMatchResponse as FeatureMatch,
	FeatureMatchAssignmentResponse as FeatureMatchAssignment,
	FeatureMatchNoteDiscardConfirmation,
	FeatureMatchNoteDiscardConflict,
	FeatureMatchPromotionResponse,
	MatchResponse as Match,
	PhaseResponse as Phase,
	PlayerResponse as Player,
	PlayerListResponse as PlayerList,
	PlayerListSummaryResponse as PlayerListSummary,
	RoundResponse as Round,
	SaveFeatureMatchAssignmentInput,
	ScreenResponse as Screen,
	TalentResponse as Talent,
	UpdateArchetypeInput,
	UpdateEventInput,
	UpdateFeatureMatchAssignmentInput,
	UpdateFeatureMatchInput,
	UpdateMatchInput,
	UpdatePhaseInput,
	UpdatePlayerInput,
	UpdatePlayerListInput,
	UpdateRoundInput,
	UpdateScreenInput,
	UpdateTalentInput,
} from '~~/shared/api';
