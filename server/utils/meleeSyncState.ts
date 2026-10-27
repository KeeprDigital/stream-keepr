import type { DbEvent, DbEventTalent } from '~~/server/db/schema';
import type { MeleeSyncContext } from '~~/server/modules/melee-sync/context';
import { mapEventToResponse } from '~~/server/mappers/event';
import { eventService } from '~~/server/services/event';
import { publishMessage } from '~~/server/utils/ably';
import { toPublicOperationalError } from '~~/server/utils/errors';

export const MELEE_SYNC_LEASE_DURATION_MS = 15 * 60 * 1000;
export const MELEE_SYNC_LEASE_RENEW_INTERVAL_MS = 60 * 1000;
/** How long an operator command waits out a Live Results tick before its 409. */
export const OPERATOR_LEASE_WAIT_MS = 10_000;
const OPERATOR_LEASE_RETRY_MS = 500;

export type MeleeSyncCommandName
	= | 'configuration'
		| 'initial-setup'
		| 'event-structure'
		| 'players'
		| 'decklists'
		| 'round'
		| 'update'
		| 'live-results';

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

async function publishEventUpdate(ctx: MeleeSyncContext, eventId: number) {
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
		ctx.originConnectionId,
	);
}

export async function recordMeleeSyncSuccess(
	ctx: MeleeSyncContext,
	eventId: number,
	data: MeleeSyncMetadataUpdate,
	leaseToken?: string,
): Promise<boolean> {
	const updated = await eventService().updateSyncMetadata(eventId, {
		...data,
		lastSyncError: null,
	}, leaseToken);

	if (updated) {
		await publishEventUpdate(ctx, eventId);
	}

	return updated;
}

export async function recordMeleeSyncFailure(
	ctx: MeleeSyncContext,
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
		await publishEventUpdate(ctx, eventId);
	}

	return updated;
}

/**
 * Takes the Event's Melee Sync lease or answers 409. Polling never blocks an
 * operator: a command finding a Live Results tick holding the lease retries
 * every `OPERATOR_LEASE_RETRY_MS` for up to `OPERATOR_LEASE_WAIT_MS` first. It
 * never waits for another operator command, and a tick never waits at all.
 * `options.now` dates the first attempt; a retry reads the clock.
 */
export async function acquireMeleeSyncLease(
	eventId: number,
	command: MeleeSyncCommandName,
	options: { now?: Date; durationMs?: number; token?: string } = {},
): Promise<MeleeSyncLease> {
	const token = options.token ?? crypto.randomUUID();
	const waitUntil = Date.now() + OPERATOR_LEASE_WAIT_MS;
	let now = options.now ?? new Date();
	for (;;) {
		const expiresAt = new Date(now.getTime() + (options.durationMs ?? MELEE_SYNC_LEASE_DURATION_MS));
		const result = await eventService().tryAcquireMeleeSyncLease({
			eventId,
			token,
			command,
			now,
			expiresAt,
		});
		if (result.acquired) {
			return {
				token: result.lease.token,
				command,
				expiresAt: result.lease.expiresAt,
			};
		}

		const waitForTick = command !== 'live-results'
			&& result.activeLease?.command === 'live-results'
			&& Date.now() + OPERATOR_LEASE_RETRY_MS <= waitUntil;
		if (!waitForTick)
			return await throwLeaseUnavailable(eventId, result.activeLease);
		await new Promise(resolve => setTimeout(resolve, OPERATOR_LEASE_RETRY_MS));
		now = new Date();
	}
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
