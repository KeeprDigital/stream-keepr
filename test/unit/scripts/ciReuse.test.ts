import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { attestationName, findVerifiedRun } from '../../../scripts/ci-reuse.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

const REPOSITORY = 'KeeprDigital/stream-keepr';
const REPOSITORY_ID = '1040000001';
const RUN_ID = 39537227179;
const GROUP_TREE = 'a'.repeat(40);
const MERGE_COMMIT = 'b'.repeat(40);
const PR_HEAD = 'c'.repeat(40);

const github = generateKeyPairSync('rsa', { modulusLength: 2048 });
const githubJwks = { keys: [{ ...github.publicKey.export({ format: 'jwk' }), kid: 'github-key', alg: 'RS256', use: 'sig' }] };

function base64url(value: string | Buffer) {
	return Buffer.from(value).toString('base64url');
}

/** A token as GitHub's OIDC provider would sign it, for a job of a full PR run of CI. */
function token(claims: Record<string, unknown> = {}, { key = github.privateKey, kid = 'github-key', alg = 'RS256' } = {}) {
	const header = base64url(JSON.stringify({ alg, typ: 'JWT', kid }));
	const payload = base64url(JSON.stringify({
		iss: 'https://token.actions.githubusercontent.com',
		aud: 'stream-keepr:ci-verified-tree',
		repository: REPOSITORY,
		repository_id: REPOSITORY_ID,
		event_name: 'pull_request',
		ref: 'refs/pull/680/merge',
		sha: MERGE_COMMIT,
		workflow_sha: MERGE_COMMIT,
		workflow_ref: `${REPOSITORY}/.github/workflows/ci.yml@refs/pull/680/merge`,
		runner_environment: 'github-hosted',
		run_id: String(RUN_ID),
		run_attempt: '1',
		iat: 1_790_000_000,
		exp: 1_790_000_300,
		...claims,
	}));
	const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key);
	return `${header}.${payload}.${base64url(signature)}`;
}

const JOBS = ['Decide what the change can affect', 'Lint, typecheck, unit and Nuxt suites', 'Integration suite (1/2)', 'Integration suite (2/2)', 'Local-auth suite and browser gates', 'Build, wrangler dry runs, and Worker smoke', 'Record the verified tree', 'CI passed'];

interface World {
	artifacts: { id: number; name: string; expired: boolean; size_in_bytes: number; workflow_run: { id: number } }[];
	attestation: string;
	jwks: unknown;
	run: Record<string, unknown>;
	jobs: { name: string; status: string; conclusion: string | null }[];
	trees: Record<string, string>;
}

/** What GitHub holds after a full, green PR run of CI on a merge commit whose tree is the group's. */
function world(overrides: Partial<World> = {}): World {
	return {
		artifacts: [{ id: 7, name: attestationName(GROUP_TREE), expired: false, size_in_bytes: 1200, workflow_run: { id: RUN_ID } }],
		attestation: token(),
		jwks: githubJwks,
		run: { id: RUN_ID, path: '.github/workflows/ci.yml', event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: PR_HEAD, repository: { full_name: REPOSITORY }, html_url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}` },
		jobs: JOBS.map(name => ({ name, status: 'completed', conclusion: 'success' })),
		trees: { [MERGE_COMMIT]: GROUP_TREE },
		...overrides,
	};
}

function io(state: World) {
	return {
		artifacts: async (name: string) => state.artifacts.filter(artifact => artifact.name === name),
		attestation: async (_runId: number, _name: string) => state.attestation,
		jwks: async () => state.jwks,
		run: async (_runId: number) => state.run,
		jobs: async (_runId: number) => state.jobs,
		commitTree: async (sha: string) => {
			const tree = state.trees[sha];
			if (!tree)
				throw new Error(`no commit ${sha}`);
			return tree;
		},
		wait: async () => {},
	};
}

function find(state: World) {
	return findVerifiedRun({ tree: GROUP_TREE, repository: REPOSITORY, repositoryId: REPOSITORY_ID, io: io(state) });
}

describe('a merge group reuses a PR run\'s verification only for the exact tree it verified', () => {
	it('reuses a full, green PR run of CI whose merge commit has the group\'s tree', async () => {
		await expect(find(world())).resolves.toMatchObject({ run: { id: RUN_ID } });
	});
});

/** Whatever is wrong, the group runs everything: never fail open to skipping. */
async function expectFullRun(state: World, reason: RegExp) {
	const result = await find(state);
	expect(result.run).toBeUndefined();
	expect(result.rejected.join('\n')).toMatch(reason);
}

describe('which records it considers', () => {
	const recorded = (id: number, expired = false) => ({ id, name: attestationName(GROUP_TREE), expired, size_in_bytes: 1200, workflow_run: { id } });

	it('no PR run recorded this tree: a docs-only or failed run, a fork, or a tree no PR run tested', async () => {
		await expectFullRun(world({ artifacts: [] }), /no .*record/i);
	});

	it('an expired record cannot be read', async () => {
		await expectFullRun(world({ artifacts: [recorded(RUN_ID, true)] }), /no .*record/i);
	});

	it('a forged record beside a genuine one does not hide the genuine one', async () => {
		const state = world({ artifacts: [recorded(666), recorded(RUN_ID)] });
		const result = await findVerifiedRun({
			tree: GROUP_TREE,
			repository: REPOSITORY,
			repositoryId: REPOSITORY_ID,
			io: { ...io(state), attestation: async (runId: number) => runId === RUN_ID ? token() : token({ run_id: '666' }, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }) },
		});

		expect(result.run).toMatchObject({ id: RUN_ID });
		expect(result.rejected.join('\n')).toMatch(/Run 666: .*signature/);
	});

	it('reads only the newest few, so a flood of forged records costs a full run, never a long one', async () => {
		const reads: number[] = [];
		const state = world({ artifacts: Array.from({ length: 50 }, (_, index) => recorded(1000 + index)) });
		await findVerifiedRun({
			tree: GROUP_TREE,
			repository: REPOSITORY,
			repositoryId: REPOSITORY_ID,
			io: { ...io(state), attestation: async (runId: number) => {
				reads.push(runId);
				return 'forged';
			} },
		});

		expect(reads.length).toBeLessThanOrEqual(5);
	});

	it('never downloads a record far larger than a token', async () => {
		const reads: number[] = [];
		const state = world({ artifacts: [{ ...recorded(RUN_ID), size_in_bytes: 50 * 1024 * 1024 }] });
		const result = await findVerifiedRun({
			tree: GROUP_TREE,
			repository: REPOSITORY,
			repositoryId: REPOSITORY_ID,
			io: { ...io(state), attestation: async (runId: number) => {
				reads.push(runId);
				return token();
			} },
		});

		expect(result.run).toBeUndefined();
		expect(reads).toEqual([]);
	});

	it('the records cannot be listed', async () => {
		const result = await findVerifiedRun({
			tree: GROUP_TREE,
			repository: REPOSITORY,
			repositoryId: REPOSITORY_ID,
			io: { ...io(world()), artifacts: async () => { throw new Error('HTTP 502'); } },
		});

		expect(result.run).toBeUndefined();
		expect(result.rejected.join('\n')).toMatch(/could not list .*HTTP 502/i);
	});
});

describe('only GitHub\'s signature makes a record: a PR\'s own workflow code can write any artifact', () => {
	const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const [header, payload] = token().split('.');

	it.each([
		['signed by a key that is not GitHub\'s', token({}, { key: attacker.privateKey })],
		['signed under a key id GitHub does not publish', token({}, { kid: 'attacker-key' })],
		['claiming no signature at all', `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'github-key' }))}.${payload}.`],
		['claiming another algorithm', token({}, { alg: 'HS256' })],
		['with its claims edited after signing', `${header}.${base64url(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sha: 'd'.repeat(40) }))}.${token().split('.')[2]}`],
		['not a token', 'not-a-token'],
		['empty', ''],
	])('a token %s', async (_case, attestation) => {
		await expectFullRun(world({ attestation }), /signature|token/i);
	});

	it('a key set that cannot be read', async () => {
		await expectFullRun(world({ jwks: { keys: 'nope' } }), /signature|token/i);
	});
});

describe('a genuine token counts only from a job of this repository\'s own CI workflow, run on a PR', () => {
	it.each<[string, Record<string, unknown>]>([
		['another issuer', { iss: 'https://token.example.invalid' }],
		['an audience meant for something else', { aud: 'sts.amazonaws.com' }],
		['another repository, such as a fork', { repository: 'someone/stream-keepr', workflow_ref: `someone/stream-keepr/.github/workflows/ci.yml@refs/pull/680/merge` }],
		['a repository that took this name after a rename', { repository_id: '999' }],
		['a merge-group run', { event_name: 'merge_group' }],
		['a pull_request_target run, which runs the base\'s code', { event_name: 'pull_request_target' }],
		['another workflow of the same tree', { workflow_ref: `${REPOSITORY}/.github/workflows/pr-title.yml@refs/pull/680/merge` }],
		['a workflow file merely named like CI', { workflow_ref: `${REPOSITORY}/.github/workflows/ci.yml.evil.yml@refs/pull/680/merge` }],
		['a workflow file read from another commit', { workflow_sha: 'd'.repeat(40) }],
		['no commit id', { sha: 'main' }],
		['a self-hosted runner', { runner_environment: 'self-hosted' }],
		['another run than the one that uploaded it', { run_id: '1' }],
	])('not from %s', async (_case, claims) => {
		await expectFullRun(world({ attestation: token(claims) }), /token/i);
	});
});

describe('the commit the token names must have exactly the group\'s tree: the artifact\'s name is only an index', () => {
	it('main moved since the PR run, or the group holds more than this PR', async () => {
		// The PR run tested its merge with an older main, or the group carries
		// other PRs: either way, a different tree.
		await expectFullRun(world({ trees: { [MERGE_COMMIT]: 'e'.repeat(40) } }), /tree/i);
	});

	it('a commit GitHub cannot show', async () => {
		await expectFullRun(world({ trees: {} }), /tree|commit/i);
	});
});

describe('the run, as GitHub records it, must show every one of its jobs ran and passed', () => {
	const jobs = (name: string, conclusion: string) => JOBS.map(job => ({ name: job, status: 'completed', conclusion: job === name ? conclusion : 'success' }));

	it.each<[string, Partial<World>]>([
		['the run failed', { run: { ...world().run, conclusion: 'failure' } }],
		['the run is another workflow\'s', { run: { ...world().run, path: '.github/workflows/pr-title.yml' } }],
		['the run is not a PR run', { run: { ...world().run, event: 'merge_group' } }],
		['the run is another repository\'s', { run: { ...world().run, repository: { full_name: 'someone/stream-keepr' } } }],
		['the scope skipped the Worker build, as for a tests-only change', { jobs: jobs('Build, wrangler dry runs, and Worker smoke', 'skipped') }],
		['the scope skipped the gates, as for a docs-only change', { jobs: JOBS.map(name => ({ name, status: 'completed', conclusion: /Decide|Record|CI passed/.test(name) ? 'success' : 'skipped' })) }],
		['a shard was cancelled', { jobs: jobs('Integration suite (2/2)', 'cancelled') }],
		['GitHub lists no jobs', { jobs: [] }],
	])('not when %s', async (_case, overrides) => {
		await expectFullRun(world(overrides), /run|job/i);
	});

	it('waits for a run whose last job passed a moment ago to conclude', async () => {
		const state = world();
		const runs = [{ ...state.run, status: 'in_progress', conclusion: null }, state.run];
		const result = await findVerifiedRun({
			tree: GROUP_TREE,
			repository: REPOSITORY,
			repositoryId: REPOSITORY_ID,
			io: { ...io(state), run: async () => runs.shift() ?? state.run },
		});

		expect(result.run).toMatchObject({ id: RUN_ID });
	});

	it('runs everything when the run never concludes', async () => {
		await expectFullRun(world({ run: { ...world().run, status: 'in_progress', conclusion: null } }), /run/i);
	});
});

/**
 * The PR run's `record` job against a stand-in for the runner's OIDC endpoint
 * and a real git checkout. Nothing remote.
 */
describe('the record job\'s command line', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	function checkout() {
		const directory = mkdtempSync(join(tmpdir(), 'ci-reuse-checkout-'));
		directories.push(directory);
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
		execFileSync('git', ['init', '-q'], { cwd: directory, env });
		writeFileSync(join(directory, 'README.md'), 'the merge commit\n');
		execFileSync('git', ['add', '.'], { cwd: directory, env });
		execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'merge'], { cwd: directory, env });
		return { directory, tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: directory, env, encoding: 'utf8' }).trim() };
	}

	function record(cwd: string, env: Record<string, string>) {
		const output = join(cwd, '..', `${cwd.split('/').at(-1)}-output`);
		const runnerTemp = mkdtempSync(join(tmpdir(), 'ci-reuse-temp-'));
		directories.push(output, runnerTemp);
		writeFileSync(output, '');
		return new Promise<{ status: number | null; stdout: string; output: string }>((resolve) => {
			const child = spawn(process.execPath, [join(repositoryRoot, 'scripts/ci-reuse.mjs'), 'record'], {
				cwd,
				env: { ...process.env, ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '', ...env, GITHUB_OUTPUT: output, RUNNER_TEMP: runnerTemp, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
			});
			let stdout = '';
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
			child.on('close', status => resolve({ status, stdout, output: readFileSync(output, 'utf8') }));
		});
	}

	it('records the token GitHub mints for this job, under the checked-out tree\'s name', async () => {
		const { directory, tree } = checkout();
		const requests: { url: string; authorization?: string }[] = [];
		const server = createServer((request, response) => {
			requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
			response.end(JSON.stringify({ value: 'header.payload.signature' }));
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		try {
			const result = await record(directory, { ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${port}/token?api-version=2.0`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token' });

			expect(result.status).toBe(0);
			expect(requests).toEqual([{ url: `/token?api-version=2.0&audience=${encodeURIComponent('stream-keepr:ci-verified-tree')}`, authorization: 'bearer runner-token' }]);
			const recorded = Object.fromEntries(result.output.trim().split('\n').map(line => line.split('=', 2) as [string, string]));
			expect(recorded.name).toBe(`ci-verified-tree-${tree}`);
			expect(readFileSync(recorded.path!, 'utf8')).toBe('header.payload.signature');
		}
		finally {
			server.close();
		}
	});

	it('records nothing, and fails nothing, when the job has no OIDC token: a fork\'s PR', async () => {
		const { directory } = checkout();
		const result = await record(directory, {});

		expect(result.status).toBe(0);
		expect(result.output).toBe('');
		expect(result.stdout).toMatch(/::warning::.*nothing recorded/);
	});
});
