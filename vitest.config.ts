import { defineConfig } from 'vitest/config';
import { wasmModulePlugin } from './build/wasmModulePlugin.ts';
import { LOAD_TOLERANT_HOOK_TIMEOUT_MS, LOAD_TOLERANT_TEST_TIMEOUT_MS, rootAliases, unitCoverageConfig } from './vitest.shared.ts';

export default defineConfig({
	plugins: [
		wasmModulePlugin('test-webassembly-modules'),
	],
	resolve: {
		alias: rootAliases,
	},
	test: {
		name: 'unit',
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
		// No suite here reaches Cloudflare; see the file (#619).
		setupFiles: ['./test/helpers/blockCloudflareCredentials.ts', './test/helpers/loadTolerantWaits.ts'],
		testTimeout: LOAD_TOLERANT_TEST_TIMEOUT_MS,
		hookTimeout: LOAD_TOLERANT_HOOK_TIMEOUT_MS,
		server: {
			deps: {
				inline: ['@jsquash/jpeg', '@jsquash/webp'],
			},
		},
		restoreMocks: true,
		clearMocks: true,
		silent: 'passed-only',
		coverage: unitCoverageConfig,
	},
});
