/**
 * What this checkout changes: every file that differs from where the branch
 * left `main`, committed or not, and every untracked file.
 *
 * `pnpm verify:quick` checks a change in proportion to it (README § Testing):
 * it lints these files and runs the tests whose imports reach them. CI is the
 * full gate, so nothing here has to be exhaustive; it has to be fast, and never
 * to leave out a file the branch touched.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

/** Where a branch is measured from, in order of preference. */
const MAIN_REFS = ['origin/main', 'main'];

function gitIn(cwd) {
	return args => execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});
}

/**
 * The ref this branch is measured against: the first of `origin/main` and
 * `main` it shares history with. A stale `origin/main` only widens the answer,
 * since the comparison is against the commit the two have in common.
 *
 * @returns {{ ref: string, commit: string } | undefined} `undefined` when there is no such ref
 */
export function changeBase({ cwd = repositoryRoot, git = gitIn(cwd) } = {}) {
	for (const ref of MAIN_REFS) {
		try {
			return {
				ref,
				commit: git(['merge-base', 'HEAD', ref]).trim(),
			};
		}
		catch {
			// No such ref, or no history in common: try the next.
		}
	}
	return undefined;
}

/**
 * @returns {string[] | undefined} repository-relative paths that exist, or `undefined` when there is nothing to measure against
 */
export function changedFiles({ cwd = repositoryRoot, git = gitIn(cwd) } = {}) {
	const base = changeBase({ cwd, git });
	if (!base)
		return undefined;
	const list = output => output.split('\0').filter(Boolean);
	return [
		...new Set([
			// The working tree against the base: commits, staged and unstaged edits alike.
			...list(git([
				'diff',
				'--name-only',
				'-z',
				'--diff-filter=d',
				base.commit,
			])),
			...list(git([
				'ls-files',
				'-z',
				'--others',
				'--exclude-standard',
			])),
		]),
	].filter(file => existsSync(join(cwd, file)));
}
