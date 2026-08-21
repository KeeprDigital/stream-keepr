import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { DbFeatureMatch, DbFeatureMatchSession } from '~~/server/db/schema';
import type { CreateFeatureMatchInput, UpdateFeatureMatchInput } from '~~/shared/api';
import type { ExternalSource } from '~~/shared/types/enums';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { events, featureMatches, featureMatchSessions, matches } from '~~/server/db/schema';
import { forgetAggregateReceipts } from '~~/server/modules/live-state';
import { FEATURE_MATCH_SESSION_AGGREGATE_KIND, featureMatchStateService } from '~~/server/services/featureMatchState';
import { chunkJsonRows } from '~~/server/utils/db';
import { runCompensation, StateConflictError } from '~~/server/utils/errors';
import { pickManualWritable } from '~~/server/utils/provenance';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { randomCommandId } from '~~/shared/utils/uuid';

interface PairingIdentity {
	matchId: number | null;
	externalId: string | null;
	externalSource: DbFeatureMatch['externalSource'] | null;
	player1Id: number | null;
	player2Id: number | null;
}

type FeatureMatchIdentityInput = UpdateFeatureMatchInput & {
	externalId?: string | null;
	externalSource?: ExternalSource | null;
};

export interface ImportedFeatureMatchResetPlan {
	queries: BatchItem<'sqlite'>[];
	clearedSlotCount: number;
}

/**
 * Prepare, but do not execute, the complete feature-slot portion of a Melee
 * import reset. Callers can append these statements to a larger D1 batch so
 * imported records, replacement feature sessions, and Event config commit or
 * roll back together.
 */
export async function buildClearImportedMatchDataQueries(
	eventId: number,
): Promise<ImportedFeatureMatchResetPlan> {
	const importedSlots = await db
		.select()
		.from(featureMatches)
		.where(and(
			eq(featureMatches.eventId, eventId),
			eq(featureMatches.externalSource, 'melee'),
		));

	if (importedSlots.length === 0) {
		return { queries: [], clearedSlotCount: 0 };
	}

	const stateSvc = featureMatchStateService();
	const eventDefaults = await stateSvc.loadEventDefaults(eventId);
	const resetAt = new Date();
	const resetAtMs = resetAt.getTime();
	const sessionRows = await Promise.all(importedSlots.map(async (slot) => {
		const clearedSlot: DbFeatureMatch = {
			...slot,
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
			updatedAt: resetAt,
		};
		const sourceSnapshot = await stateSvc.buildSourceSnapshot(clearedSlot, eventDefaults);
		const currentState = createInitialFeatureMatchSessionStateFromSnapshot(sourceSnapshot);

		return {
			slotId: slot.id,
			sourceSnapshot,
			currentState,
		};
	}));
	const payloads = chunkJsonRows(sessionRows);

	// Scope every mutation to slots that are still Melee-owned when the batch
	// starts. This prevents a stale preparation read from resetting a slot that
	// was manually rebound before the transaction acquired its write lock.
	const closeSessionQueries = payloads.map(payload => db
		.update(featureMatchSessions)
		.set({ status: 'closed', closedAt: resetAt, updatedAt: resetAt })
		.where(and(
			eq(featureMatchSessions.eventId, eventId),
			eq(featureMatchSessions.status, 'active'),
			sql`exists (
				select 1
				from ${featureMatches}
				where ${featureMatches.id} = ${featureMatchSessions.slotId}
					and ${featureMatches.eventId} = ${eventId}
					and ${featureMatches.externalSource} = 'melee'
					and ${featureMatches.id} in (
						select cast(json_extract(value, '$.slotId') as integer)
						from json_each(${payload})
					)
			)`,
		)));

	const insertSessionQueries = payloads.map(payload => db
		.insert(featureMatchSessions)
		.select(sql`
			select
				null,
				${eventId},
				cast(json_extract(input.value, '$.slotId') as integer),
				'active',
				json_extract(input.value, '$.sourceSnapshot'),
				json_extract(input.value, '$.currentState'),
				1,
				null,
				${resetAtMs},
				${resetAtMs}
			from json_each(${payload}) as input
			where cast(json_extract(input.value, '$.slotId') as integer) in (
				select ${featureMatches.id}
				from ${featureMatches}
				where ${featureMatches.eventId} = ${eventId}
					and ${featureMatches.externalSource} = 'melee'
			)
		`));

	// The Sessions closed above can never accept another command, so their command
	// receipts have nothing left to protect against.
	const forgetClosedSessionReceiptQueries = payloads.map(payload => forgetAggregateReceipts({
		aggregateKind: FEATURE_MATCH_SESSION_AGGREGATE_KIND,
		aggregateIds: sql`
			select ${featureMatchSessions.id}
			from ${featureMatchSessions}
			where ${featureMatchSessions.eventId} = ${eventId}
				and ${featureMatchSessions.status} = 'closed'
				and ${featureMatchSessions.slotId} in (
					select cast(json_extract(value, '$.slotId') as integer)
					from json_each(${payload})
				)
		`,
	}));

	const clearAndRelinkSlotQueries = payloads.map(payload => db
		.update(featureMatches)
		.set({
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
			activeSessionId: sql<number>`(
				select ${featureMatchSessions.id}
				from ${featureMatchSessions}
				where ${featureMatchSessions.eventId} = ${featureMatches.eventId}
					and ${featureMatchSessions.slotId} = ${featureMatches.id}
					and ${featureMatchSessions.status} = 'active'
				limit 1
			)`,
			updatedAt: resetAt,
		})
		.where(and(
			eq(featureMatches.eventId, eventId),
			eq(featureMatches.externalSource, 'melee'),
			sql`${featureMatches.id} in (
				select cast(json_extract(value, '$.slotId') as integer)
				from json_each(${payload})
			)`,
		)));

	return {
		queries: [
			...closeSessionQueries,
			...insertSessionQueries,
			...forgetClosedSessionReceiptQueries,
			...clearAndRelinkSlotQueries,
		],
		clearedSlotCount: importedSlots.length,
	};
}

/**
 * The equality a compare-and-swap guard needs over nullable columns: `eq`
 * compiles `= NULL`, which SQLite answers false for every row, so a guard built
 * with it alone would report every unpaired Slot as concurrently modified.
 */
function observedValue<TColumn extends SQLiteColumn>(
	column: TColumn,
	value: TColumn['_']['data'] | null,
) {
	return value === null ? isNull(column) : eq(column, value);
}

export function featureMatchService() {
	const resolveMatchProvenance = async (eventId: number, matchId: number | null | undefined) => {
		if (matchId == null)
			return { externalId: null, externalSource: 'manual' as const };

		const match = await db.query.matches.findFirst({
			where: and(eq(matches.id, matchId), eq(matches.eventId, eventId)),
			columns: { externalId: true, externalSource: true },
		});
		if (!match)
			throw createError({ statusCode: 404, message: 'Match not found' });
		return {
			externalId: match.externalId,
			externalSource: match.externalSource ?? 'manual',
		};
	};

	const withActiveSession = async <T extends DbFeatureMatch>(slot: T): Promise<T & { activeSession: DbFeatureMatchSession | null }> => {
		const activeSession = slot.activeSessionId
			? await db.query.featureMatchSessions.findFirst({
				where: and(eq(featureMatchSessions.id, slot.activeSessionId), eq(featureMatchSessions.eventId, slot.eventId)),
			}) ?? null
			: null;
		return { ...slot, activeSession };
	};

	const findById = async (id: number, eventId: number) => {
		const slot = await db.query.featureMatches.findFirst({
			where: and(
				eq(featureMatches.id, id),
				eq(featureMatches.eventId, eventId),
			),
		});
		return slot ? await withActiveSession(slot) : undefined;
	};

	const findByEventId = async (eventId: number) => {
		// Relational loading emits one joined query instead of one Session query
		// per Slot. At the supported 50-Slot maximum this keeps the request well
		// below D1 query-count limits.
		return await db.query.featureMatches.findMany({
			where: eq(featureMatches.eventId, eventId),
			with: { activeSession: true },
			orderBy: [featureMatches.sortOrder, featureMatches.id],
		});
	};

	const create = async (
		eventId: number,
		data: CreateFeatureMatchInput,
	): Promise<DbFeatureMatch> => {
		// Use event's default bestOf if not explicitly provided
		let bestOf = data.bestOf;
		if (bestOf === undefined) {
			const event = await db.query.events.findFirst({
				where: eq(events.id, eventId),
				columns: { featureMatchDefaultBestOf: true },
			});
			bestOf = event?.featureMatchDefaultBestOf ?? 3;
		}
		const provenance = await resolveMatchProvenance(eventId, data.matchId);

		const [newMatch] = await db
			.insert(featureMatches)
			.values({
				...pickManualWritable('featureMatchSlots', data),
				...provenance,
				bestOf,
				// Calculate order inside the write statement so concurrent creators
				// cannot both use the same stale max read.
				sortOrder: sql<number>`(
					select coalesce(max(existing.sort_order), -1) + 1
					from feature_match_slots as existing
					where existing.event_id = ${eventId}
				)`,
				eventId,
			})
			.returning();

		if (!newMatch) {
			throw new Error('Failed to create feature match');
		}

		try {
			await featureMatchStateService().createSessionForSlot(newMatch.id, eventId);
		}
		catch (error) {
			// A Slot is not usable without its initial Session projection.
			await runCompensation(error, () => db.delete(featureMatches).where(and(
				eq(featureMatches.id, newMatch.id),
				eq(featureMatches.eventId, eventId),
			)));
			throw error;
		}

		const updatedMatch = await findById(newMatch.id, eventId);
		return updatedMatch ?? newMatch;
	};

	function slotIdentity(slot: DbFeatureMatch): PairingIdentity {
		return {
			matchId: slot.matchId ?? null,
			externalId: slot.externalId ?? null,
			externalSource: slot.externalSource ?? null,
			player1Id: slot.player1Id ?? null,
			player2Id: slot.player2Id ?? null,
		};
	}

	function desiredIdentity(current: DbFeatureMatch, data: FeatureMatchIdentityInput): PairingIdentity {
		return {
			matchId: data.matchId === undefined ? current.matchId ?? null : data.matchId ?? null,
			externalId: data.externalId === undefined ? current.externalId ?? null : data.externalId ?? null,
			externalSource: data.externalSource === undefined ? current.externalSource ?? null : data.externalSource ?? null,
			player1Id: data.player1Id === undefined ? current.player1Id ?? null : data.player1Id ?? null,
			player2Id: data.player2Id === undefined ? current.player2Id ?? null : data.player2Id ?? null,
		};
	}

	function snapshotIdentity(snapshot: FeatureMatchSourceSnapshot): PairingIdentity {
		return {
			matchId: snapshot.matchId ?? null,
			externalId: snapshot.externalId ?? null,
			externalSource: snapshot.externalSource ?? null,
			player1Id: snapshot.player1.playerId ?? null,
			player2Id: snapshot.player2.playerId ?? null,
		};
	}

	function identitiesEqual(left: PairingIdentity, right: PairingIdentity): boolean {
		return left.matchId === right.matchId
			&& left.externalId === right.externalId
			&& left.externalSource === right.externalSource
			&& left.player1Id === right.player1Id
			&& left.player2Id === right.player2Id;
	}

	async function shouldCreateSessionForIdentityChange(current: DbFeatureMatch, data: FeatureMatchIdentityInput): Promise<boolean> {
		const nextIdentity = desiredIdentity(current, data);
		if (identitiesEqual(slotIdentity(current), nextIdentity))
			return false;

		if (!current.activeSessionId)
			return true;

		const activeSession = await db.query.featureMatchSessions.findFirst({
			where: and(eq(featureMatchSessions.id, current.activeSessionId), eq(featureMatchSessions.eventId, current.eventId)),
		});

		return !activeSession || !identitiesEqual(snapshotIdentity(activeSession.sourceSnapshot), nextIdentity);
	}

	const update = async (
		id: number,
		eventId: number,
		data: UpdateFeatureMatchInput,
	): Promise<DbFeatureMatch | undefined> => {
		const current = await db.query.featureMatches.findFirst({
			where: and(eq(featureMatches.id, id), eq(featureMatches.eventId, eventId)),
		});
		if (!current)
			return undefined;

		const manualData = pickManualWritable('featureMatchSlots', data);
		const provenance = manualData.matchId !== undefined
			? await resolveMatchProvenance(eventId, manualData.matchId)
			: {};
		const shouldCreateSession = await shouldCreateSessionForIdentityChange(current, { ...manualData, ...provenance });

		// Compare-and-swap on everything the create-session-vs-correct decision
		// read: the pairing identity and the active Session pointer. A concurrent
		// write that moved any of them makes this statement match zero rows, so a
		// stale decision can never apply to a Slot that no longer holds the state
		// it was computed from — the loser re-reads and retries instead.
		const [updatedMatch] = await db
			.update(featureMatches)
			.set({ ...manualData, ...provenance })
			.where(
				and(
					eq(featureMatches.id, id),
					eq(featureMatches.eventId, eventId),
					observedValue(featureMatches.matchId, current.matchId),
					observedValue(featureMatches.externalId, current.externalId),
					observedValue(featureMatches.externalSource, current.externalSource),
					observedValue(featureMatches.player1Id, current.player1Id),
					observedValue(featureMatches.player2Id, current.player2Id),
					observedValue(featureMatches.activeSessionId, current.activeSessionId),
				),
			)
			.returning();

		if (!updatedMatch) {
			const survivingSlot = await db.query.featureMatches.findFirst({
				where: and(eq(featureMatches.id, id), eq(featureMatches.eventId, eventId)),
				columns: { id: true },
			});
			if (!survivingSlot)
				return undefined;
			throw new StateConflictError('Feature match slot', id);
		}

		const stateSvc = featureMatchStateService();
		if (shouldCreateSession) {
			await stateSvc.createSessionForSlot(updatedMatch.id, eventId);
		}
		else {
			const snapshot = await stateSvc.buildSourceSnapshot(updatedMatch);
			await stateSvc.applyCommandToActiveSession(updatedMatch.id, eventId, session => ({
				commandId: randomCommandId('SnapshotCorrected'),
				type: 'SnapshotCorrected',
				payload: { sourceSnapshot: snapshot },
				baseSequence: session.sequence,
			}));
		}

		return await findById(updatedMatch.id, eventId);
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(featureMatches)
			.where(
				and(
					eq(featureMatches.id, id),
					eq(featureMatches.eventId, eventId),
				),
			)
			.returning();

		return result.length > 0;
	};

	const exists = async (id: number, eventId: number): Promise<boolean> => {
		const match = await db.query.featureMatches.findFirst({
			where: and(
				eq(featureMatches.id, id),
				eq(featureMatches.eventId, eventId),
			),
			columns: { id: true },
		});

		return !!match;
	};

	const countByEventId = async (eventId: number): Promise<number> => {
		const [result] = await db
			.select({ count: sql<number>`count(*)` })
			.from(featureMatches)
			.where(eq(featureMatches.eventId, eventId));

		return result?.count ?? 0;
	};

	const syncFeatureMatches = async (eventId: number, targetCount: number): Promise<{ created: DbFeatureMatch[]; deleted: number[] }> => {
		// Get current matches ordered by sortOrder, then id
		const currentMatches = await findByEventId(eventId);

		const currentCount = currentMatches.length;
		const created: DbFeatureMatch[] = [];
		const deleted: number[] = [];

		if (currentCount < targetCount) {
			// Create new matches with sequential sortOrder after current max
			const matchesToCreate = targetCount - currentCount;
			const maxSort = currentMatches.length > 0
				? Math.max(...currentMatches.map(m => m.sortOrder))
				: -1;

			const stateService = featureMatchStateService();
			const eventDefaults = await stateService.loadEventDefaults(eventId);
			const bestOf = eventDefaults?.bestOf ?? 3;

			const newMatches = Array.from({ length: matchesToCreate }, (_, i) => ({
				eventId,
				bestOf,
				sortOrder: maxSort + i + 1,
			}));

			const createdMatches = await db.insert(featureMatches).values(newMatches).returning();
			created.push(...createdMatches);

			// Initialize state for created matches, reusing event defaults
			try {
				for (const match of createdMatches) {
					await stateService.createSessionForSlot(match.id, eventId, eventDefaults);
				}
			}
			catch (error) {
				await runCompensation(error, () => db.delete(featureMatches).where(and(
					eq(featureMatches.eventId, eventId),
					inArray(featureMatches.id, createdMatches.map(match => match.id)),
				)));
				throw error;
			}
		}
		else if (currentCount > targetCount) {
			// Delete matches from the end of display order (highest sortOrder first)
			const sorted = currentMatches.toSorted((a, b) => b.sortOrder - a.sortOrder);
			const matchesToDelete = sorted.slice(0, currentCount - targetCount);
			const idsToDelete = matchesToDelete.map(m => m.id);

			await db
				.delete(featureMatches)
				.where(
					and(
						eq(featureMatches.eventId, eventId),
						inArray(featureMatches.id, idsToDelete),
					),
				);

			deleted.push(...idsToDelete);
		}

		return { created, deleted };
	};

	const swapMatchOrder = async (
		eventId: number,
		matchId: number,
		direction: 'up' | 'down',
	): Promise<{ matchId: number; sortOrder: number }[]> => {
		let allMatches = await findByEventId(eventId);

		// Normalize sortOrder if needed (all zeros, or duplicates)
		const needsNormalize = allMatches.some((match, index) =>
			index > 0 && match.sortOrder === allMatches[index - 1]!.sortOrder,
		);

		if (needsNormalize) {
			const normalizeQueries = allMatches.map((m, i) =>
				db.update(featureMatches).set({ sortOrder: i }).where(eq(featureMatches.id, m.id)),
			);
			await db.batch(normalizeQueries as [typeof normalizeQueries[0], ...typeof normalizeQueries]);
			allMatches = await findByEventId(eventId);
		}

		const index = allMatches.findIndex(m => m.id === matchId);
		if (index === -1) {
			throw createError({ statusCode: 404, message: 'Feature match not found in event' });
		}
		if (direction === 'up' && index === 0) {
			throw createError({ statusCode: 400, message: 'Feature match is already first' });
		}
		if (direction === 'down' && index === allMatches.length - 1) {
			throw createError({ statusCode: 400, message: 'Feature match is already last' });
		}

		const swapIndex = direction === 'up' ? index - 1 : index + 1;
		const current = allMatches[index]!;
		const neighbor = allMatches[swapIndex]!;

		await db.batch([
			db.update(featureMatches).set({ sortOrder: neighbor.sortOrder }).where(eq(featureMatches.id, current.id)),
			db.update(featureMatches).set({ sortOrder: current.sortOrder }).where(eq(featureMatches.id, neighbor.id)),
		]);

		return [
			{ matchId: current.id, sortOrder: neighbor.sortOrder },
			{ matchId: neighbor.id, sortOrder: current.sortOrder },
		];
	};

	return {
		findById,
		findByEventId,
		create,
		update,
		remove,
		exists,
		countByEventId,
		syncFeatureMatches,
		swapMatchOrder,
	};
}
