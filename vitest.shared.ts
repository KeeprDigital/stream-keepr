import type { Plugin } from 'vite';
import type { CoverageOptions, Reporter } from 'vitest/node';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { acquireRunSlots, RUN_SLOTS_HELD_ENV, runSlotCount, suiteSlotCeiling } from './scripts/slots.mjs';

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

export { LOAD_TOLERANT_BAIL_AFTER_FAILURES, LOAD_TOLERANT_HOOK_TIMEOUT_MS, LOAD_TOLERANT_TEST_TIMEOUT_MS } from './test/helpers/loadTolerantBounds.ts';

/**
 * Reports a timed-out `vi.waitFor`/`vi.waitUntil` at the test's line: without
 * this the wrapper that sets their default bound is the top frame.
 */
export function hideLoadTolerantWaitFrame(_error: unknown, frame: { file: string }) {
	return !frame.file.endsWith('test/helpers/loadTolerantWaits.ts');
}

const RUN_SLOT_REPORTER = Symbol.for('stream-keepr.runSlotReporter');

/**
 * Holds a test run to this machine's run slots (`scripts/slots.mjs`): one
 * per worker, taken when the run knows its files and given back when it ends.
 *
 * A run of three files takes three; a whole suite takes the ceiling, which is
 * fewer workers than Vitest would start and measurably faster for it. With
 * none free the run waits its turn and says so. However Vitest is started
 * (`pnpm test:unit`, `vitest related`, `pnpm verify`), runs in every worktree
 * draw on the one budget, so they queue rather than starve each other into
 * their timeouts.
 *
 * A plugin rather than a reporter in the config: `--reporter` on the command
 * line replaces the config's list, and would take this with it.
 */
export function heldToRunSlots(label: string, ledger: { path?: string; total?: number } = {}): Plugin {
	return {
		name: 'stream-keepr:run-slots',
		configureVitest({ vitest }) {
			const total = ledger.total ?? runSlotCount();
			if (total === 0 || vitest.config.reporters.some(reporter => RUN_SLOT_REPORTER in reporter))
				return;
			const ceiling = Math.min(vitest.config.maxWorkers, suiteSlotCeiling(total));
			let lease: Awaited<ReturnType<typeof acquireRunSlots>> | undefined;
			const giveBack = () => {
				lease?.release();
				lease = undefined;
				delete process.env[RUN_SLOTS_HELD_ENV];
			};
			vitest.config.reporters.push({
				[RUN_SLOT_REPORTER]: true,
				async onTestRunStart(specifications) {
					giveBack();
					if (specifications.length === 0)
						return;
					const want = Math.min(specifications.length, ceiling);
					lease = await acquireRunSlots({
						...ledger,
						total,
						want,
						// Half of what it could use: a suite that started on the one free
						// slot would keep that one worker long after the rest came free.
						min: Math.ceil(want / 2),
						label: specifications.length === 1
							? `${label}, 1 file`
							: `${label}, ${specifications.length} files`,
					});
					// The workers start after this and inherit it: a test that runs a gate
					// of its own (a script under test) then takes nothing more, where it
					// would otherwise wait in line behind the very run it belongs to.
					process.env[RUN_SLOTS_HELD_ENV] = String(lease.slots);
					// Read when the run groups its files, which is after this hook returns.
					for (const config of new Set([
						vitest.config,
						...vitest.projects.map(project => project.config),
					]))
						config.maxWorkers = lease.slots;
				},
				onTestRunEnd: giveBack,
			} as Reporter);
		},
	};
}

/**
 * What no test imports and every test depends on. Under `--changed`
 * (`pnpm verify:quick`) Vitest selects tests by following their imports, so a
 * change to one of these would select none; it runs the whole suite instead.
 */
export const unitRerunTriggers = [
	'**/package.json',
	'**/pnpm-lock.yaml',
	'**/{vitest,vite}.config.*',
	'**/vitest.shared.ts',
	'**/test/helpers/{blockCloudflareCredentials,loadTolerantBounds,loadTolerantWaits}.ts',
	// The sqlite harness reads these from disk.
	'**/server/db/migrations/**',
];
export const nuxtRerunTriggers = [
	...unitRerunTriggers,
	'**/nuxt.config.ts',
	'**/test/nuxt/{setup,quietSuspenseNotice,failOnUnbundledIcon}.ts',
];

export const rootAliases = {
	'~~': rootDir,
	'~~/': `${rootDir}/`,
	'~': `${rootDir}/app`,
	'~/': `${rootDir}/app/`,
	'h3': nitroH3Directory,
};

/** App code tested in the unit suite alone: measured there, and left out of the Nuxt suite's floor. */
const nodeOnlyAppCoverageInclude = [
	'app/composables/screen/screenSettingsSummaries.ts',
	'app/composables/screen/useScreenRealtimeSession.ts',
	'app/modules/auth/pageGate.ts',
	'app/modules/event-data/client.ts',
	'app/modules/feature-match-session/client.ts',
	'app/modules/metagame/client.ts',
	'app/plugins/realtime.client.ts',
	'app/utils/animation-effects/{connectionLines,dots,globe,net,random,rendererHarness,rings,sceneEffect,shaderPlane,waves}.ts',
	'app/utils/broadcastGraphicsCommandRefusal.ts',
	'app/utils/featureMatchSetup.ts',
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
		// Unit-tested here and still exercised by the Nuxt suite, so measured in both.
		'app/composables/core/useRealtimeMessageGate.ts',
		'app/composables/workflows/useEventRealtimeSession.ts',
		'app/modules/screen-mode/index.ts',
		'app/modules/screen-mode/modeTokens.ts',
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
