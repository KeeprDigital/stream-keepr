import type {
	GraphicsAuthoringArtifactRef,
	GraphicsAuthoringLeaseOutcome,
	GraphicsAuthoringLeaseRecord,
	GraphicsAuthoringLeaseState,
} from '~~/shared/modules/graphics-authoring-lease';
import { and, eq, lte, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { graphicsAuthoringLeases } from '~~/server/db/schema';
import {
	graphicsAuthoringLeaseDeadline,
	graphicsAuthoringLeaseState,
	isGraphicsAuthoringLeaseLive,
	resolveGraphicsAuthoringLease,
} from '~~/shared/modules/graphics-authoring-lease';

/**
 * Graphics Authoring Leases: the single-writer right to edit one graphics
 * authoring artifact.
 *
 * The module knows nothing about what it is leasing. Every operation takes a
 * `GraphicsAuthoringArtifactRef`, so a Screen's graphics Edit workspace and a
 * reusable graphics Template are the same problem to it — which is what lets a
 * template library become leasable by addressing its artifacts rather than by
 * growing a second lease mechanism.
 *
 * Three mechanisms keep an artifact from being stranded, and each one covers the
 * others' failure:
 *
 * - **Release.** A departing editor gives the lease up, so the ordinary case
 *   frees the artifact at once. Unreliable alone: a crash, a killed tab, or a
 *   dropped network never releases anything.
 * - **Expiry.** Every lease carries a deadline derived from the cadence its
 *   holder promised to heartbeat at, and a lapsed lease simply is not a lease.
 *   A browser that vanishes frees its artifact within seconds, with nobody
 *   watching and no sweep running. Unreliable alone: waiting out a deadline
 *   mid-show is not something an operator should have to do.
 * - **Takeover.** A second session displaces a live holder on explicit request,
 *   and the displaced holder discovers it on its next heartbeat. Unreliable
 *   alone: it needs a human to be there.
 *
 * Exclusivity is decided by conditional writes rather than read-then-write, so
 * two sessions asking at the same instant are ordered by the database and exactly
 * one of them wins.
 */

export interface GraphicsAuthoringLeaseRef {
	artifact: GraphicsAuthoringArtifactRef;
	/** The Event that owns the artifact, for artifacts scoped to one. */
	eventId?: number;
}

export interface AcquireGraphicsAuthoringLeaseParams extends GraphicsAuthoringLeaseRef {
	sessionId: string;
	takeover?: boolean;
	heartbeatIntervalMs?: number;
}

export interface GraphicsAuthoringLeaseAcquisition {
	lease: GraphicsAuthoringLeaseState;
	outcome: GraphicsAuthoringLeaseOutcome;
}

type StoredLease = typeof graphicsAuthoringLeases.$inferSelect;

function toRecord(row: StoredLease | undefined): GraphicsAuthoringLeaseRecord | undefined {
	if (!row)
		return undefined;
	return {
		holderSessionId: row.holderSessionId,
		acquiredAt: row.acquiredAt.getTime(),
		heartbeatAt: row.heartbeatAt.getTime(),
		expiresAt: row.expiresAt.getTime(),
	};
}

export function graphicsAuthoringLeaseModule() {
	function artifactCondition(artifact: GraphicsAuthoringArtifactRef) {
		return and(
			eq(graphicsAuthoringLeases.artifactKind, artifact.kind),
			eq(graphicsAuthoringLeases.artifactId, artifact.id),
		)!;
	}

	async function loadRecord(
		artifact: GraphicsAuthoringArtifactRef,
	): Promise<GraphicsAuthoringLeaseRecord | undefined> {
		const [row] = await db
			.select()
			.from(graphicsAuthoringLeases)
			.where(artifactCondition(artifact))
			.limit(1);
		return toRecord(row);
	}

	function stateOf(
		artifact: GraphicsAuthoringArtifactRef,
		row: StoredLease | undefined,
		sessionId: string,
		now: number,
	): GraphicsAuthoringLeaseState {
		return graphicsAuthoringLeaseState(artifact, toRecord(row), sessionId, now);
	}

	/** What one session may do with the artifact right now. */
	async function describe(
		ref: GraphicsAuthoringLeaseRef,
		sessionId: string | undefined,
	): Promise<GraphicsAuthoringLeaseState> {
		return graphicsAuthoringLeaseState(
			ref.artifact,
			await loadRecord(ref.artifact),
			sessionId,
			Date.now(),
		);
	}

	/**
	 * The write admission a leased artifact's write path calls.
	 *
	 * An unleased artifact admits anyone: there is no author whose work a second
	 * writer could corrupt, and it keeps the lease a guarantee between editors
	 * rather than a precondition on the artifact's whole write path.
	 */
	async function requireWritable(
		ref: GraphicsAuthoringLeaseRef,
		sessionId: string | undefined,
	): Promise<void> {
		const state = await describe(ref, sessionId);
		if (state.writable)
			return;
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Another session holds the Graphics Authoring Lease for this artifact',
		});
	}

	/**
	 * Claim the artifact, renew an existing claim, or report that another session
	 * holds it.
	 *
	 * Each branch is one conditional statement whose condition restates the reason
	 * it is allowed, so a concurrent writer cannot slip between the decision and
	 * the write. A branch that loses its race re-resolves against the state that
	 * actually committed rather than reporting a success that did not happen.
	 */
	async function acquire(
		params: AcquireGraphicsAuthoringLeaseParams,
	): Promise<GraphicsAuthoringLeaseAcquisition> {
		const { artifact, eventId, sessionId, takeover, heartbeatIntervalMs } = params;
		const now = Date.now();
		const expiresAt = graphicsAuthoringLeaseDeadline(now, heartbeatIntervalMs);
		const resolution = resolveGraphicsAuthoringLease(
			await loadRecord(artifact),
			{ sessionId, takeover, heartbeatIntervalMs },
			now,
		);

		if (resolution.outcome === 'observe')
			return { lease: await describe({ artifact, eventId }, sessionId), outcome: 'observe' };

		if (resolution.outcome === 'renew') {
			const renewed = await db
				.update(graphicsAuthoringLeases)
				.set({ heartbeatAt: new Date(now), expiresAt: new Date(expiresAt) })
				.where(and(
					artifactCondition(artifact),
					eq(graphicsAuthoringLeases.holderSessionId, sessionId),
				))
				.returning();
			if (renewed.length > 0)
				return { lease: stateOf(artifact, renewed[0], sessionId, now), outcome: 'renew' };
			return await acquireAfterRace(params);
		}

		// A grant claims an artifact that is unheld or whose holder's deadline has
		// passed; a takeover claims one whose holder is still live. Both are the same
		// write, so the condition is what separates them.
		const claimable = resolution.outcome === 'takeover'
			? artifactCondition(artifact)
			: and(artifactCondition(artifact), or(
				lte(graphicsAuthoringLeases.expiresAt, new Date(now)),
				eq(graphicsAuthoringLeases.holderSessionId, sessionId),
			))!;

		const claimed = await db
			.update(graphicsAuthoringLeases)
			.set({
				eventId: eventId ?? null,
				holderSessionId: sessionId,
				acquiredAt: new Date(now),
				heartbeatAt: new Date(now),
				expiresAt: new Date(expiresAt),
			})
			.where(claimable)
			.returning();
		if (claimed.length > 0)
			return { lease: stateOf(artifact, claimed[0], sessionId, now), outcome: resolution.outcome };

		// No row to claim: insert one, and let the unique artifact index decide the
		// race against another session inserting at the same instant.
		try {
			const [inserted] = await db
				.insert(graphicsAuthoringLeases)
				.values({
					artifactKind: artifact.kind,
					artifactId: artifact.id,
					eventId: eventId ?? null,
					holderSessionId: sessionId,
					acquiredAt: new Date(now),
					heartbeatAt: new Date(now),
					expiresAt: new Date(expiresAt),
				})
				.returning();
			if (inserted)
				return { lease: stateOf(artifact, inserted, sessionId, now), outcome: resolution.outcome };
		}
		catch {
			// Lost the insert race; fall through to re-resolve against the winner.
		}
		return await acquireAfterRace(params);
	}

	/**
	 * One retry against the state a concurrent writer committed. An explicit
	 * takeover is retried as a claim so the intent is not lost to a race, while a
	 * plain acquisition that lost simply becomes an observation.
	 */
	async function acquireAfterRace(
		params: AcquireGraphicsAuthoringLeaseParams,
	): Promise<GraphicsAuthoringLeaseAcquisition> {
		const now = Date.now();
		const record = await loadRecord(params.artifact);
		const resolution = resolveGraphicsAuthoringLease(record, params, now);
		if (resolution.outcome !== 'observe' && isGraphicsAuthoringLeaseLive(record, now))
			return await acquire({ ...params, takeover: true });
		return {
			lease: graphicsAuthoringLeaseState(params.artifact, record, params.sessionId, now),
			outcome: resolution.outcome,
		};
	}

	/** Give up a lease this session holds. Another session's lease is untouched. */
	async function release(
		ref: GraphicsAuthoringLeaseRef,
		sessionId: string,
	): Promise<GraphicsAuthoringLeaseState> {
		await db
			.delete(graphicsAuthoringLeases)
			.where(and(
				artifactCondition(ref.artifact),
				eq(graphicsAuthoringLeases.holderSessionId, sessionId),
			));
		return await describe(ref, sessionId);
	}

	return { describe, requireWritable, acquire, release };
}
