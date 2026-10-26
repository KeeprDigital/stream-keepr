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
			.mockResolvedValueOnce(Response.json({
				serverTime: Date.now(),
			}))
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
			new Response('{}', {
				status: 429,
				headers: { 'x-retry-after': '10' },
			}),
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
			Response.json({
				serverTime: Date.now(),
			}),
			new Response(null, { status: 401 }),
			Response.json({ outcome: 'created' }),
			...answers,
		]) {
			fetchRequest.mockResolvedValueOnce(answer);
		}
		return {
			run: runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest }),
			fetchRequest,
		};
	}

	/** Answers the rate-limit scenario with `scenario`, then fails the next probe with a 500. */
	async function rateLimitAnswering(scenario: Response[]) {
		const { run, fetchRequest } = await bootstrappedWorkerAnswering([
			...scenario,
			new Response(null, { status: 500 }),
		]);
		return { outcome: await run.catch(error => error), fetchRequest };
	}

	/**
	 * Built Workers limit sign-in (#697). The first case is what this artifact
	 * did before `rateLimit` was stated: every attempt reached the password check.
	 */
	it('refuses a Worker that admits a fourth sign-in attempt from one client', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({
			3: new Response(null, { status: 401 }),
		}));

		expect(outcome).toMatchObject({
			probe: 'auth-rate-limit-refusal',
			failureClass: 'unexpected-status',
			detail: { expected: 429, actual: 401 },
		});
	});

	it('refuses a Worker that limits a client it should not have limited yet', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({
			2: new Response(null, { status: 429 }),
		}));

		expect(outcome).toMatchObject({ probe: 'auth-rate-limit-admitted', failureClass: 'unexpected-status' });
	});

	it('refuses a 429 that names no retry delay', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({
			3: new Response('{}', { status: 429 }),
		}));

		expect(outcome).toMatchObject({ probe: 'auth-rate-limit-refusal', failureClass: 'unexpected-body' });
	});

	it('refuses a Worker whose limit also refuses an independent client', async () => {
		const { outcome } = await rateLimitAnswering(rateLimitScenario({
			4: new Response(null, { status: 429 }),
		}));

		expect(outcome).toMatchObject({
			probe: 'auth-rate-limit-independent-client',
			failureClass: 'unexpected-status',
			detail: { expected: 200, actual: 429 },
		});
	});

	it('names each client in cf-connecting-ip, varies x-forwarded-for, and keeps both off the probes that follow', async () => {
		const { outcome, fetchRequest } = await rateLimitAnswering(rateLimitScenario());

		// The first probe after the scenario is the origin refusal, answered 500 here.
		expect(outcome).toMatchObject({
			probe: 'auth-origin-refusal',
			detail: { actual: 500 },
		});
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
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
		});
		const repositoryRoot = await builtRepository();
		const worker = stubbornProcess();
		const spawnProcess = vi.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => worker);
		const fetchRequest = vi.fn()
			.mockResolvedValueOnce(Response.json({
				serverTime: Date.now(),
			}))
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
});
