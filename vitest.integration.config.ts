import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'integration',
		include: ['test/integration/**/*.test.ts'],
		globalSetup: ['test/integration/globalSetup.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 60000,
		fileParallelism: false,
		silent: 'passed-only',
	},
});
