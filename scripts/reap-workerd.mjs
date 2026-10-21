/**
 * Reap orphaned local workerd processes, and leaked acceptance Chrome, before
 * spawning a new one.
 *
 * Miniflare only kills its workerd child from exit hooks covering SIGINT,
 * SIGTERM, and normal exit. A dev server or test runner ending by SIGKILL or
 * SIGHUP (a force-killed background task, a closed terminal) strands workerd
 * with no parent, holding memory and sqlite locks on the persist directories.
 * An orphan is unambiguous: its parent pid is 1 and its binary lives under a
 * checkout of this repository — a live session's workerd always has a live
 * node parent.
 *
 * An acceptance Chrome whose runner died is the same kind of orphan, and worse
 * company: #687 found one spinning at 100% CPU for an hour and a half, slowing
 * every run beside it. It is told apart by its profile, which only an
 * acceptance run in a checkout of this repository uses
 * (`graphics-acceptance/chromium-profile.mjs`).
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { acceptanceProfilePrefix, checkoutProfileMarker } from './graphics-acceptance/chromium-profile.mjs';

// `ps` cannot quote the executable out of the command line, so a checkout path
// with spaces is matched by prefix: below a checkout root, the path to the
// binary itself never contains whitespace.
const WORKERD_BELOW_ROOT = /^\S*\/bin\/workerd(?:\s|$)/;

function runsWorkerdFrom(command, root) {
	return command.startsWith(`${root}/`) && WORKERD_BELOW_ROOT.test(command.slice(root.length + 1));
}

function processTable(psOutput) {
	return psOutput
		.split('\n')
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/);
			return match && { pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] };
		})
		.filter(Boolean);
}

export function selectOrphanedWorkerd(psOutput, checkoutRoots) {
	return processTable(psOutput)
		.filter(entry => entry.parentPid === 1
			&& checkoutRoots.some(root => runsWorkerdFrom(entry.command, root)))
		.map(entry => entry.pid);
}

const TERMINATION_GRACE_MS = 2000;

/**
 * The pids of every leaked acceptance Chrome: a headless browser whose parent
 * is gone and whose `--user-data-dir` is a profile one of `checkoutRoots`
 * names, and every helper process it spawned. A helper carries the same
 * profile but not always `--headless`, so it is reached through its browser.
 * A person's own Chrome never runs under one of these profiles, and a browser
 * whose runner is still alive is that run's to stop.
 */
export function selectLeakedAcceptanceChrome(psOutput, checkoutRoots) {
	const prefixes = [...new Set(checkoutRoots.map(root => acceptanceProfilePrefix(checkoutProfileMarker(root))))];
	const marked = command => prefixes.some(prefix => new RegExp(`--user-data-dir=\\S*/${prefix}`).test(command));
	const table = processTable(psOutput);
	const selected = new Set(table
		.filter(entry => entry.parentPid === 1 && /\s--headless(?:=\S*)?(?:\s|$)/.test(entry.command) && marked(entry.command))
		.map(entry => entry.pid));
	let grew = selected.size > 0;
	while (grew) {
		grew = false;
		for (const entry of table) {
			if (!selected.has(entry.pid) && selected.has(entry.parentPid) && marked(entry.command)) {
				selected.add(entry.pid);
				grew = true;
			}
		}
	}
	return table.map(entry => entry.pid).filter(pid => selected.has(pid));
}

/** SIGTERM each pid, then SIGKILL whichever survive the grace; returns those signalled. */
async function terminateAll(pids, { kill, sleep }) {
	if (pids.length === 0) {
		return [];
	}
	const signalIgnoringGone = (pid, signal) => {
		try {
			kill(pid, signal);
			return true;
		}
		catch {
			return false;
		}
	};
	// An orphan that exited between `ps` and the signal was never reaped.
	const signalled = pids.filter(pid => signalIgnoringGone(pid, 'SIGTERM'));
	if (signalled.length === 0) {
		return [];
	}
	await sleep(TERMINATION_GRACE_MS);
	for (const pid of signalled) {
		if (signalIgnoringGone(pid, 0)) {
			signalIgnoringGone(pid, 'SIGKILL');
		}
	}
	return signalled;
}

export async function reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep }) {
	return await terminateAll(selectOrphanedWorkerd(psOutput, checkoutRoots), { kill, sleep });
}

export async function reapLeakedAcceptanceChrome({ psOutput, checkoutRoots, kill, sleep }) {
	return await terminateAll(selectLeakedAcceptanceChrome(psOutput, checkoutRoots), { kill, sleep });
}

/**
 * Every checkout of this repository is in scope, wherever Git registered it:
 * a worktree may sit under the main checkout (`.claude/worktrees/`) or in a
 * tool's own directory outside it, and a reap fired from any of them covers
 * orphans the others left behind. Each root is also kept as its real path,
 * because the executable path workerd runs under has its symlinks resolved.
 */
export function discoverCheckoutRoots(cwd) {
	const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	const realPathOrSame = (path) => {
		try {
			return realpathSync(path);
		}
		catch {
			return path;
		}
	};
	const roots = [cwd];
	try {
		roots.push(...git('worktree', 'list', '--porcelain', '-z')
			.split('\0')
			.filter(field => field.startsWith('worktree '))
			.map(field => field.slice('worktree '.length)));
	}
	catch {
		// Git before 2.36 has no `-z` here; the main checkout still covers the
		// worktrees nested under it.
		try {
			roots.push(dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim()));
		}
		catch {}
	}
	return [...new Set(roots.flatMap(root => [root, realPathOrSame(root)]))];
}

export async function main() {
	const psOutput = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
	const scriptCheckout = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
	const reaping = {
		psOutput,
		checkoutRoots: discoverCheckoutRoots(scriptCheckout),
		kill: process.kill,
		sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
	};
	const reaped = await reapOrphanedWorkerd(reaping);
	if (reaped.length > 0) {
		process.stdout.write(`reap-workerd: reaped orphaned workerd ${reaped.join(', ')}\n`);
	}
	const chrome = await reapLeakedAcceptanceChrome(reaping);
	if (chrome.length > 0) {
		process.stdout.write(`reap-workerd: reaped leaked acceptance Chrome ${chrome.join(', ')}\n`);
	}
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	await main();
}
