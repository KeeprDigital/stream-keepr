import type { CoverageOptions } from 'vitest/node';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The h3 that Nitro runs on, resolved the way Nuxt resolves it. The Nitro
 * build and the generated tsconfig both alias `h3` to this copy, so server code
 * never sees whichever h3 pnpm happens to hoist; outside Nuxt, a plain vitest
 * run would, and a dependency hoisting h3 v2 (as `@nuxt/fonts` 1 does) would
 * test server code against a major version it never runs on.
 */
const requireFromNuxt = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'));
const requireFromNitroServer = createRequire(requireFromNuxt.resolve('@nuxt/nitro-server/package.json'));
export const nitroH3Directory = dirname(requireFromNitroServer.resolve('h3/package.json'));

export const rootAliases = {
	'~~': rootDir,
	'~~/': `${rootDir}/`,
	'~': `${rootDir}/app`,
	'~/': `${rootDir}/app/`,
	'h3': nitroH3Directory,
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
//
// Each floor is over its `include` minus its `exclude`, not the whole
// codebase (#621). No `.vue` file is measured, so components, pages and layouts
// are outside both. Also outside both, among others: `server/middleware`,
// `server/plugins`, `server/db`, `app/middleware`, every `app/plugins` file but
// the one listed above, `scripts/`, and `workers/`. A floor is a fixed
// minimum, not a ratchet: coverage can fall to it unnoticed.
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
	// The TypeScript under `include`, which deliberately takes in browser/WebGL
	// orchestration as well as composables and stores; the `.vue` files that
	// mount them are excluded (above). Raise the floor as browser-level coverage
	// is added.
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
