import type { DbArchetype, DbScreen } from '~~/server/db/schema';
import type { OpCatalogueCard } from '~~/shared/types/card/op';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, cards, playerDecks, players } from '~~/server/db/schema';
import { opCatalogueRowFor } from '~~/server/services/opCardCatalogue';
import { buildReleaseScreenEventReferencesQuery } from '~~/server/services/screen';
import { inJsonArray } from '~~/server/utils/db';
import { formatOpColors } from '~~/shared/utils/card/op';

/**
 * A One Piece Card Game Player's Archetype is their Leader card (ADR-0074).
 * One Archetype per Leader card number per Event, created on first use, named
 * after the Leader and coloured by it. When two Leaders share a name, every
 * Archetype in the clash an operator has not customised takes its card number
 * too, and keeps it after the clash is gone, so names stay stable.
 */

export interface LeaderArchetype {
	archetype: DbArchetype;
	created: DbArchetype | null;
	/** Archetypes a new clash gave their card number. */
	renamed: DbArchetype[];
}

function numberedName(name: string, number: string): string {
	return `${name} (${number})`;
}

/** The Archetype derived from a catalogued Leader, created, with any clash renamed, if the Event has none yet. */
export async function deriveLeaderArchetype(eventId: number, number: string, leader: OpCatalogueCard): Promise<LeaderArchetype> {
	const held = await db.query.archetypes.findFirst({
		where: and(eq(archetypes.eventId, eventId), eq(archetypes.leaderCardNumber, number)),
	});
	if (held)
		return { archetype: held, created: null, renamed: [] };

	// Another Archetype already shown by this Leader's name: a derived one whose Leader shares it, or a renamed one.
	const clashing = await db.select({ archetype: archetypes, leaderName: cards.name })
		.from(archetypes)
		.leftJoin(cards, opCatalogueRowFor(archetypes.leaderCardNumber))
		.where(and(
			eq(archetypes.eventId, eventId),
			or(eq(archetypes.name, leader.name), eq(cards.name, leader.name)),
		));

	const [created] = await db.insert(archetypes)
		.values({
			eventId,
			name: clashing.length > 0
				? numberedName(leader.name, number)
				: leader.name,
			colors: formatOpColors(leader.colors),
			leaderCardNumber: number,
		})
		.onConflictDoNothing()
		.returning();
	if (!created) {
		// A write for the same Leader landed first.
		const raced = await db.query.archetypes.findFirst({
			where: and(eq(archetypes.eventId, eventId), eq(archetypes.leaderCardNumber, number)),
		});
		if (!raced)
			throw createError({ statusCode: 409, message: `An Archetype is already named ${leader.name}` });
		return { archetype: raced, created: null, renamed: [] };
	}

	const renamed: DbArchetype[] = [];
	for (const { archetype, leaderName } of clashing) {
		if (archetype.customised || archetype.leaderCardNumber === null || archetype.name !== leaderName)
			continue;
		const [row] = await db.update(archetypes)
			.set({
				name: numberedName(archetype.name, archetype.leaderCardNumber),
				updatedAt: new Date(),
			})
			.where(and(eq(archetypes.id, archetype.id), eq(archetypes.customised, false)))
			.returning();
		if (row)
			renamed.push(row);
	}
	return { archetype: created, created, renamed };
}

/** Whether an Archetype is one the cleanup removes: derived, not customised, and with no Players. */
function unheldDerivedArchetype(eventId: number, ids: readonly number[]) {
	return and(
		eq(archetypes.eventId, eventId),
		inJsonArray(archetypes.id, ids),
		isNotNull(archetypes.leaderCardNumber),
		eq(archetypes.customised, false),
		sql`not exists (select 1 from ${players} where ${players.archetypeId} = ${archetypes.id})`,
		sql`not exists (select 1 from ${playerDecks} where ${playerDecks.archetypeId} = ${archetypes.id})`,
	)!;
}

/**
 * Deletes those of `ids` left with no Players, unless customised, and releases
 * every Screen naming them, in one batch (ADR-0060). Answers what it deleted
 * and the Screens it released.
 */
export async function removeEmptiedLeaderArchetypes(eventId: number, ids: readonly number[]): Promise<{ deletedIds: number[]; releasedScreens: DbScreen[] }> {
	if (ids.length === 0)
		return { deletedIds: [], releasedScreens: [] };
	const [deleted, releasedScreens] = await db.batch([
		db.delete(archetypes).where(unheldDerivedArchetype(eventId, ids)).returning({ id: archetypes.id }),
		buildReleaseScreenEventReferencesQuery(eventId, ['archetype']),
	]);
	return {
		deletedIds: deleted.map(row => row.id),
		releasedScreens,
	};
}
