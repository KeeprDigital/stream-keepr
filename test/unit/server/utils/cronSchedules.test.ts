import { readFileSync } from 'node:fs';
import { getStaticJSONValue, parseJSON } from 'jsonc-eslint-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_CRON, LIVE_RESULTS_CRON } from '~~/server/utils/cronSchedules';

/*
 * Every `cloudflare:scheduled` handler runs on every cron trigger, so each must
 * run only on its own: graphics jobs stay hourly beside the minute Live Results cron.
 */

const runGraphicsRetention = vi.fn();
const runGraphicsReconciliation = vi.fn();
const runDueLiveResultsTicks = vi.fn();

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin);
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForBindings: () => ({ runGraphicsRetention, runGraphicsReconciliation }),
}));
vi.doMock('~~/server/modules/melee-sync/liveResults/runner', () => ({ runDueLiveResultsTicks }));

type ScheduledHook = (payload: { controller: { cron: string }; env: unknown; context: unknown }) => Promise<void>;
type NitroPlugin = (nitroApp: { hooks: { hook: (name: string, handler: ScheduledHook) => void } }) => void;

const plugins = {
	'graphics retention': runGraphicsRetention,
	'graphics reconciliation': runGraphicsReconciliation,
	'Live Results': runDueLiveResultsTicks,
};
const pluginModules: Record<keyof typeof plugins, string> = {
	'graphics retention': '~~/server/plugins/graphics-retention-schedule',
	'graphics reconciliation': '~~/server/plugins/graphics-reconciliation-schedule',
	'Live Results': '~~/server/plugins/melee-live-results-schedule',
};

/** Fires the plugin's `cloudflare:scheduled` hook as the Worker would on `cron`. */
async function fire(plugin: keyof typeof plugins, cron: string) {
	const { default: install } = await import(pluginModules[plugin]) as { default: NitroPlugin };
	let scheduled: ScheduledHook | undefined;
	install({
		hooks: {
			hook: (name, handler) => {
				if (name === 'cloudflare:scheduled')
					scheduled = handler;
			},
		},
	});
	await scheduled!({
		controller: { cron },
		env: {},
		context: {},
	});
}

beforeEach(() => vi.clearAllMocks());

describe('cron schedules', () => {
	it('are the triggers wrangler.jsonc declares', () => {
		const config = getStaticJSONValue(parseJSON(readFileSync('wrangler.jsonc', 'utf8'))) as {
			triggers: { crons: string[] };
		};

		expect(config.triggers.crons).toEqual([GRAPHICS_CRON, LIVE_RESULTS_CRON]);
	});

	it.each([
		{ plugin: 'graphics retention', ownCron: GRAPHICS_CRON, otherCron: LIVE_RESULTS_CRON },
		{ plugin: 'graphics reconciliation', ownCron: GRAPHICS_CRON, otherCron: LIVE_RESULTS_CRON },
		{ plugin: 'Live Results', ownCron: LIVE_RESULTS_CRON, otherCron: GRAPHICS_CRON },
	] as const)('$plugin runs on its own cron only', async ({ plugin, ownCron, otherCron }) => {
		await fire(plugin, otherCron);
		expect(plugins[plugin]).not.toHaveBeenCalled();

		await fire(plugin, ownCron);
		expect(plugins[plugin]).toHaveBeenCalledOnce();
	});
});
