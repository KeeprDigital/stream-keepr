import type { DbPlayerList } from '~~/server/db/schema';
import type { CreatePlayerListInput, UpdatePlayerListInput } from '~~/shared/api';
import { and, asc, eq, getTableColumns, inArray, max, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { playerListMembers, playerLists, players } from '~~/server/db/schema';
import { chunkArray, chunkJsonRows, SAFE_INARRAY_SIZE, selectForInsert } from '~~/server/utils/db';

export function playerListService() {
	const validatePlayersBelongToEvent = async (eventId: number, playerIds: number[]) => {
		if (playerIds.length === 0)
			return;

		const uniquePlayerIds = [...new Set(playerIds)];
		const existingPlayers: Array<{ id: number }> = [];
		for (const payload of chunkJsonRows(uniquePlayerIds)) {
			existingPlayers.push(...await db
				.select({ id: players.id })
				.from(players)
				.where(and(
					eq(players.eventId, eventId),
					eq(players.isActive, true),
					sql`${players.id} in (
						select cast(value as integer)
						from json_each(${payload})
					)`,
				)));
		}

		if (existingPlayers.length !== uniquePlayerIds.length) {
			throw createError({ statusCode: 404, message: 'Player not found' });
		}
	};

	// ── List CRUD ──

	const findByEventId = async (eventId: number) => {
		return await db
			.select({
				...getTableColumns(playerLists),
				memberCount: sql<number>`count(${players.id})`.as('member_count'),
			})
			.from(playerLists)
			.leftJoin(playerListMembers, eq(playerLists.id, playerListMembers.listId))
			.leftJoin(players, and(
				eq(playerListMembers.playerId, players.id),
				eq(players.eventId, eventId),
				eq(players.isActive, true),
			))
			.where(eq(playerLists.eventId, eventId))
			.groupBy(playerLists.id)
			.orderBy(asc(playerLists.name));
	};

	const findById = async (id: number, eventId: number) => {
		const [list] = await db
			.select()
			.from(playerLists)
			.where(and(eq(playerLists.id, id), eq(playerLists.eventId, eventId)))
			.limit(1);

		return list;
	};

	const findByIdWithMembers = async (id: number, eventId: number) => {
		const list = await findById(id, eventId);
		if (!list)
			return undefined;

		const members = await getMembers(id, eventId);
		return { ...list, members };
	};

	const create = async (eventId: number, data: CreatePlayerListInput): Promise<DbPlayerList> => {
		const [newList] = await db.insert(playerLists).values({ ...data, eventId }).returning();
		if (!newList) {
			throw new Error('Failed to create player list');
		}
		return newList;
	};

	const update = async (id: number, eventId: number, data: UpdatePlayerListInput): Promise<DbPlayerList | undefined> => {
		const [updatedList] = await db
			.update(playerLists)
			.set(data)
			.where(and(eq(playerLists.id, id), eq(playerLists.eventId, eventId)))
			.returning();

		return updatedList;
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(playerLists)
			.where(and(eq(playerLists.id, id), eq(playerLists.eventId, eventId)))
			.returning();

		return result.length > 0;
	};

	// ── Member Management ──

	const addMembers = async (listId: number, eventId: number, playerIds: number[]) => {
		// Verify list belongs to event
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		await validatePlayersBelongToEvent(eventId, playerIds);

		// Get current max sortOrder for this list
		const [maxResult] = await db
			.select({ maxOrder: max(playerListMembers.sortOrder) })
			.from(playerListMembers)
			.where(eq(playerListMembers.listId, listId));
		const startOrder = (maxResult?.maxOrder ?? -1) + 1;

		const nowMs = Date.now();
		const payloads = chunkJsonRows(playerIds.map((playerId, index) => ({
			playerId,
			sortOrder: startOrder + index,
		})));
		const queries = payloads.map(payload => db.insert(playerListMembers)
			.select(selectForInsert(playerListMembers, {
				id: sql`null`,
				listId: sql`${listId}`,
				playerId: sql`cast(json_extract(value, '$.playerId') as integer)`,
				sortOrder: sql`cast(json_extract(value, '$.sortOrder') as integer)`,
				createdAt: sql`${nowMs}`,
				updatedAt: sql`${nowMs}`,
			}, sql`from json_each(${payload}) where true`))
			.onConflictDoNothing()
			.returning());
		const results = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		const added = results.flat().length;

		return { added };
	};

	const removeMember = async (listId: number, eventId: number, playerId: number): Promise<boolean> => {
		// Verify list belongs to event
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		await validatePlayersBelongToEvent(eventId, [playerId]);

		const result = await db
			.delete(playerListMembers)
			.where(and(
				eq(playerListMembers.listId, listId),
				eq(playerListMembers.playerId, playerId),
			))
			.returning();

		return result.length > 0;
	};

	async function getMembers(listId: number, eventId: number) {
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		return await db
			.select({ ...getTableColumns(players) })
			.from(playerListMembers)
			.innerJoin(players, eq(playerListMembers.playerId, players.id))
			.where(and(
				eq(playerListMembers.listId, listId),
				eq(players.eventId, eventId),
				eq(players.isActive, true),
			))
			.orderBy(asc(playerListMembers.sortOrder), asc(playerListMembers.id));
	};

	const loadMemberPlayerIds = async (listId: number, eventId: number): Promise<number[]> => {
		const results = await db
			.select({ playerId: playerListMembers.playerId })
			.from(playerListMembers)
			.innerJoin(players, eq(playerListMembers.playerId, players.id))
			.where(and(
				eq(playerListMembers.listId, listId),
				eq(players.eventId, eventId),
				eq(players.isActive, true),
			))
			.orderBy(asc(playerListMembers.sortOrder), asc(playerListMembers.id));

		return results.map(r => r.playerId);
	};

	const getMemberPlayerIds = async (listId: number, eventId: number): Promise<number[]> => {
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		return await loadMemberPlayerIds(listId, eventId);
	};

	const getMemberCount = async (listId: number, eventId: number): Promise<number> => {
		const [result] = await db
			.select({ memberCount: sql<number>`count(${playerListMembers.id})` })
			.from(playerListMembers)
			.innerJoin(playerLists, eq(playerListMembers.listId, playerLists.id))
			.innerJoin(players, eq(playerListMembers.playerId, players.id))
			.where(and(
				eq(playerListMembers.listId, listId),
				eq(playerLists.eventId, eventId),
				eq(players.eventId, eventId),
				eq(players.isActive, true),
			));

		return Number(result?.memberCount ?? 0);
	};

	const batchRemoveMembers = async (listId: number, eventId: number, playerIds: number[]): Promise<number> => {
		// Verify list belongs to event
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		if (playerIds.length === 0)
			return 0;

		await validatePlayersBelongToEvent(eventId, playerIds);

		// Chunk the inArray to stay under D1's 100 bound-parameter limit.
		// Uses db.batch so all deletes are atomic.
		const chunks = chunkArray(playerIds, SAFE_INARRAY_SIZE);
		const queries = chunks.map(chunk =>
			db
				.delete(playerListMembers)
				.where(and(
					eq(playerListMembers.listId, listId),
					inArray(playerListMembers.playerId, chunk),
				))
				.returning(),
		);

		const batchResults = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		return batchResults.flat().length;
	};

	const reorderMembers = async (listId: number, eventId: number, playerIds: number[]) => {
		// Verify list belongs to event
		const list = await findById(listId, eventId);
		if (!list) {
			throw createError({ statusCode: 404, message: 'Player list not found' });
		}

		const uniquePlayerIds = new Set(playerIds);
		const currentPlayerIds = await loadMemberPlayerIds(listId, eventId);
		if (uniquePlayerIds.size !== playerIds.length
			|| playerIds.length !== currentPlayerIds.length
			|| currentPlayerIds.some(playerId => !uniquePlayerIds.has(playerId))) {
			throw createError({
				statusCode: 400,
				message: 'playerIds must contain each current list member exactly once',
			});
		}

		const payload = JSON.stringify(playerIds);
		await db.update(playerListMembers)
			.set({
				sortOrder: sql<number>`(
					select cast(key as integer)
					from json_each(${payload})
					where cast(value as integer) = ${playerListMembers.playerId}
				)`,
			})
			.where(and(
				eq(playerListMembers.listId, listId),
				sql`${playerListMembers.playerId} in (
					select cast(value as integer)
					from json_each(${payload})
				)`,
			));

		return { reordered: currentPlayerIds.length };
	};

	return {
		findByEventId,
		findById,
		findByIdWithMembers,
		create,
		update,
		remove,
		addMembers,
		removeMember,
		batchRemoveMembers,
		reorderMembers,
		getMembers,
		getMemberPlayerIds,
		getMemberCount,
	};
}
