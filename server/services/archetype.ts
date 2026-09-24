import type { DbArchetype } from '~~/server/db/schema';
import type { CreateArchetypeInput, UpdateArchetypeInput } from '~~/shared/api';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes } from '~~/server/db/schema';
import { chunkArray, SAFE_INARRAY_SIZE } from '~~/server/utils/db';

export function archetypeService() {
	const findByEventId = async (eventId: number): Promise<DbArchetype[]> => {
		return await db
			.select()
			.from(archetypes)
			.where(eq(archetypes.eventId, eventId))
			.orderBy(asc(archetypes.name));
	};

	const findById = async (id: number, eventId: number): Promise<DbArchetype | undefined> => {
		const [archetype] = await db
			.select()
			.from(archetypes)
			.where(and(eq(archetypes.id, id), eq(archetypes.eventId, eventId)))
			.limit(1);

		return archetype;
	};

	const findManyByIds = async (eventId: number, ids: number[]): Promise<DbArchetype[]> => {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0)
			return [];

		const rows: DbArchetype[] = [];
		for (const idChunk of chunkArray(uniqueIds, SAFE_INARRAY_SIZE)) {
			rows.push(...await db
				.select()
				.from(archetypes)
				.where(and(
					eq(archetypes.eventId, eventId),
					inArray(archetypes.id, idChunk),
				)));
		}
		return rows;
	};

	const create = async (eventId: number, data: CreateArchetypeInput): Promise<DbArchetype> => {
		const [newArchetype] = await db.insert(archetypes).values({ ...data, eventId }).returning();
		if (!newArchetype) {
			throw new Error('Failed to create archetype');
		}
		return newArchetype;
	};

	/** Update an archetype record (e.g. key cards). No cascade to players. */
	const update = async (
		id: number,
		eventId: number,
		data: UpdateArchetypeInput,
	): Promise<DbArchetype | undefined> => {
		const [updated] = await db
			.update(archetypes)
			.set(data)
			.where(and(eq(archetypes.id, id), eq(archetypes.eventId, eventId)))
			.returning();

		return updated;
	};

	/**
	 * Build (without executing) the archetype delete statement. Exposed so
	 * callers that need this to commit atomically with other writes (e.g.
	 * clearing deck reviews for the same archetype) can append it to a shared
	 * `db.batch()` instead of running it as its own round trip.
	 */
	const buildRemoveQuery = (id: number, eventId: number) => {
		return db
			.delete(archetypes)
			.where(and(eq(archetypes.id, id), eq(archetypes.eventId, eventId)))
			.returning();
	};

	/** Delete an archetype record. No cascade to players. */
	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await buildRemoveQuery(id, eventId);

		return result.length > 0;
	};

	return {
		findByEventId,
		findById,
		findManyByIds,
		create,
		update,
		buildRemoveQuery,
		remove,
	};
}
