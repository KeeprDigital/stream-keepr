/**
 * The `Conventional Commit title` required check (.github/workflows/pr-title.yml).
 *
 * release-please versions from the subjects of main's commits, and a PR lands
 * as one squash commit whose subject is its title (README.md § Releases). A
 * subject that is not a Conventional Commit drops the change from the
 * changelog and the version bump without anyone noticing, so:
 *
 * - **On a PR** (`pull_request`) it checks the PR's title: the feedback, and
 *   what a PR must pass before it can be queued.
 * - **In the merge queue** (`merge_group`) it checks the subject of every
 *   commit between the queue's base and the group's head: the squash commits
 *   the group would land, exactly what release-please will read. A required
 *   check must report on the group's commit too, or the queue would wait on it
 *   until it timed out.
 *
 * Anything it cannot read fails rather than passes.
 *
 *   node scripts/conventional-title.mjs   (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
 *                                          GITHUB_REPOSITORY; `gh` for a merge group)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert', 'style'];
const CONVENTIONAL = new RegExp(`^(?:${TYPES.join('|')})(?:\\([^)]+\\))?!?: \\S`);
const COMMIT_ID = /^[0-9a-f]{40}$/;

/** @param {string} title */
export function isConventionalTitle(title) {
	return CONVENTIONAL.test(title);
}

/**
 * The problems with what this event would land; empty when it passes.
 *
 * @param {string} eventName GITHUB_EVENT_NAME
 * @param {any} event the parsed GITHUB_EVENT_PATH payload
 * @param {(base: string, head: string) => Promise<string[]>} commitMessages every commit message in base..head
 * @returns {Promise<string[]>} one line per problem
 */
export async function checkTitles(eventName, event, commitMessages) {
	if (eventName === 'pull_request') {
		const title = event?.pull_request?.title;
		if (typeof title !== 'string')
			return ['The pull_request event carries no title.'];
		return isConventionalTitle(title) ? [] : [`PR title ${JSON.stringify(title)} is not a Conventional Commit.`];
	}
	if (eventName === 'merge_group') {
		const base = event?.merge_group?.base_sha;
		const head = event?.merge_group?.head_sha;
		if (!COMMIT_ID.test(base ?? '') || !COMMIT_ID.test(head ?? ''))
			return ['The merge_group event names no base and head commit.'];
		const subjects = (await commitMessages(base, head)).map(message => message.split('\n', 1)[0] ?? '');
		if (subjects.length === 0)
			return [`No commits between ${base} and ${head}: nothing shows what the group lands.`];
		return subjects
			.filter(subject => !isConventionalTitle(subject))
			.map(subject => `Commit subject ${JSON.stringify(subject)} is not a Conventional Commit.`);
	}
	return [`No title to check on a ${eventName || 'unknown'} event.`];
}

/**
 * @param {string} base
 * @param {string} head
 */
async function compareViaGitHub(base, head) {
	const comparison = JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/compare/${base}...${head}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
	/** @type {string[]} */
	const messages = comparison.commits.map((/** @type {{ commit: { message: string } }} */ entry) => entry.commit.message);
	// The comparison lists at most 250 commits; a longer one is not all read.
	if (comparison.total_commits !== messages.length)
		throw new Error(`the comparison lists ${messages.length} of ${comparison.total_commits} commits`);
	return messages;
}

async function main() {
	const eventName = process.env.GITHUB_EVENT_NAME ?? '';
	const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
	const problems = await checkTitles(eventName, event, compareViaGitHub);
	if (problems.length === 0) {
		console.log(`Conventional: everything this ${eventName} lands.`);
		return;
	}
	for (const problem of problems)
		console.log(`::error title=Not a Conventional Commit::${problem} Use 'type(scope): summary', e.g. 'fix(export): keep the canvas origin-clean'. Types: ${TYPES.join(', ')}.`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	await main();
