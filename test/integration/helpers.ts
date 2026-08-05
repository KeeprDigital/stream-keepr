import type { NuxtConfig } from '@nuxt/schema';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fetch } from '@nuxt/test-utils/e2e';
import { getIntegrationWranglerPersistDir, INTEGRATION_MODE_ENV, INTEGRATION_WRANGLER_PERSIST_DIR_ENV } from './state';

const disableFsWatchImport = fileURLToPath(new URL('./disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');
export const INTEGRATION_GRAPHICS_ADMIN_TOKEN = 'integration-graphics-admin-token';
export const INTEGRATION_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Which suite owns which Graphic Asset Content padding counts. Claim a free
 * range here before adding a fixture.
 *
 * Every integration suite runs against one database, and identical bytes
 * deduplicate into one Graphic Asset Content by design. Two suites padding the
 * single-pixel PNG with the same chunk count therefore share canonical content,
 * and `duplicateContentPolicy: 'create-separate'` does not avoid it — that makes
 * a second Graphic Asset over the same content. Both consequences have been
 * observed: a suite asserting that its ingestion published rather than reused
 * starts depending on which file ran first, and a suite that retires, Trashes
 * or purges its asset takes the other suite's bytes with it.
 *
 *   1        graphicsAssetReferences
 *   10, 20-22 graphicsAssetCapacity
 *   30-32    graphicsAssetRetention
 *   40       graphicsAssetReconciliation
 *   50, 51   broadcastGraphicsMedia — pinned media fixtures
 *   60-64    graphicsOperationalQueues — retired, Trashed and purged assets
 *   70       graphicsIngestionAuthorisation
 *   80       screenOutputAssetDelivery
 *   90, 91   graphicsAssetLifecycle
 *   100-107  broadcastGraphicsMedia — Graphic Input media fixtures
 *
 * This registry keeps suites off each other's *content*. Keeping them off each
 * other's *Graphic Assets* is `graphicsIngestionRequest`'s job — see that file.
 *
 * `graphicsAssetIngestion` deliberately owns the *unpadded* pixel, because it is
 * the suite that asserts a first ingestion publishes. Suites that pad by keyword
 * instead of by count — broadcastGraphicTemplates, broadcastGraphicTemplatePackages,
 * and the graphicsTemplatePackage export, preflight and installation suites — are
 * distinct by construction and need no entry.
 */

/**
 * Shared setup options for all integration tests.
 * - dev: true — avoids cloudflare_module build
 * - STREAM_KEEPR_INTEGRATION tells nuxt.config.ts to use isolated Wrangler D1 state
 * - Disables Vite file watchers to prevent EMFILE (too many open files)
 */
export const integrationSetupOptions = {
	dev: true,
	env: {
		[INTEGRATION_MODE_ENV]: 'true',
		[INTEGRATION_WRANGLER_PERSIST_DIR_ENV]: getIntegrationWranglerPersistDir(),
		NUXT_GRAPHICS_ADMIN_TOKEN: INTEGRATION_GRAPHICS_ADMIN_TOKEN,
		NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: INTEGRATION_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY,
		NODE_OPTIONS: nodeOptions,
	},
	nuxtConfig: {
		nitro: {
			cloudflare: {
				dev: { persistDir: getIntegrationWranglerPersistDir() },
			},
		},
		watchers: {
			chokidar: {
				usePolling: true,
				interval: 1000,
			},
		},
		typescript: { typeCheck: false },
		vite: { server: { hmr: false, watch: null as unknown as undefined } },
	} as NuxtConfig,
};

/**
 * Wrapper around `fetch` that mimics ofetch's `$fetch.raw()` response shape.
 * Needed because `@nuxt/test-utils`'s exported `$fetch` is a function wrapper
 * that doesn't expose the `.raw` property from the underlying ofetch instance.
 */
export async function $fetchRaw(path: string, opts: { method?: string; body?: unknown; ignoreResponseError?: boolean } = {}) {
	const init: RequestInit = {};
	if (opts.method)
		init.method = opts.method;
	if (opts.body !== undefined) {
		init.body = JSON.stringify(opts.body);
		init.headers = { 'Content-Type': 'application/json' };
	}

	const res = await fetch(path, init);
	let _data: any = null;
	try {
		const text = await res.text();
		if (text)
			_data = JSON.parse(text);
	}
	catch {}

	return { status: res.status, _data };
}
