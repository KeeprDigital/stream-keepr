import type { ManualPlayerSlotData, PlayerSlotData, UpdateFeatureMatchInput } from '~~/shared/api';
import type { PlayerGameData } from '~~/shared/types/game';
import type { FeatureMatchFormData, PlayerData } from '~/types';

type FeatureMatchSetupChanges = Partial<FeatureMatchFormData>;
type NullableInteger = number | null | undefined;

const playerStringFields = [
	'name',
	'pronouns',
	'deckList',
	'lgs',
] as const satisfies readonly (keyof PlayerSlotData)[];

const playerIntegerFields = [
	'wins',
	'losses',
	'draws',
	'position',
	'points',
	'archetypeId',
] as const satisfies readonly (keyof PlayerSlotData)[];

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
	return Object.hasOwn(value, key);
}

function normalizeOptionalString(value: unknown): string | null | undefined {
	if (value === undefined)
		return undefined;
	if (value === null)
		return null;
	if (typeof value !== 'string')
		return value as string | null | undefined;

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableInteger(value: unknown): NullableInteger {
	if (value === undefined)
		return undefined;
	if (value === null)
		return null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length === 0)
			return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : (value as unknown as number);
	}
	return value as NullableInteger;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
	if (value === undefined || value === null)
		return undefined;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length === 0)
			return undefined;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : (value as unknown as number);
	}
	return value as number | undefined;
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === undefined || value === null)
		return false;
	if (typeof value === 'string')
		return value.trim().length > 0;
	if (typeof value === 'object') {
		if (Array.isArray(value))
			return value.some(hasMeaningfulValue);
		return Object.entries(value).some(([key, entry]) => key !== 'type' && hasMeaningfulValue(entry));
	}
	return true;
}

function normalizeGameData(gameData: PlayerGameData | null | undefined): PlayerGameData | null | undefined {
	if (gameData === undefined)
		return undefined;
	if (gameData === null)
		return null;

	if (gameData.type === 'mtg') {
		const normalized: PlayerGameData = {
			type: 'mtg',
			deckName: normalizeOptionalString(gameData.deckName) ?? null,
			deckColors: normalizeOptionalString(gameData.deckColors) ?? null,
		};
		return hasMeaningfulValue(normalized) ? normalized : null;
	}

	const normalized: PlayerGameData = {
		type: 'op',
		leader: normalizeOptionalString(gameData.leader) ?? null,
	};
	return hasMeaningfulValue(normalized) ? normalized : null;
}

export function normalizePlayerSlotData(data: Partial<PlayerData> | null | undefined): ManualPlayerSlotData | null {
	if (!data)
		return null;

	const normalized: ManualPlayerSlotData = {};

	for (const field of playerStringFields) {
		if (hasOwn(data, field)) {
			const value = normalizeOptionalString(data[field]);
			if (value !== undefined)
				normalized[field] = value;
		}
	}

	for (const field of playerIntegerFields) {
		if (hasOwn(data, field)) {
			const value = normalizeNullableInteger(data[field]);
			if (value !== undefined)
				normalized[field] = value as never;
		}
	}

	if (hasOwn(data, 'gameData')) {
		const value = normalizeGameData(data.gameData);
		if (value !== undefined)
			normalized.gameData = value;
	}

	return hasMeaningfulValue(normalized) ? normalized : null;
}

export function buildFeatureMatchSetupUpdate(changes: FeatureMatchSetupChanges): UpdateFeatureMatchInput {
	const update: UpdateFeatureMatchInput = {};

	if (hasOwn(changes, 'matchId'))
		update.matchId = normalizeNullableInteger(changes.matchId);
	if (hasOwn(changes, 'tableNumber'))
		update.tableNumber = normalizeNullableInteger(changes.tableNumber);
	if (hasOwn(changes, 'roundName'))
		update.roundName = normalizeOptionalString(changes.roundName) ?? null;
	if (hasOwn(changes, 'formatName'))
		update.formatName = normalizeOptionalString(changes.formatName) ?? null;
	if (hasOwn(changes, 'player1Id'))
		update.player1Id = normalizeNullableInteger(changes.player1Id);
	if (hasOwn(changes, 'player2Id'))
		update.player2Id = normalizeNullableInteger(changes.player2Id);
	if (hasOwn(changes, 'bestOf')) {
		const bestOf = normalizeOptionalInteger(changes.bestOf);
		if (bestOf !== undefined)
			update.bestOf = bestOf;
	}
	if (hasOwn(changes, 'playerDisplayMode') && changes.playerDisplayMode)
		update.playerDisplayMode = changes.playerDisplayMode;
	if (hasOwn(changes, 'player1Data'))
		update.player1Data = normalizePlayerSlotData(changes.player1Data);
	if (hasOwn(changes, 'player2Data'))
		update.player2Data = normalizePlayerSlotData(changes.player2Data);

	return update;
}
