import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
	acquireRunSlots,
	runHoldingSlots,
	runSlotCount,
	runSlotLedgerPath,
	runSlotStatus,
	suiteSlotCeiling,
} from '../../../scripts/slots.mjs';
import { LOAD_TOLERANT_TEST_TIMEOUT_MS } from '../../helpers/loadTolerantBounds';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const GIB = 1024 ** 3;

const directories: string[] = [];
function scratch() {
	const directory = mkdtempSync(join(tmpdir(), 'run-slots-'));
	directories.push(directory);
	return directory;
}
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

/** A ledger of `total` slots in which every process is alive, and waiting costs no time. */
function pool(total: number) {
	const said: string[] = [];
	const seams = {
		path: join(scratch(), 'ledger.sqlite'),
		total,
		env: {},
		isAlive: (_pid: number) => true,
		sleep: () => new Promise<void>(done => setImmediate(done)),
		say: (line: string) => said.push(line),
	};
	return {
		said,
		seams,
		take: (pid: number, want: number | 'all', min: number | 'all' = want) => acquireRunSlots({
			...seams,
			pid,
			want,
			min,
			label: `gate ${pid}`,
		}),
		held: () => runSlotStatus(seams).holders.map(holder => [holder.pid, holder.slots]),
		waiting: () => runSlotStatus(seams).waiters.map(waiter => waiter.pid),
	};
}

/** The child's exit status and what it wrote to stderr; a child that outlasts the bound is stopped, never waited on. */
function finished(child: ChildProcess) {
	let stderr = '';
	child.stderr?.setEncoding('utf8').on('data', (chunk: string) => stderr += chunk);
	const stop = setTimeout(() => child.kill('SIGKILL'), LOAD_TOLERANT_TEST_TIMEOUT_MS / 2);
	return new Promise<{ status: number | null; stderr: string }>((done) => {
		child.once('close', (status) => {
			clearTimeout(stop);
			done({ status, stderr });
		});
	});
}

/** Long enough for every waiter to have asked the ledger several times. */
async function severalTurns() {
	for (let turn = 0; turn < 20; turn++)
		await new Promise(done => setImmediate(done));
}

describe('how many run slots a machine has', () => {
	it.each([
		{
			machine: 'the 10-core, 16 GB machine the costs were measured on',
			cores: 10,
			memoryGib: 16,
			slots: 8,
		},
		{
			machine: 'a 4-core CI runner, by its cores',
			cores: 4,
			memoryGib: 16,
			slots: 3,
		},
		{
			machine: 'an 8-core machine short of memory, by its memory',
			cores: 8,
			memoryGib: 8,
			slots: 3,
		},
		{
			machine: 'a machine too small for either rule',
			cores: 2,
			memoryGib: 4,
			slots: 2,
		},
	])('$machine: $slots', ({ cores, memoryGib, slots }) => {
		expect(runSlotCount({ cores, memoryBytes: memoryGib * GIB, env: {} })).toBe(slots);
	});

	it.each([
		{ stated: '5', slots: 5 },
		{ stated: 'off', slots: 0 },
		{ stated: 'plenty', slots: 8 },
	])('sTREAM_KEEPR_RUN_SLOTS=$stated: $slots', ({ stated, slots }) => {
		expect(runSlotCount({
			cores: 10,
			memoryBytes: 16 * GIB,
			env: { STREAM_KEEPR_RUN_SLOTS: stated },
		})).toBe(slots);
	});

	// Two stay free on a machine with room, so one test file never waits behind a suite.
	it.each([
		{ total: 8, ceiling: 6 },
		{ total: 5, ceiling: 3 },
		{ total: 4, ceiling: 4 },
		{ total: 3, ceiling: 3 },
	])('a test run takes at most $ceiling of $total', ({ total, ceiling }) => {
		expect(suiteSlotCeiling(total)).toBe(ceiling);
	});
});

describe('taking run slots', () => {
	it('gives a gate what it wants while that is free, and the slots back when it ends', async () => {
		const { take, held } = pool(8);

		const lint = await take(1, 3);
		const suite = await take(2, 6, 3);

		expect([lint.slots, suite.slots]).toEqual([3, 5]);
		expect(held()).toEqual([
			[1, 3],
			[2, 5],
		]);

		lint.release();
		suite.release();

		expect(held()).toEqual([]);
	});

	it('makes a gate wait while fewer than its least are free, and says what holds them', async () => {
		const { take, held, said, seams } = pool(4);
		const first = await take(1, 3);
		let now = Date.now();

		const second = acquireRunSlots({
			...seams,
			pid: 2,
			want: 3,
			label: 'typecheck',
			// Each look at the ledger is five seconds after the last.
			clock: () => now += 5_000,
		});
		await severalTurns();

		expect(held()).toEqual([
			[1, 3],
		]);
		expect(said.some(line => line.includes('typecheck has waited') && line.includes('gate 1 ×3'))).toBe(true);

		first.release();

		expect((await second).slots).toBe(3);
	});

	// Served in order: otherwise small gates arriving in a stream would starve the one that needs the machine.
	it('serves no later gate ahead of one waiting for the whole pool', async () => {
		const { take, held, waiting } = pool(8);
		const running = await take(1, 6);

		const integration = take(2, 'all');
		await severalTurns();
		const oneFile = take(3, 1);
		await severalTurns();

		expect(held()).toEqual([
			[1, 6],
		]);
		expect(waiting()).toEqual([2, 3]);

		running.release();
		const whole = await integration;
		await severalTurns();

		expect(held()).toEqual([
			[2, 8],
		]);
		expect(waiting()).toEqual([3]);

		whole.release();

		expect((await oneFile).slots).toBe(1);
	});

	// A hung run would otherwise hold every worktree's queue for as long as its process lives.
	it.each([
		{
			holder: 'whose process is gone',
			dead: [1],
			minutesLater: 0,
		},
		{ holder: 'that has held them longer than any gate runs', dead: [], minutesLater: 31 },
	])('takes back the slots of a gate $holder', async ({ dead, minutesLater }) => {
		const { seams, held } = pool(4);
		const since = Date.now();
		await acquireRunSlots({
			...seams,
			clock: () => since,
			pid: 1,
			want: 'all',
			label: 'stuck session',
		});

		const next = await acquireRunSlots({
			...seams,
			isAlive: (pid: number) => !dead.includes(pid),
			clock: () => since + minutesLater * 60_000,
			pid: 2,
			want: 'all',
			label: 'the next gate',
		});

		expect(next.slots).toBe(4);
		expect(held()).toEqual([
			[2, 4],
		]);
	});

	// A gate started by a command that holds slots would otherwise wait on its own parent.
	it('takes nothing inside a command that already holds slots, and may use what that holds', async () => {
		const { seams, held } = pool(8);

		const nested = await acquireRunSlots({
			...seams,
			env: { STREAM_KEEPR_RUN_SLOTS_HELD: '3' },
			pid: 1,
			want: 6,
			label: 'nested suite',
		});

		expect(nested.slots).toBe(3);
		expect(held()).toEqual([]);
	});

	it.each([
		{
			ledger: 'a ledger that cannot be opened',
			path: () => join(scratch(), 'no-such-directory', 'ledger.sqlite'),
			total: 8,
			says: true,
		},
		{
			ledger: 'no checkout to keep a ledger in',
			path: () => null,
			total: 8,
			says: false,
		},
		{
			ledger: 'the pool switched off',
			path: () => join(scratch(), 'ledger.sqlite'),
			total: 0,
			says: false,
		},
	])('runs the gate unqueued with $ledger', async ({ path, total, says }) => {
		const said: string[] = [];

		const lease = await acquireRunSlots({
			path: path(),
			total,
			env: {},
			want: 3,
			label: 'lint',
			say: (line: string) => said.push(line),
		});
		lease.release();

		expect(lease.slots).toBe(3);
		expect(said.some(line => line.includes('lint runs unqueued'))).toBe(says);
	});
});

describe('one ledger for every worktree of a checkout', () => {
	it('names the same ledger from the main checkout and from a worktree of it', () => {
		const main = scratch();
		mkdirSync(join(main, '.git', 'worktrees', 'agent-1'), { recursive: true });
		writeFileSync(join(main, '.git', 'worktrees', 'agent-1', 'commondir'), '../..\n');
		const worktree = join(main, '.claude', 'worktrees', 'agent-1');
		mkdirSync(join(worktree, 'scripts'), { recursive: true });
		writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'agent-1')}\n`);

		const ledger = join(main, '.git', 'stream-keepr-run-slots.sqlite');

		expect(runSlotLedgerPath(main)).toBe(ledger);
		expect(runSlotLedgerPath(join(worktree, 'scripts'))).toBe(ledger);
	});

	it('names none outside a Git checkout', () => {
		expect(runSlotLedgerPath(scratch())).toBeUndefined();
	});
});

describe('running a command inside run slots', () => {
	const ledger = () => ({
		path: join(scratch(), 'ledger.sqlite'),
		total: 4,
		env: {},
	});

	it.each([
		{ command: 'a command that passes', code: 0 },
		{ command: 'a command that fails', code: 7 },
	])('answers with the status of $command', async ({ code }) => {
		expect(await runHoldingSlots('1', [process.execPath, '-e', `process.exit(${code})`], ledger())).toBe(code);
	});

	// What stops a gate the command starts from waiting in line behind the command itself.
	it('tells the command how many slots it runs inside', async () => {
		const held = await runHoldingSlots('3', [process.execPath, '-e', 'process.exit(Number(process.env.STREAM_KEEPR_RUN_SLOTS_HELD))'], ledger());

		expect(held).toBe(3);
	});

	it('refuses a cost it does not know, without running the command', async () => {
		const marker = join(scratch(), 'ran');

		const code = await runHoldingSlots('everything', [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`], ledger());

		expect(code).toBe(2);
		expect(readdirSync(join(marker, '..'))).toEqual([]);
	});
});

/**
 * The unit and Nuxt configs hold a run to its slots through a Vitest plugin
 * hook and by setting `maxWorkers` as the run starts. Neither is documented
 * API: this runs a real Vitest, so a bump that stops honouring either fails here.
 */
describe('a Vitest run held to its run slots', () => {
	it('starts no more workers than the slots it was given, and tells them what the run holds', async () => {
		// Inside the checkout, where the fixture's config can resolve `vitest`.
		const fixture = mkdtempSync(join(repositoryRoot, 'node_modules/.cache/run-slots-fixture-'));
		directories.push(fixture);
		const ledger = join(fixture, 'ledger.sqlite');
		const poolIds = join(fixture, 'pool-ids');
		mkdirSync(poolIds);
		for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
			writeFileSync(join(fixture, `${file}.test.ts`), `
				import { writeFileSync } from 'node:fs';
				import { it } from 'vitest';
				it('records its worker', async () => {
					writeFileSync(${JSON.stringify(poolIds)} + '/${file}', (process.env.VITEST_POOL_ID ?? '') + ' of ' + process.env.STREAM_KEEPR_RUN_SLOTS_HELD);
					await new Promise(done => setTimeout(done, 150));
				});
			`);
		}
		writeFileSync(join(fixture, 'vitest.config.mts'), `
			import { defineConfig } from 'vitest/config';
			import { heldToRunSlots } from ${JSON.stringify(join(repositoryRoot, 'vitest.shared.ts'))};
			export default defineConfig({
				plugins: [heldToRunSlots('fixture', { path: ${JSON.stringify(ledger)}, total: 8 })],
				test: { include: ['*.test.ts'], exclude: [] },
			});
		`);
		// Another gate holds five of the eight, so the run gets the three left: half of the six it could use.
		const other = await acquireRunSlots({
			path: ledger,
			total: 8,
			env: {},
			want: 5,
			label: 'another worktree',
		});

		const run = await finished(spawn(join(repositoryRoot, 'node_modules/.bin/vitest'), ['run', '--root', fixture], {
			cwd: repositoryRoot,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST') && !name.startsWith('STREAM_KEEPR_RUN_SLOTS'))),
		}));
		other.release();

		expect(run.status, run.stderr).toBe(0);
		const used = readdirSync(poolIds).map(file => readFileSync(join(poolIds, file), 'utf8'));
		expect(used).toHaveLength(8);
		expect([
			...new Set(used),
		].toSorted()).toEqual(['1 of 3', '2 of 3', '3 of 3']);
	});
});
