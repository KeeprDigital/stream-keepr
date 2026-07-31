// Loads Nitro's Cloudflare preset hook declarations, so `cloudflare:scheduled`
// is a checked hook name rather than a cast. A rename would fail typecheck here
// instead of silently disabling reconciliation.
import type {} from 'nitropack/presets/cloudflare/types';
import { graphicsAssetLibraryForBindings } from '~~/server/modules/graphics-asset-library/runtime';

type GraphicsBindings = Parameters<typeof graphicsAssetLibraryForBindings>[0];

/**
 * Runs the Graphics Asset Library reconciliation path on the Worker's scheduled
 * trigger, alongside the retention sweep and under the same approved
 * scheduled-trigger exception in #28.
 *
 * The pass is a comparison, not a mutation of the catalogue's meaning: D1 stays
 * authoritative for what should be reachable and the byte store reports only
 * what it holds. A missed or delayed run therefore leaves an incident
 * undetected for longer but can never lose an identity or a reference.
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller, env }) => {
		try {
			// Everything a successful pass observed is already in the durable
			// Evidence ledger and the discrepancy queue, so only failures need a
			// log line.
			// Nitro types the scheduled payload's bindings as `unknown`.
			await graphicsAssetLibraryForBindings(
				env as GraphicsBindings,
			).runGraphicsReconciliation();
		}
		catch (error) {
			// A failed pass must never take down the Worker: the next scheduled run
			// re-observes the same catalogue and byte store.
			console.error(JSON.stringify({
				message: 'graphics_reconciliation_sweep_failed',
				cron: controller.cron,
				errorName: error instanceof Error ? error.name : null,
			}));
		}
	});
});
