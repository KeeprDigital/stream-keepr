import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const PIXEL_PNG = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const PIXEL_JPEG = Uint8Array.from(Buffer.from(
	'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
	'base64',
));

export class WorkerSmokeFailure extends Error {
	constructor(probe, failureClass, detail = {}) {
		super(`worker:smoke ${probe} failed (${failureClass})`);
		this.name = 'WorkerSmokeFailure';
		this.probe = probe;
		this.failureClass = failureClass;
		this.detail = detail;
	}
}

export function redactSmokeText(value, secrets = []) {
	let redacted = String(value);
	for (const secret of [...secrets].filter(secret => typeof secret === 'string' && secret.length > 0))
		redacted = redacted.replaceAll(secret, '[redacted]');
	return redacted
		.replace(/https?:\/\/[^\s"'`]+/giu, '[redacted-url]')
		.replace(/((?:__Secure-)?better-auth\.session_token=)[^;\s]+/giu, '$1[redacted]')
		.replace(/\b[a-f0-9]{64}\b/giu, '[redacted-digest]')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[redacted-id]')
		.replace(/("(?:eventId|assetId|revisionId|operationId|screenId|userId|id)"\s*:\s*)(?:"[^"]+"|\d+)/giu, '$1"[redacted-id]"')
		.replace(/\/(events|screens|graphics-assets|ingestion-operations|revisions)\/[^/\s?]+/giu, '/$1/[redacted-id]');
}

export function formatWorkerSmokeFailure(error) {
	const detail = error?.detail ?? {};
	const lines = [
		`worker:smoke: ${error?.probe ?? 'runner'} failed (${error?.failureClass ?? 'unexpected-error'})`,
	];
	if (detail.expected !== undefined)
		lines.push(`  expected: ${detail.expected}`);
	if (detail.actual !== undefined)
		lines.push(`  actual: ${detail.actual}`);
	if (error?.workerLogTail) {
		lines.push('  Worker log tail:');
		for (const line of error.workerLogTail.split('\n'))
			lines.push(`    ${line}`);
	}
	return `${lines.join('\n')}\n`;
}

/**
 * @param {{
 *   repositoryRoot: string,
 *   spawnProcess?: Function,
 *   fetchRequest?: Function,
 *   readinessTimeoutMs?: number,
 *   hardTimeoutMs?: number,
 *   signal?: AbortSignal,
 * }} options
 */
export async function runWorkerSmoke({
	repositoryRoot,
	spawnProcess = spawn,
	fetchRequest = fetch,
	readinessTimeoutMs = 30_000,
	hardTimeoutMs = 300_000,
	signal,
}) {
	const configPath = join(repositoryRoot, '.output/server/wrangler.json');
	if (!existsSync(configPath)) {
		throw new WorkerSmokeFailure('precondition', 'missing-artifact', {
			expected: '.output/server/wrangler.json from pnpm build',
			actual: 'missing',
		});
	}

	const wranglerPath = join(repositoryRoot, 'node_modules/.bin/wrangler');
	const stagedEnvPath = join(repositoryRoot, '.output/server/.env');
	const stagedDevVarsPath = join(repositoryRoot, '.output/server/.dev.vars');
	const generated = generatedConfiguration();
	const sensitiveValues = [...generated.secrets];
	const workerLog = new BoundedLogTail();
	const timeout = new AbortController();
	const hardTimeout = setTimeout(() => timeout.abort(
		new WorkerSmokeFailure('runner', 'hard-timeout', {
			expected: `completion within ${hardTimeoutMs}ms`,
			actual: 'hard timeout reached',
		}),
	), hardTimeoutMs);
	const smokeSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
	const startedAt = Date.now();
	let persistencePath;
	let activeChild;
	let activeChildExit;
	let stagedConfiguration;
	try {
		stagedConfiguration = await relocateConfigurations([
			stagedEnvPath,
			stagedDevVarsPath,
		]);
		await writeFile(stagedEnvPath, generated.body, { mode: 0o600 });
		await rm(stagedDevVarsPath, { force: true });
		persistencePath = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-'));
		const childProcessOptions = {
			cwd: repositoryRoot,
			env: hermeticChildEnvironment(),
			stdio: ['ignore', 'pipe', 'pipe'],
		};
		const migration = spawnProcess(wranglerPath, [
			'd1',
			'migrations',
			'apply',
			'DB',
			'--local',
			'--config',
			configPath,
			'--persist-to',
			persistencePath,
		], { ...childProcessOptions, detached: true });
		activeChild = migration;
		captureChildOutput(migration, workerLog);
		activeChildExit = childExit(migration, 'setup');
		const migrationExit = await abortable(activeChildExit, smokeSignal);
		if (migrationExit.status !== 0) {
			throw new WorkerSmokeFailure('setup', 'migration-exit', {
				expected: 'exit 0',
				actual: exitDescription(migrationExit),
			});
		}
		activeChild = undefined;
		activeChildExit = undefined;

		const port = await availableLoopbackPort();
		activeChild = spawnProcess(wranglerPath, [
			'dev',
			'--local',
			'--config',
			configPath,
			'--persist-to',
			persistencePath,
			'--ip',
			'127.0.0.1',
			'--port',
			String(port),
		], { ...childProcessOptions, detached: true });
		captureChildOutput(activeChild, workerLog);
		activeChildExit = childExit(activeChild, 'startup');
		await waitUntilReady({
			origin: `http://127.0.0.1:${port}`,
			fetchRequest,
			exit: activeChildExit,
			readinessTimeoutMs,
			signal: smokeSignal,
		});
		await runProductProbes({
			origin: `http://127.0.0.1:${port}`,
			fetchRequest,
			generated,
			sensitiveValues,
			signal: smokeSignal,
		});
		return { elapsedMs: Date.now() - startedAt };
	}
	catch (error) {
		const failure = error instanceof WorkerSmokeFailure
			? error
			: new WorkerSmokeFailure('runner', 'unexpected-error', {
					expected: 'completed smoke run',
					actual: error?.name ?? 'unknown failure',
				});
		failure.workerLogTail = redactSmokeText(workerLog.text(), sensitiveValues);
		throw failure;
	}
	finally {
		clearTimeout(hardTimeout);
		try {
			await terminateChild(activeChild, activeChildExit);
		}
		finally {
			if (stagedConfiguration)
				await Promise.all(stagedConfiguration.map(restoreConfiguration));
			if (persistencePath)
				await rm(persistencePath, { recursive: true, force: true });
		}
	}
}

function generatedConfiguration() {
	// Deliberately omit Ably and external Melee credentials. Publication is
	// disabled without Ably, and the Melee persistence probe saves disabled
	// configuration, so this process has neither authority nor reason to leave
	// loopback.
	const randomSecret = (bytes = 32) => randomBytes(bytes).toString('base64url');
	const base64Key = () => randomBytes(32).toString('base64');
	const entries = {
		NUXT_ADMIN_BOOTSTRAP_TOKEN: randomSecret(),
		NUXT_BETTER_AUTH_SECRET: randomSecret(48),
		NUXT_GRAPHICS_ADMIN_TOKEN: randomSecret(),
		NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: base64Key(),
		NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY: base64Key(),
		NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION: '1',
	};
	return {
		entries,
		secrets: Object.entries(entries)
			.filter(([name]) => name !== 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION')
			.map(([, entry]) => entry),
		body: `${Object.entries(entries).map(([name, entry]) => `${name}=${entry}`).join('\n')}\n`,
	};
}

function hermeticChildEnvironment() {
	const allowedNames = [
		'PATH',
		'TMPDIR',
		'TEMP',
		'TMP',
		'SystemRoot',
		'WINDIR',
		'ComSpec',
		'PATHEXT',
	];
	return Object.fromEntries([
		...allowedNames
			.filter(name => process.env[name] !== undefined)
			.map(name => [name, process.env[name]]),
		['NODE_ENV', 'production'],
	]);
}

async function relocateConfigurations(paths) {
	const relocated = [];
	try {
		for (const path of paths)
			relocated.push(await relocateConfiguration(path));
		return relocated;
	}
	catch (error) {
		await Promise.all(relocated.map(restoreConfiguration));
		throw error;
	}
}

async function relocateConfiguration(path) {
	const backupPath = `${path}.worker-smoke-backup-${randomUUID()}`;
	try {
		await rename(path, backupPath);
		return { path, backupPath };
	}
	catch (error) {
		if (error?.code === 'ENOENT')
			return { path, backupPath: null };
		throw error;
	}
}

async function restoreConfiguration({ path, backupPath }) {
	await rm(path, { force: true });
	if (backupPath)
		await rename(backupPath, path);
}

function childExit(child, probe) {
	return new Promise((resolve, reject) => {
		child.once('error', error => reject(new WorkerSmokeFailure(probe, 'spawn-error', {
			expected: 'child process started',
			actual: error?.code ?? 'spawn failed',
		})));
		child.once('exit', (status, signal) => resolve({ status, signal }));
	});
}

function exitDescription({ status, signal }) {
	return status === null ? `signal ${signal ?? 'unknown'}` : `exit ${status}`;
}

async function availableLoopbackPort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	if (!address || typeof address === 'string')
		throw new WorkerSmokeFailure('setup', 'loopback-port-unavailable');
	return address.port;
}

async function waitUntilReady({ origin, fetchRequest, exit, readinessTimeoutMs, signal }) {
	const deadline = Date.now() + readinessTimeoutMs;
	while (Date.now() < deadline) {
		const outcome = await Promise.race([
			fetchRequest(`${origin}/api/time`, { signal })
				.then(async response => ({ kind: 'response', response, body: await response.json().catch(() => null) }))
				.catch(() => ({ kind: 'unreachable' })),
			exit.then(result => ({ kind: 'exit', result })),
		]);
		if (outcome.kind === 'exit') {
			throw new WorkerSmokeFailure('startup', 'process-exit', {
				expected: 'running Worker',
				actual: exitDescription(outcome.result),
			});
		}
		if (outcome.kind === 'response'
			&& outcome.response.status === 200
			&& typeof outcome.body?.serverTime === 'number') {
			return;
		}
		await abortable(new Promise(resolve => setTimeout(resolve, 50)), signal);
	}
	throw new WorkerSmokeFailure('readiness', 'timeout', {
		expected: 'GET /api/time status 200',
		actual: `no successful response within ${readinessTimeoutMs}ms`,
	});
}

async function abortable(promise, signal) {
	if (!signal)
		return await promise;
	if (signal.aborted)
		throw signal.reason;
	return await new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener('abort', aborted, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
	});
}

async function terminateChild(child, exit) {
	if (!child)
		return;
	const alreadyExited = exit
		? await Promise.race([exit.then(() => true, () => true), Promise.resolve(false)])
		: false;
	if (alreadyExited)
		return;
	signalChild(child, 'SIGTERM');
	const stopped = exit
		? await Promise.race([
				exit.then(() => true, () => true),
				new Promise(resolve => setTimeout(resolve, 2_000, false)),
			])
		: false;
	if (!stopped)
		signalChild(child, 'SIGKILL');
	if (!stopped && exit) {
		const killed = await Promise.race([
			exit.then(() => true, () => true),
			new Promise(resolve => setTimeout(resolve, 2_000, false)),
		]);
		if (!killed) {
			throw new WorkerSmokeFailure('cleanup', 'child-exit-timeout', {
				expected: 'child exited after SIGKILL',
				actual: 'still running after 2000ms',
			});
		}
	}
}

function signalChild(child, signal) {
	if (child.spawnfile && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		}
		catch {
			// A child that left between the check and signal needs no fallback;
			// child.kill is harmless there and also covers non-POSIX platforms.
		}
	}
	child.kill(signal);
}

class BoundedLogTail {
	#lines = [];

	append(chunk) {
		this.#lines.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
		this.#lines = this.#lines.slice(-40);
		while (this.text().length > 6_000)
			this.#lines.shift();
	}

	text() {
		return this.#lines.join('\n');
	}
}

function captureChildOutput(child, tail) {
	child.stdout?.on('data', chunk => tail.append(chunk));
	child.stderr?.on('data', chunk => tail.append(chunk));
}

async function runProductProbes({ origin, fetchRequest, generated, sensitiveValues, signal }) {
	await expectStatus({
		probe: 'api-boundary',
		expected: 401,
		origin,
		path: '/api/events',
		fetchRequest,
		signal,
	});

	const operatorEmail = `worker-smoke-${randomBytes(8).toString('hex')}@keepr.invalid`;
	const operatorPassword = randomBytes(24).toString('base64url');
	sensitiveValues.push(operatorEmail, operatorPassword);
	await expectStatus({
		probe: 'first-admin-bootstrap',
		expected: 200,
		origin,
		path: '/api/bootstrap/ensure-admin',
		fetchRequest,
		signal,
		init: jsonRequest({
			email: operatorEmail,
			password: operatorPassword,
			name: 'Built Worker smoke operator',
		}, { 'x-admin-bootstrap-token': generated.entries.NUXT_ADMIN_BOOTSTRAP_TOKEN }),
	});

	const signInBody = { email: operatorEmail, password: operatorPassword };
	await expectStatus({
		probe: 'auth-origin-refusal',
		expected: 403,
		origin,
		path: '/api/auth/sign-in/email',
		fetchRequest,
		signal,
		init: jsonRequest(signInBody),
	});
	const signIn = await expectStatus({
		probe: 'auth-sign-in',
		expected: 200,
		origin,
		path: '/api/auth/sign-in/email',
		fetchRequest,
		signal,
		init: jsonRequest(signInBody, { origin }),
	});
	const cookie = sessionCookie(signIn);
	if (!cookie) {
		throw new WorkerSmokeFailure('auth-sign-in', 'session-cookie-missing', {
			expected: 'session cookie',
			actual: 'none',
		});
	}
	sensitiveValues.push(cookie);
	await expectStatus({
		probe: 'authenticated-api',
		expected: 200,
		origin,
		path: '/api/events',
		fetchRequest,
		signal,
		init: { headers: { cookie } },
	});

	const event = await expectJson({
		probe: 'event-persistence',
		expected: 201,
		origin,
		path: '/api/events',
		fetchRequest,
		signal,
		init: jsonRequest({
			name: 'Built Worker smoke Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
		}, { cookie }),
	});
	if (!Number.isInteger(event?.id))
		throwShapeFailure('event-persistence', 'numeric Event identity');

	const meleeClientSecret = randomBytes(24).toString('base64url');
	sensitiveValues.push(meleeClientSecret);
	const melee = await expectJson({
		probe: 'melee-configuration',
		expected: 200,
		origin,
		path: `/api/events/${event.id}/melee-config`,
		fetchRequest,
		signal,
		init: { ...jsonRequest({
			meleeEnabled: false,
			meleeEventId: 'worker-smoke-event',
			meleeClientId: 'worker-smoke-client',
			meleeClientSecret,
		}, { cookie }), method: 'PUT' },
	});
	assertMeleeRedaction(melee, meleeClientSecret, 'melee-configuration');
	const reread = await expectJson({
		probe: 'melee-configuration-read',
		expected: 200,
		origin,
		path: `/api/events/${event.id}`,
		fetchRequest,
		signal,
		init: { headers: { cookie } },
	});
	assertMeleeRedaction(reread, meleeClientSecret, 'melee-configuration-read');

	await publishStillImage({
		format: 'png',
		bytes: PIXEL_PNG,
		mime: 'image/png',
		fileName: 'worker-smoke.png',
		eventId: event.id,
		origin,
		cookie,
		fetchRequest,
		signal,
	});
	const jpeg = await publishStillImage({
		format: 'jpeg',
		bytes: PIXEL_JPEG,
		mime: 'image/jpeg',
		fileName: 'worker-smoke.jpg',
		eventId: event.id,
		origin,
		cookie,
		fetchRequest,
		signal,
	});
	await verifyJpegDelivery({
		...jpeg,
		bytes: PIXEL_JPEG,
		origin,
		cookie,
		fetchRequest,
		signal,
	});
}

function jsonRequest(body, headers = {}) {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	};
}

async function expectStatus({ probe, expected, origin, path, fetchRequest, signal, init = {} }) {
	let response;
	try {
		response = await fetchRequest(`${origin}${path}`, { redirect: 'manual', ...init, signal });
	}
	catch {
		throw new WorkerSmokeFailure(probe, 'request-failed', {
			expected: `status ${expected}`,
			actual: 'request failed',
		});
	}
	if (response.status !== expected) {
		throw new WorkerSmokeFailure(probe, 'unexpected-status', {
			expected,
			actual: response.status,
		});
	}
	return response;
}

async function expectJson(options) {
	const response = await expectStatus(options);
	try {
		return await response.json();
	}
	catch {
		throw new WorkerSmokeFailure(options.probe, 'invalid-json', {
			expected: 'JSON response',
			actual: 'unparseable body',
		});
	}
}

function sessionCookie(response) {
	const cookies = typeof response.headers.getSetCookie === 'function'
		? response.headers.getSetCookie()
		: [response.headers.get('set-cookie')].filter(Boolean);
	return cookies
		.map(value => value.split(';', 1)[0])
		.filter(value => value.includes('='))
		.join('; ');
}

function throwShapeFailure(probe, expected) {
	throw new WorkerSmokeFailure(probe, 'unexpected-body', {
		expected,
		actual: 'response shape did not match',
	});
}

function assertMeleeRedaction(value, secret, probe) {
	if (value?.meleeConfigured !== true)
		throwShapeFailure(probe, 'persisted Melee configuration');
	if (Object.hasOwn(value, 'meleeClientSecret') || JSON.stringify(value).includes(secret)) {
		throw new WorkerSmokeFailure(probe, 'secret-exposed', {
			expected: 'redacted client secret',
			actual: 'secret-bearing response',
		});
	}
}

async function publishStillImage({ format, bytes, mime, fileName, eventId, origin, cookie, fetchRequest, signal }) {
	const digest = createHash('sha256').update(bytes).digest('hex');
	// Digests identify retained content and are deliberately withheld from failure output.
	const operation = await expectJson({
		probe: `${format}-ingestion-initiation`,
		expected: 201,
		origin,
		path: '/api/graphics-assets/ingestion-operations',
		fetchRequest,
		signal,
		init: jsonRequest({
			source: 'local-upload',
			idempotencyKey: `worker-smoke-${format}-${randomUUID()}`,
			name: `Built Worker smoke ${format}`,
			sourceFileName: fileName,
			declaredMime: mime,
			browserDecodeEvidence: { outcome: 'decoded', sourceDigest: digest, width: 1, height: 1 },
			declaredByteLength: bytes.byteLength,
			defaultEventId: eventId,
			duplicateContentPolicy: 'create-separate',
		}, { cookie }),
	});
	if (typeof operation?.id !== 'string')
		throwShapeFailure(`${format}-ingestion-initiation`, 'Graphics Ingestion Operation identity');
	const completed = await expectJson({
		probe: `${format}-ingestion-publication`,
		expected: 200,
		origin,
		path: `/api/graphics-assets/ingestion-operations/${operation.id}/content`,
		fetchRequest,
		signal,
		init: { method: 'PUT', headers: { 'content-type': mime, cookie }, body: bytes },
	});
	if (completed?.stage !== 'completed'
		|| completed?.report?.outcome !== 'accepted'
		|| completed?.report?.facts?.canonicalMime !== mime
		|| completed?.result?.outcome !== 'published'
		|| typeof completed?.result?.assetId !== 'string'
		|| typeof completed?.result?.revisionId !== 'string') {
		throwShapeFailure(`${format}-ingestion-publication`, `published ${format} Graphic Asset Revision`);
	}
	return { assetId: completed.result.assetId, revisionId: completed.result.revisionId };
}

async function verifyJpegDelivery({ assetId, revisionId, bytes, origin, cookie, fetchRequest, signal }) {
	const path = `/api/graphics-assets/${assetId}/revisions/${revisionId}/content`;
	const complete = await expectStatus({
		probe: 'jpeg-full-delivery',
		expected: 200,
		origin,
		path,
		fetchRequest,
		signal,
		init: { headers: { cookie } },
	});
	const completeBytes = new Uint8Array(await complete.arrayBuffer());
	if (complete.headers.get('content-type') !== 'image/jpeg' || !sameBytes(completeBytes, bytes))
		throwShapeFailure('jpeg-full-delivery', 'exact JPEG bytes and image/jpeg');
	const range = await expectStatus({
		probe: 'jpeg-range-delivery',
		expected: 206,
		origin,
		path,
		fetchRequest,
		signal,
		init: { headers: { cookie, range: 'bytes=1-3' } },
	});
	const rangeBytes = new Uint8Array(await range.arrayBuffer());
	if (range.headers.get('content-range') !== `bytes 1-3/${bytes.byteLength}`
		|| !sameBytes(rangeBytes, bytes.slice(1, 4))) {
		throwShapeFailure('jpeg-range-delivery', 'exact bytes 1-3 with matching Content-Range');
	}
}

function sameBytes(actual, expected) {
	return actual.byteLength === expected.byteLength
		&& actual.every((byte, index) => byte === expected[index]);
}
