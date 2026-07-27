import { defineVitestConfig } from '@nuxt/test-utils/config';
import { nuxtCoverageConfig } from './vitest.shared';

export default defineVitestConfig({
	test: {
		name: 'nuxt',
		include: ['test/nuxt/**/*.test.ts'],
		environment: 'nuxt',
		execArgv: ['--no-experimental-webstorage'],
		hookTimeout: 30000,
		restoreMocks: true,
		clearMocks: true,
		silent: 'passed-only',
		coverage: nuxtCoverageConfig,
		environmentOptions: {
			nuxt: {
				domEnvironment: 'happy-dom',
			},
		},
	},
});
