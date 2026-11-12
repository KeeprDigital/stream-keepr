/**
 * `pnpm verify` — CI's gates on the working tree, run as a dependency graph.
 *
 * Every gate runs side by side with the others where nothing forbids it, and
 * the first failure stops the rest. Each gate's output goes to
 * `node_modules/.cache/verify/<gate>.log`; a failing gate's tail is printed.
 *
 * What orders the graph:
 * - The root tsconfig extends `.nuxt/tsconfig.json`, so every Vite and TypeScript
 *   consumer reads `.nuxt`. `nuxt prepare` regenerates it first and is the only
 *   gate that writes it: the Nuxt suite (`vitest.nuxt.config.ts`), the server
 *   suites (their persist directories) and the build (`STREAM_KEEPR_BUILD_DIR`)
 *   each write their own. The silent-video validator's gates are the exception:
 *   its tsconfig stands alone, so they need no `prepare`.
 * - The server-backed stage (integration, local-auth, browser gates) starts only
 *   once the cheap stage has passed, so a lint or type error never waits behind
 *   it.
 *
 * What the graph does not decide is how much runs at once. Every heavy gate
 * takes run slots from the one budget this machine has
 * (`scripts/slots.mjs`), shared with every other worktree's runs, and waits
 * its turn when there are none: the integration suite takes them all.
 *
 * Usage: node scripts/verify.mjs [--quick [--all] | --tests]
 *   --quick  what this checkout's change can break: lint of the files it
 *            changes, typecheck, and the unit and Nuxt tests whose imports
 *            reach those files. Before a push; CI is the full gate.
 *   --quick --all
 *            the whole cheap stage: lint, typecheck, unit and Nuxt suites.
 *   --tests  every test suite and local acceptance gate, without lint,
 *            typecheck, the build, or the bundle checks; this is `pnpm test`.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { changeBase } from './changed-files.mjs';
import { main as reapStrandedWorkerd } from './reap-workerd.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const logDirectory = fileURLToPath(new URL('../node_modules/.cache/verify/', import.meta.url));

const FIRST_STAGE = [
	'lint',
	'typecheck:app',
	'typecheck:test',
	'typecheck:validator',
	'test:unit:coverage',
	'test:nuxt:coverage',
];

/** Gate name → the command it runs, the gates that must pass first, and any extra environment. */
export const GATES = {
	'prepare': {
		command: ['exec', 'nuxt', 'prepare'],
		after: [],
	},
	'lint': {
		command: ['run', 'lint'],
		after: ['prepare'],
	},
	'typecheck:app': {
		command: ['run', 'typecheck:app'],
		after: ['prepare'],
	},
	// After the app's program, not beside it: each holds 3.7 GB on a cold cache.
	'typecheck:test': {
		command: ['run', 'typecheck:test'],
		after: ['typecheck:app'],
	},
	// The silent-video validator is its own Worker with its own standalone
	// program and bundle (#618): neither reads `.nuxt`, so both start at once.
	// About a second each, they finish while lint is still running.
	'typecheck:validator': {
		command: ['run', 'typecheck:validator'],
		after: [],
	},
	'validator:dry-run': {
		command: ['run', 'validator:dry-run'],
		after: [],
	},
	'test:unit:coverage': {
		command: ['run', 'test:unit:coverage'],
		after: ['prepare'],
	},
	'test:nuxt:coverage': {
		command: ['run', 'test:nuxt:coverage'],
		after: ['test:unit:coverage'],
	},

	'test:integration': {
		command: ['run', 'test:integration', '--run'],
		after: FIRST_STAGE,
	},
	// One after another: each starts its own servers, and is timed against them.
	'test:local-auth': {
		command: ['run', 'test:local-auth'],
		after: ['test:integration'],
	},
	'accept:still-images': {
		command: ['run', 'accept', 'still-images'],
		after: ['test:local-auth'],
	},
	'accept:silent-video': {
		command: ['run', 'accept', 'silent-video'],
		after: ['accept:still-images'],
	},
	'accept:fonts': {
		command: ['run', 'accept', 'fonts'],
		after: ['accept:silent-video'],
	},
	'accept:animation-effects': {
		command: ['run', 'accept', 'animation-effects'],
		after: ['accept:fonts'],
	},
	'accept:key-matte': {
		command: ['run', 'accept', 'key-matte'],
		after: ['accept:animation-effects'],
	},
	'build': {
		command: ['run', 'build'],
		after: ['prepare'],
		env: { STREAM_KEEPR_BUILD_DIR: 'node_modules/.cache/nuxt-build' },
	},
	'worker:dry-run': {
		command: ['run', 'worker:dry-run'],
		after: ['build'],
	},
	'worker:smoke': {
		command: ['run', 'worker:smoke'],
		after: ['worker:dry-run'],
	},
};

const LOG_TAIL_LINES = 80;

function seconds(ms) {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Gates that are not test suites; `--tests` leaves them out. */
const NOT_TESTS = new Set([
	'lint',
	'typecheck:app',
	'typecheck:test',
	'typecheck:validator',
	'validator:dry-run',
	'build',
	'worker:dry-run',
	'worker:smoke',
]);

/**
 * `--quick`: the first stage, with lint and both suites narrowed to what this
 * checkout changes. Vitest reads the change itself (`--changed`), following
 * each test file's imports, and runs every test when the change reaches a
 * file every test depends on and none imports (`unitRerunTriggers`,
 * `vitest.shared.ts`).
 *
 * @param {string} baseRef the ref the branch is measured from
 */
function changedGates(baseRef) {
	const changed = ['--changed', baseRef, '--passWithNoTests'];
	return {
		'prepare': GATES.prepare,
		'lint:changed': {
			command: ['run', 'lint:changed'],
			after: ['prepare'],
		},
		'typecheck:app': GATES['typecheck:app'],
		'typecheck:test': GATES['typecheck:test'],
		'typecheck:validator': GATES['typecheck:validator'],
		'test:unit:changed': {
			command: ['exec', 'vitest', 'run', ...changed],
			after: ['prepare'],
		},
		'test:nuxt:changed': {
			command: [
				'exec',
				'vitest',
				'run',
				'--config',
				'vitest.nuxt.config.ts',
				...changed,
			],
			after: ['test:unit:changed'],
		},
	};
}

/**
 * The gates a mode runs. A dependency outside the selection counts as met, so
 * `--tests` starts the server-backed stage once the unit and Nuxt suites pass.
 *
 * `--quick` narrows to the change when there is a `main` to measure it from
 * (`baseRef` answers which), and is the whole first stage otherwise or with
 * `--all`.
 *
 * @param {string[]} argv the command line
 * @param {() => string | undefined} [baseRef] the ref the branch is measured from, if any
 * @returns {Record<string, { command: string[], after: string[], env?: Record<string, string> }>} the gates, by name
 */
export function selectGates(argv, baseRef = () => changeBase()?.ref) {
	if (argv.includes('--quick')) {
		const base = argv.includes('--all')
			? undefined
			: baseRef();
		if (base)
			return changedGates(base);
		const wanted = new Set(['prepare', ...FIRST_STAGE]);
		return Object.fromEntries(Object.entries(GATES).filter(([name]) => wanted.has(name)));
	}
	if (argv.includes('--tests'))
		return Object.fromEntries(Object.entries(GATES).filter(([name]) => !NOT_TESTS.has(name)));
	return GATES;
}

/** Signal a gate's whole process group: pnpm, vitest, and whatever they spawned. */
function signalGroup(child, signal) {
	try {
		process.kill(-child.pid, signal);
	}
	catch {
		// Already gone.
	}
}

export async function main(argv = process.argv) {
	const gates = selectGates(argv);
	await mkdir(logDirectory, { recursive: true });
	if ('lint:changed' in gates)
		process.stdout.write(`verify --quick: checking what this checkout changes since ${changeBase()?.ref}; CI runs everything\n`);

	const started = Date.now();
	const passed = new Map();
	const running = new Map();
	let failure;

	const { promise: settled, resolve: settle } = Promise.withResolvers();

	function launchReady() {
		if (failure)
			return;
		for (const [name, gate] of Object.entries(gates)) {
			if (passed.has(name) || running.has(name))
				continue;
			if (!gate.after.every(dependency => passed.has(dependency) || !(dependency in gates)))
				continue;
			launch(name, gate);
		}
		if (running.size === 0)
			settle();
	}

	function launch(name, gate) {
		const logPath = `${logDirectory}${name.replaceAll(':', '-')}.log`;
		const log = createWriteStream(logPath);
		const gateStarted = Date.now();
		// Its own process group, so stopping it reaches every descendant.
		const child = spawn('pnpm', gate.command, {
			cwd: repositoryRoot,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				FORCE_COLOR: '1',
				...gate.env,
			},
		});
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		running.set(name, child);
		process.stdout.write(`  ▶ ${name}\n`);

		child.once('close', (code, signal) => {
			log.end();
			running.delete(name);
			const elapsed = Date.now() - gateStarted;
			if (code === 0) {
				passed.set(name, elapsed);
				process.stdout.write(`  ✓ ${name} ${seconds(elapsed)}\n`);
				launchReady();
				return;
			}
			if (!failure) {
				failure = {
					name,
					elapsed,
					logPath,
					reason: signal ?? `exit ${code}`,
					stoppedAt: Date.now(),
				};
				for (const other of running.values())
					signalGroup(other, 'SIGINT');
			}
			if (running.size === 0)
				settle();
		});
	}

	const interrupt = () => {
		failure ??= {
			name: 'verify',
			reason: 'interrupted',
			stoppedAt: Date.now(),
		};
		for (const child of running.values())
			signalGroup(child, 'SIGINT');
	};
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);

	launchReady();

	// Gates stopped on another's failure get a grace period, then are killed.
	const killTimer = setInterval(() => {
		if (failure && Date.now() - failure.stoppedAt > 15_000) {
			for (const child of running.values())
				signalGroup(child, 'SIGKILL');
		}
	}, 1_000);
	await settled;
	clearInterval(killTimer);
	process.removeListener('SIGINT', interrupt);
	process.removeListener('SIGTERM', interrupt);

	if (failure) {
		// Anything a killed server suite or browser gate left behind: orphaned
		// workerd, and leaked acceptance Chrome (#687).
		await reapStrandedWorkerd();
		if (failure.logPath) {
			const lines = (await readFile(failure.logPath, 'utf8')).trimEnd().split('\n');
			process.stderr.write(`\n  ✗ ${failure.name} failed (${failure.reason}) after ${seconds(failure.elapsed)}\n`);
			process.stderr.write(`    full log: ${failure.logPath}\n\n${lines.slice(-LOG_TAIL_LINES).join('\n')}\n`);
		}
		else {
			process.stderr.write(`\n  ✗ ${failure.reason}\n`);
		}
		process.exitCode = failure.reason === 'interrupted'
			? 130
			: 1;
		return;
	}

	process.stdout.write(`\nverify: ${passed.size} gates passed in ${seconds(Date.now() - started)}\n`);
}

if (import.meta.main)
	await main();
