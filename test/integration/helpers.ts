import type { NuxtConfig } from '@nuxt/schema';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { fetch } from '@nuxt/test-utils/e2e';
import { INTEGRATION_ABLY_API_KEY_ENV } from './realtimeDiagnosis';
import { getIntegrationWranglerPersistDir, INTEGRATION_MODE_ENV, INTEGRATION_WRANGLER_PERSIST_DIR_ENV } from './state';

const disableFsWatchImport = fileURLToPath(new URL('./disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');
export const INTEGRATION_GRAPHICS_ADMIN_TOKEN = 'integration-graphics-admin-token';
export const INTEGRATION_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * The realtime notices and the diagnosis behind them live in `realtimeDiagnosis`,
 * which imports nothing, so the unit suite can exercise them without the e2e harness.
 * Re-exported here because this file is where the suites look for integration wiring.
 */
export {
	diagnoseRealtimePublishFailure,
	INTEGRATION_ABLY_API_KEY_ENV,
	INTEGRATION_REALTIME_PUBLISH_FAILED_NOTICE,
	INTEGRATION_REALTIME_PUBLISH_REJECTED_NOTICE,
	INTEGRATION_REALTIME_SKIP_NOTICE,
	SCREEN_COMMAND_ROUTE_REFUSALS,
} from './realtimeDiagnosis';

/**
 * Whether this run has a real Ably key, deciding the realtime tests and the notice.
 *
 * The suite invents its other secrets, and cannot invent this one. A fabricated key
 * still signs a token request, because `createTokenRequest` computes the HMAC
 * locally, so the realtime token test would pass against a key that could never
 * connect; meanwhile every publish would leave for the real service and 404, which
 * costs an outbound request on each screen mutation and fails whenever the suite
 * runs offline. Realtime coverage is worth having only where a genuine key is.
 *
 * Nothing here can tell a fabricated key from a real one — that answer only exists
 * on Ably's side of a publish. `realtimeDiagnosis` is where the run says so once the
 * publish has come back refused.
 *
 * The server needs no help getting the key — it inherits a real environment variable,
 * and loads `.env` itself otherwise. This resolves the key only to *decide*, and the
 * `.env` fallback exists for one process: `globalSetup` runs before the server boots,
 * so its environment does not carry `.env` yet and it would otherwise announce a skip
 * on a checkout that has a key. Test workers fork after the boot and inherit it, so
 * they mostly take the first branch; the fallback keeps them right either way.
 *
 * Resolve `.env` against this file rather than `process.cwd()`. The two diverge
 * whenever the suite is driven from elsewhere (`pnpm --dir`, an absolute `--config`,
 * any root-level orchestration over worktrees), and a miss there is not neutral: it
 * would claim "unconfigured" while the server still found its key, printing a skip
 * notice over a test that ran and failed.
 */
function resolveAblyApiKey(): string {
	const fromEnvironment = process.env[INTEGRATION_ABLY_API_KEY_ENV];
	if (fromEnvironment)
		return fromEnvironment;

	try {
		const dotenvPath = fileURLToPath(new URL('../../.env', import.meta.url));
		return parseEnv(readFileSync(dotenvPath, 'utf8'))[INTEGRATION_ABLY_API_KEY_ENV] ?? '';
	}
	catch {
		// No `.env`, or one that cannot be read: the same answer as a checkout
		// carrying no key, which is the case this whole path exists to name.
		return '';
	}
}

export const INTEGRATION_ABLY_API_KEY = resolveAblyApiKey();

/** Whether the realtime path can be exercised against the real service this run. */
export const integrationRealtimeConfigured = INTEGRATION_ABLY_API_KEY !== '';

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
 *   110, 111 graphicsAssetReplacement — original and replacement content
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
