import type { EventReferenceKind } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigsMap, ScreenModeConfig } from '~~/shared/types/screenConfig';
import { archetypeService } from '~~/server/services/archetype';
import { broadcastDeckListService } from '~~/server/services/broadcastDeckList';
import { featureMatchService } from '~~/server/services/featureMatch';
import { matchService } from '~~/server/services/match';
import { phaseService } from '~~/server/services/phase';
import { playerService } from '~~/server/services/player';
import { playerListService } from '~~/server/services/playerList';
import { roundService } from '~~/server/services/round';
import { talentService } from '~~/server/services/talent';
import { ScreenDeckSourceConflictError } from '~~/server/utils/errors';
import { SCREEN_MODES } from '~~/shared/screenModes';

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

/** A field naming an entity by id; any other value names nothing to check. */
function referencedId(value: unknown): number | null | undefined {
	return typeof value === 'number' || value === null ? value : undefined;
}

async function requireDeckSourceInEvent(eventId: number, value: unknown): Promise<void> {
	if (!value || typeof value !== 'object')
		return;

	const source = value as Record<string, unknown>;
	if (source.type === 'player') {
		await requirePlayersInEvent(eventId, [referencedId(source.playerId)]);
	}
	else if (source.type === 'broadcast') {
		// A Broadcast Deck Source always names a list; one naming none is never selectable.
		const listId = typeof source.broadcastDeckListId === 'number' ? source.broadcastDeckListId : 0;
		if (!await broadcastDeckListService().sourceIsSelectable(listId, eventId))
			throw new ScreenDeckSourceConflictError();
	}
}

/** How each kind of Event Reference is proved to belong to the Event. */
const EVENT_REFERENCE_CHECKS: { readonly [K in EventReferenceKind]: (eventId: number, value: unknown) => Promise<void> } = {
	round: (eventId, value) => requireRoundInEvent(eventId, referencedId(value)),
	player: (eventId, value) => requirePlayersInEvent(eventId, [referencedId(value)]),
	playerList: (eventId, value) => requirePlayerListInEvent(eventId, referencedId(value)),
	featureMatchSlot: (eventId, value) => requireFeatureMatchSlotInEvent(eventId, referencedId(value)),
	deckSource: requireDeckSourceInEvent,
};

/**
 * Refuses a mode config whose Event References name something outside the
 * Event: each field its Screen Mode Definition declares (`eventReferences`) is
 * checked by its kind (ADR-0038).
 */
export async function validateScreenModeConfigReferences(
	eventId: number,
	mode: ScreenMode,
	config: Partial<ScreenModeConfig> | Record<string, unknown> | null | undefined,
): Promise<void> {
	const fields: Record<string, unknown> = config && typeof config === 'object' ? config : {};
	await Promise.all(
		Object.entries(SCREEN_MODES[mode].eventReferences)
			.map(([field, kind]) => EVENT_REFERENCE_CHECKS[kind](eventId, fields[field])),
	);
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
