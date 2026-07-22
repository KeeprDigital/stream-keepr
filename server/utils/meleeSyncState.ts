import type { H3Event } from 'h3';
import type { DbEvent, DbEventTalent } from '~~/server/db/schema';
import { mapEventToResponse } from '~~/server/mappers/event';
import { eventService } from '~~/server/services/event';
import { getOriginConnectionId, publishMessage } from '~~/server/utils/ably';
import { toPublicOperationalError } from '~~/server/utils/errors';

export const MELEE_SYNC_LEASE_DURATION_MS = 15 * 60 * 1000;
export const MELEE_SYNC_LEASE_RENEW_INTERVAL_MS = 60 * 1000;

export type MeleeSyncCommandName
	= | 'configuration'
		| 'initial-setup'
		| 'event-structure'
		| 'players'
		| 'decklists'
		| 'round'
		| 'update';

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

async function publishEventUpdate(requestEvent: H3Event, eventId: number) {
	const updatedEvent = await eventService().findById(eventId);
	if (!updatedEvent) {
		return;
	}

	await publishMessage(
		eventId,
		'event:updated',
		{ event: mapEventToResponse(updatedEvent as DbEvent & { talents: DbEventTalent[] }) },
		getOriginConnectionId(requestEvent),
	);
}

export async function recordMeleeSyncSuccess(
	requestEvent: H3Event,
	eventId: number,
	data: MeleeSyncMetadataUpdate,
	leaseToken?: string,
): Promise<boolean> {
	const updated = await eventService().updateSyncMetadata(eventId, {
		...data,
		lastSyncError: null,
	}, leaseToken);

	if (updated) {
		await publishEventUpdate(requestEvent, eventId);
	}

	return updated;
}

export async function recordMeleeSyncFailure(
	requestEvent: H3Event,
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
		await publishEventUpdate(requestEvent, eventId);
	}

	return updated;
}

export async function acquireMeleeSyncLease(
	eventId: number,
	command: MeleeSyncCommandName,
	options: { now?: Date; durationMs?: number; token?: string } = {},
): Promise<MeleeSyncLease> {
	const now = options.now ?? new Date();
	const token = options.token ?? crypto.randomUUID();
	const expiresAt = new Date(now.getTime() + (options.durationMs ?? MELEE_SYNC_LEASE_DURATION_MS));
	const result = await eventService().tryAcquireMeleeSyncLease({
		eventId,
		token,
		command,
		now,
		expiresAt,
	});

	if (!result.acquired) {
		if (!result.activeLease && !await eventService().exists(eventId)) {
			throw createError({ statusCode: 404, message: 'Event not found' });
		}
		const activeCommand = result.activeLease?.command;
		const retryAt = result.activeLease?.expiresAt;
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

	return {
		token: result.lease.token,
		command,
		expiresAt: result.lease.expiresAt,
	};
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
