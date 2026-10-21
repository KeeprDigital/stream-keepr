import type { BatchItem } from 'drizzle-orm/batch';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { matches, phases, playerRoundStandings, rounds } from '~~/server/db/schema';
import { inJsonArray } from '~~/server/utils/db';

/**
 * Which imported Phases and Rounds a removal covers: the stale ones a Melee
 * Sync named, or every imported one in the Event (the Melee data reset).
 */
export type ImportedStructureScope
	= | { kind: 'stale'; phaseIds: readonly number[]; roundIds: readonly number[] }
		| { kind: 'all' };

export interface KeptPhase {
	id: number;
	name: string;
}

export interface KeptRound {
	id: number;
	name: string;
	phaseId: number;
	phaseName: string;
}

/** The imported Phases and Rounds a removal kept as manual structure. */
export interface KeptImportedStructure {
	keptPhases: KeptPhase[];
	keptRounds: KeptRound[];
}

export interface ImportedStructureRemoval {
	/** Run in order inside one batch; each later statement reads what the earlier ones left. */
	queries: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
	/** Reads the outcome from the results of `batch`, which holds `queries` in order. */
	readOutcome: (batch: readonly unknown[], results: readonly unknown[]) => KeptImportedStructure & {
		deletedPhaseIds: number[];
		deletedRoundIds: number[];
	};
}

/**
 * Removes imported (Melee-owned) Phases and Rounds without ever removing manual
 * structure beneath them (ADR-0040). The schema cascades a Phase delete through
 * its Rounds and a Round delete through its Matches, so deleting an imported
 * ancestor outright would take any manual Round or Match with it.
 *
 * Instead, inside the one batch:
 * 1. the scope's imported Matches and Round Standings go, as the Round's
 *    removal would have taken them;
 * 2. a scoped Round still holding a Match (necessarily a manual one now) is
 *    kept and released into manual structure: its Provenance is cleared;
 * 3. the other scoped Rounds are deleted;
 * 4. a scoped Phase still holding a Round (manual, or kept in step 2) is kept
 *    the same way, and the other scoped Phases are deleted.
 *
 * Each step's predicate is evaluated when the batch runs, so a manual Round or
 * Match an operator added after the caller read the structure is still kept.
 */
export function buildRemoveImportedStructureQueries(
	eventId: number,
	scope: ImportedStructureScope,
): ImportedStructureRemoval {
	const importedRound = and(eq(rounds.eventId, eventId), eq(rounds.externalSource, 'melee'));
	const importedPhase = and(eq(phases.eventId, eventId), eq(phases.externalSource, 'melee'));
	const scopedRounds = scope.kind === 'all' ? importedRound : and(importedRound, inJsonArray(rounds.id, scope.roundIds));
	const scopedPhases = scope.kind === 'all' ? importedPhase : and(importedPhase, inJsonArray(phases.id, scope.phaseIds));
	const scopedRoundIds = db.select({ id: rounds.id }).from(rounds).where(scopedRounds);
	const now = new Date();

	const queries = [
		db.delete(matches).where(and(
			eq(matches.eventId, eventId),
			eq(matches.externalSource, 'melee'),
			sql`${matches.roundId} in ${scopedRoundIds}`,
		)),
		db.delete(playerRoundStandings).where(and(
			eq(playerRoundStandings.eventId, eventId),
			sql`${playerRoundStandings.roundId} in ${scopedRoundIds}`,
		)),
		db.update(rounds)
			.set({ externalId: null, externalSource: 'manual', lastSyncedAt: null, updatedAt: now })
			.where(and(scopedRounds, sql`exists (select 1 from ${matches} where ${matches.roundId} = ${rounds.id})`))
			.returning({
				id: rounds.id,
				name: rounds.name,
				phaseId: rounds.phaseId,
				// The Phase is the operator's handle on which Round this is.
				phaseName: sql<string>`(select ${phases.name} from ${phases} where ${phases.id} = ${rounds.phaseId})`,
			}),
		db.delete(rounds).where(scopedRounds).returning({ id: rounds.id }),
		db.update(phases)
			// The format stays: it is still the format the Phase was played in,
			// and Deck Lists are matched to the Phase's Matches by it.
			.set({ externalId: null, externalSource: 'manual', updatedAt: now })
			.where(and(scopedPhases, sql`exists (select 1 from ${rounds} where ${rounds.phaseId} = ${phases.id})`))
			.returning({ id: phases.id, name: phases.name }),
		db.delete(phases).where(scopedPhases).returning({ id: phases.id }),
	] as const;

	const byId = <T extends { id: number }>(rows: T[]) => rows.toSorted((a, b) => a.id - b.id);
	return {
		queries: [...queries],
		readOutcome: (batch, results) => {
			const offset = batch.indexOf(queries[0]);
			if (offset < 0)
				throw new Error('The batch does not hold this imported structure removal');
			// RETURNING promises no row order, so the outcome sorts its own.
			return {
				keptRounds: byId(results[offset + 2] as KeptRound[]),
				deletedRoundIds: byId(results[offset + 3] as { id: number }[]).map(row => row.id),
				keptPhases: byId(results[offset + 4] as KeptPhase[]),
				deletedPhaseIds: byId(results[offset + 5] as { id: number }[]).map(row => row.id),
			};
		},
	};
}

/**
 * Runs {@link buildRemoveImportedStructureQueries} as its own batch.
 */
export async function removeImportedStructure(eventId: number, scope: ImportedStructureScope) {
	const removal = buildRemoveImportedStructureQueries(eventId, scope);
	const results = await db.batch(removal.queries);
	return removal.readOutcome(removal.queries, results);
}

/** Why the imported structure would otherwise have been removed. */
export type KeptStructureCause = 'stale' | 'disabled' | 'event-changed';

const KEPT_STRUCTURE_CAUSES: Record<KeptStructureCause, string> = {
	'stale': 'is no longer on Melee.gg',
	'disabled': 'was imported from Melee.gg',
	'event-changed': 'came from the previous Melee.gg tournament',
};

/**
 * The operator-facing account of structure a removal kept, one sentence per
 * kept Phase or Round, naming it so the operator can find it.
 */
export function describeKeptStructure(outcome: KeptImportedStructure, cause: KeptStructureCause): string[] {
	const reason = KEPT_STRUCTURE_CAUSES[cause];
	return [
		...outcome.keptPhases.map(phase =>
			`Phase "${phase.name}" ${reason} and holds manual Rounds or Matches, so it was kept as a manual Phase`),
		...outcome.keptRounds.map(round =>
			`Round "${round.name}" in "${round.phaseName}" ${reason} and holds manual Matches, so it was kept as a manual Round`),
	];
}
