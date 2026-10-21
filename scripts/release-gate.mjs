/**
 * The release gate (.github/workflows/release-please.yml): release-please cuts
 * a release only from a revision the merge queue verified (ADR-0036).
 *
 * release-please tags a merged Release PR's merge commit, and it finds the
 * ones still to tag by their `autorelease: pending` label. Through the merge
 * queue, that merge commit is the merge group's head: the exact tree CI ran
 * on before it landed, as a `merge_group` run on that commit id. A Release PR
 * merged any other way (a ruleset bypass) landed a tree nothing verified, so
 * this refuses before release-please runs, and no tag, GitHub Release or
 * Deploy candidate is made from it.
 *
 * It refuses only while such a release is pending. With none pending,
 * release-please just refreshes the Release PR.
 *
 *   node scripts/release-gate.mjs   (reads GITHUB_REPOSITORY, GITHUB_REF_NAME; uses `gh`)
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CI_WORKFLOW = '.github/workflows/ci.yml';
/** Two minutes of 10s reads: far longer than a finished run takes to conclude. */
const DEFAULT_ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;

/** @param {number} ms */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @typedef {{ number: number, mergeCommit: string | null }} PendingRelease
 * @typedef {{ event: string, path: string, head_sha: string, conclusion: string | null }} WorkflowRun
 */

/**
 * The problems with releasing what is pending; empty when every pending
 * release's commit passed CI in the merge queue.
 *
 * The queue merges once the `CI passed` check succeeds, a moment before its
 * workflow run concludes, so a merge-group CI run on the commit that is still
 * going is waited for, up to `attempts` reads.
 *
 * @param {readonly PendingRelease[]} pending merged Release PRs labelled `autorelease: pending`
 * @param {(sha: string) => Promise<readonly WorkflowRun[]>} runsFor the workflow runs on a commit
 * @param {{ attempts?: number, wait?: (ms: number) => Promise<void> }} [options] how long to wait for an unfinished run
 * @returns {Promise<string[]>} one line per refused release
 */
export async function checkPendingReleases(pending, runsFor, { attempts = DEFAULT_ATTEMPTS, wait = sleep } = {}) {
	/** @type {string[]} */
	const problems = [];
	for (const { number, mergeCommit } of pending) {
		if (!mergeCommit) {
			problems.push(`Release PR #${number} has no merge commit to verify.`);
			continue;
		}
		let verified = false;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			const queueRuns = (await runsFor(mergeCommit)).filter(run => run.event === 'merge_group'
				&& run.path === CI_WORKFLOW
				&& run.head_sha === mergeCommit);
			verified = queueRuns.some(run => run.conclusion === 'success');
			if (verified || !queueRuns.some(run => run.conclusion === null) || attempt === attempts)
				break;
			await wait(RETRY_DELAY_MS);
		}
		if (!verified)
			problems.push(`Release PR #${number} landed as ${mergeCommit}, which no successful merge-queue CI run verified.`);
	}
	return problems;
}

/** @param {string[]} args */
function gh(args) {
	return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

async function main() {
	const repository = process.env.GITHUB_REPOSITORY ?? '';
	const branch = process.env.GITHUB_REF_NAME ?? 'main';
	/** @type {{ number: number, mergeCommit: { oid: string } | null }[]} */
	const merged = gh(['pr', 'list', '--repo', repository, '--base', branch, '--state', 'merged', '--label', 'autorelease: pending', '--limit', '100', '--json', 'number,mergeCommit']);
	const pending = merged.map(pr => ({ number: pr.number, mergeCommit: pr.mergeCommit?.oid ?? null }));
	const problems = await checkPendingReleases(pending, async sha => gh(['api', `repos/${repository}/actions/runs?head_sha=${sha}&event=merge_group&per_page=100`]).workflow_runs);
	if (problems.length === 0) {
		console.log(pending.length === 0
			? 'No merged Release PR is waiting for its tag.'
			: `Pending release${pending.length > 1 ? 's' : ''} ${pending.map(pr => `#${pr.number}`).join(', ')} passed CI in the merge queue.`);
		return;
	}
	for (const problem of problems)
		console.log(`::error title=Release refused::${problem} Releases are cut only from a revision the merge queue verified (README.md § Releases).`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	await main();
