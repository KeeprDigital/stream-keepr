import { defineVitestConfig } from '@nuxt/test-utils/config';
import { defineConfig } from 'vitest/config';
import { nuxtCoverageConfig } from './vitest.shared.ts';

const nuxtVitestConfig = defineVitestConfig({
	test: {
		name: 'nuxt',
		include: ['test/nuxt/**/*.test.ts'],
		environment: 'nuxt',
		// Quarantines the app's own background `$fetch` writers away from suite
		// mocks (#367); see the file's docblock for the contract and opt-outs.
		setupFiles: ['./test/nuxt/setup.ts'],
		execArgv: ['--no-experimental-webstorage'],
		// On by default since Vitest 5. A warm cache replays the test-utils app
		// entry without resolving its relative imports, so every file fails
		// (README § Testing, "Tried and rejected").
		fsModuleCache: false,
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

export default defineConfig(async (env) => {
	const config = await nuxtVitestConfig(env);
	// Ahead of the test-utils entry, which `defineVitestConfig` puts first and
	// which mounts the app that prints Vue's Suspense notice; see the file.
	// The credential guard first of all, before anything can start a child (#619).
	// The icon guard also ahead of the entry, so its mock precedes `@nuxt/icon`.
	config.test!.setupFiles = ['./test/helpers/blockCloudflareCredentials.ts', './test/nuxt/quietSuspenseNotice.ts', './test/nuxt/failOnUnbundledIcon.ts', ...[config.test!.setupFiles ?? []].flat()];
	return config;
});
