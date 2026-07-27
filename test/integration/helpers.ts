import type { NuxtConfig } from '@nuxt/schema';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fetch } from '@nuxt/test-utils/e2e';
import { getIntegrationWranglerPersistDir, INTEGRATION_MODE_ENV, INTEGRATION_WRANGLER_PERSIST_DIR_ENV } from './state';

const disableFsWatchImport = fileURLToPath(new URL('./disable-fs-watch.mjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--import', disableFsWatchImport].filter(Boolean).join(' ');
export const INTEGRATION_GRAPHICS_ADMIN_TOKEN = 'integration-graphics-admin-token';

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
