/* eslint-disable no-template-curly-in-string -- GitHub Actions expressions are literal strings here. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { GATES, selectGates } from '../../../scripts/verify.mjs';

/**
 * The gates and the deploy are only as good as their wiring: these read the
 * committed package.json, verify graph and workflows. Nothing runs remotely.
 */

interface Step {
	'name'?: string;
	'uses'?: string;
	'run'?: string;
	'if'?: string;
	'continue-on-error'?: unknown;
	'env'?: Record<string, string>;
	'with'?: Record<string, unknown>;
}
interface Workflow {
	on: Record<string, { inputs?: Record<string, { options?: string[] }> }>;
	permissions?: Record<string, string>;
	jobs: Record<string, { steps?: Step[] }>;
}

const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;

function workflow(name: string): Workflow {
	return parse(readFileSync(`.github/workflows/${name}`, 'utf8')) as Workflow;
}

function steps(file: Workflow, job?: string): Step[] {
	return (job === undefined
		? Object.values(file.jobs)
		: [file.jobs[job]!]).flatMap(entry => entry.steps ?? []);
}

const ci = workflow('ci.yml');
const ciCommands = steps(ci).flatMap(step => (step.run ?? '').split('\n')).map(line => line.trim()).filter(line => line.startsWith('pnpm '));

describe('verify and CI run the same gates', () => {
	it('builds once, then runs the Worker dry run and smoke, in verify and in CI', () => {
		expect(scripts['worker:smoke']).not.toContain('build');
		expect(GATES['worker:dry-run']!.after).toEqual(['build']);
		expect(GATES['worker:smoke']!.after).toEqual(['worker:dry-run']);
		expect(Object.values(GATES).filter(gate => gate.command.includes('build'))).toHaveLength(1);

		const workerGuard = steps(ci, 'worker-guard').map(step => step.run ?? '');
		const at = (command: string) => workerGuard.findIndex(run => run.includes(command));
		expect(workerGuard.filter(run => run.includes('pnpm build'))).toHaveLength(1);
		expect(at('pnpm build')).toBeLessThan(at('pnpm worker:dry-run'));
		expect(at('pnpm worker:dry-run')).toBeLessThan(at('pnpm worker:smoke'));
	});

	it('typechecks and bundles the silent-video validator Worker from its own config, in verify and CI', () => {
		expect(scripts['typecheck:validator']).toContain('-p workers/silent-video-validator/tsconfig.json');
		expect(scripts['validator:dry-run']).toContain('--config workers/silent-video-validator/wrangler.jsonc');
		expect(scripts.typecheck).toMatch(/&& pnpm typecheck:validator(?: |$)/u);
		expect(Object.keys(selectGates(['--quick']))).toContain('typecheck:validator');
		expect(Object.keys(selectGates([]))).toContain('validator:dry-run');
		expect(ciCommands).toEqual(expect.arrayContaining(['pnpm typecheck', 'pnpm validator:dry-run']));
	});

	it('generates the app\'s Worker types the same on every machine, and checks them before typechecking', () => {
		// The output path comes first: a path after `--env-file` reads as a second env file.
		expect(scripts['types:app']).toMatch(/^wrangler types worker-configuration\.d\.ts /u);
		expect(scripts['types:app']).toContain('--env-file /dev/null');
		expect(scripts['typecheck:app']).toMatch(/^pnpm types:app --check && /u);
	});

	it('runs every gate `pnpm test` runs as a CI step', () => {
		// CI splits the gates across parallel jobs rather than calling `pnpm test`.
		const commands = Object.entries(selectGates(['--tests']))
			.filter(([name]) => name !== 'prepare')
			.map(([, gate]) => `pnpm ${gate.command.slice(1).join(' ')}`);

		expect(scripts.test).toBe('node scripts/verify.mjs --tests');
		expect(commands).toEqual(expect.arrayContaining(['pnpm test:unit:coverage', 'pnpm test:integration --run']));
		expect(commands.filter(command => !ciCommands.some(step => step === command || step.startsWith(`${command} `)))).toEqual([]);
	});
});

describe('the deploy advances its promotion markers only behind every check', () => {
	it('marks the app pending just before the first remote change, and deployed only after deploy:verify', () => {
		const commands = scripts.deploy!.split('&&').map(command => command.trim());
		const pending = commands.indexOf('pnpm deploy:mark-app pending');

		// Only `&&`: nothing may swallow a failed step.
		expect(scripts.deploy).not.toMatch(/\|\||;|(^|[^&])&([^&]|$)/);
		expect(commands.slice(0, pending)).toEqual(['pnpm build', 'pnpm worker:dry-run', 'pnpm worker:smoke']);
		expect(commands[pending + 1]).toBe('pnpm db:migrate:remote');
		expect(commands.slice(-2)).toEqual(['pnpm deploy:verify', 'pnpm deploy:mark-app deployed']);
	});

	describe('the Deploy workflow', () => {
		const deploy = workflow('deploy.yml');
		const all = steps(deploy);
		const index = (match: (step: Step) => boolean) => all.findIndex(match);
		const release = index(step => step.with?.ref === '${{ steps.release.outputs.tag }}');
		const tooling = index(step => step.with?.path === '.deploy-tooling');
		const install = index(step => step.run === 'pnpm install --frozen-lockfile');
		const promote = index(step => step.run?.startsWith('node .deploy-tooling/scripts/deploy-promotion.mjs promote') === true);

		it('promotes through tooling from its own commit, after installing the release', () => {
			expect(release).toBeGreaterThanOrEqual(0);
			expect([release, tooling, install, promote]).toEqual([release, tooling, install, promote].toSorted((a, b) => a - b));
			expect(all[tooling]!.with).toMatchObject({
				'ref': '${{ github.sha }}',
				'sparse-checkout': 'scripts/deploy-promotion.mjs',
				'persist-credentials': false,
			});
			expect(all.some(step => step.run === 'echo /.deploy-tooling/ >> .git/info/exclude')).toBe(true);
		});

		it('cannot skip past a failed promotion, and deploys or moves a marker nowhere else', () => {
			expect(all[promote]!.if).toBeUndefined();
			expect(all[promote]!['continue-on-error']).toBeUndefined();
			expect(all[promote]!.env).toHaveProperty('INPUT_VALIDATOR', '${{ inputs.validator }}');
			for (const [position, step] of all.entries()) {
				if (position !== promote)
					expect(step.run ?? '').not.toMatch(/git push|git tag|wrangler|pnpm (run )?deploy/);
			}
		});

		it('offers exactly the validator modes the promotion accepts, and can tag', () => {
			expect(deploy.on.workflow_dispatch!.inputs!.validator!.options).toEqual(['auto', 'always', 'never']);
			expect(deploy.permissions).toHaveProperty('contents', 'write');
		});
	});
});
