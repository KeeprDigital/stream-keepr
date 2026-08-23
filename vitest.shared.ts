import type { CoverageOptions } from 'vitest/node';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('.', import.meta.url));

export const rootAliases = {
	'~~': rootDir,
	'~~/': `${rootDir}/`,
	'~': `${rootDir}/app`,
	'~/': `${rootDir}/app/`,
};

const nodeOnlyAppCoverageInclude = [
	'app/composables/screen/useScreenRealtimeSession.ts',
	'app/composables/workflows/useEventRealtimeSession.ts',
	'app/modules/auth/pageGate.ts',
	'app/modules/event-data/client.ts',
	'app/modules/feature-match-session/client.ts',
	'app/modules/metagame/client.ts',
	'app/plugins/realtime.client.ts',
	'app/utils/clock.ts',
	'app/utils/metagame.ts',
	'app/utils/uuid.ts',
];

const coverageExclude = [
	'**/*.d.ts',
	'**/*.vue',
	'**/types.ts',
	'coverage/**',
	'node_modules/**',
	'.nuxt/**',
	'server/db/migrations/**',
];

// Thresholds gate for real: `pnpm test` (and so CI and `pnpm verify`) runs the
// unit and nuxt suites through `test:unit:coverage` / `test:nuxt:coverage`,
// which pass `--coverage` and fail the run below these floors (#469). Overhead
// measured locally at ~2s per suite. Watch mode and single-file runs stay
// uninstrumented.
export const unitCoverageConfig: CoverageOptions = {
	provider: 'v8',
	reporter: ['text', 'html', 'json'],
	reportsDirectory: 'coverage/unit',
	thresholds: {
		statements: 70,
		branches: 65,
		functions: 75,
		lines: 70,
	},
	include: [
		'shared/**/*.ts',
		'server/api/**/*.ts',
		'server/modules/**/*.ts',
		'server/services/**/*.ts',
		'server/mappers/**/*.ts',
		'server/utils/**/*.ts',
		'server/schemas/**/*.ts',
		...nodeOnlyAppCoverageInclude,
	],
	exclude: coverageExclude,
};

export const nuxtCoverageConfig: CoverageOptions = {
	provider: 'v8',
	reporter: ['text', 'html', 'json'],
	reportsDirectory: 'coverage/nuxt',
	// This scope deliberately includes browser/WebGL orchestration as well as
	// composables and stores. Keep an honest full-scope non-regression floor and
	// ratchet it upward as browser-level coverage is added.
	thresholds: {
		statements: 64,
		branches: 50,
		functions: 71,
		lines: 64,
	},
	include: [
		'app/modules/**/*.ts',
		'app/stores/**/*.ts',
		'app/composables/**/*.ts',
		'app/utils/**/*.ts',
	],
	exclude: [
		...coverageExclude,
		...nodeOnlyAppCoverageInclude,
	],
};
