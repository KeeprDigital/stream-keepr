import { defineVitestConfig } from '@nuxt/test-utils/config';
import { nuxtCoverageConfig } from './vitest.shared.ts';

export default defineVitestConfig({
	test: {
		name: 'nuxt',
		include: ['test/nuxt/**/*.test.ts'],
		environment: 'nuxt',
		// Quarantines the app's own background `$fetch` writers away from suite
		// mocks (#367); see the file's docblock for the contract and opt-outs.
		setupFiles: ['./test/nuxt/setup.ts'],
		execArgv: ['--no-experimental-webstorage'],
		hookTimeout: 30000,
		restoreMocks: true,
		clearMocks: true,
		silent: 'passed-only',
		coverage: nuxtCoverageConfig,
		environmentOptions: {
			nuxt: {
				domEnvironment: 'happy-dom',
				// Its own build directory: the config-time Nuxt build rewrites it, and
				// in `.nuxt` it would race `nuxt prepare`, lint and typecheck when
				// `pnpm verify` runs them side by side.
				overrides: {
					buildDir: 'node_modules/.cache/nuxt-vitest',
				},
			},
		},
	},
});
