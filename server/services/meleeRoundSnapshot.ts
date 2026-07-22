import type { DbMatch } from '~~/server/db/schema';
import type { MatchUpsertInput } from '~~/server/services/match';
import type { RoundStandingInput } from '~~/server/services/playerRoundStandings';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { matches, playerRoundStandings } from '~~/server/db/schema';
import { buildDeleteStaleMatchesByRoundQuery } from '~~/server/services/match';
import { buildMarkRoundSyncedQuery } from '~~/server/services/round';
import { chunkJsonRows } from '~~/server/utils/db';

export interface MeleeRoundSnapshotInput {
	eventId: number;
	roundId: number;
	matches: MatchUpsertInput[];
	standings: RoundStandingInput[];
	syncedAt?: Date;
}

export interface MeleeRoundSnapshotResult {
	matches: DbMatch[];
	created: number;
	updated: number;
	staleDeleted: number;
}

/**
 * Persist a complete Melee Round snapshot in one D1 transaction.
 *
 * D1 guarantees that `db.batch()` executes sequentially and rolls the entire
 * sequence back when any statement fails. Query builders live in their owning
 * services so standalone writes and this composed operation cannot drift.
 */
export function meleeRoundSnapshotService() {
	const replace = async (
		input: MeleeRoundSnapshotInput,
	): Promise<MeleeRoundSnapshotResult> => {
		const keepExternalIds: string[] = [];
		const matchExternalIds = new Set<string>();
		for (const match of input.matches) {
			if (
				match.eventId !== input.eventId
				|| match.roundId !== input.roundId
				|| !match.externalId
				|| match.externalSource !== 'melee'
			) {
				throw new Error('Melee Round snapshot contains a Match outside its authoritative scope');
			}
			if (matchExternalIds.has(match.externalId)) {
				throw new Error(`Duplicate Melee Match external identity: ${match.externalId}`);
			}
			matchExternalIds.add(match.externalId);
			keepExternalIds.push(match.externalId);
		}
		const standingPlayerIds = new Set<number>();
		for (const standing of input.standings) {
			if (standingPlayerIds.has(standing.playerId)) {
				throw new Error(`Duplicate Round standing player identity: ${standing.playerId}`);
			}
			standingPlayerIds.add(standing.playerId);
		}

		const writeAt = new Date();
		const writeAtMs = writeAt.getTime();
		const existingMatchQueries = chunkJsonRows(keepExternalIds).map(payload => db
			.select({ externalId: matches.externalId })
			.from(matches)
			.where(and(
				eq(matches.eventId, input.eventId),
				eq(matches.externalSource, 'melee'),
				sql`${matches.externalId} in (select value from json_each(${payload}))`,
			)));
		const matchQueries = chunkJsonRows(input.matches).map(payload => db
			.insert(matches)
			.select(sql`
				select
					null,
					json_extract(value, '$.eventId'),
					json_extract(value, '$.roundId'),
					json_extract(value, '$.externalId'),
					json_extract(value, '$.externalSource'),
					json_extract(value, '$.tableNumber'),
					json_extract(value, '$.player1Id'),
					json_extract(value, '$.player2Id'),
					json_extract(value, '$.player1Data'),
					json_extract(value, '$.player2Data'),
					coalesce(json_extract(value, '$.hasResult'), 0),
					json_extract(value, '$.player1GameWins'),
					json_extract(value, '$.player2GameWins'),
					json_extract(value, '$.gameDraws'),
					coalesce(json_extract(value, '$.isBye'), 0),
					json_extract(value, '$.resultString'),
					coalesce(json_extract(value, '$.sortOrder'), 0),
					${writeAtMs},
					${writeAtMs}
				from json_each(${payload})
				where true
			`)
			.onConflictDoUpdate({
				target: [matches.eventId, matches.externalId, matches.externalSource],
				set: {
					roundId: sql.raw('excluded.round_id'),
					tableNumber: sql.raw('excluded.table_number'),
					player1Id: sql.raw('excluded.player1_id'),
					player2Id: sql.raw('excluded.player2_id'),
					player1Data: sql.raw('excluded.player1_data'),
					player2Data: sql.raw('excluded.player2_data'),
					hasResult: sql.raw('excluded.has_result'),
					player1GameWins: sql.raw('excluded.player1_game_wins'),
					player2GameWins: sql.raw('excluded.player2_game_wins'),
					gameDraws: sql.raw('excluded.game_draws'),
					isBye: sql.raw('excluded.is_bye'),
					resultString: sql.raw('excluded.result_string'),
					sortOrder: sql.raw('excluded.sort_order'),
					updatedAt: writeAt,
				},
			})
			.returning());
		const standingsDeleteQuery = db
			.delete(playerRoundStandings)
			.where(and(
				eq(playerRoundStandings.eventId, input.eventId),
				eq(playerRoundStandings.roundId, input.roundId),
			));
		const standingsInsertQueries = chunkJsonRows(input.standings).map(payload => db
			.insert(playerRoundStandings)
			.select(sql`
				select
					null,
					${input.eventId},
					json_extract(value, '$.playerId'),
					${input.roundId},
					json_extract(value, '$.wins'),
					json_extract(value, '$.losses'),
					json_extract(value, '$.draws'),
					json_extract(value, '$.position'),
					json_extract(value, '$.points'),
					${writeAtMs},
					${writeAtMs}
				from json_each(${payload})
			`));
		const standingsQueries = [standingsDeleteQuery, ...standingsInsertQueries];
		const staleDeleteQuery = buildDeleteStaleMatchesByRoundQuery(
			input.eventId,
			input.roundId,
			keepExternalIds,
		);
		const markSyncedQuery = buildMarkRoundSyncedQuery(
			input.roundId,
			input.eventId,
			input.syncedAt,
		);

		const staleDeleteResultIndex = existingMatchQueries.length + matchQueries.length + standingsQueries.length;
		const queries = [
			...existingMatchQueries,
			...matchQueries,
			...standingsQueries,
			staleDeleteQuery,
			markSyncedQuery,
		];
		const batchResults = await db.batch(
			queries as [typeof queries[number], ...Array<typeof queries[number]>],
		);

		const existingExternalIds = new Set(
			(batchResults.slice(0, existingMatchQueries.length).flat() as Array<{ externalId: string | null }>)
				.flatMap(row => row.externalId == null ? [] : [row.externalId]),
		);
		const matchBatchResults = batchResults.slice(
			existingMatchQueries.length,
			existingMatchQueries.length + matchQueries.length,
		) as DbMatch[][];
		const persistedMatches = matchBatchResults.flat();
		const staleDeletedRows = batchResults[staleDeleteResultIndex] as Array<{ id: number }> | undefined;
		const created = persistedMatches.filter(match =>
			match.externalId != null && !existingExternalIds.has(match.externalId),
		).length;

		return {
			matches: persistedMatches,
			created,
			updated: persistedMatches.length - created,
			staleDeleted: staleDeletedRows?.length ?? 0,
		};
	};

	return { replace };
}
