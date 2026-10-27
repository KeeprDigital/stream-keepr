import type { MeleeLiveResultsStatusResponse } from '~~/shared/api';
import { phaseService } from '~~/server/services/phase';
import { requireMeleeSyncEventData } from '../eventData';
import { loadCurrentRound } from './currentRound';

/**
 * Live Results as the Sync page shows it: the setting, the Current Round, and
 * the last poll's times, error and stop reason. Read on demand, since a quiet
 * tick announces nothing. 404 when the Event does not exist.
 */
export async function loadLiveResultsStatus(eventId: number): Promise<MeleeLiveResultsStatusResponse> {
	const [event, { current }] = await Promise.all([
		requireMeleeSyncEventData(eventId),
		loadCurrentRound(eventId),
	]);
	const phase = current
		? await phaseService().findById(current.phaseId, eventId)
		: null;
	return {
		enabled: event.meleeLiveResultsEnabled,
		currentRound: current
			? { id: current.id, name: current.name, phaseName: phase?.name ?? null }
			: null,
		lastCheckedAt: event.meleeLiveResultsLastCheckedAt,
		lastChangeAt: event.meleeLiveResultsLastChangeAt,
		error: event.meleeLiveResultsError,
		stopReason: event.meleeLiveResultsStopReason,
	};
}
