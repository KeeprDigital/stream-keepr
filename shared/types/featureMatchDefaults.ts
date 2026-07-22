import type { ClockType } from './enums';

/**
 * Canonical interface for feature match default settings.
 *
 * These map 1:1 to the `featureMatchDefault*` columns on the `events` table
 * but use shorter property names since the `FeatureMatchDefaults` namespace
 * already provides context.
 */
export interface FeatureMatchDefaults {
	bestOf: number;
	startingLife: number;
	clockType: ClockType;
	clockDuration: number; // minutes
	countUpAfterCountdown: boolean;
	turnTrackingEnabled: boolean;
	activePlayerTrackingEnabled: boolean;
	extraTurnsEnabled: boolean;
	extraTurns: number;
	extraTurnsLabel: string;
	mulliganTrackingEnabled: boolean;
}

/** Default values — single source of truth (mirrors DB column defaults). */
export const DEFAULT_FEATURE_MATCH_DEFAULTS: FeatureMatchDefaults = {
	bestOf: 3,
	startingLife: 20,
	clockType: 'countdown',
	clockDuration: 50,
	countUpAfterCountdown: false,
	turnTrackingEnabled: false,
	activePlayerTrackingEnabled: false,
	extraTurnsEnabled: false,
	extraTurns: 5,
	extraTurnsLabel: 'Extra Turns',
	mulliganTrackingEnabled: false,
};

// ── Field mapping between short names and flat DB/API column names ──

const FIELD_MAP = {
	bestOf: 'featureMatchDefaultBestOf',
	startingLife: 'featureMatchDefaultStartingLife',
	clockType: 'featureMatchDefaultClockType',
	clockDuration: 'featureMatchDefaultClockDuration',
	countUpAfterCountdown: 'featureMatchDefaultCountUpAfterCountdown',
	turnTrackingEnabled: 'featureMatchDefaultTurnTrackingEnabled',
	activePlayerTrackingEnabled: 'featureMatchDefaultActivePlayerTrackingEnabled',
	extraTurnsEnabled: 'featureMatchDefaultExtraTurnsEnabled',
	extraTurns: 'featureMatchDefaultExtraTurns',
	extraTurnsLabel: 'featureMatchDefaultExtraTurnsLabel',
	mulliganTrackingEnabled: 'featureMatchDefaultMulliganTrackingEnabled',
} as const satisfies Record<keyof FeatureMatchDefaults, string>;

/** Reverse mapping: flat column name → short name. */
const REVERSE_MAP = Object.fromEntries(
	Object.entries(FIELD_MAP).map(([short, flat]) => [flat, short]),
) as Record<FeatureMatchDefaultColumnKey, keyof FeatureMatchDefaults>;

// ── Derived types ──

/** Union of flat `featureMatchDefault*` column names. */
type FeatureMatchDefaultColumnKey = typeof FIELD_MAP[keyof typeof FIELD_MAP];

/** Object shape using the flat `featureMatchDefault*` column names. */
export type FeatureMatchDefaultColumns = {
	[K in keyof typeof FIELD_MAP as typeof FIELD_MAP[K]]: FeatureMatchDefaults[K];
};

// ── Conversion helpers ──

/**
 * Extract feature match defaults from an event-like object that uses flat
 * `featureMatchDefault*` keys. Missing fields fall back to `DEFAULT_FEATURE_MATCH_DEFAULTS`.
 */
export function toFeatureMatchDefaults(source: Partial<FeatureMatchDefaultColumns> | null | undefined): FeatureMatchDefaults {
	if (!source)
		return { ...DEFAULT_FEATURE_MATCH_DEFAULTS };

	const result = { ...DEFAULT_FEATURE_MATCH_DEFAULTS };
	for (const [flat, short] of Object.entries(REVERSE_MAP)) {
		const value = (source as Record<string, unknown>)[flat];
		if (value !== undefined && value !== null) {
			(result as Record<string, unknown>)[short] = value;
		}
	}
	return result;
}

/**
 * Convert a (partial) `FeatureMatchDefaults` object back to the flat
 * `featureMatchDefault*` column keys expected by the API.
 */
export function fromFeatureMatchDefaults<T extends Partial<FeatureMatchDefaults>>(defaults: T): Partial<FeatureMatchDefaultColumns> {
	const result: Record<string, unknown> = {};
	for (const [short, flat] of Object.entries(FIELD_MAP)) {
		const value = (defaults as Record<string, unknown>)[short];
		if (value !== undefined) {
			result[flat] = value;
		}
	}
	return result as Partial<FeatureMatchDefaultColumns>;
}
