import type { DbPhase, DbScreen, ExternalSource } from '~~/server/db/schema';
import type { CreatePhaseInput, UpdatePhaseInput } from '~~/shared/api';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { phases } from '~~/server/db/schema';
import { buildReleaseScreenEventReferencesQuery } from '~~/server/services/screen';
import { pickManualWritable } from '~~/server/utils/provenance';

export type PhaseUpsertInput = CreatePhaseInput & {
	eventId: number;
	externalId?: string | null;
	externalSource?: ExternalSource | null;
	formatExternalId?: string | null;
};

export function phaseService() {
	const findById = async (id: number, eventId: number) => {
		return await db.query.phases.findFirst({
			where: and(
				eq(phases.id, id),
				eq(phases.eventId, eventId),
			),
		});
	};

	const findByEventId = async (eventId: number) => {
		return await db
			.select()
			.from(phases)
			.where(eq(phases.eventId, eventId))
			.orderBy(phases.sortOrder, phases.id);
	};

	const create = async (
		eventId: number,
		data: CreatePhaseInput,
	): Promise<DbPhase> => {
		const [newPhase] = await db
			.insert(phases)
			.values({
				...pickManualWritable('phases', data),
				eventId,
				externalId: null,
				externalSource: 'manual',
				formatExternalId: null,
			})
			.returning();

		if (!newPhase) {
			throw new Error('Failed to create phase');
		}

		return newPhase;
	};

	const update = async (
		id: number,
		eventId: number,
		data: UpdatePhaseInput,
	): Promise<DbPhase | undefined> => {
		const [updatedPhase] = await db
			.update(phases)
			.set(pickManualWritable('phases', data))
			.where(
				and(
					eq(phases.id, id),
					eq(phases.eventId, eventId),
				),
			)
			.returning();

		return updatedPhase;
	};

	/**
	 * Deletes the Phase, and its Rounds by cascade, and in the same write releases
	 * every Screen reference to them (ADR-0060).
	 */
	const remove = async (id: number, eventId: number): Promise<{ deleted: boolean; clearedScreens: DbScreen[] }> => {
		const [deleted, clearedScreens] = await db.batch([
			db
				.delete(phases)
				.where(and(eq(phases.id, id), eq(phases.eventId, eventId)))
				.returning({ id: phases.id }),
			buildReleaseScreenEventReferencesQuery(eventId, ['phase', 'round']),
		]);

		return { deleted: deleted.length > 0, clearedScreens };
	};

	const exists = async (id: number, eventId: number): Promise<boolean> => {
		const phase = await db.query.phases.findFirst({
			where: and(
				eq(phases.id, id),
				eq(phases.eventId, eventId),
			),
			columns: { id: true },
		});

		return !!phase;
	};

	const getMaxSortOrder = async (eventId: number): Promise<number> => {
		const [result] = await db
			.select({ max: sql<number>`coalesce(max(${phases.sortOrder}), -1)` })
			.from(phases)
			.where(eq(phases.eventId, eventId));
		return result?.max ?? -1;
	};

	const findByExternalId = async (eventId: number, externalId: string, externalSource: ExternalSource) => {
		return await db.query.phases.findFirst({
			where: and(
				eq(phases.eventId, eventId),
				eq(phases.externalId, externalId),
				eq(phases.externalSource, externalSource),
			),
		});
	};

	const upsertByExternalId = async (data: PhaseUpsertInput): Promise<{ phase: DbPhase; created: boolean }> => {
		if (!data.externalId || !data.externalSource) {
			const newPhase = await create(data.eventId, data);
			return { phase: newPhase, created: true };
		}

		const [upsertedPhase] = await db
			.insert(phases)
			.values(data)
			.onConflictDoUpdate({
				target: [phases.eventId, phases.externalId, phases.externalSource],
				set: {
					name: data.name,
					sortOrder: data.sortOrder ?? 0,
					formatExternalId: data.formatExternalId,
					updatedAt: new Date(),
				},
			})
			.returning();

		if (!upsertedPhase) {
			throw new Error('Failed to upsert phase');
		}

		const created = upsertedPhase.createdAt.getTime() === upsertedPhase.updatedAt.getTime();
		return { phase: upsertedPhase, created };
	};

	return {
		findById,
		findByEventId,
		findByExternalId,
		create,
		update,
		remove,
		exists,
		getMaxSortOrder,
		upsertByExternalId,
	};
}
