import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The merge queue (ADR-0036) is only as good as the workflows' wiring: these
 * read the committed workflows. Nothing runs against GitHub; only a queued
 * merge proves the events arrive.
 */

/** The `main` ruleset's required status checks: job names, as GitHub reports them. */
const REQUIRED_CHECKS = ['CI passed', 'Conventional Commit title'];

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const prTitle = readFileSync('.github/workflows/pr-title.yml', 'utf8');
const releasePlease = readFileSync('.github/workflows/release-please.yml', 'utf8');

/** A workflow without its comments, so a mention in prose never passes for wiring. */
function code(workflow: string) {
	return workflow.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
}

/** Each top-level job's id and its text. */
function jobs(workflow: string) {
	const text = code(workflow);
	const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length);
	return new Map(body.split(/^(?= {2}[\w-]+:$)/m).filter(Boolean).map(job => [job.slice(2, job.indexOf(':')), job]));
}

function triggers(workflow: string) {
	return code(workflow).match(/^on:\n((?: {2}.*\n)+)/m)?.[1] ?? '';
}

describe('every required check reports in the merge queue as well as on PRs', () => {
	it.each([['ci.yml', ci], ['pr-title.yml', prTitle]])('%s runs on merge groups and on PRs', (_name, workflow) => {
		expect(triggers(workflow)).toMatch(/^ {2}merge_group:\n {4}types: \[checks_requested\]$/m);
		expect(triggers(workflow)).toMatch(/^ {2}pull_request:$/m);
	});

	it('names each required check exactly once, as a job of a workflow that runs in the queue', () => {
		const names = [ci, prTitle].flatMap(workflow => [...jobs(workflow).values()].map(job => job.match(/^ {4}name: (.+)$/m)?.[1]));

		for (const check of REQUIRED_CHECKS)
			expect(names.filter(name => name === check)).toHaveLength(1);
	});

	it('`CI passed` waits on every other CI job and reports whatever they did', () => {
		const all = jobs(ci);
		const passed = all.get('passed')!;
		const needs = passed.match(/^ {4}needs: \[(.+)\]$/m)![1]!.split(',').map(id => id.trim());

		expect(passed).toMatch(/^ {4}name: CI passed$/m);
		expect(passed).toMatch(/^ {4}if: always\(\)$/m);
		expect(needs.toSorted()).toEqual([...all.keys()].filter(id => id !== 'passed').toSorted());
		// A failed or cancelled job fails it; only success and skipped pass. The
		// record job alone only warns: it proves nothing.
		expect(passed).toContain('success|skipped) ;;');
		expect(passed).toMatch(/NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
		expect(passed).toContain('map(select(.key != "record") | .value.result)');
	});

	it('`Conventional Commit title` has no condition that could skip it in the queue', () => {
		const job = jobs(prTitle).get('conventional')!;

		expect(job).not.toMatch(/^\s+if:/m);
		expect(job).toMatch(/^ {8}run: node scripts\/conventional-title\.mjs$/m);
		// The title is contributor-controlled: read from the payload by the script.
		expect(code(prTitle)).not.toContain('github.event.pull_request.title');
	});
});

describe('the CI scope decides what a merge group can affect against the queue\'s base', () => {
	const scope = jobs(ci).get('scope')!;

	it('the scope job runs for every merge group and for ready PRs', () => {
		expect(scope).toMatch(/^ {4}if: github\.event_name == 'merge_group' \|\| !github\.event\.pull_request\.draft$/m);
	});

	it('the scope decision is the tested script, not an inline diff of HEAD^1', () => {
		expect(scope).toMatch(/^ {8}run: node scripts\/ci-scope\.mjs$/m);
		expect(scope).not.toContain('HEAD^1');
		expect(scope).toMatch(/node-version-file: \.node-version/);
	});

	it('no gate reads PR-only state, so none is skipped in the queue for want of a PR', () => {
		for (const [id, job] of jobs(ci)) {
			if (id !== 'scope' && id !== 'record')
				expect(job, id).not.toContain('github.event.pull_request');
		}
	});

	it('each gate is skipped only on the scope job\'s decision', () => {
		for (const [id, job] of jobs(ci)) {
			if (id === 'scope' || id === 'passed' || id === 'record')
				continue;
			expect(job, id).toMatch(/^ {4}needs: scope$/m);
			expect(job, id).toMatch(/^ {4}if: needs\.scope\.outputs\.(?:code|bundle) == 'true'$/m);
		}
	});
});

describe('a merge group skips the gates only for a tree a full, green PR run verified', () => {
	const all = jobs(ci);
	const scope = all.get('scope')!;
	const record = all.get('record')!;
	const gates = [...all.keys()].filter(id => !['scope', 'record', 'passed'].includes(id));

	it('the scope job can read the PR runs\' records, their jobs and commits, and nothing more', () => {
		expect(scope).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n/m);
		expect(scope).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
		expect(scope).toMatch(/^ {6}verified-by: \$\{\{ steps\.scope\.outputs\.verified-by \}\}$/m);
	});

	it('a PR run records its tree only after every gate ran and passed, never in the queue or for a fork', () => {
		const needs = record.match(/^ {4}needs: \[(.+)\]$/m)![1]!.split(',').map(id => id.trim());
		const condition = record.match(/^ {4}if: >-\n((?: {6}.*\n)+)/m)![1]!.split('\n').map(line => line.trim()).filter(Boolean);

		expect(needs.toSorted()).toEqual(['scope', ...gates].toSorted());
		// No status function: the implicit success() needs every gate to have passed.
		expect(condition).toEqual([
			'github.event_name == \'pull_request\'',
			'&& github.event.pull_request.head.repo.full_name == github.repository',
			'&& needs.scope.outputs.code == \'true\'',
			'&& needs.scope.outputs.bundle == \'true\'',
		]);
		expect(record).toMatch(/^ {8}run: node scripts\/ci-reuse\.mjs record$/m);
		expect(record).toMatch(/name: \$\{\{ steps\.record\.outputs\.name \}\}/);
	});

	it('only the record job can mint an OIDC token, and nothing else in CI can write', () => {
		expect(code(ci)).toMatch(/^permissions:\n {2}contents: read\n\n/m);
		for (const [id, job] of all)
			expect(job.includes('id-token: write'), id).toBe(id === 'record');
		expect(code(ci)).not.toMatch(/: write$(?<!id-token: write)/m);
	});
});

describe('release-please releases only what the queue verified', () => {
	const steps = code(releasePlease).slice(code(releasePlease).indexOf('    steps:\n')).split(/^ {6}- /m).slice(1);
	const gate = steps.findIndex(step => /^ {8}run: node scripts\/release-gate\.mjs$/m.test(step));
	const release = steps.findIndex(step => step.startsWith('uses: googleapis/release-please-action@'));

	it('the gate runs before release-please, and nothing lets release-please run past a refusal', () => {
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(release).toBeGreaterThan(gate);
		// A step-level `if:` replaces the implicit `success()`; `continue-on-error` lets a failure through.
		for (const step of steps)
			expect(step).not.toMatch(/^\s+(?:if|continue-on-error):/m);
		expect(code(releasePlease)).not.toMatch(/^\s+(?:if|continue-on-error):/m);
	});

	it('the gate can read the merge-group runs, and checks out only itself', () => {
		expect(code(releasePlease)).toMatch(/^ {2}actions: read$/m);
		expect(steps[gate]).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
		expect(steps[0]).toMatch(/sparse-checkout: \|\n {12}scripts\/release-gate\.mjs\n/);
		expect(steps[0]).toMatch(/persist-credentials: false/);
	});
});
