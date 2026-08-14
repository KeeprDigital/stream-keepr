import type { H3Event } from 'h3';
import type { MeleeConfigInput } from '~~/server/schemas/api/event';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { inspectMeleeGameCompatibility } from '~~/server/modules/melee-sync/gameCompatibility';
import { eventService } from '~~/server/services/event';
import { meleeService } from '~~/server/services/melee';
import { requireMeleeIntegration } from '~~/server/services/meleeIntegration';
import { MeleeTransportError } from '~~/server/services/meleeTransport';
import { MeleeCredentialCryptoError } from '~~/server/utils/meleeCredentialCrypto';
import { acquireMeleeSyncLease, releaseMeleeSyncLease } from '~~/server/utils/meleeSyncState';

interface UpdateMeleeConfigurationParams {
	eventId: number;
	input: MeleeConfigInput;
	originConnectionId?: string;
	/**
	 * The request being answered, carried in only so the upstream-outage refusal below
	 * can set `retry-after` on it (#346). `requestEvent` rather than `event` for the
	 * reason the sibling commands in this module use that name: `eventId` beside it
	 * means a tournament Event.
	 */
	requestEvent: H3Event;
}

function throwMeleeCredentialCryptoError(error: MeleeCredentialCryptoError): never {
	throw createError({
		statusCode: 500,
		message: 'Melee credential encryption is unavailable',
		data: { code: error.code },
	});
}

class MeleeEventMismatchError extends Error {
	constructor() {
		super('Melee.gg returned a different event than requested');
		this.name = 'MeleeEventMismatchError';
	}
}

function throwInvalidMeleeConfiguration(): never {
	// Never log credential validation errors: upstream errors may retain request context.
	console.warn(JSON.stringify({ message: 'melee_credential_validation_failed' }));
	throw createError({
		statusCode: 400,
		message: 'Could not validate Melee.gg credentials. Check the event ID, client ID, and client secret.',
	});
}

/**
 * The Melee Sync configuration command: validates supplied or stored
 * credentials against Melee.gg, persists the configuration through the
 * encrypting service boundary, and publishes the Event update (plus a
 * data-reset delta when the configuration boundary moved). Serialized
 * against sync commands via the sync lease so a stale command cannot
 * repopulate data after the boundary changed.
 */
export async function updateMeleeConfiguration({ eventId, input, originConnectionId, requestEvent }: UpdateMeleeConfigurationParams) {
	const eventSvc = eventService();
	// Configuration changes can delete imported data and swap the upstream Event.
	// Serialize them with sync commands so a stale command cannot repopulate data
	// after the configuration boundary has moved.
	const lease = await acquireMeleeSyncLease(eventId, 'configuration');
	try {
		// Read only after acquiring the lease so omitted credentials are resolved
		// from the configuration version this command exclusively owns.
		const lockedEvent = await eventSvc.findById(eventId);
		if (!lockedEvent) {
			throw createError({ statusCode: 404, message: 'Event not found' });
		}
		const normalizedConfig = {
			meleeEnabled: input.meleeEnabled,
			meleeEventId: input.meleeEventId?.trim() || null,
			meleeClientId: input.meleeClientId?.trim() || null,
			...(input.meleeClientSecret !== undefined && {
				meleeClientSecret: input.meleeClientSecret?.trim() || null,
			}),
		};
		const resetReason = !normalizedConfig.meleeEnabled
			? 'disabled' as const
			: lockedEvent.meleeEventId !== normalizedConfig.meleeEventId
				? 'event-changed' as const
				: null;
		let plaintextSecretForSave: string | undefined;

		if (input.meleeEnabled) {
			const storedOrSuppliedSecret = normalizedConfig.meleeClientSecret !== undefined
				? normalizedConfig.meleeClientSecret
				: lockedEvent.meleeClientSecret;

			try {
				const credentials = await requireMeleeIntegration({
					meleeEnabled: true,
					meleeEventId: normalizedConfig.meleeEventId,
					meleeClientId: normalizedConfig.meleeClientId,
					meleeClientSecret: storedOrSuppliedSecret,
				});
				const meleeEvent = await meleeService(credentials).fetchEvent();
				if (String(meleeEvent.ID) !== credentials.eventId) {
					throw new MeleeEventMismatchError();
				}
				if (inspectMeleeGameCompatibility(lockedEvent.game, meleeEvent.Game).status === 'mismatch') {
					throw createError({
						statusCode: 422,
						message: 'The selected Melee.gg tournament uses a different game than this Event',
						data: { code: 'MELEE_GAME_MISMATCH' },
					});
				}
				plaintextSecretForSave = credentials.clientSecret;
			}
			catch (error) {
				if (error instanceof MeleeCredentialCryptoError) {
					throwMeleeCredentialCryptoError(error);
				}
				if (error instanceof MeleeTransportError) {
					const rejectedConfiguration = error.category === 'http'
						&& error.upstreamStatus !== null
						&& [400, 401, 403, 404, 422].includes(error.upstreamStatus);
					if (!rejectedConfiguration) {
						// The sentence says *temporarily*, so the response owes the caller an
						// interval: #346, the same defect #337 fixed at the author-session 503.
						// The number is the 5 seconds every retryable site here uses — a floor
						// on how hard to retry, not an estimate of when Melee.gg returns, and it
						// is the same for both statuses below because a timeout and a bad
						// gateway are the same advice to a caller. Set inside this branch rather
						// than the enclosing `MeleeTransportError` one on purpose: the refusal
						// below it is credentials Melee.gg rejected, which no waiting resolves.
						setResponseHeader(requestEvent, 'retry-after', 5);
						throw createError({
							statusCode: error.category === 'timeout' ? 504 : 502,
							statusMessage: error.category === 'timeout' ? 'Gateway Timeout' : 'Bad Gateway',
							message: 'Melee.gg is temporarily unavailable. Try again later.',
							cause: error,
						});
					}
					throwInvalidMeleeConfiguration();
				}
				if (error instanceof MeleeEventMismatchError)
					throwInvalidMeleeConfiguration();

				// Intentional client errors, database, programming, and other unknown
				// failures propagate unchanged to the global error handler.
				throw error;
			}
		}

		let updated: boolean;
		try {
			updated = await eventSvc.updateMeleeConfig(eventId, {
				...normalizedConfig,
				// Re-saving an enabled integration migrates legacy plaintext and re-wraps
				// older key versions under the currently active key.
				...(plaintextSecretForSave !== undefined && { meleeClientSecret: plaintextSecretForSave }),
			});
		}
		catch (error) {
			// Encryption happens immediately before persistence. Preserve the same
			// actionable error contract used when decrypting stored credentials.
			if (error instanceof MeleeCredentialCryptoError)
				throwMeleeCredentialCryptoError(error);
			throw error;
		}

		if (!updated) {
			throw createError({
				statusCode: 404,
				message: 'Event not found',
			});
		}

		// Re-fetch full event with relations for consistent response
		const eventData = (await eventSvc.findById(eventId))!;

		const publication = eventDataPublicationModule();
		// Broadcast event update (without credentials) so other clients see meleeConfigured change
		const response = await publication.eventUpdated({
			eventId,
			entity: eventData,
			originConnectionId,
		});
		if (resetReason) {
			await publication.meleeDataReset({
				eventId,
				originConnectionId,
				reason: resetReason,
			});
		}
		return response;
	}
	finally {
		try {
			await releaseMeleeSyncLease(eventId, lease.token);
		}
		catch {
			// Configuration has already committed or failed at this point. Lease
			// cleanup must not replace that result; its bounded TTL remains the fallback.
			console.warn(`[Melee sync] Failed to finish configuration lease cleanup for event ${eventId}`);
		}
	}
}
