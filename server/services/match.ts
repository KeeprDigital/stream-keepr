import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatch, DbMatch } from '~~/server/db/schema';
import type { CreateMatchInput, PlayerSlotData, UpdateMatchInput } from '~~/shared/api';
import type { ExternalSource } from '~~/shared/types/enums';
import { and, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { featureMatches, matches, rounds } from '~~/server/db/schema';
import { chunkJsonRows, observedValue, selectForInsert } from '~~/server/utils/db';
import { pickManualWritable } from '~~/server/utils/provenance';

export type MatchUpsertInput = Omit<CreateMatchInput, 'player1Data' | 'player2Data'> & {
	eventId: number;
	externalId?: string | null;
	externalSource?: ExternalSource | null;
	player1Data?: PlayerSlotData | null;
	player2Data?: PlayerSlotData | null;
};

/**
 * Build a Match insert/upsert without executing it so authoritative syncs can
 * compose Match writes into a larger atomic D1 batch.
 */
export function buildMatchUpsertQuery(data: MatchUpsertInput) {
	if (!data.externalId || !data.externalSource) {
		return db.insert(matches).values(data).returning();
	}

	return db
		.insert(matches)
		.values(data)
		.onConflictDoUpdate({
			target: [matches.eventId, matches.externalId, matches.externalSource],
			set: {
				roundId: data.roundId,
				tableNumber: data.tableNumber,
				player1Id: data.player1Id,
				player2Id: data.player2Id,
				player1Data: data.player1Data,
				player2Data: data.player2Data,
				hasResult: data.hasResult,
				player1GameWins: data.player1GameWins,
				player2GameWins: data.player2GameWins,
				gameDraws: data.gameDraws,
				isBye: data.isBye,
				resultString: data.resultString,
				sortOrder: data.sortOrder,
				updatedAt: new Date(),
			},
		})
		.returning();
}

/**
 * Build one stale-Match delete statement for an authoritative Melee Round
 * snapshot. Each JSON identity payload is independently byte/row bounded;
 * every chunk remains part of this one atomic delete statement.
 */
export function buildDeleteStaleMatchesByRoundQuery(
	eventId: number,
	roundId: number,
	keepExternalIds: string[],
) {
	const keepExternalIdPayloads = chunkJsonRows([...new Set(keepExternalIds)]);
	const keptExists = keepExternalIdPayloads.map(payload => sql`exists (
		select 1
		from json_each(${payload}) as kept
		where kept.value = ${matches.externalId}
	)`);

	return db
		.delete(matches)
		.where(and(
			eq(matches.eventId, eventId),
			eq(matches.roundId, roundId),
			eq(matches.externalSource, 'melee'),
			...(keptExists.length === 0
				? []
				: [sql`not (${sql.join(keptExists, sql` or `)})`]),
		))
		.returning({ id: matches.id });
}

export interface MatchPromotionPlan {
	clearedSlots: DbFeatureMatch[];
	promotedSlot: DbFeatureMatch;
	queries: BatchItem<'sqlite'>[];
}

/**
 * Abort a promotion batch whose plan has gone stale: a Slot it read no longer
 * holds the pairing or Session it read, or a Slot it did not read now holds the
 * Match. The deliberately invalid insert trips the NOT NULL constraint
 * `isMatchPromotionPlanStaleViolation()` recognises, rolling the whole batch
 * back before any of its writes.
 */
function buildPromotionPlanFenceQuery(
	eventId: number,
	observedSlots: DbFeatureMatch[],
	unobservedHolderWhere: SQL | undefined,
): BatchItem<'sqlite'> {
	const now = Date.now();
	const movedOn = observedSlots.map(slot => sql`not exists (
		select 1
		from ${featureMatches}
		where ${and(
			eq(featureMatches.id, slot.id),
			eq(featureMatches.eventId, eventId),
			observedValue(featureMatches.matchId, slot.matchId),
			observedValue(featureMatches.externalId, slot.externalId),
			observedValue(featureMatches.externalSource, slot.externalSource),
			observedValue(featureMatches.player1Id, slot.player1Id),
			observedValue(featureMatches.player2Id, slot.player2Id),
			observedValue(featureMatches.activeSessionId, slot.activeSessionId),
			eq(featureMatches.updatedAt, slot.updatedAt),
		)}
	)`);
	const unobservedHolder = sql`exists (
		select 1
		from ${featureMatches}
		where ${unobservedHolderWhere}
	)`;

	return db.insert(featureMatches).select(selectForInsert(featureMatches, {
		id: sql`null`,
		// The null event_id is the mechanism: it trips the NOT NULL constraint
		// isMatchPromotionPlanStaleViolation() recognises, aborting the batch.
		eventId: sql`null`,
		matchId: sql`null`,
		externalId: sql`null`,
		externalSource: sql`null`,
		tableNumber: sql`null`,
		roundName: sql`null`,
		formatName: sql`null`,
		player1Id: sql`null`,
		player2Id: sql`null`,
		player1Data: sql`null`,
		player2Data: sql`null`,
		bestOf: sql`0`,
		sortOrder: sql`0`,
		playerDisplayMode: sql`'score'`,
		activeSessionId: sql`null`,
		createdAt: sql`${now}`,
		updatedAt: sql`${now}`,
	}, sql`where ${sql.join([...movedOn, unobservedHolder], sql` or `)}`));
}

export function isMatchPromotionPlanStaleViolation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : '';
	return message.includes('NOT NULL constraint failed: feature_match_slots.event_id');
}

/**
 * Build the write statements that promote a Match into a Feature Match Slot
 * without executing them, so promotion can persist the Slot mutation, its
 * Assignment and the Session resets in one atomic D1 batch.
 *
 * The duplicate Slots are read up front (their pre-clear rows are needed to
 * seed the reset Sessions). The clear statement is scoped to exactly those Slot
 * ids rather than re-deriving the duplicate predicate, so the set of Slots the
 * batch clears is identical to the set the caller seeds Sessions for — no
 * cleared Slot can escape the batch without a fresh Session.
 *
 * Everything the batch writes is therefore computed from rows read before it
 * runs, and another promotion can commit in between: moving the Match out of a
 * duplicate Slot and promoting a different Match in, which a clear by id would
 * then erase (#605). A batch cannot branch, so guarding the clear alone would
 * still reset that Slot's Session from the stale row. The first statement
 * instead fences the whole plan on the pre-state it read — every Slot it read
 * still holds the pairing, Session and version it read, and no Slot it did not
 * read holds the Match — and aborts the batch, all or nothing, when it does not.
 * The unique index `feature_match_slots_match_unique_idx` stays behind it as
 * the last word on a Match occupying one Slot.
 */
export async function buildMatchPromotionPlan(
	eventId: number,
	featureMatchId: number,
	match: DbMatch,
	targetSlot: DbFeatureMatch,
): Promise<MatchPromotionPlan> {
	const sourceRound = await db.query.rounds.findFirst({
		where: and(eq(rounds.id, match.roundId), eq(rounds.eventId, eventId)),
	});
	const now = new Date();

	const duplicateConditions = [eq(featureMatches.matchId, match.id)];
	if (match.externalId && match.externalSource) {
		duplicateConditions.push(and(
			eq(featureMatches.externalId, match.externalId),
			eq(featureMatches.externalSource, match.externalSource),
		)!);
	}

	const duplicateWhere = and(
		eq(featureMatches.eventId, eventId),
		ne(featureMatches.id, featureMatchId),
		or(...duplicateConditions),
	);

	const duplicateSlots = await db
		.select()
		.from(featureMatches)
		.where(duplicateWhere);
	const clearedSlotIds = duplicateSlots.map(slot => slot.id);
	const unobservedHolderWhere = clearedSlotIds.length > 0
		? and(duplicateWhere, notInArray(featureMatches.id, clearedSlotIds))
		: duplicateWhere;

	const clearedValues = {
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		roundName: null,
		formatName: null,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
	} as const;
	const promotedValues = {
		matchId: match.id,
		externalId: match.externalId,
		externalSource: match.externalSource,
		tableNumber: match.tableNumber,
		roundName: sourceRound?.name ?? null,
		formatName: null,
		player1Id: match.player1Id,
		player2Id: match.player2Id,
		player1Data: match.player1Data,
		player2Data: match.player2Data,
	} as const;

	const clearedSlots: DbFeatureMatch[] = duplicateSlots.map(slot => ({ ...slot, ...clearedValues, updatedAt: now }));
	const promotedSlot: DbFeatureMatch = { ...targetSlot, ...promotedValues, updatedAt: now };

	const queries: BatchItem<'sqlite'>[] = [
		buildPromotionPlanFenceQuery(eventId, [targetSlot, ...duplicateSlots], unobservedHolderWhere),
	];
	if (clearedSlotIds.length > 0) {
		queries.push(db
			.update(featureMatches)
			.set({ ...clearedValues, updatedAt: now })
			.where(and(
				eq(featureMatches.eventId, eventId),
				inArray(featureMatches.id, clearedSlotIds),
			)));
	}
	queries.push(db
		.update(featureMatches)
		.set({ ...promotedValues, updatedAt: now })
		.where(and(
			eq(featureMatches.id, featureMatchId),
			eq(featureMatches.eventId, eventId),
		)));

	return { clearedSlots, promotedSlot, queries };
}

export function matchService() {
	const findById = async (id: number, eventId: number) => {
		return await db.query.matches.findFirst({
			where: and(
				eq(matches.id, id),
				eq(matches.eventId, eventId),
			),
		});
	};

	const findByEventId = async (eventId: number) => {
		return await db
			.select()
			.from(matches)
			.where(eq(matches.eventId, eventId))
			.orderBy(matches.sortOrder, matches.id);
	};

	const findByRoundId = async (eventId: number, roundId: number) => {
		return await db
			.select()
			.from(matches)
			.where(
				and(
					eq(matches.eventId, eventId),
					eq(matches.roundId, roundId),
				),
			)
			.orderBy(matches.sortOrder, matches.id);
	};

	const getMaxSortOrder = async (eventId: number, roundId: number): Promise<number> => {
		const [result] = await db
			.select({ max: sql<number>`coalesce(max(${matches.sortOrder}), -1)` })
			.from(matches)
			.where(
				and(
					eq(matches.eventId, eventId),
					eq(matches.roundId, roundId),
				),
			);
		return result?.max ?? -1;
	};

	const create = async (
		eventId: number,
		data: CreateMatchInput,
	): Promise<DbMatch> => {
		const maxSort = await getMaxSortOrder(eventId, data.roundId);

		const [newMatch] = await db
			.insert(matches)
			.values({
				...pickManualWritable('matches', data),
				sortOrder: data.sortOrder ?? maxSort + 1,
				eventId,
				externalId: null,
				externalSource: 'manual',
			})
			.returning();

		if (!newMatch) {
			throw new Error('Failed to create match');
		}

		return newMatch;
	};

	const update = async (
		id: number,
		eventId: number,
		data: UpdateMatchInput,
	): Promise<DbMatch | undefined> => {
		const [updatedMatch] = await db
			.update(matches)
			.set(pickManualWritable('matches', data))
			.where(
				and(
					eq(matches.id, id),
					eq(matches.eventId, eventId),
				),
			)
			.returning();

		return updatedMatch;
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(matches)
			.where(
				and(
					eq(matches.id, id),
					eq(matches.eventId, eventId),
				),
			)
			.returning();

		return result.length > 0;
	};

	const exists = async (id: number, eventId: number): Promise<boolean> => {
		const match = await db.query.matches.findFirst({
			where: and(
				eq(matches.id, id),
				eq(matches.eventId, eventId),
			),
			columns: { id: true },
		});

		return !!match;
	};

	return {
		findById,
		findByEventId,
		findByRoundId,
		create,
		update,
		remove,
		exists,
	};
}
