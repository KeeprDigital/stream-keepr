import { defineConfig } from 'vitest/config';
import { wasmModulePlugin } from './build/wasmModulePlugin';
import { rootAliases, unitCoverageConfig } from './vitest.shared';

export default defineConfig({
	plugins: [wasmModulePlugin('test-webassembly-modules')],
	resolve: {
		alias: rootAliases,
	},
	test: {
		name: 'unit',
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
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
