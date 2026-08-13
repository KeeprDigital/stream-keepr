import type { CreatePlayerInput, PlayerResponse, UpdatePlayerInput } from '~~/shared/api';
import type { PlayerDeckSummaryResponse } from '~~/shared/types/metagame';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { archetypeService } from '~~/server/services/archetype';
import { playerService } from '~~/server/services/player';
import { playerDeckService } from '~~/server/services/playerDeck';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';
import { requireArchetypeInEvent } from '~~/server/utils/routeGuards';

interface UpdatePlayerInputParams {
	eventId: number;
	playerId: number;
	input: UpdatePlayerInput;
	originConnectionId?: string;
}

interface CreatePlayerInputParams {
	eventId: number;
	input: CreatePlayerInput;
	originConnectionId?: string;
}

interface DeletePlayerParams {
	eventId: number;
	playerId: number;
	originConnectionId?: string;
}

interface ReviewPlayerDeckParams {
	eventId: number;
	playerId: number;
	deckId: number;
	archetypeId: number;
	originConnectionId?: string;
}

interface ReviewPlayerDeckResult {
	deck: PlayerDeckSummaryResponse;
	player: PlayerResponse | null;
}

interface PublishPlayerSnapshotUpdatesParams {
	eventId: number;
	playerIds: number[];
	originConnectionId?: string;
}

type ReconcileDeckProjectionsParams = PublishPlayerSnapshotUpdatesParams;

export function playerUpdateModule() {
	const publication = eventDataPublicationModule();
	const players = playerService();
	const playerFeatureMatchSync = playerFeatureMatchSyncService();

	async function publishPlayerSnapshotUpdates({
		eventId,
		playerIds,
		originConnectionId,
	}: PublishPlayerSnapshotUpdatesParams) {
		// Every caller reaches here after its Player write has committed, so the
		// reverse sync is a follow-on and a lost Session race must not become the
		// answer to a write that already happened.
		const updatedMatchIds = await playerFeatureMatchSync.syncMatchesFromPlayersAfterCommit(eventId, playerIds);

		await publication.featureMatchSlotsUpdated({
			eventId,
			slotIds: updatedMatchIds,
			originConnectionId,
		});

		return updatedMatchIds;
	}

	async function reconcileDeckProjections({
		eventId,
		playerIds,
		originConnectionId,
	}: ReconcileDeckProjectionsParams) {
		const updatedPlayerIds: number[] = [];
		const responses: PlayerResponse[] = [];
		const deckService = playerDeckService();

		// Bulk-reads the affected Players' deck/projection data (chunked, instead
		// of one query per Player) before writing the per-Player projection and
		// publishing its update — publication messages stay per-player and in
		// the same order as the requested Player IDs.
		const updatedPlayers = await deckService.reconcilePrimaryArchetypesForPlayers(eventId, playerIds);

		for (const player of updatedPlayers) {
			responses.push(await publication.playerUpdated({
				eventId,
				entity: player,
				originConnectionId,
			}));
			updatedPlayerIds.push(player.id);
		}

		if (updatedPlayerIds.length > 0) {
			await publishPlayerSnapshotUpdates({ eventId, playerIds: updatedPlayerIds, originConnectionId });
		}
		return responses;
	}

	async function updatePlayer({
		eventId,
		playerId,
		input,
		originConnectionId,
	}: UpdatePlayerInputParams): Promise<PlayerResponse> {
		await requireArchetypeInEvent(eventId, input.archetypeId);

		const updatedPlayer = await players.update(playerId, eventId, input);

		if (!updatedPlayer) {
			throw createError({
				statusCode: 404,
				message: 'Player not found',
			});
		}

		const reviewedProjection = await playerDeckService().reconcilePrimaryArchetype(
			eventId,
			playerId,
			{ reviewedOnly: true },
		);
		const response = await publication.playerUpdated({
			eventId,
			entity: reviewedProjection ?? updatedPlayer,
			originConnectionId,
		});

		await publishPlayerSnapshotUpdates({
			eventId,
			playerIds: [playerId],
			originConnectionId,
		});

		return response;
	}

	async function createPlayer({
		eventId,
		input,
		originConnectionId,
	}: CreatePlayerInputParams): Promise<PlayerResponse> {
		await requireArchetypeInEvent(eventId, input.archetypeId);

		const newPlayer = await players.create(eventId, input);

		return await publication.playerCreated({
			eventId,
			entity: newPlayer,
			originConnectionId,
		});
	}

	async function deletePlayer({
		eventId,
		playerId,
		originConnectionId,
	}: DeletePlayerParams): Promise<{ success: true }> {
		const result = await players.remove(playerId, eventId);

		if (!result) {
			throw createError({
				statusCode: 404,
				message: 'Player not found',
			});
		}

		await publication.playerDeleted({
			eventId,
			id: playerId,
			originConnectionId,
		});

		return { success: true };
	}

	async function reviewPlayerDeck({
		eventId,
		playerId,
		deckId,
		archetypeId,
		originConnectionId,
	}: ReviewPlayerDeckParams): Promise<ReviewPlayerDeckResult> {
		const archetype = await archetypeService().findById(archetypeId, eventId);
		if (!archetype) {
			throw createError({ statusCode: 404, statusMessage: 'Archetype not found' });
		}

		const reviewed = await playerDeckService().reviewDeck(eventId, playerId, deckId, archetypeId);
		if (!reviewed) {
			throw createError({ statusCode: 404, statusMessage: 'Player deck not found' });
		}

		const deck = await publication.playerDeckReviewed({
			eventId,
			entity: reviewed.deck,
			archetype,
			originConnectionId,
		});
		let player: PlayerResponse | null = null;
		if (reviewed.player) {
			player = await publication.playerUpdated({
				eventId,
				entity: reviewed.player,
				originConnectionId,
			});
		}
		await publishPlayerSnapshotUpdates({
			eventId,
			playerIds: [playerId],
			originConnectionId,
		});

		return { deck, player };
	}

	return {
		updatePlayer,
		createPlayer,
		deletePlayer,
		reviewPlayerDeck,
		publishPlayerSnapshotUpdates,
		reconcileDeckProjections,
	};
}
