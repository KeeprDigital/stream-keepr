import type { CreatePlayerInput, PlayerResponse, UpdatePlayerInput } from '~~/shared/api';
import type { Game } from '~~/shared/types/enums';
import type { PlayerDeckSummaryResponse } from '~~/shared/types/metagame';
import type { PlayerNameFacts } from '~~/shared/utils/playerName';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events } from '~~/server/db/schema';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { releaseEmptiedLeaderArchetypes } from '~~/server/modules/op-deck-list-write/archetypes';
import { archetypeService } from '~~/server/services/archetype';
import { playerService } from '~~/server/services/player';
import { playerDeckService } from '~~/server/services/playerDeck';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';
import { requireArchetypeInEvent } from '~~/server/utils/routeGuards';
import { unshownPlayerReason } from '~~/shared/utils/playerName';

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

/** A written Nickname as stored: trimmed, and none when blank. */
function withStoredNickname<T extends { nickname?: string | null }>(input: T): T {
	return input.nickname === undefined
		? input
		: { ...input, nickname: input.nickname?.trim() || null };
}

async function eventGame(eventId: number): Promise<Game> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true },
	});
	return event?.game ?? 'mtg';
}

/**
 * A One Piece Card Game Player's game data and Archetype are the OP Deck List
 * write's: their Deck List reference, and the Archetype their Leader derives
 * (ADR-0074). A Player write leaves them as they are.
 */
function withoutDeckListOwnedFields<T extends { gameData?: unknown; archetypeId?: unknown }>(game: Game, input: T): T {
	if (game !== 'op')
		return input;
	const { gameData: _gameData, archetypeId: _archetypeId, ...written } = input;
	return written as T;
}

/**
 * A Player must always show by something (ADR-0074). A One Piece Card Game
 * Player shows by their name, else their Nickname; a Magic: The Gathering
 * Player has no Nickname, so needs a name.
 */
function requireShownPlayer(game: Game, player: PlayerNameFacts) {
	const reason = unshownPlayerReason(game, player);
	if (reason)
		throw createError({ statusCode: 400, message: reason });
}

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
		// One bulk write for every affected Player, all or none, then one run of
		// `player:updated` messages in the order of the requested Player IDs, after
		// which Graphic Input Bindings re-resolve once.
		const updatedPlayers = await playerDeckService().reconcilePrimaryArchetypesForPlayers(eventId, playerIds);
		const responses = await publication.playersUpdated({
			eventId,
			entities: updatedPlayers,
			originConnectionId,
		});

		if (updatedPlayers.length > 0) {
			await publishPlayerSnapshotUpdates({
				eventId,
				playerIds: updatedPlayers.map(player => player.id),
				originConnectionId,
			});
		}
		return responses;
	}

	async function updatePlayer({
		eventId,
		playerId,
		input,
		originConnectionId,
	}: UpdatePlayerInputParams): Promise<PlayerResponse> {
		const game = await eventGame(eventId);
		const written = withoutDeckListOwnedFields(game, withStoredNickname(input));
		await requireArchetypeInEvent(eventId, written.archetypeId);
		if (written.name !== undefined || written.nickname !== undefined) {
			const current = await players.findById(playerId, eventId);
			if (current) {
				requireShownPlayer(game, {
					name: written.name ?? current.name,
					nickname: written.nickname !== undefined
						? written.nickname
						: current.nickname,
				});
			}
		}

		const updatedPlayer = await players.update(playerId, eventId, written);

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
		const game = await eventGame(eventId);
		const written = withoutDeckListOwnedFields(game, withStoredNickname(input));
		await requireArchetypeInEvent(eventId, written.archetypeId);
		requireShownPlayer(game, written);

		const newPlayer = await players.create(eventId, written);

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
		const { deleted, archetypeId, clearedScreens } = await players.remove(playerId, eventId);

		// Even for a Player already gone: the clear committed either way (ADR-0032).
		// No origin, because the deleting client never received these Screens back.
		for (const screen of clearedScreens)
			await publication.screenUpdated({ eventId, entity: screen });

		if (!deleted) {
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
		// A One Piece Card Game Leader Archetype goes with its last Player, unless customised (ADR-0074).
		if (archetypeId !== null)
			await releaseEmptiedLeaderArchetypes(eventId, [archetypeId]);

		return { success: true };
	}

	async function reviewPlayerDeck({
		eventId,
		playerId,
		deckId,
		archetypeId,
		originConnectionId,
	}: ReviewPlayerDeckParams): Promise<ReviewPlayerDeckResult> {
		if (await eventGame(eventId) === 'op')
			throw createError({ statusCode: 400, statusMessage: 'A One Piece Card Game Player\'s Archetype follows their Leader, so is not reviewed' });
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
