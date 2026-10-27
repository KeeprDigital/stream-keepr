import { eventService } from '~~/server/services/event';
import { runLiveResultsTick } from './tick';

/**
 * Events ticked per cron run. Each tick is a few Melee requests and D1
 * statements, run one after another, so a run stays well inside the Worker's
 * subrequest and wall-time limits and Melee sees one Event at a time.
 */
export const LIVE_RESULTS_MAX_EVENTS_PER_RUN = 25;

/**
 * Runs the Live Results tick of every Event due at `now`, longest-waiting
 * first, one at a time. One Event's failure is logged and never stops the rest.
 */
export async function runDueLiveResultsTicks(now: Date): Promise<void> {
	const dueEventIds = await eventService().findDueMeleeLiveResults(now, LIVE_RESULTS_MAX_EVENTS_PER_RUN);
	for (const eventId of dueEventIds) {
		try {
			await runLiveResultsTick(eventId, now);
		}
		catch (error) {
			console.error(JSON.stringify({
				message: 'melee_live_results_tick_failed',
				eventId,
				errorName: error instanceof Error
					? error.name
					: typeof error,
			}));
		}
	}
}
