import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigsMap, ScreenModeConfig } from '~~/shared/types/screenConfig';
import { archetypeService } from '~~/server/services/archetype';
import { featureMatchService } from '~~/server/services/featureMatch';
import { matchService } from '~~/server/services/match';
import { phaseService } from '~~/server/services/phase';
import { playerService } from '~~/server/services/player';
import { playerListService } from '~~/server/services/playerList';
import { roundService } from '~~/server/services/round';
import { talentService } from '~~/server/services/talent';

function throwReferenceNotFound(message: string): never {
	throw createError({ statusCode: 404, message });
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
	return [...new Set(values.filter((value): value is number => value != null))];
}

export async function requireRoundInEvent(eventId: number, roundId: number | null | undefined): Promise<void> {
	if (roundId == null)
		return;

	if (!await roundService().exists(roundId, eventId))
		throwReferenceNotFound('Round not found');
}

export async function requirePhaseInEvent(eventId: number, phaseId: number | null | undefined): Promise<void> {
	if (phaseId == null)
		return;

	if (!await phaseService().exists(phaseId, eventId))
		throwReferenceNotFound('Phase not found');
}

export async function requireTalentInEvent(eventId: number, talentId: number | null | undefined): Promise<void> {
	if (talentId == null)
		return;

	if (!await talentService().findById(talentId, eventId))
		throwReferenceNotFound('Talent not found');
}

export async function requireArchetypeInEvent(eventId: number, archetypeId: number | null | undefined): Promise<void> {
	if (archetypeId == null)
		return;

	if (!await archetypeService().findById(archetypeId, eventId))
		throwReferenceNotFound('Archetype not found');
}

export async function requireMatchInEvent(eventId: number, matchId: number | null | undefined): Promise<void> {
	if (matchId == null)
		return;

	if (!await matchService().exists(matchId, eventId))
		throwReferenceNotFound('Match not found');
}

export async function requireFeatureMatchSlotInEvent(eventId: number, slotId: number | null | undefined): Promise<void> {
	if (slotId == null)
		return;

	if (!await featureMatchService().exists(slotId, eventId))
		throwReferenceNotFound('Feature match slot not found');
}

export async function requirePlayerListInEvent(eventId: number, listId: number | null | undefined): Promise<void> {
	if (listId == null)
		return;

	if (!await playerListService().findById(listId, eventId))
		throwReferenceNotFound('Player list not found');
}

export async function requirePlayersInEvent(eventId: number, playerIds: Array<number | null | undefined>): Promise<void> {
	const ids = uniqueNumbers(playerIds);
	if (ids.length === 0)
		return;

	const playerCount = await playerService().countByIds(eventId, ids);
	if (playerCount !== ids.length)
		throwReferenceNotFound('Player not found');
}

export async function validateFeatureMatchReferences(
	eventId: number,
	input: {
		matchId?: number | null;
		player1Id?: number | null;
		player2Id?: number | null;
	},
): Promise<void> {
	await Promise.all([
		requireMatchInEvent(eventId, input.matchId),
		requirePlayersInEvent(eventId, [input.player1Id, input.player2Id]),
	]);
}

export async function validateFeatureMatchAssignmentCreateReferences(
	eventId: number,
	input: {
		roundId: number;
		slotId: number;
		matchId: number;
	},
): Promise<void> {
	await requireRoundInEvent(eventId, input.roundId);

	const [slot, match] = await Promise.all([
		featureMatchService().findById(input.slotId, eventId),
		matchService().findById(input.matchId, eventId),
	]);

	if (!slot)
		throwReferenceNotFound('Feature match slot not found');
	if (!match)
		throwReferenceNotFound('Match not found');
	if (match.roundId !== input.roundId)
		throw createError({ statusCode: 400, message: 'Match does not belong to round' });
}

export async function validateFeatureMatchAssignmentUpdateReferences(
	eventId: number,
	existing: { roundId: number },
	input: { matchId?: number | null },
): Promise<void> {
	if (input.matchId == null)
		return;

	const match = await matchService().findById(input.matchId, eventId);
	if (!match)
		throwReferenceNotFound('Match not found');
	if (match.roundId !== existing.roundId)
		throw createError({ statusCode: 400, message: 'Match does not belong to assignment round' });
}

function configReferenceValue(config: Partial<ScreenModeConfig> | Record<string, unknown> | null | undefined, key: string): number | null | undefined {
	if (!config || typeof config !== 'object')
		return undefined;

	const value = (config as Record<string, unknown>)[key];
	return typeof value === 'number' || value === null ? value : undefined;
}

export async function validateScreenModeConfigReferences(
	eventId: number,
	mode: ScreenMode,
	config: Partial<ScreenModeConfig> | Record<string, unknown> | null | undefined,
): Promise<void> {
	switch (mode) {
		case 'card':
		case 'feature-match':
		case 'feature-match-overlay': {
			const slotId = configReferenceValue(config, 'featureMatchId');
			await requireFeatureMatchSlotInEvent(eventId, slotId);
			break;
		}
		case 'deck':
		case 'player-history':
			await requirePlayersInEvent(eventId, [configReferenceValue(config, 'playerId')]);
			break;
		case 'standings':
			await Promise.all([
				requireRoundInEvent(eventId, configReferenceValue(config, 'roundId')),
				requirePlayerListInEvent(eventId, configReferenceValue(config, 'playerListId')),
			]);
			break;
		case 'metagame':
			await requirePlayerListInEvent(eventId, configReferenceValue(config, 'playerListId'));
			break;
	}
}

export async function validateScreenModeConfigsReferences(
	eventId: number,
	modeConfigs: ModeConfigsMap | null | undefined,
): Promise<void> {
	if (!modeConfigs)
		return;

	await Promise.all(
		(Object.entries(modeConfigs) as Array<[ScreenMode, ScreenModeConfig | undefined]>)
			.map(([mode, config]) => validateScreenModeConfigReferences(eventId, mode, config)),
	);
}
