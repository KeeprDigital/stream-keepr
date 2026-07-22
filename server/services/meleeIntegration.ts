import { meleeService } from '~~/server/services/melee';
import { rewrapMeleeClientSecret } from '~~/server/services/meleeCredentialRotation';
import { revealMeleeClientSecret } from '~~/server/services/meleeCredentials';

/**
 * Melee credential resolution: validates that the integration is enabled
 * and configured, reveals the stored client secret (including the explicit
 * legacy-plaintext compatibility path), and opportunistically re-wraps
 * older key versions on read. The single owner of the credential
 * read-side lifecycle.
 */

interface MeleeEventData {
	id?: number;
	meleeEnabled: boolean | null;
	meleeEventId: string | null;
	meleeClientId: string | null;
	meleeClientSecret: string | null;
}

interface MeleeCredentials {
	clientId: string;
	clientSecret: string;
	eventId: string;
}

function requireStoredMeleeIntegration(eventData: MeleeEventData) {
	if (!eventData.meleeEnabled) {
		throw createError({
			statusCode: 400,
			message: 'Melee.gg integration is not enabled for this event',
		});
	}

	if (!eventData.meleeEventId || !eventData.meleeClientId || !eventData.meleeClientSecret) {
		throw createError({
			statusCode: 400,
			message: 'Melee.gg credentials not configured for this event',
		});
	}

	return {
		clientId: eventData.meleeClientId,
		storedClientSecret: eventData.meleeClientSecret,
		eventId: eventData.meleeEventId,
	};
}

/**
 * Validates that melee integration is enabled and credentials are configured.
 * Returns the resolved credentials, ready to use.
 */
export async function requireMeleeIntegration(eventData: MeleeEventData): Promise<MeleeCredentials> {
	const stored = requireStoredMeleeIntegration(eventData);
	const revealed = await revealMeleeClientSecret(stored.storedClientSecret, {
		// Explicit, temporary compatibility path for rows written before encrypted storage.
		allowLegacyPlaintext: true,
	});
	if (revealed.needsReEncryption && eventData.id !== undefined) {
		try {
			await rewrapMeleeClientSecret(eventData.id, stored.storedClientSecret, revealed.plaintext);
		}
		catch {
			// Re-wrapping is an opportunistic migration after a successful reveal. A
			// transient D1 or active-key failure must not block an otherwise valid sync.
			console.warn(JSON.stringify({
				message: 'melee_credential_rewrap_failed',
				eventId: eventData.id,
			}));
		}
	}
	return {
		clientId: stored.clientId,
		clientSecret: revealed.plaintext,
		eventId: stored.eventId,
	};
}

function deferredMeleeService(eventData: MeleeEventData) {
	let servicePromise: Promise<ReturnType<typeof meleeService>> | null = null;
	const resolve = () => {
		servicePromise ??= requireMeleeIntegration(eventData).then(credentials => meleeService(credentials));
		return servicePromise;
	};

	return {
		fetchEvent: async () => await (await resolve()).fetchEvent(),
		fetchPlayers: async () => await (await resolve()).fetchPlayers(),
		fetchCurrentStandings: async () => await (await resolve()).fetchCurrentStandings(),
		fetchStandingsByRound: async (roundId: number) => await (await resolve()).fetchStandingsByRound(roundId),
		fetchMatchesByRound: async (roundId: number) => await (await resolve()).fetchMatchesByRound(roundId),
		fetchMergedPlayers: async () => await (await resolve()).fetchMergedPlayers(),
	};
}

/**
 * Validates melee integration and returns an initialized melee service.
 * Throws if Melee is not enabled or credentials are missing.
 */
export function requireMeleeService(eventData: MeleeEventData) {
	requireStoredMeleeIntegration(eventData);
	return deferredMeleeService(eventData);
}
