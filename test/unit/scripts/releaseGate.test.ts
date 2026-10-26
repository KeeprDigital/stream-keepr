import { describe, expect, it } from 'vitest';
import { checkPendingReleases } from '../../../scripts/release-gate.mjs';

const RELEASE_COMMIT = 'c'.repeat(40);

interface Run { event: string; path: string; head_sha: string; conclusion: string | null }

function ciRun(overrides: Partial<Run> = {}): Run {
	return {
		event: 'merge_group',
		path: '.github/workflows/ci.yml',
		head_sha: RELEASE_COMMIT,
		conclusion: 'success',
		...overrides,
	};
}

function runsFor(runs: Run[]) {
	return async (sha: string) => runs.filter(run => run.head_sha === sha);
}

const pending = [
	{ number: 573, mergeCommit: RELEASE_COMMIT },
];

describe('a release is cut only from a revision the merge queue verified', () => {
	it('no merged Release PR waiting for its tag: nothing to release, nothing to refuse', async () => {
		await expect(checkPendingReleases([], runsFor([]))).resolves.toEqual([]);
	});

	it('releases a Release PR whose merge commit passed CI as a merge group', async () => {
		await expect(checkPendingReleases(pending, runsFor([
			ciRun({ event: 'pull_request', conclusion: 'failure' }),
			ciRun(),
		]))).resolves.toEqual([]);
	});

	it.each<[string, Run[]]>([
		['it landed outside the queue: no merge-group run tested it', []],
		[
			'only its PR runs passed, which tested a different tree',
			[
				ciRun({ event: 'pull_request' }),
			],
		],
		[
			'its merge-group run failed',
			[
				ciRun({ conclusion: 'failure' }),
			],
		],
		[
			'its merge-group run was cancelled',
			[
				ciRun({ conclusion: 'cancelled' }),
			],
		],
		[
			'the passing merge-group run is another workflow\'s',
			[
				ciRun({ path: '.github/workflows/pr-title.yml' }),
			],
		],
		[
			'the passing merge-group run tested another commit',
			[
				ciRun({
					head_sha: 'd'.repeat(40),
				}),
			],
		],
	])('refuses when %s', async (_case, runs) => {
		await expect(checkPendingReleases(pending, runsFor(runs))).resolves.toEqual([
			`Release PR #573 landed as ${RELEASE_COMMIT}, which no successful merge-queue CI run verified.`,
		]);
	});

	it('waits for a merge-group run still finishing: the queue merges on the check, a moment before the run concludes', async () => {
		const answers = [
			[
				ciRun({ conclusion: null }),
			],
			[
				ciRun({ conclusion: null }),
			],
			[
				ciRun(),
			],
		];
		const waits: number[] = [];
		const wait = async (ms: number) => {
			waits.push(ms);
		};

		await expect(checkPendingReleases(pending, async () => answers.shift()!, { attempts: 5, wait })).resolves.toEqual([]);
		expect(waits).toHaveLength(2);
	});

	it('gives up on a merge-group run that never concludes', async () => {
		let asked = 0;
		const unfinished = async () => {
			asked += 1;
			return [
				ciRun({ conclusion: null }),
			];
		};

		await expect(checkPendingReleases(pending, unfinished, {
			attempts: 3,
			wait: async () => {},
		})).resolves.toEqual([
			`Release PR #573 landed as ${RELEASE_COMMIT}, which no successful merge-queue CI run verified.`,
		]);
		expect(asked).toBe(3);
	});

	it('does not wait when no merge-group run is still going', async () => {
		let asked = 0;
		const failed = async () => {
			asked += 1;
			return [
				ciRun({ conclusion: 'failure' }),
			];
		};

		await checkPendingReleases(pending, failed, {
			attempts: 3,
			wait: async () => {},
		});
		expect(asked).toBe(1);
	});

	it('refuses a Release PR it cannot find the merge commit of', async () => {
		await expect(checkPendingReleases([
			{ number: 573, mergeCommit: null },
		], runsFor([
			ciRun(),
		]))).resolves.toEqual([
			'Release PR #573 has no merge commit to verify.',
		]);
	});

	it('names each unverified one when several wait', async () => {
		const other = 'e'.repeat(40);

		await expect(checkPendingReleases([
			...pending,
			{ number: 580, mergeCommit: other },
		], runsFor([
			ciRun(),
		]))).resolves.toEqual([
			`Release PR #580 landed as ${other}, which no successful merge-queue CI run verified.`,
		]);
	});
});
