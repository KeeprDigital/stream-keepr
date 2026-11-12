/**
 * Run slots: one budget of heavy work for this machine, shared by every
 * checkout of this repository.
 *
 * Most work here is done by agents, several at once, each in its own worktree
 * and none able to see the others. Every gate was sized as if it had the
 * machine: a suite took every core, and a first `pnpm verify:quick` in a fresh
 * worktree held about 10 GB (cold lint, cold typecheck and the unit suite
 * together). Two of those is more memory than a 16 GB machine has, and the
 * suites then failed on timing or stopped answering (README § Testing).
 *
 * A slot stands for about one busy core and 1.5 GB. A gate takes the slots its
 * cost names before it starts and gives them back when it ends; with none free
 * it waits its turn, first come first served, and says what it is waiting for.
 * So the machine is never asked for more than it has, however many runs start.
 *
 * The ledger is one SQLite file in the Git common directory, which every
 * worktree of a checkout shares and every one of them can write. SQLite's own
 * file lock makes each take or release atomic, and a holder that died (a
 * killed session) is dropped by the next reader, since its process is gone.
 *
 * A broken ledger never blocks work: any failure to read or write it lets the
 * gate run unqueued, with one line saying so.
 *
 *   node scripts/slots.mjs                       who holds slots, who waits
 *   node scripts/slots.mjs <cost> -- <command>   run a command inside slots
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/** What one slot stands for in memory; the other half of it is a core. */
const SLOT_BYTES = 1.5 * 1024 ** 3;
/** Slots' worth of memory left to everything that is not a gate. */
const SLOTS_LEFT_FOR_THE_MACHINE = 2;

/** Set to a number to size the pool by hand, or to `off` to run unqueued. */
export const RUN_SLOTS_ENV = 'STREAM_KEEPR_RUN_SLOTS';
/**
 * Set for the children of a command that already holds slots, to the number
 * it holds. A gate started inside one takes nothing more: it would wait on
 * its own parent.
 */
export const RUN_SLOTS_HELD_ENV = 'STREAM_KEEPR_RUN_SLOTS_HELD';

/**
 * What each gate holds while it runs, measured on the 10-core, 16 GB machine
 * this was written on (November 2026): cold ESLint peaks at 3.8 GB and each
 * cold `vue-tsc` program at 3.7 GB, on one core apiece. A test suite is not
 * here: it takes one slot per worker (`vitest.shared.ts`).
 */
export const RUN_SLOT_COSTS = /** @type {const} */ ({
	'lint': 3,
	'typecheck': 3,
	'build': 3,
	// One `nuxt dev` with its workerd, and a Chrome beside it.
	'local-auth': 3,
	'browser-gate': 2,
	'worker-smoke': 2,
	// Several `nuxt dev` servers whose tests time real requests: nothing beside it.
	'integration': 'all',
});

/**
 * How many slots this machine has: two cores fewer than it has (one fewer on
 * a small machine), and no more than its memory holds at 1.5 GB a slot after
 * leaving room for everything else. Never fewer than two.
 *
 * @returns {number} the pool's size, or 0 when `STREAM_KEEPR_RUN_SLOTS=off`
 */
export function runSlotCount({ cores = availableParallelism(), memoryBytes = totalmem(), env = process.env } = {}) {
	const stated = env[RUN_SLOTS_ENV];
	if (stated === 'off')
		return 0;
	const requested = Number.parseInt(stated ?? '', 10);
	if (Number.isInteger(requested) && requested > 0)
		return requested;
	const byCores = cores > 4
		? cores - 2
		: cores - 1;
	const byMemory = Math.floor(memoryBytes / SLOT_BYTES) - SLOTS_LEFT_FOR_THE_MACHINE;
	return Math.max(2, Math.min(byCores, byMemory));
}

/**
 * The most slots one test run takes. On a machine with room it leaves two
 * free, so a single test file never waits behind a whole suite; six workers
 * also ran both suites faster here than the nine Vitest would start.
 */
export function suiteSlotCeiling(total = runSlotCount()) {
	return total > 4
		? total - 2
		: total;
}

/**
 * The Git common directory of the checkout holding `from`: `.git` itself in a
 * main checkout, and the main checkout's `.git` from any of its worktrees.
 *
 * @returns {string | undefined} `undefined` outside a Git checkout
 */
export function gitCommonDirectory(from = fileURLToPath(new URL('../', import.meta.url))) {
	for (let directory = resolve(from); ; directory = dirname(directory)) {
		const dotGit = join(directory, '.git');
		if (existsSync(dotGit)) {
			if (statSync(dotGit).isDirectory())
				return dotGit;
			// A worktree: `gitdir: <common>/worktrees/<name>`, which names its common directory.
			const gitDirectory = readFileSync(dotGit, 'utf8').match(/^gitdir: (.+)$/m)?.[1]?.trim();
			if (!gitDirectory)
				return undefined;
			const worktreeDirectory = isAbsolute(gitDirectory)
				? gitDirectory
				: resolve(directory, gitDirectory);
			try {
				const common = readFileSync(join(worktreeDirectory, 'commondir'), 'utf8').trim();
				return resolve(worktreeDirectory, common);
			}
			catch {
				return undefined;
			}
		}
		if (dirname(directory) === directory)
			return undefined;
	}
}

/** Where the ledger lives for the checkout this script is in. */
export function runSlotLedgerPath(from) {
	const common = gitCommonDirectory(from);
	return common && join(common, 'stream-keepr-run-slots.sqlite');
}

function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	}
	catch (error) {
		// EPERM: it exists and is another user's.
		return error?.code === 'EPERM';
	}
}

/**
 * No gate runs this long: CI gives its longest job less. A holder past it is
 * taken for hung (a worker blocked where no test timeout can reach it), and
 * its slots go back, so one stuck run cannot hold every worktree's queue.
 */
const HOLD_LIMIT_MS = 30 * 60 * 1000;

function openLedger(path) {
	const ledger = new DatabaseSync(path, { timeout: 10_000 });
	ledger.exec(`
		CREATE TABLE IF NOT EXISTS holders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pid INTEGER NOT NULL,
			slots INTEGER NOT NULL,
			label TEXT NOT NULL,
			checkout TEXT NOT NULL,
			since INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS waiters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			pid INTEGER NOT NULL,
			slots INTEGER NOT NULL,
			label TEXT NOT NULL,
			checkout TEXT NOT NULL,
			since INTEGER NOT NULL
		);
	`);
	return ledger;
}

/** Run `work` as one write transaction: nothing else reads or writes the ledger meanwhile. */
function transaction(ledger, work) {
	ledger.exec('BEGIN IMMEDIATE');
	try {
		const result = work();
		ledger.exec('COMMIT');
		return result;
	}
	catch (error) {
		ledger.exec('ROLLBACK');
		throw error;
	}
}

/**
 * Drop every row whose process is gone, and every holder that has outlived any
 * gate. A waiter keeps its place for as long as its process lives.
 */
function dropTheDead(ledger, { isAlive, now }) {
	for (const table of ['holders', 'waiters']) {
		for (const row of ledger.prepare(`SELECT id, pid, since FROM ${table}`).all()) {
			if (!isAlive(row.pid) || (table === 'holders' && now - row.since > HOLD_LIMIT_MS))
				ledger.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
		}
	}
}

/**
 * @typedef {{ slots: number, label: string, checkout: string, since: number, pid: number }} RunSlotRow
 * @returns {{ total: number, holders: RunSlotRow[], waiters: RunSlotRow[] }} who holds slots and who waits, oldest first
 */
export function runSlotStatus({ path = runSlotLedgerPath(), total = runSlotCount(), isAlive = processIsAlive, now = Date.now() } = {}) {
	if (!path || total === 0)
		return { total, holders: [], waiters: [] };
	const ledger = openLedger(path);
	try {
		return transaction(ledger, () => {
			dropTheDead(ledger, { isAlive, now });
			return {
				total,
				holders: ledger.prepare('SELECT pid, slots, label, checkout, since FROM holders ORDER BY id').all(),
				waiters: ledger.prepare('SELECT pid, slots, label, checkout, since FROM waiters ORDER BY id').all(),
			};
		});
	}
	finally {
		ledger.close();
	}
}

function age(since, now) {
	const seconds = Math.max(0, Math.round((now - since) / 1000));
	return seconds < 90
		? `${seconds}s`
		: `${Math.round(seconds / 60)}m`;
}

/** One line per holder and waiter, as the status command and a waiting gate print it. */
export function describeRunSlots({ total, holders, waiters }, now = Date.now()) {
	const held = holders.reduce((sum, row) => sum + row.slots, 0);
	const line = row => `${row.label} ×${row.slots} (${basename(row.checkout)}, pid ${row.pid}, ${age(row.since, now)})`;
	return [
		`${held} of ${total} run slots held${holders.length
			? `: ${holders.map(line).join(', ')}`
			: ''}`,
		...(waiters.length
			? [`waiting, in order: ${waiters.map(line).join(', ')}`]
			: []),
	].join('\n');
}

const checkoutRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');

/**
 * Take slots, waiting in line while there are too few.
 *
 * `want` is the most this gate can use and `min` the least it can start with
 * (`'all'` for either is the whole pool). The gate at the head of the line
 * takes whatever is free once that reaches `min`; nobody behind it is served
 * first, so a gate that needs the whole pool is not starved by small ones.
 *
 * Inside a command that already holds slots, or with the pool off, this takes
 * nothing and answers at once with what the gate may use.
 *
 * @param {{ want: number | 'all', min?: number | 'all', label: string, [seam: string]: unknown }} request `label` says what the gate is, for whoever waits behind it; the rest are seams for tests
 * @returns {Promise<{ slots: number, release: () => void }>} what it may use, and how to give it back
 */
export async function acquireRunSlots({
	want,
	min = want,
	label,
	path = runSlotLedgerPath(),
	total = runSlotCount(),
	env = process.env,
	pid = process.pid,
	checkout = checkoutRoot,
	isAlive = processIsAlive,
	sleep = ms => new Promise(done => setTimeout(done, ms)),
	say = line => process.stderr.write(`${line}\n`),
	clock = Date.now,
}) {
	const most = want === 'all'
		? Math.max(total, 1)
		: want;
	const inherited = Number.parseInt(env[RUN_SLOTS_HELD_ENV] ?? '', 10);
	if (Number.isInteger(inherited) && inherited > 0) {
		return {
			slots: Math.min(most, inherited),
			release() {},
		};
	}
	if (total === 0 || !path) {
		return {
			slots: most,
			release() {},
		};
	}

	const wanted = Math.min(most, total);
	const least = min === 'all'
		? total
		: Math.min(min, total);
	let ledger;
	let waiterId;
	try {
		ledger = openLedger(path);
		const started = clock();
		let lastSaid = started;
		for (;;) {
			const now = clock();
			const granted = transaction(ledger, () => {
				dropTheDead(ledger, { isAlive, now });
				// Its place in line, taken once; and again if the row was dropped under it.
				if (waiterId === undefined || !ledger.prepare('SELECT id FROM waiters WHERE id = ?').get(waiterId)) {
					waiterId = ledger.prepare('INSERT INTO waiters (pid, slots, label, checkout, since) VALUES (?, ?, ?, ?, ?)')
						.run(pid, least, label, checkout, now)
						.lastInsertRowid;
				}
				const head = ledger.prepare('SELECT MIN(id) AS id FROM waiters').get().id;
				if (head !== waiterId)
					return undefined;
				const held = ledger.prepare('SELECT COALESCE(SUM(slots), 0) AS slots FROM holders').get().slots;
				const free = total - held;
				if (free < least)
					return undefined;
				const slots = Math.min(wanted, free);
				ledger.prepare('DELETE FROM waiters WHERE id = ?').run(waiterId);
				return {
					slots,
					id: ledger.prepare('INSERT INTO holders (pid, slots, label, checkout, since) VALUES (?, ?, ?, ?, ?)')
						.run(pid, slots, label, checkout, now)
						.lastInsertRowid,
				};
			});
			if (granted) {
				if (now - started >= 2_000)
					say(`[run-slots] ${label}: started after waiting ${age(started, now)}`);
				let released = false;
				const held = ledger;
				const release = () => {
					if (released)
						return;
					released = true;
					process.removeListener('exit', release);
					try {
						held.prepare('DELETE FROM holders WHERE id = ?').run(granted.id);
						held.close();
					}
					catch {
						// The next reader drops this holder once the process is gone.
					}
				};
				// A killed gate never gets here; its row goes when its process does.
				process.once('exit', release);
				return { slots: granted.slots, release };
			}
			if (now - lastSaid >= 15_000 || (lastSaid === started && now - started >= 2_000)) {
				lastSaid = now;
				const status = runSlotStatus({ path, total, isAlive, now });
				say(`[run-slots] ${label} has waited ${age(started, now)} for ${least === wanted
					? least
					: `${least} to ${wanted}`} run slots. ${describeRunSlots(status, now).replace('\n', '; ')}`);
			}
			await sleep(250);
		}
	}
	catch (error) {
		try {
			if (waiterId !== undefined)
				ledger?.prepare('DELETE FROM waiters WHERE id = ?').run(waiterId);
			ledger?.close();
		}
		catch {}
		say(`[run-slots] ledger unavailable (${error instanceof Error
			? error.message
			: error}); ${label} runs unqueued`);
		return {
			slots: most,
			release() {},
		};
	}
}

/**
 * Run `command` holding the slots `cost` names: a key of `RUN_SLOT_COSTS`, a
 * number, or `all`. Its output passes through.
 *
 * @param {string} cost what the command holds while it runs
 * @param {string[]} command the program and its arguments
 * @param {{ [seam: string]: unknown }} [ledger] seams for tests, as `acquireRunSlots` takes them
 * @returns {Promise<number>} the command's exit status
 */
export async function runHoldingSlots(cost, command, ledger = {}) {
	const slots = RUN_SLOT_COSTS[cost] ?? (cost === 'all'
		? 'all'
		: Number.parseInt(cost, 10));
	if (slots !== 'all' && !(Number.isInteger(slots) && slots > 0)) {
		process.stderr.write(`slots: unknown cost "${cost}": name one of ${Object.keys(RUN_SLOT_COSTS).join(', ')}, a number, or "all"\n`);
		return 2;
	}
	const lease = await acquireRunSlots({ ...ledger, want: slots, label: cost });
	const child = spawn(command[0], command.slice(1), {
		stdio: 'inherit',
		env: {
			...process.env,
			[RUN_SLOTS_HELD_ENV]: String(lease.slots),
		},
	});
	const forward = signal => child.kill(signal);
	const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
	for (const signal of signals)
		process.on(signal, forward);
	try {
		return await new Promise((done) => {
			child.once('error', (error) => {
				process.stderr.write(`slots: ${error.message}\n`);
				done(127);
			});
			child.once('close', (status, signal) => done(status ?? (signal
				? 1
				: 0)));
		});
	}
	finally {
		for (const signal of signals)
			process.removeListener(signal, forward);
		lease.release();
	}
}

if (import.meta.main) {
	const separator = process.argv.indexOf('--');
	if (separator === -1)
		process.stdout.write(`${describeRunSlots(runSlotStatus())}\n`);
	else
		process.exitCode = await runHoldingSlots(process.argv[separator - 1], process.argv.slice(separator + 1));
}
