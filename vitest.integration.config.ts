import { defineConfig } from 'vitest/config';
import { integrationServerCount } from './test/integration/state.ts';

// One server per worker (test/integration/globalSetup.ts): files run in
// parallel only across servers, never two against one database.
const servers = integrationServerCount();

export default defineConfig({
	test: {
		name: 'integration',
		include: ['test/integration/**/*.test.ts'],
		globalSetup: ['test/integration/globalSetup.ts'],
		setupFiles: ['test/integration/selectServer.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 60000,
		fileParallelism: servers > 1,
		maxWorkers: servers,
		silent: 'passed-only',
	},
});
