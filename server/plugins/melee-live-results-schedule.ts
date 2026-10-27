// Loads Nitro's Cloudflare preset hook declarations, so `cloudflare:scheduled`
// is a checked hook name rather than a cast.
import type {} from 'nitropack/presets/cloudflare/types';
import { runDueLiveResultsTicks } from '~~/server/modules/melee-sync/liveResults/runner';
import { LIVE_RESULTS_CRON } from '~~/server/utils/cronSchedules';

/**
 * Runs the due Melee Live Results ticks on the Worker's minute trigger. Nitro's
 * scheduled handler sets `globalThis.__env__` before calling this hook, so the
 * D1 binding resolves here as in a request.
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
		if (controller.cron !== LIVE_RESULTS_CRON)
			return;
		try {
			// Each tick's outcome is in the Event's poll state; only failures log.
			await runDueLiveResultsTicks(new Date());
		}
		catch (error) {
			// A failed run must never take down the Worker: the next minute's run
			// reads the same due Events from D1.
			console.error(JSON.stringify({
				message: 'melee_live_results_run_failed',
				cron: controller.cron,
				errorName: error instanceof Error
					? error.name
					: null,
			}));
		}
	});
});
