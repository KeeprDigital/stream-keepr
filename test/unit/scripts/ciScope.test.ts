import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { diffRange, scopeOf } from '../../../scripts/ci-scope.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

const EVERYTHING = { code: true, bundle: true };

describe('what a change can affect', () => {
	it.each([
		['docs only', ['README.md', 'DECISIONS.md'], { code: false, bundle: false }],
		['editor settings and dependabot', ['.vscode/settings.json', '.github/dependabot.yml'], { code: false, bundle: false }],
		// Each is held by wiring tests, which run only if CI does.
		['another workflow', ['.github/workflows/deploy.yml', '.github/workflows/pr-title.yml', '.github/workflows/release-please.yml'], { code: true, bundle: false }],
		['tests only', ['test/unit/scripts/ciScope.test.ts', 'README.md'], { code: true, bundle: false }],
		['server code', ['server/api/time.get.ts'], EVERYTHING],
		['a script', ['scripts/ci-scope.mjs'], EVERYTHING],
		['CI itself', ['.github/workflows/ci.yml'], EVERYTHING],
		['the shared setup action', ['.github/actions/setup/action.yml'], EVERYTHING],
		['the version bump of a Release PR', ['CHANGELOG.md', 'package.json', '.release-please-manifest.json'], EVERYTHING],
	])('%s', (_case, files, expected) => {
		expect(scopeOf(files)).toEqual(expected);
	});

	it('runs everything when it cannot tell what changed', () => {
		expect(scopeOf([])).toEqual(EVERYTHING);
	});
});

describe('which revisions the change is measured between', () => {
	it('a PR: its test merge commit against that commit\'s first parent, the base', () => {
		expect(diffRange('pull_request', { pull_request: { draft: false } })).toEqual({ base: 'HEAD^1', head: 'HEAD' });
	});

	it('a merge group: the queue\'s base against the combined tree it would land, never HEAD^1', () => {
		// A group of several squashed PRs has one commit per PR above its base, so
		// HEAD^1 would measure only the last of them.
		const event = { merge_group: { base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), head_ref: 'refs/heads/gh-readonly-queue/main/pr-1-x', base_ref: 'refs/heads/main' } };

		expect(diffRange('merge_group', event)).toEqual({ base: 'a'.repeat(40), head: 'b'.repeat(40), fetch: 'a'.repeat(40) });
	});

	it.each([
		['a merge group without a base', 'merge_group', { merge_group: { head_sha: 'b'.repeat(40) } }],
		['a merge group whose base is not a commit id', 'merge_group', { merge_group: { base_sha: 'main; rm -rf /', head_sha: 'b'.repeat(40) } }],
		['a push', 'push', { after: 'b'.repeat(40) }],
		['a manual run', 'workflow_dispatch', {}],
	])('nothing to measure against for %s: run everything', (_case, eventName, event) => {
		expect(diffRange(eventName, event)).toBeUndefined();
	});
});

/**
 * The command line against real git: a local "origin" and a checkout shaped
 * like CI's (`fetch-depth: 2` of the event's revision). Nothing remote.
 */
describe('the scope job\'s command line', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
	}

	function commit(cwd: string, file: string, message: string) {
		mkdirSync(join(cwd, dirname(file)), { recursive: true });
		writeFileSync(join(cwd, file), `${message}\n`);
		git(cwd, 'add', '.');
		git(cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', message);
		return git(cwd, 'rev-parse', 'HEAD');
	}

	/** A main revision with a merge group of two squashed PRs above it. */
	function mergeGroup(firstFile: string, secondFile: string) {
		const origin = mkdtempSync(join(tmpdir(), 'ci-scope-origin-'));
		directories.push(origin);
		git(origin, 'init', '-q', '-b', 'main');
		commit(origin, 'README.md', 'chore: the base');
		const base = commit(origin, 'docs/notes.md', 'docs: main moves on');
		commit(origin, firstFile, 'fix(server): the first queued PR');
		const head = commit(origin, secondFile, 'docs: the second queued PR');

		const checkout = mkdtempSync(join(tmpdir(), 'ci-scope-checkout-'));
		directories.push(checkout);
		git(checkout, 'init', '-q');
		git(checkout, 'remote', 'add', 'origin', `file://${origin}`);
		git(checkout, 'fetch', '-q', '--no-tags', '--depth=2', 'origin', head);
		git(checkout, 'checkout', '-q', head);
		return { checkout, base, head };
	}

	function scope(cwd: string, eventName: string, event: unknown) {
		const eventPath = join(cwd, '..', `${cwd.split('/').at(-1)}-event.json`);
		const output = join(cwd, '..', `${cwd.split('/').at(-1)}-output`);
		directories.push(eventPath, output);
		writeFileSync(eventPath, JSON.stringify(event));
		writeFileSync(output, '');
		const result = spawnSync(process.execPath, [join(repositoryRoot, 'scripts/ci-scope.mjs')], {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
		});
		expect(result.status, result.stderr).toBe(0);
		return readFileSync(output, 'utf8');
	}

	it('a merge group whose last PR is docs-only still runs the gates its first PR needs', () => {
		const { checkout, base, head } = mergeGroup('server/api/time.get.ts', 'docs/second.md');

		expect(scope(checkout, 'merge_group', { merge_group: { base_sha: base, head_sha: head } })).toBe('code=true\nbundle=true\n');
	});

	it('a merge group of docs-only PRs skips them', () => {
		const { checkout, base, head } = mergeGroup('docs/first.md', 'docs/second.md');

		expect(scope(checkout, 'merge_group', { merge_group: { base_sha: base, head_sha: head } })).toBe('code=false\nbundle=false\n');
	});

	it('a base it cannot fetch runs everything', () => {
		const { checkout, head } = mergeGroup('docs/first.md', 'docs/second.md');

		expect(scope(checkout, 'merge_group', { merge_group: { base_sha: 'f'.repeat(40), head_sha: head } })).toBe('code=true\nbundle=true\n');
	});
});
