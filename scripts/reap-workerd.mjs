/**
 * Reap orphaned local workerd processes before spawning a new one.
 *
 * Miniflare only kills its workerd child from exit hooks covering SIGINT,
 * SIGTERM, and normal exit. A dev server or test runner ending by SIGKILL or
 * SIGHUP (a force-killed background task, a closed terminal) strands workerd
 * with no parent, holding memory and sqlite locks on the persist directories.
 * An orphan is unambiguous: its parent pid is 1 and its binary lives under
 * this repository — a live session's workerd always has a live node parent.
 */

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function selectOrphanedWorkerd(psOutput, repositoryRoot) {
	return psOutput
		.split('\n')
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)/);
			return match && { pid: Number(match[1]), parentPid: Number(match[2]), binary: match[3] };
		})
		.filter(process => process
			&& process.parentPid === 1
			&& process.binary.startsWith(`${repositoryRoot}/`)
			&& process.binary.endsWith('/bin/workerd'))
		.map(process => process.pid);
}

const TERMINATION_GRACE_MS = 2000;

export async function reapOrphanedWorkerd({ psOutput, repositoryRoot, kill, sleep }) {
	const orphans = selectOrphanedWorkerd(psOutput, repositoryRoot);
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
	for (const pid of orphans) {
		signalIgnoringGone(pid, 'SIGTERM');
	}
	await sleep(TERMINATION_GRACE_MS);
	for (const pid of orphans) {
		if (signalIgnoringGone(pid, 0)) {
			signalIgnoringGone(pid, 'SIGKILL');
		}
	}
	return orphans;
}

/**
 * The main checkout is the scope boundary, not the current one: worktrees live
 * under `.claude/worktrees/`, so a reap fired from any checkout also covers
 * orphans the others left behind.
 */
function mainRepositoryRoot() {
	try {
		const commonGitDir = execFileSync(
			'git',
			['rev-parse', '--path-format=absolute', '--git-common-dir'],
			{ encoding: 'utf8' },
		).trim();
		return dirname(commonGitDir);
	}
	catch {
		return fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
	}
}

export async function main() {
	const psOutput = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
	const reaped = await reapOrphanedWorkerd({
		psOutput,
		repositoryRoot: mainRepositoryRoot(),
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
