import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatchAssignment } from '~~/server/db/schema';
import type { CreateFeatureMatchAssignmentInput, UpdateFeatureMatchAssignmentInput } from '~~/shared/api';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { featureMatchAssignments } from '~~/server/db/schema';

/**
 * Build the displacement/move/create statements for an Assignment without
 * executing them, so promotion can persist the Assignment inside the same atomic
 * D1 batch as the Slot and Session writes. Mirrors `upsert` exactly; keep the two
 * in sync.
 */
export function buildUpsertAssignmentQueries(eventId: number, input: CreateFeatureMatchAssignmentInput): BatchItem<'sqlite'>[] {
	return [
		// A different Match already assigned to the destination ends here. The
		// promotion workflow checks destructive Note loss before this query runs.
		db.delete(featureMatchAssignments).where(and(
			eq(featureMatchAssignments.eventId, eventId),
			eq(featureMatchAssignments.roundId, input.roundId),
			eq(featureMatchAssignments.slotId, input.slotId),
			ne(featureMatchAssignments.matchId, input.matchId),
		)),
		// Moving the same Match in this Round continues its Assignment, including
		// identity and Note. Re-promoting it to the same Slot is therefore harmless.
		db.update(featureMatchAssignments)
			.set({
				slotId: input.slotId,
				...(input.note !== undefined ? { note: input.note } : {}),
				updatedAt: new Date(),
			})
			.where(and(
				eq(featureMatchAssignments.eventId, eventId),
				eq(featureMatchAssignments.roundId, input.roundId),
				eq(featureMatchAssignments.matchId, input.matchId),
			)),
		// If the Match was not already assigned in this Round, start a blank new
		// Assignment. Any conflict means the preceding update continued it instead.
		db
			.insert(featureMatchAssignments)
			.values({ ...input, eventId })
			.onConflictDoNothing(),
	];
}

/**
 * Abort a reassignment batch if the destination changed since preflight. This
 * guard is present even when the destination was empty, so a Note created by a
 * concurrent request cannot appear between the read and destructive delete.
 * The deliberately invalid insert rolls the whole D1 batch back before writes.
 */
interface AssignmentDisplacementGuardInput {
	roundId: number;
	slotId: number;
	incomingMatchId: number;
	expectedAssignment?: Pick<DbFeatureMatchAssignment, 'id' | 'updatedAt'>;
}

export function buildAssignmentDisplacementGuardQuery(
	eventId: number,
	input: AssignmentDisplacementGuardInput,
): BatchItem<'sqlite'> {
	const now = Date.now();
	const unsafeDestination = input.expectedAssignment
		? sql`not exists (
			select 1
			from ${featureMatchAssignments}
			where ${featureMatchAssignments.id} = ${input.expectedAssignment.id}
				and ${featureMatchAssignments.eventId} = ${eventId}
				and ${featureMatchAssignments.roundId} = ${input.roundId}
				and ${featureMatchAssignments.slotId} = ${input.slotId}
				and ${featureMatchAssignments.matchId} != ${input.incomingMatchId}
				and ${featureMatchAssignments.updatedAt} = ${input.expectedAssignment.updatedAt.getTime()}
		)`
		: sql`exists (
			select 1
			from ${featureMatchAssignments}
			where ${featureMatchAssignments.eventId} = ${eventId}
				and ${featureMatchAssignments.roundId} = ${input.roundId}
				and ${featureMatchAssignments.slotId} = ${input.slotId}
				and ${featureMatchAssignments.matchId} != ${input.incomingMatchId}
		)`;
	return db.insert(featureMatchAssignments).select(sql`
		select
			0,
			null,
			0,
			0,
			0,
			null,
			${now},
			${now}
		where ${unsafeDestination}
	`);
}

export function isAssignmentDisplacementGuardViolation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('NOT NULL constraint failed: feature_match_assignments.event_id');
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

	const findByRoundAndMatch = async (eventId: number, roundId: number, matchId: number): Promise<DbFeatureMatchAssignment | undefined> => {
		return await db.query.featureMatchAssignments.findFirst({
			where: and(
				eq(featureMatchAssignments.eventId, eventId),
				eq(featureMatchAssignments.roundId, roundId),
				eq(featureMatchAssignments.matchId, matchId),
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

	const upsert = async (
		eventId: number,
		input: CreateFeatureMatchAssignmentInput,
		expectedAssignment?: Pick<DbFeatureMatchAssignment, 'id' | 'updatedAt'>,
	): Promise<DbFeatureMatchAssignment> => {
		await db.batch(
			[
				buildAssignmentDisplacementGuardQuery(eventId, {
					roundId: input.roundId,
					slotId: input.slotId,
					incomingMatchId: input.matchId,
					expectedAssignment,
				}),
				...buildUpsertAssignmentQueries(eventId, input),
			] as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
		);

		const assignment = await findByRoundAndSlot(eventId, input.roundId, input.slotId);
		if (!assignment)
			throw new Error('Failed to save feature match assignment');
		return assignment;
	};

	const update = async (eventId: number, assignmentId: number, input: UpdateFeatureMatchAssignmentInput): Promise<DbFeatureMatchAssignment | undefined> => {
		const current = await findById(eventId, assignmentId);
		if (!current)
			return undefined;

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

	return { findById, findByRound, findByRoundAndSlot, findByRoundAndMatch, upsert, update, remove };
}
