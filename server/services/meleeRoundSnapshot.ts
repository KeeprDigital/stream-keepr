import type { DbMatch } from '~~/server/db/schema';
import type { MatchUpsertInput } from '~~/server/services/match';
import type { RoundStandingInput } from '~~/server/services/playerRoundStandings';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { matches, playerRoundStandings } from '~~/server/db/schema';
import { buildDeleteStaleMatchesByRoundQuery } from '~~/server/services/match';
import { diffRoundMatches, standingsDiffer } from '~~/server/services/meleeRoundDiff';
import { buildMarkRoundSyncedQuery } from '~~/server/services/round';
import { chunkJsonRows, selectForInsert } from '~~/server/utils/db';

export interface MeleeRoundSnapshotInput {
	eventId: number;
	roundId: number;
	matches: MatchUpsertInput[];
	/** `null` leaves the Round's stored Round Standings alone. */
	standings: RoundStandingInput[] | null;
	syncedAt?: Date;
}

export interface MeleeRoundSnapshotResult {
	/** The Round's Melee Matches after the write, in snapshot order. */
	matches: DbMatch[];
	created: number;
	/** Stored Matches the snapshot actually changed. */
	updated: number;
	staleDeleted: number;
	/** Stored Matches whose Match Result changed. */
	resultChangedMatchIds: number[];
	/** A Match was added, removed, or re-seated. */
	pairingsChanged: boolean;
	/** The stored Round Standings were replaced with a different set. */
	standingsChanged: boolean;
}

/**
 * Persist a complete Melee Round snapshot, writing only what changed.
 *
 * Stored rows are read and diffed first. The writes then run as one D1
 * `db.batch()`, which executes sequentially and rolls the entire sequence back
 * when any statement fails. Query builders live in their owning services so
 * standalone writes and this composed operation cannot drift.
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
		for (const standing of input.standings ?? []) {
			if (standingPlayerIds.has(standing.playerId)) {
				throw new Error(`Duplicate Round standing player identity: ${standing.playerId}`);
			}
			standingPlayerIds.add(standing.playerId);
		}

		// The Round's Melee Matches, plus any the snapshot moves in from another Round.
		const snapshotIdentities = chunkJsonRows(keepExternalIds).map(payload =>
			sql`${matches.externalId} in (select value from json_each(${payload}))`);
		const [storedMatches, storedStandings] = await Promise.all([
			db.select().from(matches).where(and(
				eq(matches.eventId, input.eventId),
				eq(matches.externalSource, 'melee'),
				or(eq(matches.roundId, input.roundId), ...snapshotIdentities),
			)),
			input.standings === null
				? []
				: db.select().from(playerRoundStandings).where(and(
						eq(playerRoundStandings.eventId, input.eventId),
						eq(playerRoundStandings.roundId, input.roundId),
					)),
		]);
		const diff = diffRoundMatches(storedMatches, input.matches);
		const changedStandings = input.standings !== null && standingsDiffer(storedStandings, input.standings)
			? input.standings
			: null;

		const writeAt = new Date();
		const writeAtMs = writeAt.getTime();
		const matchQueries = chunkJsonRows(diff.toWrite).map(payload => db
			.insert(matches)
			.select(selectForInsert(matches, {
				id: sql`null`,
				eventId: sql`json_extract(value, '$.eventId')`,
				roundId: sql`json_extract(value, '$.roundId')`,
				externalId: sql`json_extract(value, '$.externalId')`,
				externalSource: sql`json_extract(value, '$.externalSource')`,
				tableNumber: sql`json_extract(value, '$.tableNumber')`,
				player1Id: sql`json_extract(value, '$.player1Id')`,
				player2Id: sql`json_extract(value, '$.player2Id')`,
				player1Data: sql`json_extract(value, '$.player1Data')`,
				player2Data: sql`json_extract(value, '$.player2Data')`,
				hasResult: sql`coalesce(json_extract(value, '$.hasResult'), 0)`,
				player1GameWins: sql`json_extract(value, '$.player1GameWins')`,
				player2GameWins: sql`json_extract(value, '$.player2GameWins')`,
				gameDraws: sql`json_extract(value, '$.gameDraws')`,
				isBye: sql`coalesce(json_extract(value, '$.isBye'), 0)`,
				sortOrder: sql`coalesce(json_extract(value, '$.sortOrder'), 0)`,
				createdAt: sql`${writeAtMs}`,
				updatedAt: sql`${writeAtMs}`,
			}, sql`from json_each(${payload}) where true`))
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
					sortOrder: sql.raw('excluded.sort_order'),
					updatedAt: writeAt,
				},
			})
			.returning());
		const standingsQueries = changedStandings === null
			? []
			: [
					db
						.delete(playerRoundStandings)
						.where(and(
							eq(playerRoundStandings.eventId, input.eventId),
							eq(playerRoundStandings.roundId, input.roundId),
						)),
					...chunkJsonRows(changedStandings).map(payload => db
						.insert(playerRoundStandings)
						.select(selectForInsert(playerRoundStandings, {
							id: sql`null`,
							eventId: sql`${input.eventId}`,
							playerId: sql`json_extract(value, '$.playerId')`,
							roundId: sql`${input.roundId}`,
							wins: sql`json_extract(value, '$.wins')`,
							losses: sql`json_extract(value, '$.losses')`,
							draws: sql`json_extract(value, '$.draws')`,
							position: sql`json_extract(value, '$.position')`,
							points: sql`json_extract(value, '$.points')`,
							createdAt: sql`${writeAtMs}`,
							updatedAt: sql`${writeAtMs}`,
						}, sql`from json_each(${payload})`))),
				];
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

		const staleDeleteResultIndex = matchQueries.length + standingsQueries.length;
		const queries = [
			...matchQueries,
			...standingsQueries,
			staleDeleteQuery,
			markSyncedQuery,
		];
		const batchResults = await db.batch(
			queries as [typeof queries[number], ...Array<typeof queries[number]>],
		);

		const writtenMatches = (batchResults.slice(0, matchQueries.length) as DbMatch[][]).flat();
		const staleDeletedRows = batchResults[staleDeleteResultIndex] as Array<{ id: number }> | undefined;
		const storedByExternalId = new Map(storedMatches.map(match => [match.externalId, match]));
		const writtenByExternalId = new Map(writtenMatches.map(match => [match.externalId, match]));
		const created = writtenMatches.filter(match => !storedByExternalId.has(match.externalId)).length;

		return {
			matches: keepExternalIds.map(externalId =>
				(writtenByExternalId.get(externalId) ?? storedByExternalId.get(externalId))!),
			created,
			updated: writtenMatches.length - created,
			staleDeleted: staleDeletedRows?.length ?? 0,
			resultChangedMatchIds: diff.resultChangedExternalIds.map(externalId =>
				storedByExternalId.get(externalId)!.id),
			pairingsChanged: diff.pairingsChanged,
			standingsChanged: changedStandings !== null,
		};
	};

	return { replace };
}
