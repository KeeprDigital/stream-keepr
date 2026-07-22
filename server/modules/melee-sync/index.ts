import type { H3Event } from 'h3';
import type { MeleeSyncCommandName, MeleeSyncMetadataUpdate } from '~~/server/utils/meleeSyncState';
import {
	acquireMeleeSyncLease,
	MELEE_SYNC_LEASE_RENEW_INTERVAL_MS,
	recordMeleeSyncFailure,
	recordMeleeSyncSuccess,
	releaseMeleeSyncLease,
	renewMeleeSyncLease,
} from '~~/server/utils/meleeSyncState';
import { updateMeleeConfiguration } from './configuration';
import { requireMeleeSyncEventData as loadMeleeSyncEventData } from './eventData';
import { createMeleeSyncWorkflows } from './workflows';

interface MeleeSyncCommandResult {
	success?: boolean;
	message?: string;
	warnings?: string[];
}

interface RunMeleeSyncCommandOptions<T extends MeleeSyncCommandResult> {
	requestEvent: H3Event;
	eventId: number;
	command: MeleeSyncCommandName;
	execute: (checkpoint: () => Promise<void>) => Promise<T>;
	metadata: (result: T) => MeleeSyncMetadataUpdate;
	failureMetadata?: () => MeleeSyncMetadataUpdate;
}

function commandFailureFromResult(result: MeleeSyncCommandResult) {
	return new Error(result.warnings?.at(-1) ?? result.message ?? 'Melee sync did not complete successfully');
}

function leaseOwnershipLostError() {
	return new Error('Melee sync lease ownership was lost while the command was running');
}

function createMeleeSyncProgress() {
	let metadata: MeleeSyncMetadataUpdate = {};

	return {
		record(update: MeleeSyncMetadataUpdate) {
			metadata = { ...metadata, ...update };
		},
		snapshot() {
			return { ...metadata };
		},
	};
}

/**
 * Owns the durable lease and the single aggregate status transition for a
 * route-facing command. Internal workflows deliberately do neither, which
 * keeps nested update/setup steps from clearing one another's failures.
 */
async function runMeleeSyncCommand<T extends MeleeSyncCommandResult>(
	options: RunMeleeSyncCommandOptions<T>,
): Promise<T> {
	const lease = await acquireMeleeSyncLease(options.eventId, options.command);
	let renewalError: unknown = null;
	let renewalInFlight: Promise<void> | null = null;
	const renewLease = () => {
		if (renewalInFlight)
			return renewalInFlight;

		const renewal = renewMeleeSyncLease(options.eventId, lease.token)
			.then((renewed) => {
				if (!renewed)
					renewalError = leaseOwnershipLostError();
			})
			.catch((error) => {
				renewalError = error;
			})
			.finally(() => {
				if (renewalInFlight === renewal)
					renewalInFlight = null;
			});
		renewalInFlight = renewal;
		return renewal;
	};
	const renewalTimer = setInterval(() => {
		void renewLease();
	}, MELEE_SYNC_LEASE_RENEW_INTERVAL_MS);
	const verifyLeaseOwnership = async () => {
		if (renewalInFlight)
			await renewalInFlight;

		// A transient timer heartbeat failure can recover, but every composite-stage
		// checkpoint and final metadata transition needs a fresh token-guarded check.
		renewalError = null;
		await renewLease();
		if (renewalError)
			throw renewalError;
	};

	try {
		let execution: { success: true; result: T } | { success: false; error: unknown };
		try {
			execution = { success: true, result: await options.execute(verifyLeaseOwnership) };
		}
		catch (error) {
			execution = { success: false, error };
		}

		try {
			await verifyLeaseOwnership();
		}
		catch (ownershipError) {
			// This write is itself token-conditioned and therefore becomes a no-op if
			// another command already owns the Event.
			await recordMeleeSyncFailure(
				options.requestEvent,
				options.eventId,
				ownershipError,
				options.failureMetadata?.() ?? {},
				lease.token,
			);
			throw ownershipError;
		}

		if (!execution.success) {
			const recorded = await recordMeleeSyncFailure(
				options.requestEvent,
				options.eventId,
				execution.error,
				options.failureMetadata?.() ?? {},
				lease.token,
			);
			if (!recorded)
				throw leaseOwnershipLostError();
			throw execution.error;
		}

		const { result } = execution;

		const metadata = options.metadata(result);
		let recorded: boolean;
		if (result.success === false) {
			recorded = await recordMeleeSyncFailure(
				options.requestEvent,
				options.eventId,
				commandFailureFromResult(result),
				metadata,
				lease.token,
			);
		}
		else {
			recorded = await recordMeleeSyncSuccess(
				options.requestEvent,
				options.eventId,
				metadata,
				lease.token,
			);
		}
		if (!recorded)
			throw leaseOwnershipLostError();

		return result;
	}
	finally {
		clearInterval(renewalTimer);
		if (renewalInFlight)
			await renewalInFlight;
		// releaseMeleeSyncLease is best-effort and catches internally, so a cleanup
		// regression never replaces the command's durable outcome.
		await releaseMeleeSyncLease(options.eventId, lease.token);
	}
}

/**
 * Melee Sync command seam.
 *
 * Routes pass only request context, Event identity, and command-specific
 * options. Event loading and validated Melee adapter setup stay behind this
 * route-facing interface while lower-level workflows remain internal adapters.
 */
export function meleeSyncModule() {
	const workflows = createMeleeSyncWorkflows();

	return {
		updateConfiguration: updateMeleeConfiguration,

		async runInitialSetup(requestEvent: H3Event, eventId: number) {
			const progress = createMeleeSyncProgress();
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'initial-setup',
				execute: async checkpoint => await workflows.runInitialSetup(
					requestEvent,
					eventId,
					await loadMeleeSyncEventData(eventId),
					checkpoint,
					progress.record,
				),
				failureMetadata: progress.snapshot,
				metadata: (result) => {
					const completedAt = new Date();
					return {
						lastEventSyncedAt: completedAt,
						lastPlayersSyncedAt: completedAt,
						...(result.success === false
							? {}
							: {
									initialSetupCompletedAt: completedAt,
									...(result.deckListsSkipped === true ? {} : { lastDecklistsSyncedAt: completedAt }),
								}),
					};
				},
			});
		},
		async syncEventStructure(requestEvent: H3Event, eventId: number) {
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'event-structure',
				execute: async () => await workflows.syncEventStructure(
					requestEvent,
					eventId,
					await loadMeleeSyncEventData(eventId),
				),
				metadata: () => ({ lastEventSyncedAt: new Date() }),
			});
		},
		async syncPlayers(requestEvent: H3Event, eventId: number) {
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'players',
				execute: async () => await workflows.syncPlayers(
					requestEvent,
					eventId,
					await loadMeleeSyncEventData(eventId),
				),
				metadata: () => ({ lastPlayersSyncedAt: new Date() }),
			});
		},
		async syncDeckLists(requestEvent: H3Event, eventId: number) {
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'decklists',
				execute: async () => await workflows.syncDeckLists(
					requestEvent,
					eventId,
					await loadMeleeSyncEventData(eventId),
				),
				metadata: result => result.success === false || result.skipped === true ? {} : { lastDecklistsSyncedAt: new Date() },
			});
		},
		async syncRoundMatches(requestEvent: H3Event, eventId: number, roundId: number) {
			const progress = createMeleeSyncProgress();
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'round',
				execute: async (checkpoint) => {
					const syncEventData = await loadMeleeSyncEventData(eventId);
					await checkpoint();
					const players = await workflows.syncPlayers(requestEvent, eventId, syncEventData);
					if (players.success !== false)
						progress.record({ lastPlayersSyncedAt: new Date() });
					await checkpoint();
					const round = await workflows.syncRoundMatches(requestEvent, eventId, syncEventData, roundId);
					return {
						...round,
						warnings: [...(players.warnings ?? []), ...(round.warnings ?? [])],
					};
				},
				failureMetadata: progress.snapshot,
				metadata: () => ({ lastPlayersSyncedAt: new Date() }),
			});
		},
		async updateFromMelee(
			requestEvent: H3Event,
			eventId: number,
			options: { includeDeckLists?: boolean; advanceRound?: boolean } = {},
		) {
			const progress = createMeleeSyncProgress();
			return await runMeleeSyncCommand({
				requestEvent,
				eventId,
				command: 'update',
				execute: async checkpoint => await workflows.updateFromMelee(
					requestEvent,
					eventId,
					await loadMeleeSyncEventData(eventId),
					options,
					checkpoint,
					progress.record,
				),
				failureMetadata: progress.snapshot,
				metadata: (result) => {
					const completedAt = new Date();
					const includedDeckLists = result.steps.includes('decklists');
					const completedDeckLists = includedDeckLists
						&& result.success !== false
						&& result.deckListsSkipped !== true;
					return {
						lastEventSyncedAt: completedAt,
						lastPlayersSyncedAt: completedAt,
						...(completedDeckLists ? { lastDecklistsSyncedAt: completedAt } : {}),
					};
				},
			});
		},
	};
}
