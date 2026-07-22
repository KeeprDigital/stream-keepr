import type { BatchItem } from 'drizzle-orm/batch';
import type { DbPlayer, DbPlayerInsert } from '~~/server/db/schema';
import type { CreatePlayerInput, UpdatePlayerInput } from '~~/shared/api';

import { and, asc, eq, getTableColumns, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { playerListMembers, playerLists, players } from '~~/server/db/schema';
import { chunkJsonRows } from '~~/server/utils/db';
import { pickManualWritable } from '~~/server/utils/provenance';

/** Full insert data including eventId (used by sync/upsert operations). archetypeId excluded — set separately. */
type PlayerInsertData = Omit<DbPlayerInsert, 'id' | 'createdAt' | 'updatedAt' | 'archetypeId'>;

interface FindAllParams {
	eventId?: number;
	listId?: number;
	includeInactive?: boolean;
}

export type MeleePlayerSnapshotData = Omit<
	PlayerInsertData,
	'eventId' | 'externalSource' | 'isActive' | 'lastSeenAt'
> & {
	externalId: string;
	externalStatus: number | null;
};

function buildBulkPlayerUpsertQueries(
	dataList: PlayerInsertData[],
	writeAt: Date,
): BatchItem<'sqlite'>[] {
	const writeAtMs = writeAt.getTime();
	const updateFields = [
		'pronouns',
		'wins',
		'losses',
		'draws',
		'position',
		'points',
		'gameData',
		'externalStatus',
		'isActive',
		'lastSeenAt',
	] as const;
	const grouped = new Map<string, PlayerInsertData[]>();
	for (const data of dataList) {
		const mask = updateFields.map(field => data[field] !== undefined ? '1' : '0').join('');
		const rows = grouped.get(mask) ?? [];
		rows.push(data);
		grouped.set(mask, rows);
	}

	return [...grouped.values()].flatMap((group) => {
		const example = group[0]!;
		const set = {
			name: sql.raw('excluded.name'),
			...(example.pronouns !== undefined ? { pronouns: sql.raw('excluded.pronouns') } : {}),
			...(example.wins !== undefined ? { wins: sql.raw('excluded.wins') } : {}),
			...(example.losses !== undefined ? { losses: sql.raw('excluded.losses') } : {}),
			...(example.draws !== undefined ? { draws: sql.raw('excluded.draws') } : {}),
			...(example.position !== undefined ? { position: sql.raw('excluded.position') } : {}),
			...(example.points !== undefined ? { points: sql.raw('excluded.points') } : {}),
			...(example.gameData !== undefined ? { gameData: sql.raw('excluded.game_data') } : {}),
			...(example.externalStatus !== undefined ? { externalStatus: sql.raw('excluded.external_status') } : {}),
			...(example.isActive !== undefined ? { isActive: sql.raw('excluded.is_active') } : {}),
			...(example.lastSeenAt !== undefined ? { lastSeenAt: sql.raw('excluded.last_seen_at') } : {}),
			updatedAt: writeAt,
		};
		return chunkJsonRows(group.map(data => ({
			...data,
			lastSeenAt: data.lastSeenAt?.getTime(),
		}))).map(payload => db
			.insert(players)
			.select(sql`
			select
				null,
				json_extract(value, '$.eventId'),
				json_extract(value, '$.name'),
				json_extract(value, '$.pronouns'),
				json_extract(value, '$.externalId'),
				json_extract(value, '$.externalSource'),
				json_extract(value, '$.externalStatus'),
				coalesce(json_extract(value, '$.isActive'), 1),
				json_extract(value, '$.lastSeenAt'),
				json_extract(value, '$.wins'),
				json_extract(value, '$.losses'),
				json_extract(value, '$.draws'),
				json_extract(value, '$.position'),
				json_extract(value, '$.points'),
				null,
				json_extract(value, '$.lgs'),
				json_extract(value, '$.gameData'),
				${writeAtMs},
				${writeAtMs}
			from json_each(${payload})
			where true
		`)
			.onConflictDoUpdate({
				target: [players.eventId, players.externalId, players.externalSource],
				set,
			})
			.returning());
	});
}

function playerIdentityKey(row: Pick<PlayerInsertData, 'eventId' | 'externalId' | 'externalSource'>): string | null {
	return row.externalId && row.externalSource
		? `${row.eventId}\u0000${row.externalSource}\u0000${row.externalId}`
		: null;
}

function buildExistingPlayerQueries(dataList: PlayerInsertData[]): BatchItem<'sqlite'>[] {
	const identities = dataList.flatMap(data => data.externalId && data.externalSource
		? [{ eventId: data.eventId, externalId: data.externalId, externalSource: data.externalSource }]
		: []);
	return chunkJsonRows(identities).map(payload => db
		.select({
			eventId: players.eventId,
			externalId: players.externalId,
			externalSource: players.externalSource,
		})
		.from(players)
		.where(sql`exists (
			select 1 from json_each(${payload}) incoming
			where cast(json_extract(incoming.value, '$.eventId') as integer) = ${players.eventId}
				and json_extract(incoming.value, '$.externalId') = ${players.externalId}
				and json_extract(incoming.value, '$.externalSource') = ${players.externalSource}
		)`));
}

export function playerService() {
	const findById = async (id: number, eventId: number) => {
		return await db.query.players.findFirst({
			where: and(eq(players.id, id), eq(players.eventId, eventId)),
		});
	};

	const findAll = async (params: FindAllParams = {}) => {
		if (!params.eventId)
			return [];

		if (params.listId) {
			return await db
				.select({ ...getTableColumns(players) })
				.from(players)
				.innerJoin(playerListMembers, eq(players.id, playerListMembers.playerId))
				.innerJoin(playerLists, eq(playerListMembers.listId, playerLists.id))
				.where(and(
					eq(players.eventId, params.eventId),
					eq(playerListMembers.listId, params.listId),
					eq(playerLists.eventId, params.eventId),
					...(params.includeInactive ? [] : [eq(players.isActive, true)]),
				))
				.orderBy(sql`${players.position} IS NULL`, asc(players.position));
		}

		return await db
			.select()
			.from(players)
			.where(and(
				eq(players.eventId, params.eventId),
				...(params.includeInactive ? [] : [eq(players.isActive, true)]),
			))
			.orderBy(sql`${players.position} IS NULL`, asc(players.position));
	};

	const create = async (eventId: number, data: CreatePlayerInput): Promise<DbPlayer> => {
		const [newPlayer] = await db.insert(players).values({ ...pickManualWritable('players', data), eventId }).returning();
		if (!newPlayer) {
			throw new Error('Failed to create player');
		}
		return newPlayer;
	};

	const update = async (id: number, eventId: number, data: UpdatePlayerInput): Promise<DbPlayer | undefined> => {
		const [updatedPlayer] = await db
			.update(players)
			.set(pickManualWritable('players', data))
			.where(and(eq(players.id, id), eq(players.eventId, eventId)))
			.returning();

		return updatedPlayer;
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(players)
			.where(and(eq(players.id, id), eq(players.eventId, eventId)))
			.returning();

		return result.length > 0;
	};

	/**
	 * Batch upsert players atomically using D1 batch API
	 * All queries are executed in a single round-trip
	 */
	const batchUpsertByExternalId = async (
		dataList: PlayerInsertData[],
	): Promise<{ players: DbPlayer[]; created: number; updated: number }> => {
		// Handle empty input
		if (dataList.length === 0) {
			return { players: [], created: 0, updated: 0 };
		}

		const existingQueries = buildExistingPlayerQueries(dataList);
		const upsertQueries = buildBulkPlayerUpsertQueries(dataList, new Date());
		const queries = [...existingQueries, ...upsertQueries];

		// Execute all queries in a single batch (atomic in D1)
		// Cast needed because batch expects a non-empty tuple type
		const batchResults = await db.batch(queries as [typeof queries[0], ...typeof queries]);

		// Flatten results and count created vs updated
		const existingKeys = new Set(
			(batchResults.slice(0, existingQueries.length).flat() as PlayerInsertData[])
				.flatMap(row => playerIdentityKey(row) ?? []),
		);
		const allPlayers = batchResults.slice(existingQueries.length).flat() as DbPlayer[];
		const created = allPlayers.filter((player) => {
			const key = playerIdentityKey(player);
			return key == null || !existingKeys.has(key);
		}).length;
		const updated = allPlayers.length - created;

		return {
			players: allPlayers,
			created,
			updated,
		};
	};

	/**
	 * Reconcile one complete, validated Melee player snapshot atomically.
	 * Returned players are active and stamped as seen; previously imported
	 * players absent from the snapshot are retained but marked inactive.
	 */
	const reconcileMeleeSnapshot = async (
		eventId: number,
		dataList: MeleePlayerSnapshotData[],
		seenAt: Date = new Date(),
	): Promise<{ players: DbPlayer[]; created: number; updated: number; deactivated: number }> => {
		const externalIds = new Set<string>();
		for (const data of dataList) {
			if (externalIds.has(data.externalId)) {
				throw new Error(`Duplicate Melee player external identity: ${data.externalId}`);
			}
			externalIds.add(data.externalId);
		}

		const upsertRows = dataList.map((data): PlayerInsertData => {
			return {
				...data,
				eventId,
				externalSource: 'melee',
				isActive: true,
				lastSeenAt: seenAt,
			};
		});
		const upsertQueries = buildBulkPlayerUpsertQueries(upsertRows, seenAt);
		const existingQueries = buildExistingPlayerQueries(upsertRows);

		const deactivateMissingQuery = db
			.update(players)
			.set({ isActive: false, updatedAt: seenAt })
			.where(and(
				eq(players.eventId, eventId),
				eq(players.externalSource, 'melee'),
				eq(players.isActive, true),
				or(isNull(players.lastSeenAt), ne(players.lastSeenAt, seenAt)),
			))
			.returning({ id: players.id });
		const queries = [...existingQueries, ...upsertQueries, deactivateMissingQuery];
		const batchResults = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		const existingKeys = new Set(
			(batchResults.slice(0, existingQueries.length).flat() as PlayerInsertData[])
				.flatMap(row => playerIdentityKey(row) ?? []),
		);
		const upsertedPlayers = batchResults.slice(
			existingQueries.length,
			existingQueries.length + upsertQueries.length,
		).flat() as DbPlayer[];
		const deactivatedRows = (batchResults.at(-1) ?? []) as Array<{ id: number }>;
		const created = upsertedPlayers.filter((player) => {
			const key = playerIdentityKey(player);
			return key == null || !existingKeys.has(key);
		}).length;

		return {
			players: upsertedPlayers,
			created,
			updated: upsertedPlayers.length - created,
			deactivated: deactivatedRows.length,
		};
	};

	const countByIds = async (eventId: number, playerIds: number[]): Promise<number> => {
		if (playerIds.length === 0)
			return 0;

		const results = await db
			.select({ id: players.id })
			.from(players)
			.where(and(
				eq(players.eventId, eventId),
				inArray(players.id, playerIds),
			));

		return results.length;
	};

	return {
		findById,
		findAll,
		create,
		update,
		remove,
		batchUpsertByExternalId,
		reconcileMeleeSnapshot,
		countByIds,
	};
}
