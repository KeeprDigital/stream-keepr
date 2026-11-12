import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The merge queue (ADR-0036) is only as good as the workflows' wiring: these read
 * the committed workflows. Nothing runs against GitHub; only a queued merge proves
 * the events arrive.
 */

interface Step {
	'id'?: string;
	'uses'?: string;
	'run'?: string;
	'if'?: string;
	'continue-on-error'?: unknown;
	'env'?: Record<string, string>;
	'with'?: Record<string, unknown>;
}
interface Job {
	'name'?: string;
	'needs'?: string | string[];
	'if'?: string;
	'permissions'?: Record<string, string>;
	'outputs'?: Record<string, string>;
	'steps'?: Step[];
	'continue-on-error'?: unknown;
}
interface Workflow {
	on: Record<string, { types?: string[] } | null>;
	permissions?: Record<string, string>;
	jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
	return parse(readFileSync(`.github/workflows/${name}`, 'utf8')) as Workflow;
}

/** The `main` ruleset's required status checks: job names, as GitHub reports them. */
const REQUIRED_CHECKS = ['CI passed', 'Conventional Commit title'];

const ci = workflow('ci.yml');
const prTitle = workflow('pr-title.yml');
const releasePlease = workflow('release-please.yml');
const gates = Object.keys(ci.jobs).filter(id => !['scope', 'record', 'passed'].includes(id));
const FOR_CODE = 'needs.scope.outputs.code == \'true\'';
const FOR_DOCS = 'needs.scope.outputs.docs == \'true\'';

function needs(job: Job) {
	return [job.needs ?? []].flat().toSorted();
}

function runs(job: Job) {
	return (job.steps ?? []).map(step => step.run).filter(Boolean).join('\n');
}

describe('every required check reports in the merge queue as well as on PRs', () => {
	it.each([
		['ci.yml', ci],
		['pr-title.yml', prTitle],
	])('%s runs on merge groups and on PRs', (_, file) => {
		expect(file.on.merge_group).toEqual({
			types: ['checks_requested'],
		});
		expect(file.on).toHaveProperty('pull_request');
	});

	it('names each required check exactly once, as a job of a workflow that runs in the queue', () => {
		const names = [ci, prTitle].flatMap(file => Object.values(file.jobs).map(job => job.name));

		for (const check of REQUIRED_CHECKS)
			expect(names.filter(name => name === check)).toHaveLength(1);
	});

	it('`CI passed` waits on every other CI job, whatever became of it, and judges each result but `record`\'s', () => {
		const passed = ci.jobs.passed!;

		expect(passed.name).toBe('CI passed');
		expect(passed.if).toBe('always()');
		expect(needs(passed)).toEqual(Object.keys(ci.jobs).filter(id => id !== 'passed').toSorted());
		expect(runs(passed)).toContain('map(select(.key != "record") | .value.result)');
	});

	it('`Conventional Commit title` has no condition that could skip it in the queue', () => {
		const job = prTitle.jobs.conventional!;

		expect(job.if).toBeUndefined();
		expect((job.steps ?? []).every(step => step.if === undefined)).toBe(true);
		expect(runs(job)).toBe('node scripts/conventional-title.mjs');
		// The title is contributor-controlled, so only the script reads it, from the payload.
		expect(JSON.stringify(prTitle)).not.toContain('github.event.pull_request.title');
	});
});

describe('the CI scope decides what a merge group can affect against the queue\'s base', () => {
	const scope = ci.jobs.scope!;

	it('runs for every merge group and for ready PRs, through the tested script', () => {
		expect(scope.if).toBe('github.event_name == \'merge_group\' || !github.event.pull_request.draft');
		expect(runs(scope)).toContain('node scripts/ci-scope.mjs');
	});

	// An output the scope job does not export reads as '', which skips the job asking for it.
	it('exports every output another job reads, each from a step it runs', () => {
		const read = [
			...new Set([
				...JSON.stringify(ci.jobs).matchAll(/needs\.scope\.outputs\.([\w-]+)/g),
			].map(match => match[1]!)),
		];
		const stepIds = (scope.steps ?? []).map(step => step.id);

		expect(read.length).toBeGreaterThan(0);
		expect(Object.keys(scope.outputs ?? {})).toEqual(expect.arrayContaining(read));
		for (const [name, expression] of Object.entries(scope.outputs ?? {})) {
			const [, stepId] = expression.match(/^\$\{\{ steps\.([\w-]+)\.outputs\.[\w-]+ \}\}$/) ?? [];
			expect({
				name,
				fromItsStep: stepIds.includes(stepId),
			}).toEqual({ name, fromItsStep: true });
		}
	});

	it.each(gates)('gate %s is skipped only on the scope job\'s decision, and reads no PR-only state', (id) => {
		const job = ci.jobs[id]!;

		expect(job.needs).toBe('scope');
		expect(job.if).toMatch(id === 'checks'
			? /^needs\.scope\.outputs\.code == 'true' \|\| needs\.scope\.outputs\.docs == 'true'$/
			: /^needs\.scope\.outputs\.(?:code|bundle) == 'true'$/);
		expect(JSON.stringify(job)).not.toContain('github.event.pull_request');
	});

	// A docs-only change skips the code gates, so `checks` runs what they check of a document instead.
	it('the checks job lints only for code, and runs the docs checks only for a docs-only change', () => {
		const commands = (ci.jobs.checks!.steps ?? []).filter(step => step.run).map(step => [step.run, step.if]);

		expect(commands).toEqual([
			['pnpm lint', FOR_CODE],
			['pnpm verify:docs', FOR_DOCS],
		]);
	});

	// One job held all four for 11 to 18 minutes; apart, the longest sets the wall time.
	it('typecheck and the two suites each run in a job of their own', () => {
		const alone = (id: string) => (ci.jobs[id]!.steps ?? []).filter(step => step.run).map(step => step.run);

		expect([
			alone('typecheck'),
			alone('unit'),
			alone('nuxt'),
		]).toEqual([
			['pnpm typecheck'],
			['pnpm test:unit:coverage'],
			['pnpm test:nuxt:coverage'],
		]);
	});
});

describe('a merge group skips the gates only for a tree a full, green PR run verified', () => {
	const record = ci.jobs.record!;

	it('a PR run records its tree only after every gate passed, never in the queue or for a fork', () => {
		expect(needs(record)).toEqual(['scope', ...gates].toSorted());
		// No status function: the implicit success() needs every gate to have passed.
		expect(record.if?.split('&&').map(clause => clause.trim())).toEqual([
			'github.event_name == \'pull_request\'',
			'github.event.pull_request.head.repo.full_name == github.repository',
			'needs.scope.outputs.code == \'true\'',
			'needs.scope.outputs.bundle == \'true\'',
		]);
		expect(runs(record)).toContain('node scripts/ci-reuse.mjs record');
	});

	it('only the record job can mint an OIDC token, and nothing in CI can write', () => {
		expect(ci.permissions).toEqual({ contents: 'read' });
		for (const [id, job] of Object.entries(ci.jobs)) {
			const writes = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write').map(([scopeName]) => scopeName);
			expect(writes, id).toEqual(id === 'record'
				? ['id-token']
				: []);
		}
	});
});

describe('release-please releases only what the queue verified', () => {
	const steps = Object.values(releasePlease.jobs).flatMap(job => job.steps ?? []);
	const gate = steps.findIndex(step => step.run === 'node scripts/release-gate.mjs');
	const release = steps.findIndex(step => step.uses?.startsWith('googleapis/release-please-action@'));

	it('the gate runs before release-please, and nothing lets release-please run past a refusal', () => {
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(release).toBeGreaterThan(gate);
		for (const step of steps) {
			expect(step.if).toBeUndefined();
			expect(step['continue-on-error']).toBeUndefined();
		}
		for (const job of Object.values(releasePlease.jobs)) {
			expect(job.if).toBeUndefined();
			expect(job['continue-on-error']).toBeUndefined();
		}
	});
});
