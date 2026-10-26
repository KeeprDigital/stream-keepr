import { describe, expect, it } from 'vitest';
import { checkTitles, isConventionalTitle } from '../../../scripts/conventional-title.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const group = {
	merge_group: { base_sha: BASE, head_sha: HEAD },
};

describe('a Conventional Commit title', () => {
	it.each([
		'fix(export): keep the canvas origin-clean',
		'feat!: drop the legacy screen',
		'ci: verify the exact combined tree through the merge queue (#615)',
		'chore(main): release 1.5.0',
		// The squash commit a queue lands: the PR title plus its number.
		'chore(main): release 1.5.0 (#573)',
	])('accepts %s', (title) => {
		expect(isConventionalTitle(title)).toBe(true);
	});

	it.each([
		'Fix the canvas',
		'fix:no space',
		'fix(export) keep it',
		'feature: not a type',
		'Merge pull request #1 from someone/branch',
		'',
	])('refuses %j', (title) => {
		expect(isConventionalTitle(title)).toBe(false);
	});
});

describe('what the check reads for each event', () => {
	const noCompare = async () => {
		throw new Error('a PR is checked from its own payload');
	};

	it('a PR: its title', async () => {
		await expect(checkTitles('pull_request', {
			pull_request: { title: 'fix(screen): hold the slug' },
		}, noCompare)).resolves.toEqual([]);
		await expect(checkTitles('pull_request', {
			pull_request: { title: 'Hold the slug' },
		}, noCompare)).resolves.toEqual([
			'PR title "Hold the slug" is not a Conventional Commit.',
		]);
	});

	it('a merge group: the subject of every commit the group lands, which is what release-please reads', async () => {
		const asked: string[][] = [];
		const compare = async (base: string, head: string) => {
			asked.push([base, head]);
			return ['fix(screen): hold the slug (#1)\n\nBody text: not a title.', 'Update README.md (#2)'];
		};

		await expect(checkTitles('merge_group', group, compare)).resolves.toEqual([
			'Commit subject "Update README.md (#2)" is not a Conventional Commit.',
		]);
		expect(asked).toEqual([
			[BASE, HEAD],
		]);
	});

	it('a merge group of conventional squash commits passes', async () => {
		await expect(checkTitles('merge_group', group, async () => ['fix(a): one (#1)', 'docs: two (#2)'])).resolves.toEqual([]);
	});

	it('fails what it cannot read rather than passing it', async () => {
		await expect(checkTitles('merge_group', group, async () => [])).resolves.toEqual([
			`No commits between ${BASE} and ${HEAD}: nothing shows what the group lands.`,
		]);
		await expect(checkTitles('merge_group', {
			merge_group: { head_sha: HEAD },
		}, noCompare)).resolves.toEqual([
			'The merge_group event names no base and head commit.',
		]);
		await expect(checkTitles('push', {}, noCompare)).resolves.toEqual(['No title to check on a push event.']);
		await expect(checkTitles('pull_request', { pull_request: {} }, noCompare)).resolves.toEqual(['The pull_request event carries no title.']);
	});
});
