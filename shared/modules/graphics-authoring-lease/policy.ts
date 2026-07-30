import type { GraphicsAuthoringArtifactRef } from './artifact';

/**
 * The whole decision a Graphics Authoring Lease makes, as pure logic.
 *
 * A lease is one artifact's single-writer right, and everything interesting
 * about it is a comparison of three facts: who is asking, who currently holds
 * it, and whether that holder is still alive. Keeping that comparison here — out
 * of the storage that persists it and the routes that expose it — is what lets
 * the same rules answer the server's admission check and the editor's
 * "am I writable?" question without either restating them.
 *
 * Liveness is a stored deadline rather than an open-ended flag. A lease can
 * therefore never outlive the session that took it: whatever happens to the
 * browser, the process, or the server, the deadline still passes and the artifact
 * frees itself. That is the property that keeps a closed browser from stranding a
 * Screen, and it is why the lease needs no cleanup sweep to be correct.
 */

/** How the deadline follows from the cadence its holder promises to heartbeat at. */
const HEARTBEAT_DEADLINE_FACTOR = 3;
const MIN_LEASE_TTL_MS = 3_000;
const MAX_LEASE_TTL_MS = 180_000;

/**
 * The cadence an ordinary editor session promises. Short enough that an
 * abandoned artifact frees itself within a minute, long enough that a page
 * reload, a slow request, or a brief network drop never costs an author the
 * lease they are actively using.
 */
export const GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS = 20_000;

/**
 * One session's currently stored claim on an artifact.
 *
 * A heartbeat leaves no separate trace: it is stored as the deadline it bought,
 * so liveness has exactly one source and there is no second timestamp to keep
 * consistent with it.
 */
export interface GraphicsAuthoringLeaseRecord {
	holderSessionId: string;
	acquiredAt: number;
	expiresAt: number;
}

export type GraphicsAuthoringLeaseRole = 'holder' | 'observer';

/**
 * What a session may do with an artifact right now, in the form both the editor
 * and the server's write admission read.
 */
export interface GraphicsAuthoringLeaseState {
	artifact: GraphicsAuthoringArtifactRef;
	role: GraphicsAuthoringLeaseRole;
	/** The single fact the editor gates every authoring control on. */
	writable: boolean;
	/** A live lease belongs to someone else — the only reason to offer a takeover. */
	heldByAnotherSession: boolean;
	/** When the current holder's claim lapses, so an observer can show the wait. */
	expiresAt: number | null;
	heldSince: number | null;
	/** The cadence the client should heartbeat or re-ask at. */
	heartbeatIntervalMs: number;
}

export interface GraphicsAuthoringLeaseRequest {
	/** The asking graphics author session, or none for a client without one. */
	sessionId: string | undefined;
	/** Explicit intent to displace a live holder. */
	takeover?: boolean;
	/** The cadence the asking client promises to heartbeat at. */
	heartbeatIntervalMs?: number;
}

/**
 * `grant` an unheld artifact, `renew` the asking session's own claim, `takeover`
 * a live claim on explicit request, or `observe` it read-only.
 */
export type GraphicsAuthoringLeaseOutcome = 'grant' | 'renew' | 'takeover' | 'observe';

export interface GraphicsAuthoringLeaseResolution {
	outcome: GraphicsAuthoringLeaseOutcome;
	role: GraphicsAuthoringLeaseRole;
	writable: boolean;
	heldByAnotherSession: boolean;
}

/** The deadline a declared heartbeat cadence earns, bounded at both ends. */
export function graphicsAuthoringLeaseTtlMs(heartbeatIntervalMs?: number): number {
	const cadence = Number.isFinite(heartbeatIntervalMs)
		? heartbeatIntervalMs as number
		: GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS;
	return Math.min(
		MAX_LEASE_TTL_MS,
		Math.max(MIN_LEASE_TTL_MS, Math.round(cadence * HEARTBEAT_DEADLINE_FACTOR)),
	);
}

export function graphicsAuthoringLeaseDeadline(now: number, heartbeatIntervalMs?: number): number {
	return now + graphicsAuthoringLeaseTtlMs(heartbeatIntervalMs);
}

/** A stored claim counts only while its deadline is still ahead. */
export function isGraphicsAuthoringLeaseLive(
	record: GraphicsAuthoringLeaseRecord | undefined,
	now: number,
): record is GraphicsAuthoringLeaseRecord {
	return record !== undefined && record.expiresAt > now;
}

/**
 * Whether one session may write the artifact.
 *
 * An artifact nobody holds is writable by anyone: there is no author whose work
 * a second writer could corrupt, and refusing writes to an unleased artifact
 * would turn a single-writer guarantee into a ceremony every other caller of the
 * artifact's write path would have to perform first.
 */
export function graphicsAuthoringLeaseAllowsWrite(
	record: GraphicsAuthoringLeaseRecord | undefined,
	sessionId: string | undefined,
	now: number,
): boolean {
	return !isGraphicsAuthoringLeaseLive(record, now) || record.holderSessionId === sessionId;
}

export function resolveGraphicsAuthoringLease(
	record: GraphicsAuthoringLeaseRecord | undefined,
	request: GraphicsAuthoringLeaseRequest,
	now: number,
): GraphicsAuthoringLeaseResolution {
	const live = isGraphicsAuthoringLeaseLive(record, now);
	const ownedByAsker = live && request.sessionId !== undefined && record.holderSessionId === request.sessionId;

	if (!live)
		return { outcome: 'grant', role: 'holder', writable: true, heldByAnotherSession: false };
	if (ownedByAsker)
		return { outcome: 'renew', role: 'holder', writable: true, heldByAnotherSession: false };
	if (request.takeover)
		return { outcome: 'takeover', role: 'holder', writable: true, heldByAnotherSession: false };
	return { outcome: 'observe', role: 'observer', writable: false, heldByAnotherSession: true };
}

/** The state one session sees for an artifact, without asking to hold it. */
export function graphicsAuthoringLeaseState(
	artifact: GraphicsAuthoringArtifactRef,
	record: GraphicsAuthoringLeaseRecord | undefined,
	sessionId: string | undefined,
	now: number,
): GraphicsAuthoringLeaseState {
	const live = isGraphicsAuthoringLeaseLive(record, now);
	const held = live && sessionId !== undefined && record.holderSessionId === sessionId;
	return {
		artifact,
		role: held ? 'holder' : 'observer',
		writable: graphicsAuthoringLeaseAllowsWrite(record, sessionId, now),
		heldByAnotherSession: live && !held,
		expiresAt: live ? record.expiresAt : null,
		heldSince: live ? record.acquiredAt : null,
		heartbeatIntervalMs: GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS,
	};
}
