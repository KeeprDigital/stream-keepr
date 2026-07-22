import type { FeatureMatchResponse } from '~~/shared/api';

// Local Types
export type FeatureMatchData = OmitTimestamps<FeatureMatchResponse>;

/**
 * Configuration for player display/control components.
 * Groups display toggles, permission flags, and game phase state
 * that varies by rendering context (admin panel vs screen overlay).
 * All fields are optional with sensible defaults applied by the consumer.
 */
export interface PlayerDisplayConfig {
	// Display toggles
	showName?: boolean;
	showPronouns?: boolean;
	showDeckName?: boolean;
	showCounters?: boolean;
	showRecord?: boolean;
	showMulliganInfo?: boolean;
	showLgs?: boolean;
	// Permission flags (screen path)
	allowLifeControls?: boolean;
	allowGameWinControls?: boolean;
	allowCounterControls?: boolean;
	// Game phase state (from useFeatureMatchGameMode)
	mulliganPhase?: boolean;
	startingHandSize?: number;
	activePlayerTrackingEnabled?: boolean;
	// Context-dependent overrides
	seatLabel?: string;
	hasDeckList?: boolean;
}
