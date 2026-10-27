import type { DbEvent } from '~~/server/db/schema';
import type { LiveResultsTarget } from './currentRound';
import type { LiveResultsOutcome } from './schedule';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { eventService } from '~~/server/services/event';
import { requireMeleeService } from '~~/server/services/meleeIntegration';
import { MeleeTransportError } from '~~/server/services/meleeTransport';
import { errorNameOf } from '~~/server/utils/errorLogFields';
import { isStateConflictFailure, toPublicOperationalError } from '~~/server/utils/errors';
import {
	acquireMeleeSyncLease,
	LIVE_RESULTS_COMMAND,
	releaseMeleeSyncLease,
	renewMeleeSyncLease,
} from '~~/server/utils/meleeSyncState';
import { createMeleeSyncWorkflows } from '../workflows';
import { loadCurrentRound } from './currentRound';
import { nextLiveResultsSchedule } from './schedule';

/** Long enough for one Round sync; renewed only at the checkpoint before a write. */
export const LIVE_RESULTS_LEASE_MS = 120_000;

/** A Melee 401/403 always stops Live Results, so a tick reports it as `stopped`. */
export type LiveResultsTickOutcome = Exclude<LiveResultsOutcome, 'auth-failed'> | 'skipped' | 'stopped';

/**
 * The tick may no longer write: an operator command has taken the Event over,
 * or Melee Sync or Live Results was switched off.
 */
class LiveResultsAbandonedError extends Error {}

function isMeleeAuthFailure(error: unknown) {
	return error instanceof MeleeTransportError
		&& (error.upstreamStatus === 401 || error.upstreamStatus === 403);
}

function isMeleeNotFound(error: unknown) {
	return error instanceof MeleeTransportError
		&& error.category === 'http'
		&& error.upstreamStatus === 404;
}

/**
 * One Live Results check for an Event. Takes the Event's Melee Sync lease or
 * skips, polls the Current Round's Match Results or probes the next Round for
 * pairings, and stores when to check next. An operator command may take the
 * lease over mid-tick: the tick then abandons every write still to come,
 * its poll state included. Writes the Event row's poll state only, and
 * announces the Event only when its Live Results error appears or clears or
 * Live Results stops itself.
 */
export async function runLiveResultsTick(eventId: number, now: Date): Promise<{ outcome: LiveResultsTickOutcome }> {
	let lease;
	try {
		lease = await acquireMeleeSyncLease(eventId, LIVE_RESULTS_COMMAND, { now, durationMs: LIVE_RESULTS_LEASE_MS });
	}
	catch (error) {
		if (isStateConflictFailure(error))
			return { outcome: 'skipped' };
		throw error;
	}

	try {
		const eventSvc = eventService();
		const event = await eventSvc.findById(eventId);
		if (!event?.meleeEnabled || !event.meleeLiveResultsEnabled)
			return { outcome: 'skipped' };

		// Player and Round writes are not lease-conditioned, so just before each
		// one confirm the lease is still ours (an operator command, configuration
		// included, takes it over) and both settings are still on.
		const checkpoint = async () => {
			const held = await renewMeleeSyncLease(eventId, lease.token, { durationMs: LIVE_RESULTS_LEASE_MS });
			if (!held)
				throw new LiveResultsAbandonedError();
			const current = await eventSvc.findById(eventId);
			if (!current?.meleeEnabled || !current.meleeLiveResultsEnabled)
				throw new LiveResultsAbandonedError();
		};

		let target: LiveResultsTarget['kind'] = 'idle';
		let outcome: LiveResultsOutcome;
		let error: string | null = null;
		try {
			const checked = await checkCurrentRound(event, checkpoint);
			target = checked.target;
			outcome = checked.changed
				? 'changed'
				: 'unchanged';
		}
		catch (cause) {
			if (cause instanceof LiveResultsAbandonedError)
				return { outcome: 'skipped' };
			outcome = isMeleeAuthFailure(cause)
				? 'auth-failed'
				: 'failed';
			error = toPublicOperationalError(cause);
			console.warn(JSON.stringify({
				message: 'melee_live_results_check_failed',
				eventId,
				errorName: errorNameOf(cause),
				upstreamStatus: cause instanceof MeleeTransportError
					? cause.upstreamStatus
					: null,
			}));
		}

		const schedule = nextLiveResultsSchedule({
			now,
			target,
			outcome,
			backoffStep: event.meleeLiveResultsBackoffStep,
			lastChangeAt: event.meleeLiveResultsLastChangeAt ?? now,
		});
		const announce = schedule.stop != null
			|| (event.meleeLiveResultsError != null) !== (error != null);
		const recorded = await eventSvc.recordMeleeLiveResultsCheck(eventId, lease.token, {
			meleeLiveResultsNextCheckAt: schedule.nextCheckAt,
			meleeLiveResultsBackoffStep: schedule.backoffStep,
			meleeLiveResultsLastCheckedAt: now,
			meleeLiveResultsLastChangeAt: schedule.lastChangeAt,
			meleeLiveResultsError: error,
			...(schedule.stop && {
				meleeLiveResultsEnabled: false,
				meleeLiveResultsStopReason: schedule.stop,
			}),
		});
		if (recorded && announce)
			await announceEvent(eventId);

		if (!recorded)
			return { outcome: 'skipped' };
		if (schedule.stop || outcome === 'auth-failed')
			return { outcome: 'stopped' };
		return { outcome };
	}
	finally {
		await releaseMeleeSyncLease(eventId, lease.token);
	}
}

/**
 * Polls what the Current Round calls for. A Round Melee has paired since the
 * last tick becomes current: Players are refreshed once so its new Players
 * resolve, then its Matches are stored. `checkpoint` runs just before each
 * write and throws to abandon it. Throws Melee and storage failures.
 */
async function checkCurrentRound(
	event: DbEvent,
	checkpoint: () => Promise<void>,
): Promise<{ target: LiveResultsTarget['kind']; changed: boolean }> {
	const { target } = await loadCurrentRound(event.id);
	if (target.kind === 'idle')
		return { target: target.kind, changed: false };

	const workflows = createMeleeSyncWorkflows();
	if (target.kind === 'probe') {
		const paired = await probeForPairings(event, Number(target.round.externalId));
		if (!paired)
			return { target: target.kind, changed: false };
		await workflows.syncPlayers({}, event.id, event, undefined, { beforeWrite: checkpoint });
	}

	const { published } = await workflows.syncRoundMatches({}, event.id, event, target.round.id, {
		beforeWrite: checkpoint,
	});
	// A probe that found pairings has moved the Current Round on: a change.
	return {
		target: target.kind,
		changed: target.kind === 'probe' || published.length > 0,
	};
}

/** Whether Melee has paired a Round: a 404 or no Matches means not yet. */
async function probeForPairings(event: DbEvent, meleeRoundId: number): Promise<boolean> {
	try {
		const matches = await requireMeleeService(event).fetchMatchesByRound(meleeRoundId);
		return matches.length > 0;
	}
	catch (error) {
		if (isMeleeNotFound(error))
			return false;
		throw error;
	}
}

/** Announces the Event after its error or stop state changed; the write has landed. */
async function announceEvent(eventId: number) {
	try {
		const event = await eventService().findById(eventId);
		if (event)
			await eventDataPublicationModule().eventUpdated({ eventId, entity: event });
	}
	catch (error) {
		console.warn(JSON.stringify({
			message: 'melee_live_results_event_update_undelivered',
			eventId,
			errorName: errorNameOf(error),
		}));
	}
}
