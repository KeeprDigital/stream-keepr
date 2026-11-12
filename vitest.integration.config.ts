import { defineConfig } from 'vitest/config';
import { CHECKOUT_TSCONFIG } from './build/checkoutTsconfig.ts';
import {
	INTEGRATION_REALTIME_PROJECT_ENV,
	INTEGRATION_REALTIME_TEST_FILES,
	integrationServerCount,
} from './test/integration/state.ts';

// One server per worker (test/integration/globalSetup.ts): files run in
// parallel only across servers, never two against one database.
const servers = integrationServerCount();

// Two projects, one after the other. The realtime files run first, one at a
// time, against the only server holding the Ably key; every other file then
// runs against the keyless ones (test/integration/state.ts § realtime server).
export default defineConfig({
	// Named, or Vite goes looking and climbs out of this checkout (build/checkoutTsconfig.ts).
	tsconfig: CHECKOUT_TSCONFIG,
	test: {
		globalSetup: ['test/integration/globalSetup.ts'],
		setupFiles: ['test/integration/selectServer.ts', 'test/integration/requestLedgerReport.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 60000,
		silent: 'passed-only',
		projects: [
			{
				extends: true,
				test: {
					name: 'integration-realtime',
					include: [INTEGRATION_REALTIME_TEST_FILES],
					env: { [INTEGRATION_REALTIME_PROJECT_ENV]: 'true' },
					fileParallelism: false,
					maxWorkers: 1,
					sequence: { groupOrder: 0 },
				},
			},
			{
				extends: true,
				test: {
					name: 'integration',
					include: ['test/integration/**/*.test.ts'],
					exclude: [INTEGRATION_REALTIME_TEST_FILES],
					fileParallelism: servers > 1,
					maxWorkers: servers,
					sequence: { groupOrder: 1 },
				},
			},
		],
	},
});
