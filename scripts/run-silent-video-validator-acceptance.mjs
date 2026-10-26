import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	assertManifestTarget,
	DEFAULT_CLEANUP_MANIFEST,
	drainCleanupManifest,
	isSettledStatus,
	openCleanupManifest,
} from './graphics-acceptance/cleanup-manifest.mjs';
import { loadCommittedInstallation, resolveDeployedTarget, stagingBucketOf } from './graphics-acceptance/deployed-target.mjs';
import { AcceptanceFailure } from './graphics-acceptance/evidence.mjs';
import { runAcceptanceHarness } from './graphics-acceptance/harness.mjs';
import { openOperatorSession } from './graphics-acceptance/operator.mjs';
import { createWranglerCommands, RemoteCommandFailure } from './graphics-acceptance/validator-commands.mjs';

/**
 * Acceptance for the silent-video validation runtime.
 *
 * Local mode seeds the exact fixture revisions into local R2 state, runs the
 * validator Worker under `wrangler dev` with its real Workflow and Container,
 * and drives the production service-binding contract end to end, including a
 * deterministic metadata rejection.
 *
 * `--deployed` stages the same fixtures in the target installation's staging
 * bucket, triggers its `silent-video-validation` Workflow for each, and verifies
 * decode, playback, seeking, transparency, and the deterministic poster against
 * the exact staged revision before cleaning up (#619):
 *
 * 1. **Preflight, before anything is written.** The shared deployed target
 *    (`deployed-target.mjs`) resolves the URL, the operator, an explicit
 *    account, and the bucket and Workflow the installation that URL names
 *    binds. A cleanup manifest left by an earlier run stops it. The operator
 *    signs in, and the account is asked read-only whether it holds the bucket
 *    and the Workflow.
 * 2. **Every write is recorded first** in the cleanup manifest
 *    (`cleanup-manifest.mjs`), and deleted at the end whatever the verdict. A
 *    delete that fails leaves its key listed and fails the run.
 * 3. **Output is evidence only.** Pass and failure lines go through the shared
 *    formatter; a failure names its fixture, step and exit code, never a key,
 *    digest, validation id, Wrangler argument or remote diagnostic.
 *
 * `--deployed --cleanup` retries a left manifest's deletes against the same
 * target, and is safe to repeat.
 */

const HARNESS = 'silent-video-validator-v1';

const FIXTURE_NAMES = ['h264Mp4', 'vp9Webm', 'vp9AlphaWebm'];
const fixtures = JSON.parse(await readFile(
	new URL('./silent-video-validator-fixtures.json', import.meta.url),
	'utf8',
));

function sha256Hex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function validationInput(fixture, operationId) {
	const factsDigest = sha256Hex(Buffer.from(JSON.stringify(fixture.facts), 'utf8'));
	const idempotencyKey = [
		'silent-video-playback-v1',
		operationId,
		fixture.facts.sha256,
		factsDigest,
	].join(':');
	return {
		operationId,
		idempotencyKey,
		sourceDigest: fixture.facts.sha256,
		sourceByteLength: fixture.facts.byteLength,
		sourceContentType: fixture.facts.canonicalMime,
		factsDigest,
		inspectedFacts: fixture.facts,
	};
}

const sourceKey = operationId => `ingestion/${operationId}/source`;
const posterKey = validationId => `validation/silent-video/${validationId}/poster`;

/**
 * Run one adapter command, turning its failure into `code` with `detail` and
 * the exit code. The failure's own message is never read: it is the adapter's.
 */
async function remote(code, detail, action) {
	try {
		return await action();
	}
	catch (error) {
		if (error instanceof RemoteCommandFailure)
			throw new AcceptanceFailure(code, { ...detail, exit: error.exit ?? 'signal' });
		throw error;
	}
}

/** A fixture's command, named by the one-word step it was. */
function command(fixture, step, action) {
	return remote('validator-command-failed', { fixture, step }, action);
}

const operationIdFor = (suffix, name) => `acceptance-${suffix}-${name.toLowerCase()}`;

function stageFixture(commands, target, name, operationId) {
	return command(name, 'put', () => commands.putObject({
		target,
		key: sourceKey(operationId),
		bytes: Buffer.from(fixtures[name].base64, 'base64'),
		contentType: fixtures[name].facts.canonicalMime,
	}));
}

/**
 * The stage a local rejection names is the validator's response text, so only
 * a word of the shape the validator uses travels.
 */
function stageWord(stage) {
	return typeof stage === 'string' && /^[a-z][a-z-]{0,31}$/.test(stage)
		? stage
		: 'unrecognised';
}

/** The first field of a settled output that is not an exact acceptance of `input`. */
function inexactField(fixture, input, output) {
	if (output.outcome !== 'accepted')
		return 'outcome';
	if (output.idempotencyKey !== input.idempotencyKey)
		return 'idempotencyKey';
	if (output.mutedInlinePlayback !== true)
		return 'mutedInlinePlayback';
	if (output.seeked !== true)
		return 'seeked';
	if (fixture.facts.hasAlpha && output.transparencyRendered !== true)
		return 'transparencyRendered';
	if (typeof output.posterKey !== 'string' || typeof output.posterDigest !== 'string')
		return 'poster';
	return undefined;
}

function assertAccepted(fixture, input, headers, posterBytes, name) {
	const required = (header) => {
		const value = headers.get(header);
		if (!value)
			throw new AcceptanceFailure('validator-output-unexpected', { fixture: name, field: 'header-missing' });
		return value;
	};
	const unexpected = field => new AcceptanceFailure('validator-output-unexpected', { fixture: name, field });
	if (required('x-stream-keepr-operation-id') !== input.operationId
		|| required('x-stream-keepr-idempotency-key') !== input.idempotencyKey
		|| required('x-stream-keepr-source-digest') !== input.sourceDigest
		|| required('x-stream-keepr-facts-digest') !== input.factsDigest) {
		throw unexpected('binding');
	}
	if (required('x-stream-keepr-muted-inline-playback') !== 'true')
		throw unexpected('mutedInlinePlayback');
	if (required('x-stream-keepr-seeked') !== 'true')
		throw unexpected('seeked');
	if (fixture.facts.hasAlpha && required('x-stream-keepr-transparency-rendered') !== 'true')
		throw unexpected('transparencyRendered');
	if (Number(required('x-stream-keepr-video-width')) !== fixture.facts.width
		|| Number(required('x-stream-keepr-video-height')) !== fixture.facts.height) {
		throw unexpected('dimensions');
	}
	if (Math.abs(Number(required('x-stream-keepr-video-duration')) - fixture.facts.durationSeconds) > 0.05)
		throw unexpected('duration');
	if (Math.abs(Number(required('x-stream-keepr-poster-time')) - fixture.facts.posterTimeSeconds) > 0.001)
		throw unexpected('posterTime');
	if (sha256Hex(posterBytes) !== required('x-stream-keepr-poster-digest'))
		throw new AcceptanceFailure('validator-poster-mismatch', { fixture: name });
	if (posterBytes.length <= 0 || posterBytes.length > 2 * 1024 * 1024)
		throw unexpected('posterLength');
}

async function driveServiceBinding(baseUrl, fixture, operationId, name) {
	const input = validationInput(fixture, operationId);
	for (let attempt = 1; attempt <= 60; attempt++) {
		const response = await fetch(`${baseUrl}/validate`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': input.idempotencyKey,
			},
			body: JSON.stringify(input),
		});
		if (response.status === 429 || response.status >= 500) {
			await response.arrayBuffer();
			await new Promise(resolve => setTimeout(resolve, 3000));
			continue;
		}
		if (response.status === 422) {
			const body = await response.json();
			return {
				outcome: 'rejected',
				stage: stageWord(body?.stage),
				input,
			};
		}
		if (!response.ok)
			throw new AcceptanceFailure('validator-settled-unsuccessfully', { fixture: name, status: response.status });
		const posterBytes = Buffer.from(await response.arrayBuffer());
		assertAccepted(fixture, input, response.headers, posterBytes, name);
		return { outcome: 'accepted', input };
	}
	throw new AcceptanceFailure('validator-did-not-settle', { fixture: name });
}

/** `wrangler dev` for the validator, ready to serve, or a named failure. */
function startLocalValidator({ validatorConfigPath, persistTo, port, repoRoot }) {
	const dev = spawn('npx', [
		'wrangler',
		'dev',
		'--config',
		validatorConfigPath,
		'--persist-to',
		persistTo,
		'--port',
		String(port),
	], {
		cwd: repoRoot,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const ready = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new AcceptanceFailure('validator-runtime-unavailable', { reason: 'not-ready-is-docker-running' })),
			300_000,
		);
		let output = '';
		const watch = (chunk) => {
			output += chunk;
			if (output.includes('Ready on')) {
				clearTimeout(timeout);
				resolve();
			}
		};
		dev.stdout.setEncoding('utf8').on('data', watch);
		dev.stderr.setEncoding('utf8').on('data', watch);
		dev.once('exit', (code) => {
			clearTimeout(timeout);
			reject(new AcceptanceFailure('validator-runtime-unavailable', { exit: code ?? 'signal' }));
		});
	});
	return {
		ready,
		async stop() {
			dev.kill('SIGTERM');
			await new Promise(resolve => setTimeout(resolve, 2000));
			dev.kill('SIGKILL');
		},
	};
}

async function runLocalAcceptance({ record }, { commands, installation, repoRoot, startValidator }) {
	const persistTo = await mkdtemp(join(tmpdir(), 'silent-video-validator-state-'));
	const target = {
		local: persistTo,
		stagingBucket: stagingBucketOf(installation.validator),
		validatorConfigPath: installation.validatorConfigPath,
	};
	const port = 8987;
	const suffix = Date.now().toString(36);
	const plan = FIXTURE_NAMES.map(name => [
		name,
		operationIdFor(suffix, name),
	]);
	// The tampered case declares WebM facts against staged MP4 bytes.
	const tamperedOperation = `acceptance-${suffix}-tampered`;
	let validator;
	try {
		for (const [name, operationId] of [
			...plan,
			['h264Mp4', tamperedOperation],
		])
			await stageFixture(commands, target, name, operationId);
		validator = startValidator({
			validatorConfigPath: target.validatorConfigPath,
			persistTo,
			port,
			repoRoot,
		});
		await validator.ready;
		const baseUrl = `http://127.0.0.1:${port}`;
		for (const [name, operationId] of plan) {
			const result = await driveServiceBinding(baseUrl, fixtures[name], operationId, name);
			if (result.outcome !== 'accepted')
				throw new AcceptanceFailure('validator-settled-unsuccessfully', { fixture: name, stage: result.stage });
			record([]);
		}
		const tampered = await driveServiceBinding(baseUrl, fixtures.vp9Webm, tamperedOperation, 'tampered');
		if (tampered.outcome !== 'rejected' || tampered.stage !== 'metadata')
			throw new AcceptanceFailure('validator-tamper-not-rejected', { outcome: tampered.outcome, stage: tampered.stage ?? 'none' });
		record([]);
		return { mode: 'local', fixtures: plan.length, tampered: 'rejected' };
	}
	finally {
		await validator?.stop();
		await rm(persistTo, { recursive: true, force: true });
	}
}

/** Everything a deployed run checks before its first write. */
async function preflightDeployed({ evidence }, { env, installation, manifest, commands, openSession }) {
	const target = resolveDeployedTarget({ env, installation });
	evidence.addSecret(target.accountId);
	const left = await manifest.read();
	if (left) {
		process.stderr.write('An earlier deployed run could not delete everything it staged. Run '
			+ '`pnpm accept silent-video-validator --deployed --cleanup` with the same target first.\n');
		throw new AcceptanceFailure('harness-cleanup-pending', { remaining: left.objects?.length ?? 0 });
	}
	// Read-only probes before the sign-in, because a bootstrapping sign-in
	// creates or resets an account and is itself a write.
	await remote('harness-target-unverified', { step: 'bucket' }, () => commands.probeBucket({ target }));
	await remote('harness-target-unverified', { step: 'workflow' }, () => commands.probeWorkflow({ target }));
	for (const cookie of await openSession(target.origin))
		evidence.addSecret(cookie);
	return target;
}

async function runDeployedFixture({ commands, manifest, target, pollIntervalMs }, name, suffix) {
	const fixture = fixtures[name];
	const operationId = operationIdFor(suffix, name);
	const input = validationInput(fixture, operationId);
	const validationId = sha256Hex(Buffer.from(input.idempotencyKey, 'utf8'));

	await manifest.record(sourceKey(operationId));
	await stageFixture(commands, target, name, operationId);
	// The Workflow writes its poster under this key, so it is listed before the
	// Workflow can write it, and stays listed until the instance has settled.
	await manifest.record(posterKey(validationId), { instance: validationId });
	await command(name, 'trigger', () => commands.triggerWorkflow({ target, id: validationId, params: input }));

	let output;
	for (let attempt = 1; attempt <= 120 && !output; attempt++) {
		const { status, output: settled } = await command(name, 'describe', () =>
			commands.describeInstance({ target, id: validationId }));
		if (isSettledStatus(status))
			await manifest.settle(posterKey(validationId));
		if (status.includes('Complete')) {
			if (!settled || typeof settled !== 'object')
				throw new AcceptanceFailure('validator-output-unexpected', { fixture: name, field: 'output' });
			output = settled;
		}
		else if (status.includes('Errored') || status.includes('Terminated')) {
			throw new AcceptanceFailure('validator-settled-unsuccessfully', {
				fixture: name,
				status: status.includes('Errored')
					? 'errored'
					: 'terminated',
			});
		}
		else {
			await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
		}
	}
	if (!output)
		throw new AcceptanceFailure('validator-did-not-settle', { fixture: name });
	const field = inexactField(fixture, input, output);
	if (field)
		throw new AcceptanceFailure('validator-output-unexpected', { fixture: name, field });
	if (output.posterKey !== posterKey(validationId))
		throw new AcceptanceFailure('validator-output-unexpected', { fixture: name, field: 'posterKey' });

	const posterBytes = await command(name, 'get', () => commands.getObject({ target, key: output.posterKey }));
	if (!posterBytes || sha256Hex(posterBytes) !== output.posterDigest)
		throw new AcceptanceFailure('validator-poster-mismatch', { fixture: name });
}

async function runDeployedAcceptance(context, dependencies) {
	const target = await preflightDeployed(context, dependencies);
	const { manifest, commands } = dependencies;
	const suffix = Date.now().toString(36);

	manifest.begin(target);
	let cleaned = 0;
	try {
		for (const name of FIXTURE_NAMES) {
			await runDeployedFixture({ ...dependencies, target }, name, suffix);
			context.record([]);
		}
	}
	finally {
		const drained = await drainCleanupManifest({ manifest, commands, target });
		cleaned = drained.cleaned;
		if (drained.remaining > 0) {
			process.stderr.write('Some staged objects could not be deleted, or a Workflow had not settled; they are '
				+ 'listed in the cleanup manifest. Retry with `pnpm accept silent-video-validator --deployed --cleanup`.\n');
			context.record([
				{
					code: 'harness-cleanup-incomplete',
					detail: { remaining: drained.remaining },
				},
			]);
		}
	}
	return { fixtures: FIXTURE_NAMES.length, cleaned };
}

async function runDeployedCleanup(context, { env, installation, manifest, commands }) {
	const target = resolveDeployedTarget({ env, installation, requireOperator: false });
	context.evidence.addSecret(target.accountId);
	const left = await manifest.read();
	if (!left) {
		context.record([]);
		return { cleaned: 0 };
	}
	assertManifestTarget(left, target);
	manifest.resume(left);
	const { cleaned, remaining } = await drainCleanupManifest({ manifest, commands, target });
	context.record(remaining > 0
		? [
				{
					code: 'harness-cleanup-incomplete',
					detail: { remaining },
				},
			]
		: []);
	return { cleaned };
}

/** Stands in for any dependency a caller did not inject, so an imported `main` cannot reach Wrangler. */
const NOT_INJECTED = new Proxy({}, {
	get: (_, name) => () => {
		throw new Error(`run-silent-video-validator-acceptance: ${String(name)} was not injected`);
	},
});

/**
 * @param {string[]} [argv]
 * @param {{
 *   commands?: ReturnType<typeof createWranglerCommands>,
 *   env?: Record<string, string | undefined>,
 *   installation?: Awaited<ReturnType<typeof loadCommittedInstallation>>,
 *   manifestPath?: string,
 *   openSession?: (origin: string) => Promise<string[]>,
 *   startValidator?: typeof startLocalValidator,
 *   pollIntervalMs?: number,
 * }} [options]
 * Only the CLI entry point below passes the real Wrangler commands and session;
 * an imported `main` without them fails at its first command instead.
 */
export async function main(argv = process.argv, options = {}) {
	const deployed = argv.includes('--deployed');
	const cleanup = argv.includes('--cleanup');
	await runAcceptanceHarness({
		harness: HARNESS,
		async run(context) {
			if (cleanup && !deployed)
				throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'cleanup-needs-deployed' });
			const dependencies = {
				commands: options.commands ?? NOT_INJECTED,
				env: options.env ?? process.env,
				installation: options.installation ?? await loadCommittedInstallation(),
				manifest: openCleanupManifest(options.manifestPath ?? DEFAULT_CLEANUP_MANIFEST),
				openSession: options.openSession ?? NOT_INJECTED.openSession,
				startValidator: options.startValidator ?? NOT_INJECTED.startValidator,
				pollIntervalMs: options.pollIntervalMs ?? 5000,
				repoRoot: fileURLToPath(new URL('..', import.meta.url)),
			};
			if (!deployed)
				return await runLocalAcceptance(context, dependencies);
			return cleanup
				? await runDeployedCleanup(context, dependencies)
				: await runDeployedAcceptance(context, dependencies);
		},
	});
}

if (import.meta.main) {
	const repoRoot = fileURLToPath(new URL('..', import.meta.url));
	await main(process.argv, {
		commands: createWranglerCommands({ repoRoot }),
		openSession: origin => openOperatorSession(origin, { deployed: true }),
		startValidator: startLocalValidator,
	});
}
