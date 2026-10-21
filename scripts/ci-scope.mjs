/**
 * CI's `scope` job ("Decide what the change can affect"): which of CI's jobs
 * a change can affect, so a docs-only change skips the gates and a tests-only
 * change skips the Worker build (.github/workflows/ci.yml).
 *
 * A skipped gate is only safe when what it would have checked is unchanged
 * from a revision that already passed it, so the change is always measured
 * against the revision it lands on (ADR-0036):
 *
 * - **A PR** (`pull_request`): its test merge commit against that commit's
 *   first parent, the base branch's tip. This is PR feedback; the queue's
 *   run is what lands.
 * - **A merge group** (`merge_group`): the queue's base, the main revision the
 *   group lands on, against the group's head, the exact tree that lands. Not
 *   `HEAD^1`: a group holding several squashed PRs has one commit per PR above
 *   its base, so the first parent would measure only the last of them.
 *
 * Anything it cannot tell runs everything: another event, a malformed event,
 * a failed fetch or diff, an empty diff.
 *
 *   node scripts/ci-scope.mjs   (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH;
 *                                appends code= and bundle= to GITHUB_OUTPUT)
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Docs, editor settings and Dependabot's config. Every workflow is code: each
 * is held by unit tests of its wiring (ciWorkflows.test.ts,
 * deployPromotion.test.ts), which only run if CI does.
 */
const OUTSIDE_CODE = /\.md$|^\.vscode\/|^\.github\/dependabot\.yml$/;
/**
 * Neither a test, a workflow other than CI's own, nor anything outside the
 * code can change the uploaded Worker bundle or how CI builds it.
 */
const OUTSIDE_BUNDLE = /^test\/|^\.github\/workflows\/(?:deploy|pr-title|release-please)\.yml$/;

const COMMIT_ID = /^[0-9a-f]{40}$/;

/**
 * @param {readonly string[]} changedFiles repository-relative paths
 * @returns {{ code: boolean, bundle: boolean }} whether any file can affect the code gates, and the Worker bundle
 */
export function scopeOf(changedFiles) {
	if (changedFiles.length === 0)
		return { code: true, bundle: true };
	const code = changedFiles.some(file => !OUTSIDE_CODE.test(file));
	const bundle = changedFiles.some(file => !OUTSIDE_CODE.test(file) && !OUTSIDE_BUNDLE.test(file));
	return { code, bundle };
}

/**
 * The revisions to diff for this event, and a commit to fetch first, or
 * `undefined` when there is nothing trustworthy to measure against.
 *
 * @param {string} eventName GITHUB_EVENT_NAME
 * @param {any} event the parsed GITHUB_EVENT_PATH payload
 * @returns {{ base: string, head: string, fetch?: string } | undefined} the range, or `undefined` to run everything
 */
export function diffRange(eventName, event) {
	if (eventName === 'pull_request')
		return { base: 'HEAD^1', head: 'HEAD' };
	if (eventName === 'merge_group') {
		const base = event?.merge_group?.base_sha;
		const head = event?.merge_group?.head_sha;
		if (typeof base !== 'string' || typeof head !== 'string' || !COMMIT_ID.test(base) || !COMMIT_ID.test(head))
			return undefined;
		// The checkout is the group's head and its parent; the base is further back.
		return { base, head, fetch: base };
	}
	return undefined;
}

/** @param {string[]} args */
function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
	const eventName = process.env.GITHUB_EVENT_NAME ?? '';
	const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
	const range = diffRange(eventName, event);
	/** @type {string[]} */
	let changed = [];
	if (range === undefined) {
		console.log(`No base to measure a ${eventName || 'unknown'} event against: running everything.`);
	}
	else {
		try {
			if (range.fetch)
				git(['fetch', '--no-tags', '--depth=1', 'origin', range.fetch]);
			changed = git(['diff', '--name-only', range.base, range.head]).split('\n').filter(Boolean);
			console.log(`Changed between ${range.base} and ${range.head}:\n${changed.join('\n')}`);
		}
		catch (error) {
			console.log(`::warning::Could not diff ${range.base}..${range.head} (${error instanceof Error ? error.message : error}): running everything.`);
			changed = [];
		}
	}
	const { code, bundle } = scopeOf(changed);
	console.log(`code=${code} bundle=${bundle}`);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\nbundle=${bundle}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	main();
