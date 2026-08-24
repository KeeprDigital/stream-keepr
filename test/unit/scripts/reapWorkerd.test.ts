import { describe, expect, it } from 'vitest';
import { reapOrphanedWorkerd, selectOrphanedWorkerd } from '../../../scripts/reap-workerd.mjs';

const repositoryRoot = '/Users/dev/stream-keepr';
const workerdBinary = `${repositoryRoot}/node_modules/.pnpm/@cloudflare+workerd-darwin-arm64@1.0.0/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd`;

describe('selecting orphaned workerd processes', () => {
	it('selects a workerd whose parent is gone and whose binary lives under the repository', () => {
		const psOutput = `61019     1 ${workerdBinary} serve --binary --experimental --socket-addr=entry=127.0.0.1:49621\n`;

		expect(selectOrphanedWorkerd(psOutput, repositoryRoot)).toEqual([61019]);
	});

	it('selects an orphan running from a worktree checkout under the repository', () => {
		const worktreeBinary = `${repositoryRoot}/.claude/worktrees/issue-473/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd`;
		const psOutput = `66963     1 ${worktreeBinary} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, repositoryRoot)).toEqual([66963]);
	});

	it('leaves a workerd with a live parent alone', () => {
		const psOutput = `61808 61515 ${workerdBinary} serve --binary\n`;

		expect(selectOrphanedWorkerd(psOutput, repositoryRoot)).toEqual([]);
	});

	it('leaves another repository\'s orphaned workerd alone', () => {
		const psOutput = '50000     1 /Users/dev/other-project/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve\n';

		expect(selectOrphanedWorkerd(psOutput, repositoryRoot)).toEqual([]);
	});

	it('leaves non-workerd orphans under the repository alone', () => {
		const psOutput = `50001     1 ${repositoryRoot}/node_modules/.bin/vitest run\n`;

		expect(selectOrphanedWorkerd(psOutput, repositoryRoot)).toEqual([]);
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

		const reaped = await reapOrphanedWorkerd({ psOutput, repositoryRoot, kill, sleep: async () => {} });

		expect(reaped).toEqual([61019]);
		expect(signals).toEqual([[61019, 'SIGTERM']]);
	});

	it('escalates to SIGKILL when an orphan survives SIGTERM', async () => {
		const signals: Array<[number, string | number]> = [];
		const kill = (pid: number, signal: string | number) => {
			if (signal !== 0)
				signals.push([pid, signal]);
		};

		await reapOrphanedWorkerd({ psOutput, repositoryRoot, kill, sleep: async () => {} });

		expect(signals).toEqual([[61019, 'SIGTERM'], [61019, 'SIGKILL']]);
	});

	it('reaps nothing and skips the grace wait when no orphans exist', async () => {
		let slept = false;

		const reaped = await reapOrphanedWorkerd({
			psOutput: '',
			repositoryRoot,
			kill: () => {},
			sleep: async () => { slept = true; },
		});

		expect(reaped).toEqual([]);
		expect(slept).toBe(false);
	});
});
