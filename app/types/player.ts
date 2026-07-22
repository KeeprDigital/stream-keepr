import type { CreatePlayerInput, PlayerSlotData } from '~~/shared/api';
import type { FeatureMatchData } from './featureMatch';

// ── Local Form Types ──

/** Maps `| null` to `| undefined` on every property of T. */
type NullToUndefined<T> = {
	[K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K];
};

/**
 * Frontend-only variant of CreatePlayerInput where nullable fields use
 * `| undefined` instead of `| null`.  This satisfies Nuxt UI v-model
 * constraints (UInput expects `string | undefined`, not `string | null`).
 */
export type PlayerData = NullToUndefined<PlayerSlotData>;

/** FeatureMatchData with player data fields typed as PlayerData for form use. */
export type FeatureMatchFormData = Omit<FeatureMatchData, 'player1Data' | 'player2Data'> & {
	player1Data: PlayerData | null;
	player2Data: PlayerData | null;
};

// Default player data for empty match forms
export const DEFAULT_PLAYER_DATA: PlayerData = {
	name: '',
	pronouns: undefined,
	externalId: undefined,
	externalSource: undefined,
	wins: undefined,
	losses: undefined,
	draws: undefined,
	position: undefined,
	points: undefined,
	archetypeId: undefined,
	lgs: undefined,
	gameData: undefined,
};

// ── Boundary Converters ──

/** Convert API data (null) to form data (undefined). */
export function toPlayerData(input: PlayerSlotData): PlayerData {
	return {
		...DEFAULT_PLAYER_DATA,
		...Object.fromEntries(
			Object.entries(input).map(([k, v]) => [k, v === null ? undefined : v]),
		),
	} as PlayerData;
}

/** Convert feature-match form data (undefined) back to slot metadata shape (null). */
export function toPlayerSlotData(data: PlayerData): PlayerSlotData {
	return Object.fromEntries(
		Object.entries(data).map(([k, v]) => [k, v === undefined ? null : v]),
	) as unknown as PlayerSlotData;
}

/**
 * Convert form data (undefined) back to player-create shape (null).
 * Melee identity is server-managed and never sent by manual create/update —
 * strip it here regardless of what the form happened to carry.
 */
export function toCreatePlayerInput(data: PlayerData): CreatePlayerInput {
	const { externalId: _externalId, externalSource: _externalSource, ...rest } = toPlayerSlotData(data);
	return rest as CreatePlayerInput;
}
