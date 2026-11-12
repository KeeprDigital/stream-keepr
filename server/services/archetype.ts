import type { DbArchetype } from '~~/server/db/schema';
import type { CreateArchetypeInput, UpdateArchetypeInput } from '~~/shared/api';
import { and, asc, eq, inArray, notExists } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, playerDecks, players } from '~~/server/db/schema';
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
		const uniqueIds = [
			...new Set(ids),
		];
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
		data: UpdateArchetypeInput & { customised?: true },
	): Promise<DbArchetype | undefined> => {
		const [updated] = await db
			.update(archetypes)
			.set(data)
			.where(and(eq(archetypes.id, id), eq(archetypes.eventId, eventId)))
			.returning();

		return updated;
	};

	/**
	 * Build (without executing) the archetype delete statement, for a batch
	 * that also clears the deck reviews naming it and releases the Screens
	 * naming it (ADR-0060). There is no standalone delete: it would release
	 * neither.
	 */
	const buildRemoveQuery = (id: number, eventId: number) => {
		return db
			.delete(archetypes)
			.where(and(eq(archetypes.id, id), eq(archetypes.eventId, eventId)))
			.returning();
	};

	/**
	 * Build (without executing) the delete of the Event's Empty Archetypes: those
	 * no Deck List is assigned to, primary or not. One a Player holds with no
	 * Deck List, as the Player write allows, has a Pilot and stays. For a batch
	 * that also releases the Screens naming them (ADR-0060).
	 */
	const buildRemoveEmptyQuery = (eventId: number) => {
		return db
			.delete(archetypes)
			.where(and(
				eq(archetypes.eventId, eventId),
				notExists(db.select({ id: playerDecks.id }).from(playerDecks).where(eq(playerDecks.archetypeId, archetypes.id))),
				notExists(db.select({ id: players.id }).from(players).where(eq(players.archetypeId, archetypes.id))),
			))
			.returning();
	};

	return {
		findByEventId,
		findById,
		findManyByIds,
		create,
		update,
		buildRemoveQuery,
		buildRemoveEmptyQuery,
	};
}
