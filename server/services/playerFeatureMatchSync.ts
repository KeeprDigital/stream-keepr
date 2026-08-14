import type { DbFeatureMatch, DbPlayer, DbPlayerDeck } from '~~/server/db/schema';
import type { PlayerSlotData } from '~~/shared/api';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { archetypes, featureMatches, matches, phases, playerDecks, players, rounds } from '~~/server/db/schema';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { chunkJsonRows } from '~~/server/utils/db';
import { isStateConflictFailure } from '~~/server/utils/errors';
import { applyMatchDeckSnapshot, selectMatchDeck } from '~~/server/utils/matchDeckSelection';
import { randomCommandId } from '~~/shared/utils/uuid';

/**
 * Builds a playerData snapshot from a player record for embedding in a match.
 * Used for reverse sync (player → match).
 */
function playerToMatchData(player: DbPlayer): PlayerSlotData {
	return {
		name: player.name,
		pronouns: player.pronouns,
		externalId: player.externalId,
		externalSource: player.externalSource,
		wins: player.wins,
		losses: player.losses,
		draws: player.draws,
		position: player.position,
		points: player.points,
		archetypeId: player.archetypeId,
		lgs: player.lgs,
		gameData: player.gameData,
		// Note: deckList is NOT included — large blob, match doesn't need it
	};
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right))
		return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
		return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left)
			&& Array.isArray(right)
			&& left.length === right.length
			&& left.every((value, index) => jsonValuesEqual(value, right[index]));
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length
		&& leftKeys.every(key => Object.hasOwn(rightRecord, key)
			&& jsonValuesEqual(leftRecord[key], rightRecord[key]));
}

/**
 * Service for bidirectional sync between feature match player data and the players table.
 *
 * Match → Player: When match player data is edited, write changes back to the players table.
 * Player → Match: When a player is updated (e.g. Melee sync), update match snapshots.
 */
export function playerFeatureMatchSyncService() {
	/**
	 * Player → Match reverse sync.
	 * After a player is updated, update any match snapshots that reference them.
	 * Returns the IDs of matches that were updated.
	 */
	async function refreshMatchesFromPlayers(eventId: number, playerIds: number[]): Promise<{
		updatedMatchIds: number[];
		updatedSlots: DbFeatureMatch[];
		playersById: Map<number, DbPlayer>;
		commit: () => Promise<void>;
	}> {
		const uniqueIds = [...new Set(playerIds)];
		if (uniqueIds.length === 0)
			return { updatedMatchIds: [], updatedSlots: [], playersById: new Map(), commit: async () => {} };

		const affectedById = new Map<number, DbFeatureMatch & { formatExternalId: string | null }>();
		for (const payload of chunkJsonRows(uniqueIds)) {
			const rows = await db
				.select({
					id: featureMatches.id,
					eventId: featureMatches.eventId,
					matchId: featureMatches.matchId,
					externalId: featureMatches.externalId,
					externalSource: featureMatches.externalSource,
					tableNumber: featureMatches.tableNumber,
					roundName: featureMatches.roundName,
					formatName: featureMatches.formatName,
					player1Id: featureMatches.player1Id,
					player2Id: featureMatches.player2Id,
					player1Data: featureMatches.player1Data,
					player2Data: featureMatches.player2Data,
					bestOf: featureMatches.bestOf,
					sortOrder: featureMatches.sortOrder,
					playerDisplayMode: featureMatches.playerDisplayMode,
					activeSessionId: featureMatches.activeSessionId,
					createdAt: featureMatches.createdAt,
					updatedAt: featureMatches.updatedAt,
					formatExternalId: phases.formatExternalId,
				})
				.from(featureMatches)
				.leftJoin(matches, eq(featureMatches.matchId, matches.id))
				.leftJoin(rounds, eq(matches.roundId, rounds.id))
				.leftJoin(phases, eq(rounds.phaseId, phases.id))
				.where(and(
					eq(featureMatches.eventId, eventId),
					or(
						sql`${featureMatches.player1Id} in (select cast(value as integer) from json_each(${payload}))`,
						sql`${featureMatches.player2Id} in (select cast(value as integer) from json_each(${payload}))`,
					),
				));
			for (const row of rows)
				affectedById.set(row.id, row);
		}
		const affectedMatches = [...affectedById.values()];
		if (affectedMatches.length === 0)
			return { updatedMatchIds: [], updatedSlots: [], playersById: new Map(), commit: async () => {} };

		const targetIds = new Set(uniqueIds);
		const referencedPlayerIds = [...new Set(affectedMatches.flatMap(match =>
			[match.player1Id, match.player2Id].filter((id): id is number => id != null),
		))];
		const loadedPlayers: DbPlayer[] = [];
		for (const payload of chunkJsonRows(referencedPlayerIds)) {
			loadedPlayers.push(...await db
				.select()
				.from(players)
				.where(and(
					eq(players.eventId, eventId),
					sql`${players.id} in (select cast(value as integer) from json_each(${payload}))`,
				)));
		}
		const playersById = new Map(loadedPlayers.map(player => [player.id, player]));

		const affectedTargetIds = referencedPlayerIds.filter(id => targetIds.has(id) && playersById.has(id));
		const deckRows: DbPlayerDeck[] = [];
		for (const payload of chunkJsonRows(affectedTargetIds)) {
			deckRows.push(...await db
				.select()
				.from(playerDecks)
				.where(and(
					eq(playerDecks.eventId, eventId),
					sql`${playerDecks.playerId} in (select cast(value as integer) from json_each(${payload}))`,
				))
				.orderBy(asc(playerDecks.playerId), desc(playerDecks.isPrimary), asc(playerDecks.sortOrder), asc(playerDecks.id)));
		}
		const decksByPlayerId = new Map<number, DbPlayerDeck[]>();
		for (const deck of deckRows) {
			const rows = decksByPlayerId.get(deck.playerId) ?? [];
			rows.push(deck);
			decksByPlayerId.set(deck.playerId, rows);
		}

		const reviewedArchetypeIds = [...new Set(deckRows.flatMap(deck =>
			deck.reviewedAt != null && deck.archetypeId != null ? [deck.archetypeId] : [],
		))];
		const archetypesById = new Map<number, { id: number; name: string; colors: string | null }>();
		for (const payload of chunkJsonRows(reviewedArchetypeIds)) {
			const rows = await db
				.select({ id: archetypes.id, name: archetypes.name, colors: archetypes.colors })
				.from(archetypes)
				.where(and(
					eq(archetypes.eventId, eventId),
					sql`${archetypes.id} in (select cast(value as integer) from json_each(${payload}))`,
				));
			for (const archetype of rows)
				archetypesById.set(archetype.id, archetype);
		}

		const changed = new Map<number, {
			slot: DbFeatureMatch;
			player1Data?: PlayerSlotData;
			player2Data?: PlayerSlotData;
		}>();
		for (const match of affectedMatches) {
			const next: {
				slot: DbFeatureMatch;
				player1Data?: PlayerSlotData;
				player2Data?: PlayerSlotData;
			} = { slot: match as DbFeatureMatch };
			for (const side of [1, 2] as const) {
				const playerId = side === 1 ? match.player1Id : match.player2Id;
				if (playerId == null || !targetIds.has(playerId))
					continue;
				const player = playersById.get(playerId);
				if (!player)
					continue;
				const existingData = side === 1 ? match.player1Data : match.player2Data;
				const playerDeckRows = decksByPlayerId.get(playerId) ?? [];
				const hasDeckIdentity = existingData != null && Object.hasOwn(existingData, 'deckId');
				const selectedDeck = hasDeckIdentity
					? existingData.deckId == null
						? null
						: playerDeckRows.find(deck => deck.id === existingData.deckId) ?? null
					: selectMatchDeck(playerDeckRows, { formatExternalId: match.formatExternalId }).deck;
				// The preserved-identity branch assigns its overrides onto a fresh factory
				// result rather than writing them beside a spread of one. `{ ...factory(), key: … }`
				// is correct as written — the override is last, so it wins — but
				// `playerToMatchData` returns a bare literal that writes `archetypeId` and
				// `gameData` itself, which rolldown is free to inline into the same object
				// literal; the emitted chunk would then carry both keys twice. #324 found four
				// of that shape and #338/#348 fixed the rest. Nothing here warns today — the
				// motivation is that precedent plus the form, not an observed bundler defect —
				// and keeping the factory out of the literal is what makes the form immune
				// rather than merely currently-correct.
				//
				// The `satisfies` clause is doing new work rather than restoring old work, which
				// is the opposite of the two `carriedForwardBroadcastGraphicsLiveState` returns
				// and was measured rather than assumed: because `updatedData` is a conditional
				// with no declared type, the literal below never had a contextual type, so an
				// invented key here was reported by neither typecheck program before this
				// rewrite. `Object.assign` takes its second argument by assignability and would
				// let one through in silence, so the clause is what keeps the override honest.
				//
				// `Object.assign` also mutates its target where the spread did not, so this now
				// depends on `playerToMatchData` handing back a fresh object per call. No test
				// held that property, so one now does — see the pin in this module's suite.
				const updatedData = hasDeckIdentity && existingData.deckId != null && !selectedDeck
					? Object.assign(playerToMatchData(player), {
							// The exact historical deck is no longer in the current submitted-deck
							// snapshot. Preserve its embedded identity instead of rebinding this
							// match to another format/primary deck.
							deckId: existingData.deckId,
							archetypeId: existingData.archetypeId,
							gameData: existingData.gameData,
						} satisfies Partial<PlayerSlotData>)
					: applyMatchDeckSnapshot(
							playerToMatchData(player),
							selectedDeck,
							selectedDeck?.archetypeId == null ? null : archetypesById.get(selectedDeck.archetypeId),
							{
								expectsMtgDeck: playerDeckRows.length > 0
									|| existingData?.gameData?.type === 'mtg',
							},
						);
				if (jsonValuesEqual(existingData, updatedData))
					continue;
				if (side === 1)
					next.player1Data = updatedData;
				else
					next.player2Data = updatedData;
			}
			if (next.player1Data !== undefined || next.player2Data !== undefined)
				changed.set(match.id, next);
		}
		if (changed.size === 0)
			return { updatedMatchIds: [], updatedSlots: [], playersById, commit: async () => {} };

		const now = new Date();
		const updateQueries = chunkJsonRows([...changed].map(([id, update]) => ({
			id,
			hasPlayer1Data: update.player1Data !== undefined,
			player1Data: update.player1Data,
			hasPlayer2Data: update.player2Data !== undefined,
			player2Data: update.player2Data,
		}))).map((payload) => {
			const incoming = sql`(
				select value from json_each(${payload})
				where cast(json_extract(value, '$.id') as integer) = ${featureMatches.id}
				limit 1
			)`;
			return db
				.update(featureMatches)
				.set({
					player1Data: sql`case when coalesce(json_extract(${incoming}, '$.hasPlayer1Data'), 0) then json_extract(${incoming}, '$.player1Data') else ${featureMatches.player1Data} end`,
					player2Data: sql`case when coalesce(json_extract(${incoming}, '$.hasPlayer2Data'), 0) then json_extract(${incoming}, '$.player2Data') else ${featureMatches.player2Data} end`,
					updatedAt: now,
				})
				.where(and(
					eq(featureMatches.eventId, eventId),
					sql`${featureMatches.id} in (select cast(json_extract(value, '$.id') as integer) from json_each(${payload}))`,
				))
				.returning({ id: featureMatches.id });
		});
		const updatedSlots = [...changed.values()].map(({ slot, player1Data, player2Data }) => ({
			...slot,
			...(player1Data === undefined ? {} : { player1Data }),
			...(player2Data === undefined ? {} : { player2Data }),
			updatedAt: now,
		}));
		return {
			updatedMatchIds: [...changed.keys()],
			updatedSlots,
			playersById,
			commit: async () => {
				await db.batch(updateQueries as [typeof updateQueries[0], ...typeof updateQueries]);
			},
		};
	}

	/**
	 * Batch Player → Match reverse sync.
	 * After multiple players are updated (e.g. Melee sync), update all affected match snapshots.
	 * Returns the IDs of matches that were updated.
	 */
	async function syncMatchesFromPlayers(eventId: number, playerIds: number[]): Promise<number[]> {
		if (playerIds.length === 0)
			return [];

		const { updatedMatchIds, updatedSlots, playersById, commit } = await refreshMatchesFromPlayers(eventId, playerIds);
		const state = featureMatchStateService();
		const defaults = updatedSlots.length > 0 ? await state.loadEventDefaults(eventId) : undefined;
		// Correct active-session snapshots before advancing the durable slot rows.
		// If any session CAS fails, all slots remain at their previous snapshot and
		// the next retry will detect the same delta instead of permanently skipping
		// the stale session.
		for (const slot of updatedSlots) {
			const sourceSnapshot = await state.buildSourceSnapshot(slot, defaults, playersById);
			await state.applyCommandToActiveSession(slot.id, eventId, session => ({
				commandId: randomCommandId('ReviewedDeckSnapshot'),
				type: 'SnapshotCorrected',
				payload: { sourceSnapshot },
				baseSequence: session.sequence,
			}));
		}
		await commit();

		return updatedMatchIds;
	}

	/**
	 * The reverse sync as a post-commit follow-on, for callers whose own write is
	 * already durable.
	 *
	 * Such a caller cannot answer a lost Session race with a failure: its write
	 * committed, so a `409` tells the client to retry something that already
	 * happened, and skipping the caller's own publications leaves every peer
	 * stale until a reload. A race is therefore logged and absorbed here, and the
	 * caller goes on to publish. Nothing is silently dropped by doing so — the
	 * strict form leaves the durable Slot rows at their previous snapshot when a
	 * Session correction fails, so the same delta is still there for the next
	 * pass to detect.
	 *
	 * Only races are absorbed. A fault still propagates, because a caller that
	 * cannot write its Slot snapshots at all is not a caller that should answer
	 * with success.
	 */
	async function syncMatchesFromPlayersAfterCommit(eventId: number, playerIds: number[]): Promise<number[]> {
		try {
			return await syncMatchesFromPlayers(eventId, playerIds);
		}
		catch (error) {
			if (!isStateConflictFailure(error))
				throw error;
			console.error(JSON.stringify({
				message: 'feature_match_reverse_sync_conflict',
				eventId,
				playerCount: new Set(playerIds).size,
			}));
			return [];
		}
	}

	return {
		syncMatchesFromPlayers,
		syncMatchesFromPlayersAfterCommit,
	};
}
