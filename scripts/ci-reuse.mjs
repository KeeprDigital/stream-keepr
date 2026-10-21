/**
 * A merge group skips CI's gates only when its tree is byte-identical to one
 * a full, green PR run of CI already verified (ADR-0036). Otherwise it runs
 * everything, as before.
 *
 * A PR run tests `refs/pull/N/merge`, but GitHub's record of the run names
 * only the PR head, so the tested tree is not recoverable afterwards. The PR
 * run therefore leaves a record: an artifact holding an OIDC token GitHub
 * signed for one of its jobs (`record`). The token's claims, which the job
 * cannot choose, name the run, the event, the workflow file, and the commit
 * the run executed (`sha`, `workflow_sha`). The merge group (`ci-scope.mjs`)
 * accepts the record only if the signature is GitHub's, the claims are a
 * `pull_request` run of this repository's `ci.yml` on a GitHub-hosted runner,
 * that commit's tree is exactly the group's, and GitHub's own record of the
 * run shows every job of it ran and passed (`findVerifiedRun`).
 *
 * Why a PR cannot forge one: a PR run executes the PR's workflow code, so it
 * can upload any artifact, but it cannot get a token signed for a commit it
 * did not run on. A token that names a commit whose tree is the group's was
 * minted by a run that executed exactly the group's code, CI's own workflow
 * and scripts included: the same code the group's run would execute. Reusing
 * it trusts nothing the group's own run does not.
 *
 * Anything else runs everything: no record, an expired or unreadable one, a
 * bad signature or claim, another tree (main moved, or the group holds more
 * than this PR), a skipped or failed job, an API error.
 *
 *   node scripts/ci-reuse.mjs record   (the PR run's `record` job: reads
 *       ACTIONS_ID_TOKEN_REQUEST_URL/_TOKEN; writes the token under
 *       RUNNER_TEMP and appends name= and path= to GITHUB_OUTPUT)
 */

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const ATTESTATION_FILE = 'attestation.jwt';
/** Ours alone: no cloud provider accepts a token minted for it. */
export const AUDIENCE = 'stream-keepr:ci-verified-tree';
const CI_WORKFLOW = '.github/workflows/ci.yml';
const COMMIT_ID = /^[0-9a-f]{40}$/;
/** A minute of 10s reads for a run whose last job passed a moment ago. */
const DEFAULT_ATTEMPTS = 6;
const RETRY_DELAY_MS = 10_000;
/** Newest first: enough for a PR run re-run a few times, few enough that forged records cannot stall the group. */
const MAX_RECORDS = 5;
/** A token is about a kilobyte; anything far larger is not one, and is not downloaded. */
const MAX_RECORD_BYTES = 64 * 1024;

/**
 * The artifact a PR run records tree `tree` under. Only an index: the run's
 * code chooses it, so nothing trusts it.
 *
 * @param {string} tree a tree id
 */
export function attestationName(tree) {
	return `ci-verified-tree-${tree}`;
}

/**
 * The claims of a token GitHub's OIDC provider signed, or a reason it is not one.
 *
 * @param {string} jwt
 * @param {any} jwks
 * @returns {{ claims: Record<string, unknown> } | { problem: string }} the claims, or why the token is not GitHub's
 */
function verifiedClaims(jwt, jwks) {
	const parts = typeof jwt === 'string' ? jwt.trim().split('.') : [];
	if (parts.length !== 3 || parts.includes(''))
		return { problem: 'the record is not a signed token' };
	const [header, payload, signature] = /** @type {[string, string, string]} */ (parts);
	let parsedHeader;
	let claims;
	try {
		parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
		claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	}
	catch {
		return { problem: 'the record is not a readable token' };
	}
	if (parsedHeader?.alg !== 'RS256')
		return { problem: `the token's signature algorithm is ${JSON.stringify(parsedHeader?.alg)}, not GitHub's RS256` };
	const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
	const jwk = keys.find((/** @type {any} */ key) => key?.kid === parsedHeader.kid && key?.kty === 'RSA');
	if (!jwk)
		return { problem: `the token's signing key ${JSON.stringify(parsedHeader.kid)} is not one GitHub publishes` };
	let valid = false;
	try {
		valid = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'));
	}
	catch {
		valid = false;
	}
	if (!valid)
		return { problem: 'the token\'s signature is not GitHub\'s' };
	if (claims === null || typeof claims !== 'object')
		return { problem: 'the token carries no claims' };
	return { claims };
}

/**
 * Why these claims are not a job of this repository's own CI workflow, run
 * on a PR, in the run that uploaded the record; `undefined` when they are.
 *
 * @param {Record<string, unknown>} claims
 * @param {{ repository: string, repositoryId: string, runId: number }} expected
 * @returns {string | undefined} the problem, if any
 */
function claimsProblem(claims, { repository, repositoryId, runId }) {
	const workflowRef = typeof claims.workflow_ref === 'string' ? claims.workflow_ref : '';
	/** @type {[boolean, string][]} */
	const checks = [
		[claims.iss === ISSUER, `the token's issuer is ${JSON.stringify(claims.iss)}`],
		[claims.aud === AUDIENCE, `the token's audience is ${JSON.stringify(claims.aud)}`],
		[claims.repository === repository && String(claims.repository_id) === repositoryId, `the token is from ${JSON.stringify(claims.repository)} (${JSON.stringify(claims.repository_id)}), not this repository`],
		[claims.event_name === 'pull_request', `the token is from a ${JSON.stringify(claims.event_name)} run, not a pull_request run`],
		[workflowRef.startsWith(`${repository}/${CI_WORKFLOW}@`), `the token is from workflow ${JSON.stringify(claims.workflow_ref)}, not ${CI_WORKFLOW}`],
		[typeof claims.sha === 'string' && COMMIT_ID.test(claims.sha), `the token's commit ${JSON.stringify(claims.sha)} is not a commit id`],
		[claims.workflow_sha === claims.sha, `the token's workflow file came from ${JSON.stringify(claims.workflow_sha)}, not the commit it ran on`],
		[claims.runner_environment === 'github-hosted', `the token is from a ${JSON.stringify(claims.runner_environment)} runner`],
		[claims.run_id === String(runId), `the token is from run ${JSON.stringify(claims.run_id)}, not run ${runId}, which uploaded it`],
	];
	return checks.find(([ok]) => !ok)?.[1];
}

/**
 * Why GitHub's record of the run does not show a full, green PR run of CI:
 * every job of it ran and passed, none skipped by its scope decision.
 *
 * @param {any} run GET /repos/{repository}/actions/runs/{id}
 * @param {readonly any[]} jobs its jobs, the latest attempt of each
 * @param {{ repository: string, runId: number }} expected
 * @returns {string | undefined} the problem, if any
 */
function runProblem(run, jobs, { repository, runId }) {
	if (run?.id !== runId || run?.repository?.full_name !== repository || run?.path !== CI_WORKFLOW || run?.event !== 'pull_request')
		return `run ${runId} is not a pull_request run of ${CI_WORKFLOW} in ${repository}`;
	if (run.status !== 'completed' || run.conclusion !== 'success')
		return `run ${runId} is ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}, not a completed success`;
	if (!Array.isArray(jobs) || jobs.length === 0)
		return `GitHub lists no jobs for run ${runId}`;
	const notPassed = jobs.filter(job => job?.status !== 'completed' || job?.conclusion !== 'success');
	if (notPassed.length > 0)
		return `run ${runId} did not run and pass every job: ${notPassed.map(job => `${job?.name} ${job?.conclusion ?? job?.status}`).join(', ')}`;
	return undefined;
}

/**
 * @typedef {{
 *   artifacts: (name: string) => Promise<readonly { name: string, expired: boolean, size_in_bytes?: number, workflow_run?: { id?: number } }[]>,
 *   attestation: (runId: number, name: string) => Promise<string>,
 *   jwks: () => Promise<unknown>,
 *   run: (runId: number) => Promise<any>,
 *   jobs: (runId: number) => Promise<readonly any[]>,
 *   commitTree: (sha: string) => Promise<string>,
 *   wait: (ms: number) => Promise<void>,
 * }} ReuseIo what it reads from GitHub
 * @typedef {{ tree: string, repository: string, repositoryId: string, io: ReuseIo, attempts?: number }} FindOptions
 */

/**
 * Why one recorded run does not verify the group's tree, or the run.
 *
 * @param {{ runId: number, name: string }} record an artifact's run and name
 * @param {FindOptions} options
 * @returns {Promise<string | { id: number, url: string }>} the problem, or the run
 */
async function checkRecord({ runId, name }, { tree, repository, repositoryId, io, attempts = DEFAULT_ATTEMPTS }) {
	const verified = verifiedClaims(await io.attestation(runId, name), await io.jwks());
	if ('problem' in verified)
		return verified.problem;
	const claimsWrong = claimsProblem(verified.claims, { repository, repositoryId, runId });
	if (claimsWrong)
		return claimsWrong;
	// The commit the run executed, as GitHub signed it: its tree is the code,
	// the workflow included, that the run's jobs ran.
	const sha = /** @type {string} */ (verified.claims.sha);
	const verifiedTree = await io.commitTree(sha);
	if (verifiedTree !== tree)
		return `it verified ${sha}, whose tree ${verifiedTree} is not the group's`;
	let run = await io.run(runId);
	for (let attempt = 1; run?.status !== 'completed' && attempt < attempts; attempt += 1) {
		await io.wait(RETRY_DELAY_MS);
		run = await io.run(runId);
	}
	return runProblem(run, await io.jobs(runId), { repository, runId }) ?? { id: run.id, url: run.html_url };
}

/**
 * The full, green PR run of CI that verified exactly this tree, if one did;
 * otherwise `run` is `undefined` and the group runs everything. Every
 * problem, a thrown read included, rejects only the record it concerns.
 *
 * @param {FindOptions} options the group's tree (`git rev-parse HEAD^{tree}`), this repository, and GitHub
 * @returns {Promise<{ run: { id: number, url: string } | undefined, rejected: string[] }>} the run, and why each record was not one
 */
export async function findVerifiedRun(options) {
	/** @type {string[]} */
	const rejected = [];
	let records;
	try {
		records = (await options.io.artifacts(attestationName(options.tree)))
			.filter(artifact => !artifact.expired
				&& Number.isSafeInteger(artifact.workflow_run?.id)
				&& typeof artifact.size_in_bytes === 'number' && artifact.size_in_bytes <= MAX_RECORD_BYTES)
			.slice(0, MAX_RECORDS)
			.map(artifact => ({ runId: /** @type {number} */ (artifact.workflow_run?.id), name: artifact.name }));
	}
	catch (error) {
		return { run: undefined, rejected: [`Could not list the records of tree ${options.tree} (${messageOf(error)}).`] };
	}
	if (records.length === 0)
		return { run: undefined, rejected: [`No PR run left a record of tree ${options.tree}.`] };
	for (const record of records) {
		try {
			const outcome = await checkRecord(record, options);
			if (typeof outcome !== 'string')
				return { run: outcome, rejected };
			rejected.push(`Run ${record.runId}: ${outcome}.`);
		}
		catch (error) {
			rejected.push(`Run ${record.runId}: could not check its record (${messageOf(error)}).`);
		}
	}
	return { run: undefined, rejected };
}

/**
 * On one line, so a failed `gh` call's stderr stays in its log line.
 *
 * @param {unknown} error
 */
function messageOf(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
}

/** @param {string[]} args */
function git(args) {
	return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/**
 * GitHub, read through `gh` with the job's token (`actions: read`,
 * `contents: read`), and GitHub's OIDC key set.
 *
 * @param {string} repository owner/name
 * @returns {ReuseIo} the reads `findVerifiedRun` makes
 */
export function githubIo(repository) {
	/** @param {string} path */
	const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }));
	return {
		artifacts: async name => api(`repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=20`).artifacts,
		attestation: async (runId, name) => {
			const directory = mkdtempSync(join(tmpdir(), 'ci-reuse-'));
			execFileSync('gh', ['run', 'download', String(runId), '--repo', repository, '--name', name, '--dir', directory], { stdio: ['ignore', 'ignore', 'pipe'] });
			return readFileSync(join(directory, ATTESTATION_FILE), 'utf8');
		},
		jwks: async () => {
			const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(15_000) });
			if (!response.ok)
				throw new Error(`${JWKS_URL} answered ${response.status}`);
			return response.json();
		},
		run: async runId => api(`repos/${repository}/actions/runs/${runId}`),
		jobs: async runId => api(`repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`).jobs,
		commitTree: async sha => api(`repos/${repository}/git/commits/${sha}`).tree.sha,
		wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
	};
}

/**
 * The PR run's `record` job: mint a token for this job and leave it where
 * the upload step finds it. A failure records nothing, so the queue runs
 * everything; it never fails the PR's CI.
 */
async function record() {
	const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
	const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	if (!requestUrl || !requestToken) {
		console.log('::warning::No OIDC token is available to this job: nothing recorded, so the merge queue will run everything.');
		return;
	}
	try {
		const tree = git(['rev-parse', 'HEAD^{tree}']);
		const url = new URL(requestUrl);
		url.searchParams.set('audience', AUDIENCE);
		const response = await fetch(url, { headers: { Authorization: `bearer ${requestToken}` }, signal: AbortSignal.timeout(15_000) });
		if (!response.ok)
			throw new Error(`the OIDC provider answered ${response.status}`);
		const { value } = /** @type {{ value?: unknown }} */ (await response.json());
		if (typeof value !== 'string' || value === '')
			throw new Error('the OIDC provider returned no token');
		const directory = join(process.env.RUNNER_TEMP ?? tmpdir(), 'ci-verified-tree');
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, ATTESTATION_FILE), value);
		console.log(`Recorded tree ${tree} of ${git(['rev-parse', 'HEAD'])}.`);
		if (process.env.GITHUB_OUTPUT)
			appendFileSync(process.env.GITHUB_OUTPUT, `name=${attestationName(tree)}\npath=${join(directory, ATTESTATION_FILE)}\n`);
	}
	catch (error) {
		console.log(`::warning::Could not record the verified tree (${messageOf(error)}): the merge queue will run everything.`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	if (process.argv[2] === 'record') {
		await record();
	}
	else {
		console.error('usage: node scripts/ci-reuse.mjs record');
		process.exitCode = 2;
	}
}
