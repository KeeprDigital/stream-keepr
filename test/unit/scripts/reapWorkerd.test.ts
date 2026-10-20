import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverCheckoutRoots, reapOrphanedWorkerd, selectOrphanedWorkerd } from '../../../scripts/reap-workerd.mjs';

const repositoryRoot = '/Users/dev/stream-keepr';
const externalWorktreeRoot = '/Users/dev/.codex/worktrees/a1b2/stream-keepr';
const checkoutRoots = [repositoryRoot, externalWorktreeRoot];
const workerdPath = 'node_modules/.pnpm/@cloudflare+workerd-darwin-arm64@1.0.0/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd';
const workerdBinary = `${repositoryRoot}/${workerdPath}`;

describe('selecting orphaned workerd processes', () => {
	it('selects a workerd whose parent is gone and whose binary lives under the repository', () => {
		const psOutput = `61019     1 ${workerdBinary} serve --binary --experimental --socket-addr=entry=127.0.0.1:49621\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([61019]);
	});

	it('selects an orphan running from a worktree checkout under the repository', () => {
		const worktreeBinary = `${repositoryRoot}/.claude/worktrees/issue-473/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd`;
		const psOutput = `66963     1 ${worktreeBinary} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([66963]);
	});

	it('selects an orphan running from a registered worktree outside the main checkout', () => {
		const psOutput = `70001     1 ${externalWorktreeRoot}/${workerdPath} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([70001]);
	});

	it('selects an orphan whose checkout path contains spaces', () => {
		const spacedRoot = '/Users/dev/My Projects/stream keepr';
		const psOutput = `70002     1 ${spacedRoot}/${workerdPath} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, [spacedRoot])).toEqual([70002]);
	});

	it('leaves an orphan alone whose command only mentions workerd in its arguments', () => {
		const psOutput = `70003     1 ${repositoryRoot}/node_modules/.bin/vitest run ${repositoryRoot}/${workerdPath}\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([]);
	});

	it('leaves a workerd with a live parent alone', () => {
		const psOutput = `61808 61515 ${workerdBinary} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([]);
	});

	it('leaves another repository\'s orphaned workerd alone', () => {
		const psOutput = '50000     1 /Users/dev/other-project/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve\n';

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([]);
	});

	it('leaves an orphan alone in an unregistered checkout sharing a root\'s prefix', () => {
		const psOutput = `50002     1 ${repositoryRoot}-scratch/${workerdPath} serve\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([]);
	});

	it('leaves non-workerd orphans under the repository alone', () => {
		const psOutput = `50001     1 ${repositoryRoot}/node_modules/.bin/vitest run\n`;

		expect(selectOrphanedWorkerd(psOutput, checkoutRoots)).toEqual([]);
	});
});

describe('reaping orphaned workerd processes', () => {
	const psOutput = `61019     1 ${workerdBinary} serve --binary\n`;

	it('terminates each orphan and reports the reaped pids', async () => {
		const signals: Array<[number, string | number]> = [];
		const kill = (pid: number, signal: string | number) => {
			if (signal === 0)
				throw Object.assign(new Error('gone'), { code: 'ESRCH' });
			signals.push([pid, signal]);
		};

		const reaped = await reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep: async () => {} });

		expect(reaped).toEqual([61019]);
		expect(signals).toEqual([[61019, 'SIGTERM']]);
	});

	it('escalates to SIGKILL when an orphan survives SIGTERM', async () => {
		const signals: Array<[number, string | number]> = [];
		const kill = (pid: number, signal: string | number) => {
			if (signal !== 0)
				signals.push([pid, signal]);
		};

		await reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep: async () => {} });

		expect(signals).toEqual([[61019, 'SIGTERM'], [61019, 'SIGKILL']]);
	});

	it('neither reports nor escalates an orphan that exited before it was signalled', async () => {
		const signals: Array<[number, string | number]> = [];
		const kill = (pid: number, signal: string | number) => {
			signals.push([pid, signal]);
			throw Object.assign(new Error('gone'), { code: 'ESRCH' });
		};

		const reaped = await reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep: async () => {} });

		expect(reaped).toEqual([]);
		expect(signals).toEqual([[61019, 'SIGTERM']]);
	});

	it('reaps nothing and skips the grace wait when no orphans exist', async () => {
		let slept = false;

		const reaped = await reapOrphanedWorkerd({
			psOutput: '',
			checkoutRoots,
			kill: () => {},
			sleep: async () => { slept = true; },
		});

		expect(reaped).toEqual([]);
		expect(slept).toBe(false);
	});
});

describe('discovering this repository\'s checkout roots', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	function git(cwd: string, ...args: string[]) {
		execFileSync('git', args, {
			cwd,
			stdio: 'ignore',
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		});
	}

	function repository(path: string) {
		mkdirSync(path, { recursive: true });
		git(path, 'init', '--quiet');
		git(path, 'commit', '--quiet', '--allow-empty', '-m', 'initial');
		return path;
	}

	/** A main checkout with a nested and an external worktree, beside an unrelated repository. */
	function layout() {
		const base = realpathSync(mkdtempSync(join(tmpdir(), 'stream-keepr-reap-')));
		directories.push(base);
		const main = repository(join(base, 'stream keepr'));
		const nested = join(main, '.claude/worktrees/issue-620');
		const external = join(base, 'codex worktrees/a1b2/stream-keepr');
		git(main, 'worktree', 'add', '--quiet', '-b', 'nested', nested);
		git(main, 'worktree', 'add', '--quiet', '-b', 'external', external);
		const unrelated = repository(join(base, 'other project'));
		return { main, nested, external, unrelated };
	}

	it('finds every registered worktree from whichever checkout runs the reap', () => {
		const { main, nested, external } = layout();

		for (const checkout of [main, nested, external])
			expect(discoverCheckoutRoots(checkout).sort()).toEqual([main, nested, external].sort());
	});

	it('leaves out unrelated repositories', () => {
		const { main, unrelated } = layout();

		expect(discoverCheckoutRoots(main)).not.toContain(unrelated);
		expect(discoverCheckoutRoots(unrelated)).toEqual([unrelated]);
	});
});
