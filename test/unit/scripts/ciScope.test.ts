import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffRange, scopeOf } from '../../../scripts/ci-scope.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

const EVERYTHING = { code: true, bundle: true, docs: false };

describe('what a change can affect', () => {
	it.each([
		[
			'docs only',
			['README.md', 'DECISIONS.md'],
			{ code: false, bundle: false, docs: true },
		],
		[
			'editor settings and dependabot',
			['.vscode/settings.json', '.github/dependabot.yml'],
			{ code: false, bundle: false, docs: false },
		],
		[
			'docs beside editor settings',
			['.vscode/settings.json', 'docs/notes.md'],
			{ code: false, bundle: false, docs: true },
		],
		// Each is held by wiring tests, which run only if CI does.
		[
			'another workflow',
			['.github/workflows/deploy.yml', '.github/workflows/pr-title.yml', '.github/workflows/release-please.yml'],
			{ code: true, bundle: false, docs: false },
		],
		// The code gates lint every document and run the documentation test themselves.
		[
			'tests and docs',
			['test/unit/scripts/ciScope.test.ts', 'README.md'],
			{ code: true, bundle: false, docs: false },
		],
		[
			'server code',
			['server/api/time.get.ts'],
			EVERYTHING,
		],
		[
			'a script',
			['scripts/ci-scope.mjs'],
			EVERYTHING,
		],
		[
			'CI itself',
			['.github/workflows/ci.yml'],
			EVERYTHING,
		],
		[
			'the shared setup action',
			['.github/actions/setup/action.yml'],
			EVERYTHING,
		],
		[
			'the version bump of a Release PR',
			['CHANGELOG.md', 'package.json', '.release-please-manifest.json'],
			EVERYTHING,
		],
	])('%s', (_case, files, expected) => {
		expect(scopeOf(files)).toEqual(expected);
	});

	it('runs everything when it cannot tell what changed', () => {
		expect(scopeOf([])).toEqual(EVERYTHING);
	});
});

describe('which revisions the change is measured between', () => {
	it('a PR: its test merge commit against that commit\'s first parent, the base', () => {
		expect(diffRange('pull_request', {
			pull_request: { draft: false },
		})).toEqual({ base: 'HEAD^1', head: 'HEAD' });
	});

	it('a merge group: the queue\'s base against the combined tree it would land, never HEAD^1', () => {
		// A group of several squashed PRs has one commit per PR above its base, so
		// HEAD^1 would measure only the last of them.
		const event = {
			merge_group: {
				base_sha: 'a'.repeat(40),
				head_sha: 'b'.repeat(40),
				head_ref: 'refs/heads/gh-readonly-queue/main/pr-1-x',
				base_ref: 'refs/heads/main',
			},
		};

		expect(diffRange('merge_group', event)).toEqual({
			base: 'a'.repeat(40),
			head: 'b'.repeat(40),
			fetch: 'a'.repeat(40),
		});
	});

	it.each([
		[
			'a merge group without a base',
			'merge_group',
			{
				merge_group: {
					head_sha: 'b'.repeat(40),
				},
			},
		],
		[
			'a merge group whose base is not a commit id',
			'merge_group',
			{
				merge_group: {
					base_sha: 'main; rm -rf /',
					head_sha: 'b'.repeat(40),
				},
			},
		],
		[
			'a push',
			'push',
			{
				after: 'b'.repeat(40),
			},
		],
		['a manual run', 'workflow_dispatch', {}],
	])('nothing to measure against for %s: run everything', (_case, eventName, event) => {
		expect(diffRange(eventName, event)).toBeUndefined();
	});
});

/**
 * The command line against real git: a local "origin" and a checkout shaped
 * like CI's (`fetch-depth: 2` of the event's revision), copied for each case
 * because the command fetches into it. Nothing remote.
 */
describe('the scope job\'s command line', () => {
	/** The two squashed PRs each merge group queues above main, by the file each changes. */
	const QUEUED = {
		codeThenDocs: ['server/api/time.get.ts', 'docs/second.md'],
		docsOnly: ['docs/first.md', 'docs/second.md'],
	} as const;

	let workspace: string;
	/** Per group: the main revision it lands on, its head, and its checkout as first fetched. */
	let groups: Record<keyof typeof QUEUED, { base: string; head: string; pristine: string }>;

	const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();
	}

	/** A `git fast-import` commit adding `file` to `branch`, which forks from `from` when new. */
	function commit(branch: string, file: string, message: string, from?: string) {
		return [
			`commit refs/heads/${branch}`,
			'committer test <test@example.invalid> 1700000000 +0000',
			'data <<END',
			message,
			'END',
			...(from
				? [`from refs/heads/${from}`]
				: []),
			`M 100644 inline ${file}`,
			'data <<END',
			message,
			'END',
			'',
		].join('\n');
	}

	/** A checkout as `actions/checkout` leaves it: `head` and its parent, the base further back. */
	function shallowCheckout(origin: string, head: string, checkout: string) {
		git(workspace, 'init', '-q', checkout);
		git(checkout, 'remote', 'add', 'origin', `file://${origin}`);
		git(checkout, 'fetch', '-q', '--no-tags', '--depth=2', 'origin', head);
		git(checkout, 'checkout', '-q', head);
		return checkout;
	}

	beforeAll(() => {
		workspace = mkdtempSync(join(tmpdir(), 'ci-scope-'));
		const origin = join(workspace, 'origin');
		git(workspace, 'init', '-q', '--bare', '-b', 'main', origin);
		// One git process writes main and both queues above it.
		execFileSync('git', ['fast-import', '--quiet'], {
			cwd: origin,
			env: gitEnv,
			input: [
				commit('main', 'README.md', 'chore: the base'),
				commit('main', 'docs/notes.md', 'docs: main moves on'),
				...Object.entries(QUEUED).flatMap(([group, [first, second]]) => [
					commit(`queue/${group}`, first, 'fix(server): the first queued PR', 'main'),
					commit(`queue/${group}`, second, 'docs: the second queued PR'),
				]),
			].join('\n'),
		});
		const [base, codeThenDocs, docsOnly] = git(origin, 'rev-parse', 'main', 'queue/codeThenDocs', 'queue/docsOnly').split('\n') as [string, string, string];
		groups = {
			codeThenDocs: {
				base,
				head: codeThenDocs,
				pristine: shallowCheckout(origin, codeThenDocs, join(workspace, 'codeThenDocs')),
			},
			docsOnly: {
				base,
				head: docsOnly,
				pristine: shallowCheckout(origin, docsOnly, join(workspace, 'docsOnly')),
			},
		};
	});

	afterAll(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	/** A main revision with a merge group of two squashed PRs above it, in a checkout of this case's own. */
	function mergeGroup(group: keyof typeof QUEUED) {
		const { base, head, pristine } = groups[group];
		const checkout = join(mkdtempSync(join(workspace, 'job-')), 'checkout');
		cpSync(pristine, checkout, { recursive: true });
		return { checkout, base, head };
	}

	/** No GitHub to read unless a case supplies one: CI's own test jobs carry GITHUB_REPOSITORY. */
	const offline = { GH_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_REPOSITORY_ID: '' };

	function scope(cwd: string, eventName: string, event: unknown, env: Record<string, string> = offline) {
		const eventPath = join(dirname(cwd), 'event.json');
		const output = join(dirname(cwd), 'output');
		writeFileSync(eventPath, JSON.stringify(event));
		writeFileSync(output, '');
		const result = spawnSync(process.execPath, [
			join(repositoryRoot, 'scripts/ci-scope.mjs'),
		], {
			cwd,
			encoding: 'utf8',
			env: {
				...process.env,
				...env,
				GITHUB_EVENT_NAME: eventName,
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_OUTPUT: output,
				GIT_CONFIG_GLOBAL: '/dev/null',
				GIT_CONFIG_NOSYSTEM: '1',
			},
		});
		expect(result.status, result.stderr).toBe(0);
		return {
			output: readFileSync(output, 'utf8'),
			log: result.stdout,
		};
	}

	it('a merge group that cannot read GitHub for a PR run\'s record is scoped as usual, never skipped', () => {
		const { checkout, base, head } = mergeGroup('codeThenDocs');
		const bin = join(dirname(checkout), 'bin');
		mkdirSync(bin);
		writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n', { mode: 0o755 });

		const { output, log } = scope(checkout, 'merge_group', {
			merge_group: { base_sha: base, head_sha: head },
		}, {
			GH_TOKEN: 'test-token',
			GITHUB_REPOSITORY: 'KeeprDigital/stream-keepr',
			GITHUB_REPOSITORY_ID: '1',
			PATH: `${bin}:${process.env.PATH}`,
		});

		expect(output).toBe('code=true\nbundle=true\ndocs=false\n');
		expect(log).toMatch(/Could not list the records.*HTTP 502/);
		expect(log).toMatch(/running the gates/);
	});

	it('a merge group whose last PR is docs-only still runs the gates its first PR needs', () => {
		const { checkout, base, head } = mergeGroup('codeThenDocs');

		expect(scope(checkout, 'merge_group', {
			merge_group: { base_sha: base, head_sha: head },
		}).output).toBe('code=true\nbundle=true\ndocs=false\n');
	});

	it('a merge group of docs-only PRs skips the code gates and checks the docs', () => {
		const { checkout, base, head } = mergeGroup('docsOnly');

		expect(scope(checkout, 'merge_group', {
			merge_group: { base_sha: base, head_sha: head },
		}).output).toBe('code=false\nbundle=false\ndocs=true\n');
	});

	it('a base it cannot fetch runs everything', () => {
		const { checkout, head } = mergeGroup('docsOnly');

		expect(scope(checkout, 'merge_group', {
			merge_group: {
				base_sha: 'f'.repeat(40),
				head_sha: head,
			},
		}).output).toBe('code=true\nbundle=true\ndocs=false\n');
	});
});
