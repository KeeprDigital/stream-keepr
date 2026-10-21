import type { BatchItem } from 'drizzle-orm/batch';
import type { DbFeatureMatch, DbFeatureMatchSession } from '~~/server/db/schema';
import type { CreateFeatureMatchInput, UpdateFeatureMatchInput } from '~~/shared/api';
import type { ExternalSource } from '~~/shared/types/enums';
import type { FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events, featureMatches, featureMatchSessions, matches } from '~~/server/db/schema';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { chunkRowsWithinParameterBudget, observedValue } from '~~/server/utils/db';
import { runCompensation, StateConflictError } from '~~/server/utils/errors';
import { pickManualWritable } from '~~/server/utils/provenance';
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
	/** Run once the batch carrying `queries` has committed, to announce the replacement Sessions. */
	settle: () => Promise<unknown>;
}

/** The Slots named, as one bound JSON array: within D1's parameter limit at any Slot count. */
function slotIdIn(slotIds: readonly number[]) {
	return sql`${featureMatches.id} in (select value from json_each(${JSON.stringify(slotIds)}))`;
}

/**
 * Prepare, but do not execute, the complete feature-slot portion of a Melee
 * import reset. Callers can append these statements to a larger D1 batch so
 * imported records, replacement feature sessions, and Event config commit or
 * roll back together, then settle the plan once that batch has committed.
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
		return { queries: [], clearedSlotCount: 0, settle: async () => {} };
	}

	const resetAt = new Date();
	const clearedSlots = importedSlots.map((slot): DbFeatureMatch => ({
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
	}));

	// Scope every mutation to slots that are still Melee-owned when the batch
	// starts. This prevents a stale preparation read from resetting a slot that
	// was manually rebound before the transaction acquired its write lock.
	const stillMeleeOwned = eq(featureMatches.externalSource, 'melee');
	const sessionReplacement = await featureMatchStateService().buildSessionReplacement(eventId, clearedSlots, {
		slotCondition: stillMeleeOwned,
	});

	// After the Session statements, which select their Slots through the same
	// Melee ownership this clears.
	const clearSlotQuery = db
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
			updatedAt: resetAt,
		})
		.where(and(
			eq(featureMatches.eventId, eventId),
			stillMeleeOwned,
			slotIdIn(importedSlots.map(slot => slot.id)),
		));

	return {
		queries: [...sessionReplacement.statements, clearSlotQuery],
		clearedSlotCount: importedSlots.length,
		settle: sessionReplacement.settle,
	};
}

/**
 * A Slot row still holds the pairing identity and active Feature Match Session
 * pointer it was read with: what a decision computed from that read depends on.
 */
export function observedSlotPairing(slot: DbFeatureMatch) {
	return and(
		observedValue(featureMatches.matchId, slot.matchId),
		observedValue(featureMatches.externalId, slot.externalId),
		observedValue(featureMatches.externalSource, slot.externalSource),
		observedValue(featureMatches.player1Id, slot.player1Id),
		observedValue(featureMatches.player2Id, slot.player2Id),
		observedValue(featureMatches.activeSessionId, slot.activeSessionId),
	);
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
					observedSlotPairing(current),
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

			// One D1 batch, so the new Slots are inserted all together or not at
			// all, in statements each within D1's bound-parameter limit (#702).
			const insertSlots = (rows: typeof newMatches) => db.insert(featureMatches).values(rows).returning();
			const [firstInsert, ...restInserts] = chunkRowsWithinParameterBudget(newMatches, insertSlots).map(insertSlots);
			const createdMatches = firstInsert ? (await db.batch([firstInsert, ...restInserts])).flat() : [];
			created.push(...createdMatches);

			// Initialize state for created matches in one commit, reusing event defaults
			try {
				await stateService.openSessionsForSlots(eventId, createdMatches.map(match => match.id), { defaults: eventDefaults });
			}
			catch (error) {
				// A Slot is not usable without its first Session: remove every Slot
				// this call created, so the Event holds only the Slots it held before.
				await runCompensation(error, () => db.delete(featureMatches).where(and(
					eq(featureMatches.eventId, eventId),
					slotIdIn(createdMatches.map(match => match.id)),
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
						slotIdIn(idsToDelete),
					),
				);

			deleted.push(...idsToDelete);
		}

		return { created, deleted };
	};

	/**
	 * The compensation for a Slot count change that failed after the Event's count
	 * was written: set the count back to the Slots the Event actually holds. It
	 * applies only while the Event still holds the count that change wrote, so a
	 * later write's count is never overwritten by this one's recovery.
	 */
	const reconcileEventSlotCount = async (eventId: number, writtenCount: number): Promise<void> => {
		await db
			.update(events)
			.set({
				numFeatureMatches: sql<number>`(
					select count(*) from ${featureMatches} where ${featureMatches.eventId} = ${eventId}
				)`,
			})
			.where(and(eq(events.id, eventId), eq(events.numFeatureMatches, writtenCount)));
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
		reconcileEventSlotCount,
		swapMatchOrder,
	};
}
