// Loads Nitro's Cloudflare preset hook declarations, so `cloudflare:scheduled`
// is a checked hook name rather than a cast.
import type {} from 'nitropack/presets/cloudflare/types';
import type { NitroApp } from 'nitropack/types';
import { LIVE_RESULTS_CRON, LIVE_RESULTS_CRON_INTERVAL_MS } from '~~/server/utils/cronSchedules';
import { errorNameOf } from '~~/server/utils/errorLogFields';
import { startLocalCron } from '~~/server/utils/localCron';

/**
 * Under `nuxt dev` no cron trigger fires, so the dev server fires the Worker's
 * Live Results cron hook itself: at once, then every minute, never overlapping.
 * Each Event's poll state still decides whether it is due. Does nothing unless
 * `dev`: a deployed Worker has its real cron, and would tick twice. The gate is
 * this argument, not the caller's `if`, so the one place it lives is tested.
 */
export function startLocalLiveResultsSchedule(nitroApp: Pick<NitroApp, 'hooks'>, { dev }: { dev: boolean }) {
	if (!dev)
		return;
	const cron = startLocalCron({
		intervalMs: LIVE_RESULTS_CRON_INTERVAL_MS,
		fire: () => fireLiveResultsCron(nitroApp),
		onError: error => console.error(JSON.stringify({
			message: 'melee_live_results_local_schedule_failed',
			errorName: errorNameOf(error),
		})),
	});
	nitroApp.hooks.hook('close', () => cron.stop());
}

/** Calls the `cloudflare:scheduled` hook as the Worker's scheduled handler does, awaiting its `waitUntil` work. */
async function fireLiveResultsCron(nitroApp: Pick<NitroApp, 'hooks'>) {
	const pending: Promise<unknown>[] = [];
	await nitroApp.hooks.callHook('cloudflare:scheduled', {
		controller: {
			cron: LIVE_RESULTS_CRON,
			scheduledTime: Date.now(),
			noRetry: () => {},
		},
		// The dev server's Wrangler binding proxy (Nitro's Cloudflare dev plugin).
		env: (globalThis as { __env__?: unknown }).__env__,
		context: {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
			passThroughOnException: () => {},
			props: {},
		},
	});
	await Promise.all(pending);
}
