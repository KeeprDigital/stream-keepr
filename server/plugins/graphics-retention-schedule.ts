// Loads Nitro's Cloudflare preset hook declarations, so `cloudflare:scheduled`
// is a checked hook name rather than a cast. A rename would fail typecheck here
// instead of silently disabling retention.
import type {} from 'nitropack/presets/cloudflare/types';
import { graphicsAssetLibraryForBindings } from '~~/server/modules/graphics-asset-library/runtime';

type GraphicsBindings = Parameters<typeof graphicsAssetLibraryForBindings>[0];

/**
 * Runs the Graphics Asset Library retention path on the Worker's scheduled
 * trigger, using the Cloudflare scheduled capability directly. Every deadline
 * it enforces is evaluated inside the library, so a missed or delayed run only
 * ever retains state for longer.
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller, env }) => {
		try {
			// Everything a successful sweep decided is already in the durable
			// Evidence ledger, so only failures need a log line.
			// Nitro types the scheduled payload's bindings as `unknown`.
			await graphicsAssetLibraryForBindings(
				env as GraphicsBindings,
			).runGraphicsRetention();
		}
		catch (error) {
			// A failed sweep must never take down the Worker: the next scheduled
			// run retries from durable catalogue state.
			console.error(JSON.stringify({
				message: 'graphics_retention_sweep_failed',
				cron: controller.cron,
				errorName: error instanceof Error ? error.name : null,
			}));
		}
	});
});
