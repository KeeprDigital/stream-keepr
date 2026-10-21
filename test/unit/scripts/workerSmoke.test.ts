import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	redactSmokeText,
	runWorkerSmoke,
	WorkerSmokeFailure,
} from '../../../scripts/worker-smoke/runner.mjs';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
} from '../../../shared/utils/localDeveloperAuth';

describe('the built Worker smoke runner', () => {
	const temporaryRoots: string[] = [];

	afterEach(async () => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
	});

	async function builtRepository() {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-test-'));
		temporaryRoots.push(repositoryRoot);
		await mkdir(join(repositoryRoot, '.output/server'), { recursive: true });
		await mkdir(join(repositoryRoot, 'node_modules/.bin'), { recursive: true });
		await writeFile(join(repositoryRoot, '.output/server/wrangler.json'), '{}');
		await writeFile(join(repositoryRoot, 'node_modules/.bin/wrangler'), '');
		return repositoryRoot;
	}

	function exitedProcess(status: number) {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			pid: number;
			kill: ReturnType<typeof vi.fn>;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.pid = 12345;
		child.kill = vi.fn();
		queueMicrotask(() => child.emit('exit', status, null));
		return child;
	}

	function livingProcess() {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			pid: number;
			kill: ReturnType<typeof vi.fn>;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.pid = 12346;
		child.kill = vi.fn(() => {
			queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
			return true;
		});
		return child;
	}

	function stubbornProcess() {
		const child = livingProcess();
		child.kill = vi.fn((signal: NodeJS.Signals) => {
			if (signal === 'SIGKILL')
				queueMicrotask(() => child.emit('exit', null, signal));
			return true;
		});
		return child;
	}

	it('refuses a missing production artifact without starting any process', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-test-'));
		temporaryRoots.push(repositoryRoot);
		const spawnProcess = vi.fn();

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'precondition',
			failureClass: 'missing-artifact',
		});
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	it('distinguishes a Worker that exits during startup from readiness timeout', async () => {
		const repositoryRoot = await builtRepository();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => exitedProcess(17));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'startup',
			failureClass: 'process-exit',
			detail: { actual: 'exit 17' },
		});
		expect(spawnProcess).toHaveBeenCalledTimes(2);
	});

	it('restores both staged configuration files byte-for-byte after startup failure', async () => {
		const repositoryRoot = await builtRepository();
		const stagedEnv = join(repositoryRoot, '.output/server/.env');
		const stagedDevVars = join(repositoryRoot, '.output/server/.dev.vars');
		const originalEnv = Buffer.from('NUXT_BETTER_AUTH_SECRET=developer-value\n');
		const originalDevVars = Buffer.from('NUXT_ADMIN_BOOTSTRAP_TOKEN=older-preview\n');
		vi.stubEnv('NUXT_DEVELOPER_CREDENTIAL', 'must-not-reach-wrangler');
		await writeFile(stagedEnv, originalEnv);
		await writeFile(stagedDevVars, originalDevVars);
		let generatedBody = '';
		const spawnProcess = vi.fn()
			.mockImplementationOnce((_command, _arguments, options) => {
				generatedBody = readFileSync(stagedEnv, 'utf8');
				expect(generatedBody).not.toContain('developer-value');
				expect(generatedBody).toContain('NUXT_BETTER_AUTH_SECRET=');
				expect(generatedBody).toContain('NUXT_ADMIN_BOOTSTRAP_TOKEN=');
				expect(generatedBody).toContain('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=');
				expect(generatedBody).toContain('NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY=');
				expect(existsSync(stagedDevVars)).toBe(false);
				expect(options.env).toMatchObject({ NODE_ENV: 'production' });
				expect(options.env.NUXT_DEVELOPER_CREDENTIAL).toBeUndefined();
				expect(options.env.HOME).toBeUndefined();
				return exitedProcess(0);
			})
			.mockImplementationOnce(() => exitedProcess(17));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'startup',
		});
		expect(generatedBody).not.toBe('');
		expect(await readFile(stagedEnv)).toEqual(originalEnv);
		expect(await readFile(stagedDevVars)).toEqual(originalDevVars);
	});

	it('terminates an interrupted migration and removes its temporary binding state', async () => {
		const repositoryRoot = await builtRepository();
		const stagedEnv = join(repositoryRoot, '.output/server/.env');
		const stagedDevVars = join(repositoryRoot, '.output/server/.dev.vars');
		const originalEnv = Buffer.from('original env\n');
		const originalDevVars = Buffer.from('original dev vars\n');
		await writeFile(stagedEnv, originalEnv);
		await writeFile(stagedDevVars, originalDevVars);
		const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('stream-keepr-worker-smoke-')));
		const migration = livingProcess();

		await expect(runWorkerSmoke({
			repositoryRoot,
			spawnProcess: vi.fn(() => migration),
			hardTimeoutMs: 5,
		})).rejects.toMatchObject({
			probe: 'runner',
			failureClass: 'hard-timeout',
		});

		expect(migration.kill).toHaveBeenCalledWith('SIGTERM');
		expect(await readFile(stagedEnv)).toEqual(originalEnv);
		expect(await readFile(stagedDevVars)).toEqual(originalDevVars);
		const after = (await readdir(tmpdir())).filter(name => name.startsWith('stream-keepr-worker-smoke-'));
		expect(after.filter(name => !before.has(name))).toEqual([]);
	});

	it('terminates setup when the caller interrupts the smoke run', async () => {
		const repositoryRoot = await builtRepository();
		const migration = livingProcess();
		const interrupted = new AbortController();
		const spawnProcess = vi.fn(() => {
			queueMicrotask(() => interrupted.abort(new WorkerSmokeFailure('runner', 'interrupted')));
			return migration;
		});

		await expect(runWorkerSmoke({
			repositoryRoot,
			spawnProcess,
			signal: interrupted.signal,
		})).rejects.toMatchObject({
			probe: 'runner',
			failureClass: 'interrupted',
		});
		expect(migration.kill).toHaveBeenCalledWith('SIGTERM');
	});

	it('names an API-boundary probe failure instead of accepting a reachable Worker', async () => {
		const repositoryRoot = await builtRepository();
		const worker = livingProcess();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => worker);
		const fetchRequest = vi.fn()
			.mockResolvedValueOnce(Response.json({ serverTime: Date.now() }))
			.mockResolvedValueOnce(Response.json({ events: [] }));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest })).rejects.toMatchObject({
			probe: 'api-boundary',
			failureClass: 'unexpected-status',
			detail: { expected: 401, actual: 200 },
		});
		expect(worker.kill).toHaveBeenCalled();
	});

	/**
	 * What a limiting Worker answers the rate-limit scenario: three refused
	 * passwords, a 429, then the independent client's sign-in. `overrides`
	 * replaces answers by position.
	 */
	function rateLimitScenario(overrides: Record<number, Response> = {}) {
		const answers = [
			new Response(null, { status: 401 }),
			new Response(null, { status: 401 }),
			new Response(null, { status: 401 }),
			new Response('{}', { status: 429, headers: { 'x-retry-after': '10' } }),
			new Response('{}', { status: 200 }),
		];
		return answers.map((answer, index) => overrides[index] ?? answer);
	}

	/**
	 * A Worker that is ready, refuses the API boundary, bootstraps its operator,
	 * then answers the smoke's next requests with `answers`, in order.
	 */
	async function bootstrappedWorkerAnswering(answers: Response[]) {
		const repositoryRoot = await builtRepository();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => livingProcess());
		const fetchRequest = vi.fn();
		for (const answer of [
			Response.json({ serverTime: Date.now() }),
			new Response(null, { status: 401 }),
			Response.json({ outcome: 'created' }),
			...answers,
		]) {
			fetchRequest.mockResolvedValueOnce(answer);
		}
		return { run: runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest }), fetchRequest };
	}

	/** Answers the rate-limit scenario with `scenario`, then fails the next probe with a 500. */
	async function rateLimitAnswering(scenario: Response[]) {
		const { run, fetchRequest } = await bootstrappedWorkerAnswering([...scenario, new Response(null, { status: 500 })]);
		return { outcome: await run.catch(error => error), fetchRequest };
	}

	/**
	 * Built Workers limit sign-in (#697). The first case is what this artifact
	 * did before `rateLimit` was stated: every attempt reached the password check.
	 */
	it('refuses a Worker that admits a fourth sign-in attempt from one client', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({ 3: new Response(null, { status: 401 }) }));

		expect(outcome).toMatchObject({
			probe: 'auth-rate-limit-refusal',
			failureClass: 'unexpected-status',
			detail: { expected: 429, actual: 401 },
		});
	});

	it('refuses a Worker that limits a client it should not have limited yet', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({ 2: new Response(null, { status: 429 }) }));

		expect(outcome).toMatchObject({ probe: 'auth-rate-limit-admitted', failureClass: 'unexpected-status' });
	});

	it('refuses a 429 that names no retry delay', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({ 3: new Response('{}', { status: 429 }) }));

		expect(outcome).toMatchObject({ probe: 'auth-rate-limit-refusal', failureClass: 'unexpected-body' });
	});

	it('refuses a Worker whose limit also refuses an independent client', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({ 4: new Response(null, { status: 429 }) }));

		expect(outcome).toMatchObject({
			probe: 'auth-rate-limit-independent-client',
			failureClass: 'unexpected-status',
			detail: { expected: 200, actual: 429 },
		});
	});

	it('names each client in cf-connecting-ip, varies x-forwarded-for, and keeps both off the probes that follow', async () => {
		const { outcome, fetchRequest } = await rateLimitAnswering(rateLimitScenario());

		// The first probe after the scenario is the origin refusal, answered 500 here.
		expect(outcome).toMatchObject({ probe: 'auth-origin-refusal', detail: { actual: 500 } });
		const headers = fetchRequest.mock.calls.slice(3).map(([, init]) => new Headers(init?.headers));
		const limited = headers.slice(0, 4);
		const independent = headers[4]!;
		const following = headers[5]!;

		expect(new Set(limited.map(each => each.get('cf-connecting-ip'))).size).toBe(1);
		expect(new Set(limited.map(each => each.get('x-forwarded-for'))).size).toBeGreaterThan(1);
		expect(independent.get('cf-connecting-ip')).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
		expect(independent.get('cf-connecting-ip')).not.toBe(limited[0]!.get('cf-connecting-ip'));
		expect(following.has('cf-connecting-ip')).toBe(false);
		expect(following.has('x-forwarded-for')).toBe(false);
	});

	/**
	 * A Worker that reaches sign-in and answers it with `setCookies`, then
	 * refuses the first signed-in request, so a cookie the probe accepts shows
	 * up as the next probe's failure.
	 */
	async function signInAnswering(setCookies: string[]) {
		const signIn = new Response('{}', { status: 200 });
		for (const value of setCookies)
			signIn.headers.append('set-cookie', value);
		const { run } = await bootstrappedWorkerAnswering([
			...rateLimitScenario(),
			new Response(null, { status: 403 }),
			signIn,
			new Response(null, { status: 401 }),
		]);
		return await run;
	}

	/**
	 * The built Worker is the artifact a deploy uploads, so its session cookie
	 * is the production one even though the smoke run reaches it over plain
	 * http: `Secure` and `__Secure-`-prefixed. The first case is what the built
	 * Worker actually set before the option was stated, measured on #621.
	 */
	it.each([
		['unprefixed and not Secure', 'better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax'],
		['named __Secure- but not Secure', '__Secure-better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax'],
		['Secure but not named __Secure-', 'better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure'],
		['without HttpOnly', '__Secure-better-auth.session_token=t; Max-Age=604800; Path=/; Secure; SameSite=Lax'],
		['without SameSite=Lax', '__Secure-better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=None'],
		['scoped below the root path', '__Secure-better-auth.session_token=t; Max-Age=604800; Path=/api; HttpOnly; Secure; SameSite=Lax'],
	])('refuses a production session cookie %s', async (_case, setCookie) => {
		await expect(signInAnswering([setCookie])).rejects.toMatchObject({
			probe: 'auth-sign-in',
			failureClass: 'session-cookie-attributes',
		});
	});

	it('names a sign-in that sets cookies but no session token', async () => {
		await expect(signInAnswering(['unrelated=1; Path=/'])).rejects.toMatchObject({
			probe: 'auth-sign-in',
			failureClass: 'session-cookie-missing',
		});
	});

	it('accepts a __Secure- prefixed, Secure session cookie and signs in with it', async () => {
		await expect(signInAnswering([
			'__Secure-better-auth.session_token=t; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
		])).rejects.toMatchObject({
			probe: 'authenticated-api',
			failureClass: 'unexpected-status',
		});
	});

	it('escalates cleanup to SIGKILL and waits for the child exit', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const repositoryRoot = await builtRepository();
		const worker = stubbornProcess();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => worker);
		const fetchRequest = vi.fn()
			.mockResolvedValueOnce(Response.json({ serverTime: Date.now() }))
			.mockResolvedValueOnce(Response.json({ events: [] }));
		const outcome = runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest }).catch(error => error);

		// Bounded by real time, not event-loop turns: the runner does real
		// filesystem work first, and a slow CI machine needs more turns than a
		// fixed count allowed. `vi.waitFor` keeps real timers under fake ones.
		await vi.waitFor(() => expect(worker.kill).toHaveBeenCalledWith('SIGTERM'), { timeout: 10_000 });
		await vi.advanceTimersByTimeAsync(2_000);

		expect(await outcome).toMatchObject({
			probe: 'api-boundary',
			failureClass: 'unexpected-status',
		});
		expect(worker.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
	});

	it('reports readiness timeout separately while the Worker is still running', async () => {
		const repositoryRoot = await builtRepository();
		const worker = livingProcess();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => worker);

		await expect(runWorkerSmoke({
			repositoryRoot,
			spawnProcess,
			fetchRequest: vi.fn().mockRejectedValue(new Error('not ready')),
			readinessTimeoutMs: 5,
		})).rejects.toMatchObject({
			probe: 'readiness',
			failureClass: 'timeout',
		});
		expect(worker.kill).toHaveBeenCalled();
	});

	it('redacts generated values, cookies, digests, resource identities, and full URLs', () => {
		const secret = 'generated-secret-value';
		const digest = 'a'.repeat(64);
		const text = [
			secret,
			'better-auth.session_token=session-cookie-value',
			digest,
			'/api/events/42/graphics-assets/550e8400-e29b-41d4-a716-446655440000',
			'{"eventId":42,"assetId":"asset-in-a-log"}',
			'https://127.0.0.1:8787/api/events/42?credential=secret',
		].join(' ');
		const redacted = redactSmokeText(text, [secret]);

		expect(redacted).not.toContain(secret);
		expect(redacted).not.toContain('session-cookie-value');
		expect(redacted).not.toContain(digest);
		expect(redacted).not.toContain('550e8400-e29b-41d4-a716-446655440000');
		expect(redacted).not.toContain('asset-in-a-log');
		expect(redacted).not.toContain('https://127.0.0.1:8787');
		expect(redacted).toContain('[redacted]');
	});

	it('builds once, then runs the dry run and smoke command in verify and CI', async () => {
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts['worker:smoke']).toMatch(/node scripts\/worker-smoke\.mjs$/u);
		expect(packageJson.scripts['worker:smoke']).not.toContain('build');

		// `pnpm verify` is a gate graph (`scripts/verify.mjs`), not a command chain.
		expect(packageJson.scripts.verify).toBe('node scripts/verify.mjs');
		const { GATES } = await import('../../../scripts/verify.mjs');
		expect(GATES['worker:dry-run']!.after).toEqual(['build']);
		expect(GATES['worker:smoke']!.after).toEqual(['worker:dry-run']);
		expect(Object.values(GATES).filter(gate => gate.command.includes('build'))).toHaveLength(1);

		const ci = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
		const workerGuard = ci.slice(ci.indexOf('  worker-guard:'));
		expect(workerGuard.indexOf('pnpm build')).toBeLessThan(workerGuard.indexOf('pnpm worker:dry-run'));
		expect(workerGuard.indexOf('pnpm worker:dry-run')).toBeLessThan(workerGuard.indexOf('pnpm worker:smoke'));
		expect(workerGuard.match(/pnpm build/gu)).toHaveLength(1);
	});

	it('typechecks and bundles the silent-video validator Worker in verify and CI', async () => {
		// #618: the validator deploys from its own wrangler.jsonc, so the app's
		// programs and build never see it.
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts['typecheck:validator']).toContain('-p workers/silent-video-validator/tsconfig.json');
		expect(packageJson.scripts['validator:dry-run']).toContain('--config workers/silent-video-validator/wrangler.jsonc');
		// CI's `checks` job runs `pnpm typecheck`, so the validator program rides on it.
		expect(packageJson.scripts.typecheck).toMatch(/&& pnpm typecheck:validator(?: |$)/u);

		const { selectGates } = await import('../../../scripts/verify.mjs');
		expect(Object.keys(selectGates([]))).toEqual(expect.arrayContaining(['typecheck:validator', 'validator:dry-run']));
		expect(Object.keys(selectGates(['--quick']))).toContain('typecheck:validator');

		const ci = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
		const steps = [...ci.matchAll(/run: (pnpm .+)$/gmu)].map(match => match[1]!);
		expect(steps).toEqual(expect.arrayContaining(['pnpm typecheck', 'pnpm validator:dry-run']));
	});

	it('checks the app\'s generated Worker types are fresh and machine-independent in verify and CI', async () => {
		// The root worker-configuration.d.ts went stale unnoticed, and regenerating
		// it on a dev machine wrote that machine's `.env` names into `Env`.
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		const generate = packageJson.scripts['types:app'];
		// The output path comes first: `--env-file` takes an array, so a path after
		// it would be read as a second env file.
		expect(generate).toMatch(/^wrangler types worker-configuration\.d\.ts /u);
		expect(generate).toContain('--config wrangler.dev.jsonc');
		// No `.env` or `.dev.vars` is read, so every checkout generates the same file.
		expect(generate).toContain('--env-file /dev/null');
		// `pnpm typecheck` runs `typecheck:app`, and verify runs it as a first-stage gate.
		expect(packageJson.scripts['typecheck:app']).toMatch(/^pnpm types:app --check && /u);
	});

	it('runs `pnpm test` as the test gates of verify\'s graph', async () => {
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		const { selectGates } = await import('../../../scripts/verify.mjs');
		const suites = Object.keys(selectGates(['--tests']));

		// One list of suites: `pnpm test` is verify's graph, not a second chain.
		expect(packageJson.scripts.test).toBe('node scripts/verify.mjs --tests');
		expect(suites).toEqual(expect.arrayContaining(['test:unit:coverage', 'test:integration', 'accept:still-images']));
		expect(suites).not.toContain('lint');
		expect(suites).not.toContain('build');
	});

	it('runs every gate `pnpm test` runs as a CI step', async () => {
		// CI splits the gates across parallel jobs rather than calling `pnpm test`,
		// so a gate added to verify must be added to ci.yml too.
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const ci = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
		const steps = [...ci.matchAll(/run: (pnpm .+)$/gmu)].map(match => match[1]!);
		const { selectGates } = await import('../../../scripts/verify.mjs');
		const commands = Object.entries(selectGates(['--tests']))
			.filter(([name]) => name !== 'prepare')
			.map(([, gate]) => `pnpm ${gate.command.slice(1).join(' ')}`);

		expect(commands.length).toBeGreaterThan(4);
		expect(commands.filter(command => !steps.some(step => step === command || step.startsWith(`${command} `)))).toEqual([]);
	});

	/**
	 * #519: the launchers are the only place the bypass is named, so the launchers
	 * are what this has to read.
	 *
	 * The scripts *are* the mechanism — there is no file to check, and a
	 * `:bypass` suffix is the one mark that says a launcher arms it. Each
	 * bypassed launcher is its unbypassed twin plus the assignment, so the suffix
	 * never changes where a launcher binds: `dev:local:bypass` is on `0.0.0.0`
	 * because `dev:local` is, which is the exposure ADR-0018 accepts.
	 */
	it('names the bypass in the :bypass launchers and nowhere else', async () => {
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		const assignment = `${LOCAL_AUTH_BYPASS_NAME}=${LOCAL_AUTH_BYPASS_ENABLED_VALUE}`;

		expect(packageJson.scripts['dev:bypass']).toBe(`${assignment} pnpm dev`);
		expect(packageJson.scripts['preview:bypass']).toBe(`${assignment} pnpm preview`);
		expect(packageJson.scripts['dev:local:bypass']).toBe(`${assignment} pnpm dev:local`);

		for (const [name, script] of Object.entries(packageJson.scripts)) {
			if (name.endsWith(':bypass'))
				continue;
			expect(script, `${name} must not arm the bypass`).not.toContain(LOCAL_AUTH_BYPASS_NAME);
		}
	});

	it('keeps the bypass out of .env.example, which is the file it must never be in', async () => {
		// The launchers are the whole mechanism, so the example file a developer
		// copies must not offer the name at all — a blank assignment there reads as
		// "set me", which is the confusion #519 removed.
		const repositoryRoot = join(import.meta.dirname, '../../..');
		const example = await readFile(join(repositoryRoot, '.env.example'), 'utf8');

		expect(example).not.toContain('LOCAL_AUTH_BYPASS');
	});
});
