import type { DbRound, ExternalSource } from '~~/server/db/schema';
import type { CreateRoundInput, UpdateRoundInput } from '~~/shared/api';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { phases, rounds } from '~~/server/db/schema';
import { pickManualWritable } from '~~/server/utils/provenance';

export type RoundUpsertInput = CreateRoundInput & {
	eventId: number;
	externalId?: string | null;
	externalSource?: ExternalSource | null;
};

/** Build a Round sync timestamp update for composition into an atomic batch. */
export function buildMarkRoundSyncedQuery(
	id: number,
	eventId: number,
	syncedAt = new Date(),
) {
	return db
		.update(rounds)
		.set({ lastSyncedAt: syncedAt })
		.where(
			and(
				eq(rounds.id, id),
				eq(rounds.eventId, eventId),
			),
		)
		.returning();
}

export function roundService() {
	const findById = async (id: number, eventId: number): Promise<DbRound | undefined> => {
		return (await db.query.rounds.findFirst({
			where: and(
				eq(rounds.id, id),
				eq(rounds.eventId, eventId),
			),
		})) as DbRound | undefined;
	};

	const findByEventId = async (eventId: number): Promise<DbRound[]> => {
		return await db
			.select()
			.from(rounds)
			.where(eq(rounds.eventId, eventId))
			.orderBy(
				sql`(select ${phases.sortOrder} from ${phases} where ${phases.id} = ${rounds.phaseId})`,
				rounds.roundNumber,
				rounds.id,
			);
	};

	const findByPhaseId = async (phaseId: number, eventId: number): Promise<DbRound[]> => {
		return await db
			.select()
			.from(rounds)
			.where(
				and(
					eq(rounds.phaseId, phaseId),
					eq(rounds.eventId, eventId),
				),
			)
			.orderBy(rounds.roundNumber, rounds.id);
	};

	const create = async (
		eventId: number,
		data: CreateRoundInput,
	): Promise<DbRound> => {
		const [newRound] = await db
			.insert(rounds)
			.values({
				...pickManualWritable('rounds', data),
				eventId,
				externalId: null,
				externalSource: 'manual',
				lastSyncedAt: null,
			})
			.returning();

		if (!newRound) {
			throw new Error('Failed to create round');
		}

		return newRound;
	};

	const update = async (
		id: number,
		eventId: number,
		data: UpdateRoundInput,
	): Promise<DbRound | undefined> => {
		const [updatedRound] = await db
			.update(rounds)
			.set(pickManualWritable('rounds', data))
			.where(
				and(
					eq(rounds.id, id),
					eq(rounds.eventId, eventId),
				),
			)
			.returning();

		return updatedRound;
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(rounds)
			.where(
				and(
					eq(rounds.id, id),
					eq(rounds.eventId, eventId),
				),
			)
			.returning();

		return result.length > 0;
	};

	const findByExternalId = async (eventId: number, externalId: string, externalSource: ExternalSource): Promise<DbRound | undefined> => {
		return (await db.query.rounds.findFirst({
			where: and(
				eq(rounds.eventId, eventId),
				eq(rounds.externalId, externalId),
				eq(rounds.externalSource, externalSource),
			),
		})) as DbRound | undefined;
	};

	const exists = async (id: number, eventId: number): Promise<boolean> => {
		const round = await db.query.rounds.findFirst({
			where: and(
				eq(rounds.id, id),
				eq(rounds.eventId, eventId),
			),
			columns: { id: true },
		});

		return !!round;
	};

	const upsertByExternalId = async (data: RoundUpsertInput): Promise<{ round: DbRound; created: boolean }> => {
		if (!data.externalId || !data.externalSource) {
			const newRound = await create(data.eventId, data);
			return { round: newRound, created: true };
		}

		const [upsertedRound] = await db
			.insert(rounds)
			.values(data)
			.onConflictDoUpdate({
				target: [rounds.eventId, rounds.externalId, rounds.externalSource],
				set: {
					name: data.name,
					roundNumber: data.roundNumber,
					phaseId: data.phaseId,
					updatedAt: new Date(),
				},
			})
			.returning();

		if (!upsertedRound) {
			throw new Error('Failed to upsert round');
		}

		const created = upsertedRound.createdAt.getTime() === upsertedRound.updatedAt.getTime();
		return { round: upsertedRound, created };
	};

	return {
		findById,
		findByEventId,
		findByPhaseId,
		findByExternalId,
		create,
		update,
		remove,
		exists,
		upsertByExternalId,
	};
}
