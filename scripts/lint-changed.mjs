/**
 * `pnpm lint:changed` — ESLint over the files this checkout changes.
 *
 * A whole-repository lint builds the TypeScript program for one type-aware
 * rule: 140 s and 3.8 GB on a cold cache, which is what every fresh worktree
 * has. The files a branch touched take about 15 s. CI lints everything cold,
 * and is the backstop for a finding one file's change causes in another
 * (README § Testing).
 *
 * Lints everything after all when the change reaches what decides how every
 * file is linted, when there is nothing to measure against, or when the change
 * is so wide that naming its files saves nothing.
 */

import process from 'node:process';
import { changedFiles } from './changed-files.mjs';
import { runHoldingSlots } from './slots.mjs';

/** Files whose change alters how other files lint. */
const DECIDES_EVERY_FILE = /^(?:eslint\.config\.mjs|package\.json|pnpm-lock\.yaml|nuxt\.config\.ts|tsconfig[^/]*\.json)$/;
const TOO_MANY_TO_NAME = 400;

const ESLINT = [
	'pnpm',
	'exec',
	'eslint',
	'--cache',
	'--cache-strategy',
	'content',
	'--cache-location',
	'node_modules/.cache/eslint/',
];

/**
 * @param {string[] | undefined} changed what `changedFiles()` answered
 * @returns {string[] | 'everything' | 'nothing'} the files to name to ESLint
 */
export function lintTargets(changed) {
	if (!changed || changed.length > TOO_MANY_TO_NAME || changed.some(file => DECIDES_EVERY_FILE.test(file)))
		return 'everything';
	return changed.length === 0
		? 'nothing'
		: changed;
}

if (import.meta.main) {
	const targets = lintTargets(changedFiles());
	if (targets === 'nothing') {
		process.stdout.write('lint:changed: this checkout changes no files\n');
	}
	else {
		process.stdout.write(targets === 'everything'
			? 'lint:changed: linting everything\n'
			: `lint:changed: linting ${targets.length} changed file${targets.length === 1
				? ''
				: 's'}\n`);
		// A changed file ESLint has no configuration for (an image, a migration) is not a finding.
		process.exitCode = await runHoldingSlots('lint', targets === 'everything'
			? [...ESLINT, '.']
			: [
					...ESLINT,
					'--no-warn-ignored',
					...targets,
				]);
	}
}
