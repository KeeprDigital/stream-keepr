import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { CreateFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput } from '~~/shared/api';
import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { featureMatchAssignments } from '~~/server/db/schema';

/**
 * Build the delete-then-upsert statements for an Assignment without executing
 * them, so promotion can persist the Assignment inside the same atomic D1 batch
 * as the Slot and Session writes. Mirrors `upsert` exactly; keep the two in sync.
 */
export function buildUpsertAssignmentQueries(eventId: number, input: CreateFeatureMatchAssignmentInput): BatchItem<'sqlite'>[] {
	return [
		// Move this match out of any other slot in the same round.
		db.delete(featureMatchAssignments).where(and(
			eq(featureMatchAssignments.eventId, eventId),
			eq(featureMatchAssignments.roundId, input.roundId),
			eq(featureMatchAssignments.matchId, input.matchId),
		)),
		db
			.insert(featureMatchAssignments)
			.values({ ...input, eventId })
			.onConflictDoUpdate({
				target: [featureMatchAssignments.roundId, featureMatchAssignments.slotId],
				set: {
					matchId: input.matchId,
					note: input.note ?? null,
					updatedAt: new Date(),
				},
			})
			.returning(),
	];
}

export function featureMatchAssignmentService() {
	const findById = async (eventId: number, id: number): Promise<DbFeatureMatchAssignment | undefined> => {
		return await db.query.featureMatchAssignments.findFirst({
			where: and(eq(featureMatchAssignments.eventId, eventId), eq(featureMatchAssignments.id, id)),
		});
	};

	const findByRoundAndSlot = async (eventId: number, roundId: number, slotId: number): Promise<DbFeatureMatchAssignment | undefined> => {
		return await db.query.featureMatchAssignments.findFirst({
			where: and(
				eq(featureMatchAssignments.eventId, eventId),
				eq(featureMatchAssignments.roundId, roundId),
				eq(featureMatchAssignments.slotId, slotId),
			),
		});
	};

	const findByRound = async (eventId: number, roundId: number): Promise<DbFeatureMatchAssignment[]> => {
		return await db
			.select()
			.from(featureMatchAssignments)
			.where(and(
				eq(featureMatchAssignments.eventId, eventId),
				eq(featureMatchAssignments.roundId, roundId),
			));
	};

	const upsert = async (eventId: number, input: CreateFeatureMatchAssignmentInput): Promise<DbFeatureMatchAssignment> => {
		const [, insertedRows] = await db.batch(
			buildUpsertAssignmentQueries(eventId, input) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
		);

		const [assignment] = (insertedRows ?? []) as DbFeatureMatchAssignment[];
		if (!assignment)
			throw new Error('Failed to save feature match assignment');
		return assignment;
	};

	const update = async (eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput): Promise<DbFeatureMatchAssignment | undefined> => {
		const current = await findById(eventId, assignmentId);
		if (!current)
			return undefined;

		if (input.matchId !== undefined) {
			await db.delete(featureMatchAssignments).where(and(
				eq(featureMatchAssignments.eventId, eventId),
				eq(featureMatchAssignments.roundId, current.roundId),
				eq(featureMatchAssignments.matchId, input.matchId),
				ne(featureMatchAssignments.id, assignmentId),
			));
		}

		const [updated] = await db
			.update(featureMatchAssignments)
			.set({ ...input, updatedAt: new Date() })
			.where(and(eq(featureMatchAssignments.eventId, eventId), eq(featureMatchAssignments.id, assignmentId)))
			.returning();
		return updated;
	};

	const remove = async (eventId: number, assignmentId: number): Promise<boolean> => {
		const deleted = await db
			.delete(featureMatchAssignments)
			.where(and(eq(featureMatchAssignments.eventId, eventId), eq(featureMatchAssignments.id, assignmentId)))
			.returning({ id: featureMatchAssignments.id });
		return deleted.length > 0;
	};

	return { findById, findByRound, findByRoundAndSlot, upsert, update, remove };
}
