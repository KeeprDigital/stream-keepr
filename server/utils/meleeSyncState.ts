import type { DbEvent, DbEventTalent } from '~~/server/db/schema';
import type { MeleeSyncContext } from '~~/server/modules/melee-sync/context';
import { mapEventToResponse } from '~~/server/mappers/event';
import { eventService } from '~~/server/services/event';
import { publishMessage } from '~~/server/utils/ably';
import { toPublicOperationalError } from '~~/server/utils/errors';

export const MELEE_SYNC_LEASE_DURATION_MS = 15 * 60 * 1000;
export const MELEE_SYNC_LEASE_RENEW_INTERVAL_MS = 60 * 1000;

/** The lease command a Live Results tick holds; any operator command takes it over. */
export const LIVE_RESULTS_COMMAND = 'live-results';

export type MeleeSyncCommandName
	= | 'configuration'
		| 'initial-setup'
		| 'event-structure'
		| 'players'
		| 'decklists'
		| 'round'
		| 'update'
		| typeof LIVE_RESULTS_COMMAND;

export interface MeleeSyncMetadataUpdate {
	initialSetupCompletedAt?: Date | null;
	lastEventSyncedAt?: Date | null;
	lastPlayersSyncedAt?: Date | null;
	lastDecklistsSyncedAt?: Date | null;
}

export interface MeleeSyncLease {
	token: string;
	command: MeleeSyncCommandName;
	expiresAt: Date;
}

async function publishEventUpdate(syncContext: MeleeSyncContext, eventId: number) {
	const updatedEvent = await eventService().findById(eventId);
	if (!updatedEvent) {
		return;
	}

	await publishMessage(
		eventId,
		'event:updated',
		{
			event: mapEventToResponse(updatedEvent as DbEvent & { talents: DbEventTalent[] }),
		},
		syncContext.originConnectionId,
	);
}

export async function recordMeleeSyncSuccess(
	syncContext: MeleeSyncContext,
	eventId: number,
	data: MeleeSyncMetadataUpdate,
	leaseToken?: string,
): Promise<boolean> {
	const updated = await eventService().updateSyncMetadata(eventId, {
		...data,
		lastSyncError: null,
	}, leaseToken);

	if (updated) {
		await publishEventUpdate(syncContext, eventId);
	}

	return updated;
}

export async function recordMeleeSyncFailure(
	syncContext: MeleeSyncContext,
	eventId: number,
	error: unknown,
	data: MeleeSyncMetadataUpdate = {},
	leaseToken?: string,
): Promise<boolean> {
	const message = toPublicOperationalError(error);
	const updated = await eventService().updateSyncMetadata(eventId, {
		...data,
		lastSyncError: message,
	}, leaseToken);

	if (updated) {
		await publishEventUpdate(syncContext, eventId);
	}

	return updated;
}

/**
 * Takes the Event's Melee Sync lease or answers 409. Live Results never blocks an
 * operator: an operator command takes a Live Results tick's lease over at once,
 * and the tick finds it gone at its next checkpoint. It never takes another
 * operator command's lease, and a tick never takes any.
 */
export async function acquireMeleeSyncLease(
	eventId: number,
	command: MeleeSyncCommandName,
	options: { now?: Date; durationMs?: number; token?: string } = {},
): Promise<MeleeSyncLease> {
	const token = options.token ?? crypto.randomUUID();
	const now = options.now ?? new Date();
	const result = await eventService().tryAcquireMeleeSyncLease({
		eventId,
		token,
		command,
		now,
		expiresAt: new Date(now.getTime() + (options.durationMs ?? MELEE_SYNC_LEASE_DURATION_MS)),
		...(command !== LIVE_RESULTS_COMMAND && { preempts: LIVE_RESULTS_COMMAND }),
	});
	if (!result.acquired)
		return await throwLeaseUnavailable(eventId, result.activeLease);
	return {
		token: result.lease.token,
		command,
		expiresAt: result.lease.expiresAt,
	};
}

async function throwLeaseUnavailable(
	eventId: number,
	activeLease: { command: string; expiresAt: Date } | null,
): Promise<never> {
	if (!activeLease && !await eventService().exists(eventId)) {
		throw createError({ statusCode: 404, message: 'Event not found' });
	}
	const activeCommand = activeLease?.command;
	const retryAt = activeLease?.expiresAt;
	throw createError({
		statusCode: 409,
		message: activeCommand
			? `Melee sync command "${activeCommand}" is already running for this event`
			: 'Another Melee sync command is already running for this event',
		data: {
			code: 'MELEE_SYNC_IN_PROGRESS',
			command: activeCommand ?? null,
			retryAt: retryAt?.toISOString() ?? null,
		},
	});
}

export async function releaseMeleeSyncLease(eventId: number, token: string): Promise<boolean> {
	try {
		return await eventService().releaseMeleeSyncLease(eventId, token);
	}
	catch {
		// Releasing is cleanup after the command outcome has already been decided.
		// A transient D1 failure must not turn a committed sync into an HTTP failure
		// (or hide the original command error). The bounded lease will expire safely,
		// and the opaque token is deliberately excluded from this log entry.
		console.warn(`[Melee sync] Failed to release lease for event ${eventId}; it will expire automatically`);
		return false;
	}
}

export async function renewMeleeSyncLease(
	eventId: number,
	token: string,
	options: { now?: Date; durationMs?: number } = {},
): Promise<boolean> {
	const now = options.now ?? new Date();
	const expiresAt = new Date(now.getTime() + (options.durationMs ?? MELEE_SYNC_LEASE_DURATION_MS));
	return await eventService().renewMeleeSyncLease(eventId, token, expiresAt);
}
