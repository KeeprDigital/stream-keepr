import { defineConfig } from 'vitest/config';
import { rootAliases } from './vitest.shared.ts';

export default defineConfig({
	resolve: { alias: rootAliases },
	test: {
		name: 'local-auth',
		include: ['test/local-auth/**/*.test.ts'],
		globalSetup: ['test/local-auth/globalSetup.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		silent: 'passed-only',
	},
});
