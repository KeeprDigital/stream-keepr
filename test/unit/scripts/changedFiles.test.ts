import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles } from '../../../scripts/changed-files.mjs';
import { lintTargets } from '../../../scripts/lint-changed.mjs';

/** Against real git: a local "origin" and a clone of it on a branch. Nothing remote. */
describe('what a checkout changes', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
		}).trim();
	}

	function write(cwd: string, file: string, content: string) {
		mkdirSync(join(cwd, dirname(file)), { recursive: true });
		writeFileSync(join(cwd, file), content);
	}

	function commit(cwd: string, file: string, message: string) {
		write(cwd, file, `${message}\n`);
		git(cwd, 'add', '.');
		git(cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', message);
	}

	function repository(prefix: string) {
		const directory = mkdtempSync(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}

	/** A branch off `main` in a clone, with `main` having moved on at the origin since. */
	function branchOffMain() {
		const origin = repository('changed-files-origin-');
		git(origin, 'init', '-q', '-b', 'main');
		commit(origin, 'server/kept.ts', 'chore: the base');
		commit(origin, 'server/removed.ts', 'chore: a file the branch deletes');
		const checkout = repository('changed-files-checkout-');
		git(checkout, 'clone', '-q', `file://${origin}`, '.');
		git(checkout, 'switch', '-q', '-c', 'fix/branch');
		commit(origin, 'docs/later.md', 'docs: main moves on');
		git(checkout, 'fetch', '-q', 'origin');
		return checkout;
	}

	it('names what the branch committed, edited and added, and nothing main changed since or the branch deleted', () => {
		const checkout = branchOffMain();
		commit(checkout, 'app/committed.vue', 'fix: a committed change');
		write(checkout, 'server/kept.ts', 'an unstaged edit\n');
		write(checkout, 'test/unit/untracked.test.ts', 'an untracked file\n');
		rmSync(join(checkout, 'server/removed.ts'));

		expect(changedFiles({ cwd: checkout })?.toSorted()).toEqual([
			'app/committed.vue',
			'server/kept.ts',
			'test/unit/untracked.test.ts',
		]);
	});

	it('names nothing for a branch that has changed nothing', () => {
		expect(changedFiles({
			cwd: branchOffMain(),
		})).toEqual([]);
	});

	it('cannot tell where there is no main to measure from', () => {
		const alone = repository('changed-files-alone-');
		git(alone, 'init', '-q', '-b', 'work');
		commit(alone, 'README.md', 'chore: no main anywhere');

		expect(changedFiles({ cwd: alone })).toBeUndefined();
	});
});

describe('what `pnpm lint:changed` lints', () => {
	it.each([
		{
			change: 'the files a branch changed',
			changed: ['app/a.vue', 'server/b.ts'],
			lints: ['app/a.vue', 'server/b.ts'],
		},
		{ change: 'nothing, for a branch that changed nothing', changed: [], lints: 'nothing' },
		{ change: 'everything when it cannot tell what changed', changed: undefined, lints: 'everything' },
		{
			change: 'everything when the ESLint config changed',
			changed: ['app/a.vue', 'eslint.config.mjs'],
			lints: 'everything',
		},
		{
			change: 'everything when a dependency changed',
			changed: ['package.json'],
			lints: 'everything',
		},
		{
			change: 'everything when a typecheck program changed',
			changed: ['tsconfig.test.json'],
			lints: 'everything',
		},
		{
			change: 'a nested package.json as an ordinary file',
			changed: ['workers/silent-video-validator/package.json'],
			lints: ['workers/silent-video-validator/package.json'],
		},
	])('$change', ({ changed, lints }) => {
		expect(lintTargets(changed)).toEqual(lints);
	});

	it('lints everything once naming the files would save nothing', () => {
		const wide = Array.from({ length: 401 }, (_, index) => `app/file-${index}.ts`);

		expect(lintTargets(wide.slice(0, 400))).toHaveLength(400);
		expect(lintTargets(wide)).toBe('everything');
	});
});
