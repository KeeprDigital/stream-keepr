import { defineConfig } from 'vitest/config';
import { rootAliases, unitCoverageConfig } from './';

export default defineConfig({
	resolve: {
		alias: rootAliases,
	},
	test: {
		name: 'unit',
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
		restoreMocks: true,
		clearMocks: true,
		silent: 'passed-only',
		coverage: unitCoverageConfig,
	},
});
