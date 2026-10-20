/**
 * Reap orphaned local workerd processes before spawning a new one.
 *
 * Miniflare only kills its workerd child from exit hooks covering SIGINT,
 * SIGTERM, and normal exit. A dev server or test runner ending by SIGKILL or
 * SIGHUP (a force-killed background task, a closed terminal) strands workerd
 * with no parent, holding memory and sqlite locks on the persist directories.
 * An orphan is unambiguous: its parent pid is 1 and its binary lives under a
 * checkout of this repository — a live session's workerd always has a live
 * node parent.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// `ps` cannot quote the executable out of the command line, so a checkout path
// with spaces is matched by prefix: below a checkout root, the path to the
// binary itself never contains whitespace.
const WORKERD_BELOW_ROOT = /^\S*\/bin\/workerd(?:\s|$)/;

function runsWorkerdFrom(command, root) {
	return command.startsWith(`${root}/`) && WORKERD_BELOW_ROOT.test(command.slice(root.length + 1));
}

export function selectOrphanedWorkerd(psOutput, checkoutRoots) {
	return psOutput
		.split('\n')
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/);
			return match && { pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] };
		})
		.filter(process => process
			&& process.parentPid === 1
			&& checkoutRoots.some(root => runsWorkerdFrom(process.command, root)))
		.map(process => process.pid);
}

const TERMINATION_GRACE_MS = 2000;

export async function reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep }) {
	const orphans = selectOrphanedWorkerd(psOutput, checkoutRoots);
	if (orphans.length === 0) {
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
	const signalled = orphans.filter(pid => signalIgnoringGone(pid, 'SIGTERM'));
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
	let roots;
	try {
		const worktrees = git('worktree', 'list', '--porcelain', '-z')
			.split('\0')
			.filter(field => field.startsWith('worktree '))
			.map(field => field.slice('worktree '.length));
		roots = [git('rev-parse', '--show-toplevel').trim(), ...worktrees];
	}
	catch {
		roots = [cwd];
	}
	return [...new Set(roots.flatMap(root => [root, realPathOrSame(root)]))];
}

export async function main() {
	const psOutput = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
	const reaped = await reapOrphanedWorkerd({
		psOutput,
		checkoutRoots: discoverCheckoutRoots(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')),
		kill: process.kill,
		sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
	});
	if (reaped.length > 0) {
		process.stdout.write(`reap-workerd: reaped orphaned workerd ${reaped.join(', ')}\n`);
	}
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	await main();
}
