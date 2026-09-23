import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEPLOY_DAY, HARNESSES, main } from '../../../scripts/accept.mjs';
import { PAGES, main as runBrowserPage } from '../../../scripts/run-browser-page-acceptance.mjs';
import { GATES } from '../../../scripts/verify.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

/**
 * `scripts/accept.mjs` is the one list of acceptance harnesses; package.json,
 * verify, CI, and README § Deploy day all name harnesses through it.
 */
describe('pnpm accept', () => {
	it('points every harness at a runner that exists', async () => {
		for (const { script: [file] } of Object.values(HARNESSES))
			await expect(access(join(repositoryRoot, 'scripts', file!))).resolves.toBeUndefined();
	});

	it('lists every run-* runner, so none is reachable only by path', async () => {
		const runners = (await readdir(join(repositoryRoot, 'scripts'))).filter(file => /^run-.+\.mjs$/u.test(file));
		const listed = new Set(Object.values(HARNESSES).map(({ script: [file] }) => file));

		expect(runners.filter(file => !listed.has(file))).toEqual([]);
	});

	it('runs only harnesses with a deployed mode on deploy day', () => {
		expect(DEPLOY_DAY).toHaveLength(7);
		expect(DEPLOY_DAY.filter(name => !(name in HARNESSES) || HARNESSES[name]?.deployed === false)).toEqual([]);
	});

	it('names only known harnesses in verify gates', () => {
		const accepted = Object.values(GATES)
			.filter(gate => gate.command[1] === 'accept')
			.map(gate => gate.command[2]!);

		expect(accepted.length).toBeGreaterThan(0);
		expect(accepted.filter(name => !(name in HARNESSES))).toEqual([]);
	});

	it('routes browser-page harnesses to pages the runner knows', () => {
		const pages = Object.values(HARNESSES)
			.filter(({ script: [file] }) => file === 'run-browser-page-acceptance.mjs')
			.map(({ script: [, page] }) => page!);

		expect(pages.sort()).toEqual(Object.keys(PAGES).sort());
	});

	it('refuses an unknown browser page rather than running nothing', async () => {
		await expect(runBrowserPage(['node', 'run-browser-page-acceptance.mjs', 'nope'])).rejects.toThrow(/expected one of/u);
	});

	it('leaves no package script calling a runner directly', async () => {
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts.accept).toBe('node scripts/accept.mjs');
		expect(Object.values(packageJson.scripts).filter(command => /scripts\/run-/u.test(command))).toEqual([]);
	});

	it('refuses an unknown harness and a deployed run of a local-only one', async () => {
		const exitCode = process.exitCode;
		vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		try {
			await main(['node', 'accept.mjs', 'nope']);
			expect(process.exitCode).toBe(2);
			process.exitCode = undefined;
			await main(['node', 'accept.mjs', 'animation-effects', '--deployed']);
			expect(process.exitCode).toBe(2);
		}
		finally {
			process.exitCode = exitCode;
			vi.restoreAllMocks();
		}
	});
});
